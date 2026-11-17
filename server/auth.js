/* tradeBerry server: accounts and sessions on D1 (env.DB). Shared by functions/_middleware.js and functions/api/*.
   Passwords: PBKDF2-SHA256 (the Workers maximum of 100,000 iterations), 16-byte salt; the same parameters as
   tools/tb-user.mjs, which creates the accounts. Sessions: a random 32-byte token in an HttpOnly cookie; only its
   SHA-256 is stored. Failed logins are counted per username and per address: 10 in 15 minutes locks that key.
   A session lasts until the browser closes (a cookie without Max-Age; Victor, 31.10.2026: sign in at every launch),
   and the server ends it after SESSION_H hours whatever the browser keeps. */
export const ITER = 100000, SESSION_H = 12, FAIL_MAX = 10, FAIL_WINDOW = 15 * 60;
export const USER_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
// the modules an administrator grants per user (users.modules); Trade and Monitor are open to everyone
export const MODULES = ['research', 'lab', 'coach'];
export const modulesOf = v => String(v || '').split(',').filter(m => MODULES.includes(m));
const enc = new TextEncoder();
export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
export const now = () => Math.floor(Date.now() / 1000);

export async function pbkdf2(password, saltHex, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: iter }, key, 256));
}
// constant-time comparison of two hex strings of the same length
export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

// cookie: __Host- prefix (Secure, Path=/, no Domain) on HTTPS; a plain name on http://localhost for local runs
export function cookieName(req) { return new URL(req.url).protocol === 'https:' ? '__Host-tb_s' : 'tb_s'; }
export function readCookie(req) {
  const name = cookieName(req), raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
}
// maxAge null: a browser-session cookie (gone when the browser closes); 0 clears it
export function setCookie(req, token, maxAge) {
  const secure = new URL(req.url).protocol === 'https:';
  return `${cookieName(req)}=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge == null ? '' : `; Max-Age=${maxAge}`}${secure ? '; Secure' : ''}`;
}

// the signed-in user for this request, or null
// a readable flag (no secret in it): the page is served with the account server; cleared at sign-out
export function flagCookie(req, on) {
  const secure = new URL(req.url).protocol === 'https:';
  return `tb_u=${on ? 1 : ''}; Path=/; SameSite=Lax${on ? '' : '; Max-Age=0'}${secure ? '; Secure' : ''}`;
}
export async function sessionUser(env, req) {
  const tok = readCookie(req);
  if (!tok || !/^[0-9a-f]{64}$/.test(tok)) return null;
  const row = await env.DB.prepare('SELECT u.id, u.username, u.shared, u.admin, u.modules FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0')
    .bind(await sha256(tok), now()).first();
  return row ? { id: row.id, username: row.username, shared: !!row.shared, admin: !!row.admin, modules: modulesOf(row.modules) } : null;
}
export async function newSession(env, userId) {
  const tok = hex(crypto.getRandomValues(new Uint8Array(32))), t = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(t),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(tok), userId, t, t + SESSION_H * 3600)
  ]);
  return tok;
}
export async function dropSession(env, req) {
  const tok = readCookie(req);
  if (tok && /^[0-9a-f]{64}$/.test(tok)) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(tok)).run();
}

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
// state-changing requests come from this site's own pages: same Origin (or none, e.g. curl), JSON body
export function sameOrigin(req) {
  const o = req.headers.get('Origin');
  return !o || o === new URL(req.url).origin;
}

/* One active device per account: each device runs its own simulated market, so two at once would trade the same
   account apart. The device that holds the lease saves; any other one may take it over ("Use it here"). */
export const LEASE_S = 120, DEVICE_RE = /^[a-z0-9]{12,40}$/;
export const deviceOf = req => { const d = req.headers.get('X-TB-Device') || ''; return DEVICE_RE.test(d) ? d : null; };
export async function lease(env, uid, device, take, shared) {
  // a shared account has no single portfolio to protect: every device runs its own
  if (shared) return { ok: true };
  // one statement: granted only if free, expired, already this device's, or taken over on purpose
  const t = now();
  const r = await env.DB.prepare('INSERT INTO lease (user_id, device, since, until) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET since = CASE WHEN lease.device = excluded.device THEN lease.since ELSE excluded.since END, device = excluded.device, until = excluded.until WHERE lease.device = excluded.device OR lease.until <= ? OR ?')
    .bind(uid, device, t, t + LEASE_S, t, take ? 1 : 0).run();
  if (r.meta.changes === 1) return { ok: true };
  const row = await env.DB.prepare('SELECT since FROM lease WHERE user_id = ?').bind(uid).first();
  return { ok: false, since: row ? row.since : t };
}

/* Where a portfolio is kept: one row per user in `state`, or, for a shared account, one row per user and device in
   `dstate` (the same columns plus device). */
export function slot(user, device) {
  return user.shared
    ? { table: 'dstate', where: 'user_id = ? AND device = ?', keys: [user.id, device], cols: 'user_id, device', marks: '?, ?', conflict: '(user_id, device)' }
    : { table: 'state', where: 'user_id = ?', keys: [user.id], cols: 'user_id', marks: '?', conflict: '(user_id)' };
}

/* Security log (migrations/0011_audit_log.sql, security audit 09.11.2026, F08): one append-only row per sign-in, sign-out
   and administrator action. auditStmt gives the statement, for a caller's batch; audit runs it alone and never throws
   (a full disk must not turn a sign-in into an error page; the console says it). */
const cut = (v, n) => (v == null ? null : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n));
export const clientIp = req => cut(req.headers.get('CF-Connecting-IP') || 'local', 64);
export const auditStmt = (env, req, actor, action, target = null, ok = true, detail = null) =>
  env.DB.prepare('INSERT INTO audit_log (at, actor, ip, action, target, ok, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(now(), cut(actor || '-', 64), clientIp(req), cut(action, 40), cut(target, 64), ok ? 1 : 0, cut(detail, 200));
export async function audit(env, req, actor, action, target, ok, detail) {
  try { await auditStmt(env, req, actor, action, target, ok, detail).run(); }
  catch (e) { console.error(new Date().toISOString(), 'audit: not written (' + (e && e.message) + ')'); }
}
