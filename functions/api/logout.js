// POST /api/logout → ends this session (the cookie is cleared even if it was already invalid)
import { dropSession, setCookie, flagCookie, json, sameOrigin, audit } from '../../server/auth.js';

export async function onRequestPost({ request, env, data }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  await dropSession(env, request);
  if (data && data.user) await audit(env, request, data.user.username, 'logout');
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', setCookie(request, '', 0)); h.append('Set-Cookie', flagCookie(request, false));
  return new Response('{"ok":true}', { headers: h });
}
