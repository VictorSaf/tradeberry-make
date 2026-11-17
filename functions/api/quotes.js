// GET /api/quotes → {at (ms, when the platform answered), q: [[sym, bid, ask, tMs], …]}: the broker platform's live quotes
import { json } from '../../server/auth.js';
import { quotes } from '../../server/legacy.js';

export async function onRequestGet({ env }) {
  try {
    const { at, q } = await quotes(env);
    return json({ at, q });
  } catch (e) {
    return json({ error: e.message || 'Live prices unavailable' }, e.status || 502);
  }
}
