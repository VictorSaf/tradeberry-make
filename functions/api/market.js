// PUT /api/market {market} → the simulated market snapshot alone; last writer wins (it is the environment, not the account)
import { json, now, sameOrigin, deviceOf, slot } from '../../server/auth.js';

const MAX_BYTES = 200000;

export async function onRequestPut({ request, env, data }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  const device = deviceOf(request); if (!device) return json({ error: 'Missing device id' }, 400);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: 'Market snapshot too large' }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'Not JSON' }, 400); }
  if (!body || typeof body.market !== 'object' || body.market === null || Array.isArray(body.market)) return json({ error: 'Expected {market}' }, 400);
  const s = slot(data.user, device);
  await env.DB.prepare(`INSERT INTO ${s.table} (${s.cols}, rev, data, market, saved_at) VALUES (${s.marks}, 0, 'null', ?, ?) ON CONFLICT${s.conflict} DO UPDATE SET market = excluded.market`)
    .bind(...s.keys, JSON.stringify(body.market), now()).run();
  return json({ ok: true });
}
