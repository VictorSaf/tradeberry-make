/* The economic calendar of the week: ForexFactory's public weekly feed (nfs.faireconomy.media), read on the server.
   The feed is unofficial and throttles callers, so it is read at most once an hour for every viewer (the Cache API
   keeps the last good copy for a day, served when the feed refuses); it has times, impact, forecast and previous, but
   no actual values. Notes: .mace/research/2026-10-31-calendar.md (decision: Victor, 31.10.2026). */
const FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FRESH_MS = 3600 * 1000, KEEP_S = 86400;
const IMPACT = { High: 'hi', Medium: 'md', Low: 'lo', Holiday: 'lo' };
let memo = null;

// the feed's rows → {t (s), ccy, name, impact: 'hi' | 'md' | 'lo', fc, prev (text as published), holiday}; bad rows are skipped
export function normalize(rows) {
  if (!Array.isArray(rows)) throw new Error('Unexpected calendar feed');
  const out = [];
  for (const r of rows) {
    if (!r || typeof r.title !== 'string' || typeof r.country !== 'string' || !/^[A-Z]{3}$/.test(r.country)) continue;
    const t = Math.floor(Date.parse(r.date) / 1000); if (!Number.isFinite(t)) continue;
    // a third party's text, shown in the app's markup: no markup characters pass (security audit 09.11.2026, F01)
    const clean = v => v.replace(/[<>"'`\\]/g, '').trim();
    const s = v => (typeof v === 'string' ? clean(v).slice(0, 24) : '');
    out.push({ t, ccy: r.country, name: clean(r.title).slice(0, 80), impact: IMPACT[r.impact] || 'lo', fc: s(r.forecast), prev: s(r.previous), holiday: r.impact === 'Holiday' });
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function calendar() {
  if (memo && Date.now() - memo.at < FRESH_MS) return memo;
  const cache = typeof caches !== 'undefined' ? caches.default : null, key = new Request('https://tradeberry.cache/calendar/week');
  const hit = cache ? await cache.match(key) : null, kept = hit ? await hit.json().catch(() => null) : null;
  if (kept && Date.now() - kept.at < FRESH_MS) return (memo = kept);
  try {
    const r = await fetch(FEED, { headers: { 'User-Agent': 'tradeBerry/1.0 (+https://tb.oneaigency.com)', Accept: 'application/json' } });
    if (!r.ok) throw new Error('Calendar feed answered ' + r.status);
    const events = normalize(JSON.parse(await r.text()));
    if (!events.length) throw new Error('Empty calendar feed');
    memo = { at: Date.now(), src: 'ForexFactory', events };
    if (cache) await cache.put(key, new Response(JSON.stringify(memo), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${KEEP_S}` } }));
    return memo;
  } catch (e) {
    if (kept) return (memo = { ...kept, stale: true });
    if (memo) return { ...memo, stale: true };
    throw e;
  }
}
