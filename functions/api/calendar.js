// GET /api/calendar → {at (ms, when the feed was read), src, stale?, events: [{t, ccy, name, impact, fc, prev, holiday}]}:
// the week's real economic calendar (server/calendar.js)
import { json } from '../../server/auth.js';
import { calendar } from '../../server/calendar.js';

export async function onRequestGet() {
  try {
    return json(await calendar(), 200, { 'Cache-Control': 'private, max-age=300' });
  } catch (e) {
    return json({ error: e.message || 'Calendar unavailable' }, 502);
  }
}
