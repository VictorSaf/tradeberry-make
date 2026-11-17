// GET /api/history?sym=EURUSD&days=7 → one instrument's 1-minute bars from the broker platform (packed: server/legacy.js),
// up to 98 days (the platform keeps about 9 months); &res=60&days=90 → its 1-hour bars, up to 1,600 days (the platform's
// 1-hour history starts in 2022-2023)
// &before=<sec>&res=1|60 → the aligned window (7 days of 1-minute bars, 365 days of 1-hour bars) holding the second before
// `before`: { …packed, from, to, more } (server/legacy.js historyWindow); &p=bg queues it behind the startup load
import { json } from '../../server/auth.js';
import { history, historyWindow, SYM_RE } from '../../server/legacy.js';

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), sym = u.searchParams.get('sym') || '', res = u.searchParams.get('res') === '60' ? 60 : 1;
  const days = Math.min(res === 60 ? 1600 : 98, Math.max(1, Math.round(+u.searchParams.get('days') || 7)));
  if (!SYM_RE.test(sym)) return json({ error: 'Bad instrument' }, 400);
  if (!env.LEGACY_API_KEY) return json({ error: 'Live prices are not configured on this server' }, 503);
  const b = u.searchParams.get('before');
  if (b !== null) {
    const before = +b;
    if (!/^\d+$/.test(b) || !(before > 0) || before > Math.floor(Date.now() / 1000)) return json({ error: 'Bad before' }, 400);
    try {
      const w = await historyWindow(sym, res, before, u.searchParams.get('p') === 'bg' ? 1 : 0);
      return json(w, 200); // the app keeps windows itself (livefeed.js) and asks with no-store
    } catch (e) { return json({ error: e.message || 'History unavailable' }, e.status || 502); }
  }
  try {
    return json(await history(sym, days, res), 200, { 'Cache-Control': res === 60 ? 'private, max-age=300' : 'private, max-age=30' });
  } catch (e) {
    return json({ error: e.message || 'History unavailable' }, e.status || 502);
  }
}
