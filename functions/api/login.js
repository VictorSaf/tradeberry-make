// POST /api/login {username, password} → 200 + session cookie | 401 wrong | 429 locked | 400 malformed
// Every attempt is recorded before the password is checked (parallel requests cannot slip past the count), and
// removed again when it succeeds. An address is blocked after 10 failures in 15 minutes; a username only after 50,
// so nobody can keep a tester locked out with a handful of wrong guesses.
import { ITER, FAIL_WINDOW, USER_RE, pbkdf2, same, now, newSession, setCookie, json, sameOrigin, audit } from '../../server/auth.js';

const IP_MAX = 10, USER_MAX = 50;
// a fixed salt, so an unknown username costs the same PBKDF2 time as a known one
const DUMMY_SALT = '00112233445566778899aabbccddeeff';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'Send username and password' }, 400); }
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password || username.length > 32 || password.length > 256) return json({ error: 'Wrong username or password' }, 401);
  const ip = request.headers.get('CF-Connecting-IP') || 'local', t = now(), since = t - FAIL_WINDOW;
  const ku = 'u:' + username, ki = 'ip:' + ip;
  const [, , ii, cnt] = await env.DB.batch([
    env.DB.prepare('DELETE FROM login_fail WHERE at <= ?').bind(since),
    env.DB.prepare('INSERT INTO login_fail (k, at) VALUES (?, ?)').bind(ku, t),
    env.DB.prepare('INSERT INTO login_fail (k, at) VALUES (?, ?) RETURNING rowid AS id').bind(ki, t),
    env.DB.prepare('SELECT k, COUNT(*) AS n FROM login_fail WHERE k IN (?, ?) AND at > ? GROUP BY k').bind(ku, ki, since)
  ]);
  const n = k => ((cnt.results || []).find(r => r.k === k) || { n: 0 }).n;
  if (n(ki) > IP_MAX || n(ku) > USER_MAX) { await audit(env, request, username, 'login.locked', null, false, n(ki) > IP_MAX ? 'address' : 'username'); return json({ error: 'Too many failed attempts. Wait 15 minutes and try again.' }, 429); }
  const user = USER_RE.test(username) ? await env.DB.prepare('SELECT id, salt, hash, iter, disabled FROM users WHERE username = ?').bind(username).first() : null;
  const got = await pbkdf2(password, user ? user.salt : DUMMY_SALT, user ? user.iter : ITER);
  if (!user || user.disabled || !same(got, user.hash)) { await audit(env, request, username, 'login.fail', null, false, !user ? 'no such user' : user.disabled ? 'disabled' : 'wrong password'); return json({ error: 'Wrong username or password' }, 401); }
  // success: this attempt does not count, and the username starts afresh
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_fail WHERE k = ?').bind(ku),
    env.DB.prepare('DELETE FROM login_fail WHERE rowid = ?').bind(ii.results[0].id)
  ]);
  const tok = await newSession(env, user.id);
  await audit(env, request, username, 'login.ok');
  // the log keeps 400 days (a sign-in is rare enough to prune here)
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(t - 400 * 86400).run();
  return json({ username }, 200, { 'Set-Cookie': setCookie(request, tok, null) }); // until the browser closes
}
