/* GET /api/state → {rev, savedAt, data: {state, market}} (rev 0: nothing saved yet). state holds the interface
   preferences, key by key (a copy saved by a build before the execution server may also hold the old account keys:
   they stay as they were, untouched, and the app reads only the preferences).
   GET /api/state?meta=1 → {rev, savedAt}
   PUT /api/state {base, prefs} → {rev, savedAt}: each key of prefs replaces that key of the stored copy, the other keys
   stay; the last writer of a key wins (base is the revision the browser had, for the record, never a reason to
   refuse: no device holds the account, so there is nothing to protect with a 409). The trading account itself lives
   on the execution server (host/gateway.mjs) and never comes here. A shared account keeps one copy per device
   (server/auth.js slot()). The app reads the copy back through sanitizeState like any outside state.
   The blob of an account moved to the server is frozen as it was at the cut-over (tools/cutover.sh), the rollback copy
   (tools/rollback.sh): no account key is ever written, and `set` is merged so its execution fields (jur, lev, slip,
   slipSd, latMs, comm: on the server, app.js SET_EXEC) stay as stored while the display settings change.
   PUT /api/state {base, state} (a build from before the execution server) → 423 {since}: that build's cloud.js shows
   its "open on another device" overlay and stops running the account in the browser (functions/api/lease.js).
   While ops_flags has 'state_frozen' (tools/cutover.sh, the accounts being migrated), every other PUT answers 503. */
import { json, now, sameOrigin, deviceOf, slot } from '../../server/auth.js';

const MAX_BYTES = 1500000; // D1 keeps up to 2 MB per value
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// the account's keys never come from a browser any more (app.js ACCT_KEYS): the execution server holds the account
const ACCOUNT = new Set(['balance', 'peak', 'positions', 'orders', 'history', 'fills', 'ordLog', 'alerts', 'nextId', 'nextFill', 'chal', 'bkPos', 'bkHist', 'bkAlerts', 'bkOrders', 'demo', 'catv']);
const SET_EXEC = ['jur', 'lev', 'slip', 'slipSd', 'latMs', 'comm'];

export async function onRequestGet({ request, env, data }) {
  const device = deviceOf(request);
  if (data.user.shared && !device) return json({ error: 'Missing device id' }, 400);
  const s = slot(data.user, device);
  if (new URL(request.url).searchParams.get('meta')) {
    const m = await env.DB.prepare(`SELECT rev, saved_at FROM ${s.table} WHERE ${s.where}`).bind(...s.keys).first();
    return json({ rev: m ? m.rev : 0, savedAt: m ? m.saved_at : 0 });
  }
  const row = await env.DB.prepare(`SELECT rev, data, market, saved_at FROM ${s.table} WHERE ${s.where}`).bind(...s.keys).first();
  if (!row) return json({ rev: 0, savedAt: 0, data: null });
  // the stored texts are already JSON: put them in place without parsing them again
  return new Response(`{"rev":${row.rev},"savedAt":${row.saved_at},"data":{"state":${row.rev ? row.data : 'null'},"market":${row.market || 'null'}}}`, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function onRequestPut({ request, env, data }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  const device = deviceOf(request); if (!device) return json({ error: 'Missing device id' }, 400);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: `Preferences too large to sync (limit ${MAX_BYTES / 1000} KB)` }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'Not JSON' }, 400); }
  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  // an old build saving its whole account: stopped, as if the account were open on another device
  if (plain(body) && 'state' in body && !('prefs' in body)) return json({ error: 'Open on another device', since: now() }, 423);
  // the cut-over reads the blobs (tools/cutover.sh): nothing is saved meanwhile; the browser keeps the change and retries
  if (await env.DB.prepare("SELECT 1 FROM ops_flags WHERE k = 'state_frozen'").first()) return json({ error: 'Your account is being moved to the server; try again in a few minutes' }, 503);
  if (!plain(body) || !Number.isInteger(body.base) || body.base < 0 || !plain(body.prefs)) return json({ error: 'Expected {base, prefs}' }, 400);
  const keys = Object.keys(body.prefs);
  if (keys.some(k => !KEY_RE.test(k) || ACCOUNT.has(k))) return json({ error: 'Not an interface preference' }, 400);
  const s = slot(data.user, device), t = now();
  // read, merge key by key, write: one statement each, retried if another save landed in between (the last one wins)
  for (let i = 0; i < 5; i++) {
    const row = await env.DB.prepare(`SELECT rev, data FROM ${s.table} WHERE ${s.where}`).bind(...s.keys).first();
    let cur = {}; if (row && row.rev && row.data) { try { const v = JSON.parse(row.data); if (plain(v)) cur = v; } catch (e) { /* a damaged copy: the preferences start again */ } }
    for (const k of keys) {
      let v = body.prefs[k];
      if (k === 'set' && plain(v)) { // the execution fields of the stored settings stay, whatever the browser sent
        v = { ...v }; const was = plain(cur.set) ? cur.set : {};
        for (const f of SET_EXEC) { delete v[f]; if (f in was) v[f] = was[f]; }
      }
      cur[k] = v;
    }
    const payload = JSON.stringify(cur);
    if (new TextEncoder().encode(payload).length > MAX_BYTES) return json({ error: `Preferences too large to sync (limit ${MAX_BYTES / 1000} KB)` }, 413);
    const r = !row
      ? await env.DB.prepare(`INSERT INTO ${s.table} (${s.cols}, rev, data, market, saved_at) VALUES (${s.marks}, 1, ?, NULL, ?) ON CONFLICT${s.conflict} DO NOTHING`).bind(...s.keys, payload, t).run()
      : await env.DB.prepare(`UPDATE ${s.table} SET rev = rev + 1, data = ?, saved_at = ? WHERE ${s.where} AND rev = ?`).bind(payload, t, ...s.keys, row.rev).run();
    if (r.meta.changes === 1) return json({ rev: (row ? row.rev : 0) + 1, savedAt: t });
  }
  return json({ error: 'Busy, try again' }, 503);
}
