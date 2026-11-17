import { mockHistory } from './fixtures/hist-mock.mjs';
// On-demand history (spec istoric-la-cerere): liveRange walks the server's aligned /api/history windows back from `to`.
// /api/history is mocked with page.route; the candle generator is deterministic (a bar every 10 minutes), a holiday is an empty window.
const W = 604800, K = 2900, TO = K * W + 3 * 86400; // `to` sits 3 days into window K
// opts.empty: window numbers (K - n) that answer with no bars; opts.fail503: [before] fails its first request; opts.delay(n) ms
const mock = (page, opts = {}) => mockHistory(page, { n0: K, empty: opts.empty && (w => opts.empty.includes(w.n)), fail503: opts.fail503 && (w => opts.fail503.includes(w.before)), delay: opts.delay && (w => opts.delay(w.n)) });
const call = (page, from, to, res = 1) => page.evaluate(async ([from, to, res]) => {
  const prog = [];
  try {
    const r = await liveRange('EURUSD', res, from, to, { onProgress: (d, t) => prog.push([d, t]) });
    return { ok: true, n: r.bars.length, first: r.bars[0] && r.bars[0].time, last: r.bars.length && r.bars[r.bars.length - 1].time, start: r.start, from: r.from, to: r.to,
      asc: r.bars.every((b, i) => !i || b.time > r.bars[i - 1].time), inRange: r.bars.every(b => b.time >= from && b.time < to), shape: Object.keys(r.bars[0] || {}).join(), times: r.bars.map(b => b.time), prog };
  } catch (e) { return { ok: false, status: e.status, msg: e.message, isErr: e instanceof Error, prog }; }
}, [from, to, res]);

export const tests = [
  {
    name: 'LR1 liveRange: 3 weeks of 1-minute bars = 3-4 window requests (before, p=bg), ascending and unique, onProgress ends at done === total, at most 3 in flight',
    async run({ t, open }) {
      const page = await open('/'); const log = await mock(page, { delay: n => (n === 0 ? 120 : 10) }); // the newest answers last
      const r = await call(page, TO - 21 * 86400, TO);
      t.ok(r.ok, 'resolves: ' + r.msg);
      t.ok(log.reqs.length >= 3 && log.reqs.length <= 4, 'requests: ' + log.reqs.length);
      t.eq(log.reqs[0].before, TO, 'the first window is asked with before = to'); t.ok(log.reqs.slice(1).every((q, i) => q.before % W === 0), 'the next ones with the previous window\'s from');
      t.ok(log.reqs.every(q => q.p === 'bg' && q.res === '1' && q.sym === 'EURUSD'), 'p=bg, res=1, sym');
      t.ok(log.max <= 3, 'at most 3 in flight: ' + log.max);
      t.ok(r.asc && r.inRange, 'ascending, inside [from, to)'); t.eq(new Set(r.times).size, r.times.length, 'unique'); t.eq(r.shape, 'time,open,high,low,close', 'bar shape');
      t.eq(r.n, 21 * 86400 / 600, 'every bar of the range, none twice'); t.eq(r.first, TO - 21 * 86400, 'first bar'); t.eq(r.last, TO - 600, 'last bar');
      t.eq(r.start, false, 'start not reached'); t.ok(r.prog.length >= 3, 'progress after each window');
      const l = r.prog[r.prog.length - 1]; t.ok(l[0] === l[1] && l[1] === log.reqs.length, 'done === total: ' + JSON.stringify(l));
      t.noErrors(page);
    }
  },
  {
    name: 'LR2 liveRange cache: an identical second call makes no request; liveHas is false while the feed is off',
    async run({ t, open }) {
      const page = await open('/'); const log = await mock(page);
      const a = await call(page, TO - 14 * 86400, TO), n = log.reqs.length;
      const b = await call(page, TO - 14 * 86400, TO);
      t.ok(n >= 2, 'first call asked: ' + n); t.eq(log.reqs.length, n, 'second call asked nothing'); t.deep(b.times, a.times, 'same bars');
      t.eq(await page.evaluate(() => liveHas('EURUSD')), false, 'liveHas: no feed, false');
      t.noErrors(page);
    }
  },
  {
    name: 'LR3 liveRange start: one empty window (holiday) between full ones is not the start; two empty at the end are, with everything newer kept',
    async run({ t, open }) {
      const from = TO - 25 * 86400; // windows K .. K-4
      const p1 = await open('/'); await mock(p1, { empty: [2] });
      const a = await call(p1, from, TO);
      t.ok(a.ok && a.start === false, 'a lone empty window is not the start'); t.ok(a.times.some(x => x < (K - 2) * W) && !a.times.some(x => x >= (K - 2) * W && x < (K - 1) * W), 'older bars kept, the holiday window empty');
      const p2 = await open('/'); const log = await mock(p2, { empty: [3, 4], delay: n => (n === 3 ? 100 : 5) }); // evaluated in window order, not arrival order
      const b = await call(p2, from, TO);
      t.ok(b.ok && b.start === true, 'two consecutive empty windows = start');
      t.ok(b.asc && b.first >= (K - 2) * W && b.last === TO - 600, 'bars = everything newer than the empty pair');
      t.eq(b.n, (TO - (K - 2) * W) / 600, 'all of them'); t.ok(b.prog[b.prog.length - 1][0] === b.prog[b.prog.length - 1][1], 'progress closes at done === total');
      t.ok(log.reqs.length <= 5, 'no window beyond the range');
      t.noErrors(p1); t.noErrors(p2);
    }
  },
  {
    name: 'LR4 liveRange failure: a 503 rejects with an Error carrying status, nothing stays cached for that window, the next call asks again',
    async run({ t, open }) {
      const page = await open('/');
      const log = await mock(page, { fail503: [K * W] });
      const r = await call(page, TO - 14 * 86400, TO);
      t.ok(!r.ok && r.isErr && r.status === 503, 'rejected with status 503: ' + JSON.stringify(r));
      t.ok(/busy/i.test(r.msg), 'message from the body: ' + r.msg);
      const asked = log.reqs.filter(q => q.before === K * W).length;
      const r2 = await call(page, TO - 14 * 86400, TO);
      t.ok(r2.ok, 'second call resolves'); t.eq(log.reqs.filter(q => q.before === K * W).length, asked + 1, 'the failed window (window K-1: its before is K*W) was asked again');
      t.noErrors(page);
    }
  }
];
