// GET /api/stream (WebSocket) → the live quote stream of host/relay.mjs, for signed-in users of this site only
import { json, sameOrigin } from '../../server/auth.js';

export function onRequestGet({ request, env }) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ error: 'Expected a WebSocket' }, 426);
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  if (!env.RELAY) return json({ error: 'The live stream is not configured on this server' }, 503);
  return env.RELAY.get(env.RELAY.idFromName('quotes')).fetch(request);
}
