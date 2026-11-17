// /api/admin — account management for administrators (users.admin = 1), from the app's Administration screen.
// GET  → { users: [{ username, shared, admin, modules, disabled, created, saved, saves, sessions, device }] }
// GET ?journal=<username>&before=&limit= → that client's complete journal, newest first (server/journal.js)
// POST { op, username, password?, shared?, modules? } → { ok } | 400 bad request | 403 not an administrator / cross-site
//   op: create · passwd · disable · enable · logout · admin · unadmin · reset (erase the saved state) · delete
//   · modules (modules: the list from server/auth.js MODULES the user may open; read by the app at its next load)
// active ("on a device now"): the execution gateway has an open WebSocket of the user, written by it in gw_live within
//   the last 90 s (host/gateway/db.mjs setLive); nothing written → false, never a guess.
// delete: the user's broker accounts are archived, not erased: their gw_accounts rows are closed (closed_at) and kept
//   with the broker's data, the gateway stops mapping them (host/gateway/db.mjs accountOpen / account), and a new user
//   who gets the same users.id gets a new account id (migrations/0009_gw_accounts_owner.sql). Positions still open
//   there stay at the broker as they were (its stops and stop-out keep running); nobody can trade them any more.
// The password is hashed here (PBKDF2-SHA256, 100,000 iterations, 16-byte salt, as tools/tb-user.mjs) and never
// stored or returned in clear. An administrator cannot disable, delete or demote their own account.
import { ITER, USER_RE, MODULES, modulesOf, pbkdf2, hex, now, json, sameOrigin, audit } from '../../server/auth.js';
import { journal } from '../../server/journal.js';

const PW_MIN = 8, PW_MAX = 256;
const deny = () => json({ error: 'Administrators only' }, 403);
const AUDIT_ROWS = 100;

export async function onRequestGet({ request, env, data }) {
  if (!data.user.admin) return deny();
  // ?journal=<username>[&before=<s>&limit=<n>] → that client's complete journal (server/journal.js), read only
  const q = request ? new URL(request.url).searchParams : null;
  if (q && q.has('journal')) {
    const who = (q.get('journal') || '').toLowerCase();
    if (!USER_RE.test(who)) return json({ error: 'Bad username' }, 400);
    const j = await journal(env, who, { before: q.get('before'), limit: q.get('limit') });
    return j ? json(j) : json({ error: 'No such user' }, 404);
  }
  const t = now();
  const r = await env.DB.prepare(`SELECT u.username, u.shared, u.admin, u.modules, u.disabled, u.created_at,
      (SELECT saved_at FROM state s WHERE s.user_id = u.id) AS saved, (SELECT rev FROM state s WHERE s.user_id = u.id) AS saves,
      (SELECT COUNT(*) FROM dstate d WHERE d.user_id = u.id) AS devices,
      (SELECT COUNT(*) FROM sessions x WHERE x.user_id = u.id AND x.expires_at > ?) AS sessions,
      (SELECT COALESCE(SUM(n), 0) FROM gw_live g WHERE g.user_id = u.id AND g.at > ?) AS live
    FROM users u ORDER BY u.username`).bind(t, t - 90).all();
  const log = await env.DB.prepare('SELECT at, actor, ip, action, target, ok, detail FROM audit_log ORDER BY id DESC LIMIT ?').bind(AUDIT_ROWS).all();
  return json({ audit: (log.results || []).map(r => ({ ...r, ok: !!r.ok })), me: data.user.username, users: (r.results || []).map(u => ({ username: u.username, shared: !!u.shared, admin: !!u.admin, modules: modulesOf(u.modules), disabled: !!u.disabled,
    created: u.created_at, saved: u.saved || null, saves: u.saves || 0, devices: u.devices || 0, sessions: u.sessions || 0, active: u.live > 0 })) });
}

export async function onRequestPost(ctx) {
  const { request, env, data } = ctx;
  if (!data.user.admin) { await audit(env, request, data.user.username, 'admin.denied', null, false); return deny(); }
  // every answer is logged with the operation, the account it was for and whether it was done (F08)
  const res = await post(ctx), j = await res.clone().json().catch(() => ({}));
  await audit(env, request, data.user.username, 'admin.' + String(ctx.op || 'unknown').slice(0, 20), ctx.target || null, res.ok, res.ok ? null : j.error);
  return res;
}
async function post(ctx) {
  const { request, env, data } = ctx;
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Send JSON' }, 400); }
  const op = String(b.op || ''), username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
  ctx.op = op; ctx.target = username || null;
  if (!USER_RE.test(username)) return json({ error: 'Username: 2–32 characters, lowercase letters, digits, . _ -' }, 400);
  const self = username === data.user.username;
  const pwOk = p => typeof p === 'string' && p.length >= PW_MIN && p.length <= PW_MAX;
  const hashOf = async p => { const salt = hex(crypto.getRandomValues(new Uint8Array(16))); return { salt, hash: await pbkdf2(p, salt, ITER) }; };
  const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (op === 'create') {
    if (user) return json({ error: `${username} already exists` }, 400);
    if (!pwOk(b.password)) return json({ error: `Password: ${PW_MIN}–${PW_MAX} characters` }, 400);
    const { salt, hash } = await hashOf(b.password);
    await env.DB.prepare('INSERT INTO users (username, salt, hash, iter, created_at, shared) VALUES (?, ?, ?, ?, ?, ?)').bind(username, salt, hash, ITER, now(), b.shared ? 1 : 0).run();
    return json({ ok: true });
  }
  if (!user) return json({ error: `No user ${username}` }, 400);
  const ends = env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id);
  if ((op === 'disable' || op === 'delete' || op === 'unadmin') && self) return json({ error: 'Not on your own account' }, 400);
  switch (op) {
    case 'passwd': {
      if (!pwOk(b.password)) return json({ error: `Password: ${PW_MIN}–${PW_MAX} characters` }, 400);
      const { salt, hash } = await hashOf(b.password);
      // a new password signs the user out everywhere (this browser too, when it is the administrator's own)
      await env.DB.batch([env.DB.prepare('UPDATE users SET salt = ?, hash = ?, iter = ? WHERE id = ?').bind(salt, hash, ITER, user.id), ends]);
      break;
    }
    case 'disable': await env.DB.batch([env.DB.prepare('UPDATE users SET disabled = 1 WHERE id = ?').bind(user.id), ends]); break;
    case 'enable': await env.DB.prepare('UPDATE users SET disabled = 0 WHERE id = ?').bind(user.id).run(); break;
    case 'logout': await ends.run(); break;
    case 'admin': await env.DB.prepare('UPDATE users SET admin = 1 WHERE id = ?').bind(user.id).run(); break;
    case 'unadmin': await env.DB.prepare('UPDATE users SET admin = 0 WHERE id = ?').bind(user.id).run(); break;
    case 'modules': {
      if (!Array.isArray(b.modules) || b.modules.some(m => !MODULES.includes(m))) return json({ error: `Modules: a list of ${MODULES.join(', ')}` }, 400);
      await env.DB.prepare('UPDATE users SET modules = ? WHERE id = ?').bind(MODULES.filter(m => b.modules.includes(m)).join(','), user.id).run();
      break;
    }
    case 'reset': await env.DB.batch([env.DB.prepare('DELETE FROM state WHERE user_id = ?').bind(user.id), env.DB.prepare('DELETE FROM dstate WHERE user_id = ?').bind(user.id)]); break;
    case 'delete': await env.DB.batch([
      env.DB.prepare('UPDATE gw_accounts SET closed_at = ? WHERE user_id = ? AND closed_at IS NULL').bind(now(), user.id),
      env.DB.prepare('DELETE FROM gw_live WHERE user_id = ?').bind(user.id)
    ].concat(['dstate', 'lease', 'state', 'sessions'].map(tb => env.DB.prepare(`DELETE FROM ${tb} WHERE user_id = ?`).bind(user.id)), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id))); break; // as tools/tb-user.mjs: D1 does not cascade
    default: return json({ error: 'Unknown operation' }, 400);
  }
  return json({ ok: true });
}
