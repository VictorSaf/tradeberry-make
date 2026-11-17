// GET /api/trade (WebSocket) → the execution gateway (host/gateway.mjs), for signed-in users of this site only. The
// server (host/server.mjs, env.GATEWAY) forwards the upgrade to the gateway with the user and the browser's device id.
// The device id comes in X-TB-Device or, since a browser cannot set headers on a WebSocket, in ?device=; a shared
// login needs it (one portfolio per browser).
import { json, sameOrigin, DEVICE_RE } from '../../server/auth.js';

export function onRequestGet({ request, env, data }) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ error: 'Expected a WebSocket' }, 426);
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  if (!env.GATEWAY) return json({ error: 'Execution is not configured on this server' }, 503);
  const d = request.headers.get('X-TB-Device') || new URL(request.url).searchParams.get('device') || '', device = DEVICE_RE.test(d) ? d : '';
  if (data.user.shared && !device) return json({ error: 'Missing device id' }, 400);
  return env.GATEWAY.open(data.user.id, data.user.shared ? device : '');
}
