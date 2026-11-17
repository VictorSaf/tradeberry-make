// Market replay: determinism from seed + start, fixed steps independent of speed, no future in memory, rewind to a
// checkpoint, replay account isolated from the main account, recorded-bar fidelity, URL validation, transport UI,
// the live engine unchanged (fingerprint of the v15 market, engine VERSION 2: catalog, 15 currencies, bid pivot), and
// replays on the 16 G8 pairs with the launcher anchored to the platform snapshot (no ECB).
const START = 1760425200; // 2025-10-14 07:00 UTC (a multiple of 60)
const RATES = [0.89222, 0.75491, 157.98, 0.83021, 1.447, 1.4207, 1.7855];
const CCY = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'];
// live seeded engine (seed 42, snapshot levels, clock 2026-10-16T10:30Z, 400 ticks of 250 ms at 1×, 300 at 60×), bids.
// Retaken for v15 (VERSION 2): the market maths changed by design (catalog.md §6), so this is a determinism fixture
// of the new engine; n is smaller because the weekend has no FX bars any more.
const LIVE_REF = { v: 2, px: [1.1234929019164523, 1.3387281167805245, 157.91160404364376, 0.8223873164844672, 0.6993943268734873, 1.4038919098881342, 0.569846695200922, 0.8392241022160003, 177.4125662732751, 211.4007042991391, 110.44248001561687, 0.923946312696418, 1.6063797756822236, 1.10095302346144, 112.481312080662, 1.227337690581654], regime: 0.3710815016169685, t: 1792151200, n: 7276, hsum: 860232232970.1697 };

const rid = page => page.evaluate(() => window.__mfxRpRid || null);
// the replay document of the current rid (a rewind replaces it with a new one)
async function child(page, t, prevRid = null) {
  for (let i = 0; i < 400; i++) {
    const r = await rid(page);
    const f = r && r !== prevRid && page.frames().find(x => x !== page.mainFrame() && x.url().includes('rid=' + r));
    if (f) {
      try {
        await f.waitForFunction(() => window.RP && (RP.state === 'paused' || RP.state === 'ended' || RP.state === 'error'), null, { timeout: 30000 });
        const st = await f.evaluate(() => RP.state);
        t.ok(st !== 'error', 'replay started: ' + (await f.evaluate(() => RP.error || '')));
        await f.evaluate(() => { pmCfg().on = false; tiltCfg().on = false; });
        return f;
      } catch (e) { if (!/detached|destroyed|navigat/i.test(String(e))) throw e; }
    }
    await page.waitForTimeout(50);
  }
  throw new Error('replay document did not appear');
}
async function openReplay(page, t, opts) {
  await page.evaluate(o => RP.open(o), opts);
  return child(page, t);
}
const idle = f => f.waitForFunction(() => RP.state === 'paused' || RP.state === 'ended', null, { timeout: 60000 });
// every pair: the last n bars (time + OHLC), the quotes and the clock
const fingerprint = (f, n = 400) => f.evaluate(n => ({
  simTime: Engine.simTime,
  bars: Engine.PAIRS.map(p => Engine.candles[p.sym].slice(-n).map(c => [c.time, c.open, c.high, c.low, c.close])),
  q: Engine.PAIRS.map(p => { const q = Engine.quote(p.sym); return [q.bid, q.ask]; })
}), n);
const SPEC = { kind: 'sim', seed: 4821, start: START, rates: RATES, rateDate: '2026-10-15' };

export const tests = [
  {
    name: 'R1 same seed and start: same bars at step N; another seed differs; anchored at start; no future',
    async run({ t, app }) {
      const run = async (spec, n) => {
        const page = await app();
        const f = await openReplay(page, t, spec);
        const boot = await f.evaluate(({ RATES, CCY }) => {
          const lv = Object.fromEntries(CCY.map((c, i) => [c, Math.log(1 / RATES[i])]));
          const want = Engine.PAIRS.map(p => Math.exp((p.base === 'USD' ? 0 : lv[p.base]) - (p.quote === 'USD' ? 0 : lv[p.quote])));
          return { simTime: Engine.simTime, last: Engine.candles.EURUSD.at(-1).time, mode: Engine.mode, mids: Engine.PAIRS.map(p => Engine.mid(p.sym)), want, feed: document.getElementById('feedPill').textContent };
        }, { RATES, CCY });
        const done = await f.evaluate(n => Engine.stepFixed(n), n);
        const fp = await fingerprint(f);
        const peek = await f.evaluate(() => ({
          maxT: Math.max(...Engine.PAIRS.map(p => Engine.candles[p.sym].at(-1).time)), cur: Math.floor(Engine.simTime / 60) * 60,
          future: CAL.events.filter(e => !e.done && e.actual != null).length, cal: CAL.events.map(e => [e.t, e.name, e.actual, e.move ?? null])
        }));
        return { boot, done, fp, peek, page };
      };
      const a = await run(SPEC, 20000), b = await run(SPEC, 20000), c = await run({ ...SPEC, seed: 4822 }, 60), a60 = await run(SPEC, 60);
      t.eq(a.boot.mode, 'sim', 'the replay document runs the sim feed');
      t.eq(a.boot.simTime, START, 'clock starts at the start moment');
      t.eq(a.boot.last, START, 'the last history bar is the start minute');
      a.boot.mids.forEach((m, i) => t.near(m, a.boot.want[i], 'mid at start = rate from the spec #' + i, 1e-12, 0));
      t.ok(/REPLAY/.test(a.boot.feed) && /4821/.test(a.boot.feed), 'feed pill names the replay and its seed: ' + a.boot.feed);
      t.eq(a.done, 20000, 'stepFixed made every step');
      t.eq(a.fp.simTime, START + 20000, 'one step = one simulated second');
      t.deep(a.fp, b.fp, 'same seed and start: identical bars and quotes after 20000 steps');
      t.deep(a.peek.cal, b.peek.cal, 'same seed and start: identical calendar (times, names, actuals, moves)');
      t.ok(a.peek.cal.length >= 10, 'the calendar runs in the replay');
      t.ok(a.peek.maxT <= a.peek.cur, 'no bar beyond the cursor minute');
      t.eq(a.peek.future, 0, 'no actual known before its release');
      const diff = c.fp.q.filter((q, i) => q[0] !== a60.fp.q[i][0]).length;
      t.ok(diff >= 15, `seed+1 gives other prices after 60 steps on ${diff}/16 pairs`);
      for (const x of [a, b, c, a60]) t.noErrors(x.page);
    }
  },
  {
    name: 'R2 speed and frame cadence do not change the price path',
    async run({ t, app }) {
      const page = await app();
      const f = await openReplay(page, t, SPEC);
      await f.evaluate(() => Engine.stepFixed(7200));
      const a = await fingerprint(f, 200);
      await f.evaluate(() => RP.close());
      const page2 = await app();
      const g = await openReplay(page2, t, SPEC);
      const r = await g.evaluate(({ target }) => {
        // random frame lengths at the replay speeds, never past the target
        let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const speeds = Engine.RP_SPEEDS; let frames = 0;
        while (Engine.simTime < target) {
          const v = speeds[Math.floor(rnd() * speeds.length)], left = target - Engine.simTime;
          let dt = 30 + rnd() * 970; if (dt / 1000 * v > left) dt = left / v * 1000;
          Engine.replaySpeed = v; Engine.tick(dt); frames++;
          if (frames > 1e6) break;
        }
        Engine.replaySpeed = 0;
        return { frames, simTime: Engine.simTime };
      }, { target: START + 7200 });
      const b = await fingerprint(g, 200);
      t.ok(r.frames >= 10, 'many frames of different lengths: ' + r.frames);
      t.deep(b, a, 'ticks at mixed speeds reach the same bars as fixed steps');
      t.noErrors(page2);
    }
  },
  {
    name: 'R3 step, back to a checkpoint and forward again: same market, account back at the checkpoint',
    async run({ t, app }) {
      const page = await app();
      let f = await openReplay(page, t, SPEC);
      // Step goes to the close of the current chart bar (15m by default)
      const st = await f.evaluate(async () => { S.set.tf = 15; RP.step(); while (RP.state === 'seeking') await new Promise(r => setTimeout(r, 20)); return Engine.simTime; });
      t.eq(st, START + 900, 'Step stops at the next 15m bar close');
      await f.evaluate(() => RP.jumpTo(Engine.simTime + 2700)); await idle(f);
      const cpT = await f.evaluate(() => Engine.simTime);
      t.eq(cpT, START + 3600, 'jump forward lands on the target');
      const b1 = await fingerprint(f, 300);
      const acct0 = await f.evaluate(() => ({ bal: S.balance, pos: S.positions.length, hist: S.history.length, cps: RP.cps.map(c => c.t) }));
      t.ok(acct0.cps.includes(cpT), 'a checkpoint exists at 08:00 (15 min grid)');
      await f.evaluate(() => { const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }); closePosition(p.id, 'Manual'); openPosition({ sym: 'GBPUSD', side: 'sell', lots: 2, dupOk: true }); });
      await f.evaluate(() => RP.jumpTo(Engine.simTime + 1800)); await idle(f);
      const b2 = await fingerprint(f, 300);
      const before = await rid(page);
      // back to 08:00: one replay trade and one open position made after it are discarded, after a confirmation
      const ask = await f.evaluate(cpT => { RP.back(cpT); const d = document.getElementById('confirmDlg'); return { state: RP.state, open: !!d && !d.hidden, text: d ? d.textContent : '' }; }, cpT);
      t.eq(ask.state, 'confirm', 'back with something to lose asks first');
      t.ok(ask.open && /1 replay trade/.test(ask.text) && /1 open position/.test(ask.text), 'the dialog counts what is lost: ' + ask.text);
      await f.evaluate(() => document.querySelector('#confirmDlg [data-cf=ok]').click());
      f = await child(page, t, before);
      const back = await fingerprint(f, 300);
      const acct1 = await f.evaluate(() => ({ bal: S.balance, pos: S.positions.length, hist: S.history.length, cps: RP.cps.map(c => c.t) }));
      t.eq(back.simTime, cpT, 'clock back at the checkpoint');
      t.deep(back, b1, 'bars and quotes at the checkpoint are the ones of the first pass');
      t.deep({ bal: acct1.bal, pos: acct1.pos, hist: acct1.hist }, { bal: acct0.bal, pos: acct0.pos, hist: acct0.hist }, 'account back at the checkpoint');
      t.ok(acct1.cps.every(x => x <= cpT) && acct1.cps.length === acct0.cps.length, 'checkpoints after the target are gone, earlier ones kept');
      await f.evaluate(() => RP.jumpTo(Engine.simTime + 1800)); await idle(f);
      t.deep(await fingerprint(f, 300), b2, 'played forward again: the same market as the first pass');
      t.noErrors(page);
    }
  },
  {
    name: 'R4 the main account and its market are untouched by a replay session with trades',
    async run({ t, app }) {
      const page = await app();
      const before = await page.evaluate(async () => {
        T.reset();
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.5, dupOk: true, sl: Engine.quote('EURUSD').bid - 0.005 });
        placeOrder({ sym: 'USDJPY', side: 'buy', ot: 'limit', price: Engine.quote('USDJPY').ask - 0.5, lots: 0.3, dupOk: true });
        persistNow(); await store.flush();
        Engine.speed = 1;
        return JSON.stringify({ b: S.balance, p: S.positions, o: S.orders, h: S.history, a: S.alerts, n: S.nextId, pk: S.peak });
      });
      const f = await openReplay(page, t, { ...SPEC, seed: 99 });
      const held = await page.evaluate(() => Engine.simTime);
      const r = await f.evaluate(async () => {
        const a = openPosition({ sym: 'EURUSD', side: 'sell', lots: 3, dupOk: true });
        openPosition({ sym: 'AUDUSD', side: 'buy', lots: 1, dupOk: true });
        closePosition(a.id, 'Manual');
        RP.jumpBy(3600); while (RP.state === 'seeking') await new Promise(r => setTimeout(r, 20));
        return { hist: S.history.length, pos: S.positions.length, bal: S.balance, mode: store.mode() };
      });
      t.ok(r.hist === 1 && r.pos === 1 && r.bal !== 100000, 'trades happened in the replay account');
      t.eq(r.mode, 'session', 'the replay document has no browser storage');
      await page.waitForTimeout(1200);
      t.eq(await page.evaluate(() => Engine.simTime), held, 'main market clock frozen while Replay is open');
      t.eq(await page.evaluate(() => JSON.stringify({ b: S.balance, p: S.positions, o: S.orders, h: S.history, a: S.alerts, n: S.nextId, pk: S.peak })), before, 'main account unchanged during the replay');
      // Close replay: asks (there are trades), then the iframe goes and the main market runs again
      const ask = await f.evaluate(() => { RP.close(); const d = document.getElementById('confirmDlg'); return !!d && !d.hidden && /main account is unchanged/i.test(d.textContent); });
      t.ok(ask, 'closing a replay with trades asks first and says the main account is unchanged');
      await f.evaluate(() => document.querySelector('#confirmDlg [data-cf=ok]').click());
      await page.waitForFunction(() => !document.querySelector('#rpHost iframe'), null, { timeout: 5000 });
      const after = await page.evaluate(() => JSON.stringify({ b: S.balance, p: S.positions, o: S.orders, h: S.history, a: S.alerts, n: S.nextId, pk: S.peak }));
      t.eq(after, before, 'main account exactly as before after closing the replay');
      const saved = await page.evaluate(() => new Promise((res, rej) => { const q = indexedDB.open('meridian-fx'); q.onerror = () => rej(q.error); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result.state); }; }));
      t.eq(JSON.stringify({ b: saved.balance, p: saved.positions, o: saved.orders, h: saved.history, a: saved.alerts, n: saved.nextId, pk: saved.peak }), before, 'the saved main account was not touched by the replay');
      await page.waitForTimeout(1200);
      t.ok(await page.evaluate(() => Engine.simTime) > held, 'the main market runs again after Close replay');
      t.eq(await page.evaluate(() => document.activeElement && document.activeElement.id), 'rpBtn', 'focus back on the Replay button');
      t.noErrors(page);
    }
  },
  {
    name: 'R5 stops inside a jump fill at the first second the price reaches them',
    async run({ t, app }) {
      let hits = 0;
      for (const seed of [1, 2, 3]) {
        const spec = { ...SPEC, seed }, span = 4 * 3600;
        const page = await app();
        const f = await openReplay(page, t, spec);
        const r = await f.evaluate(async span => {
          const q = Engine.quote('EURUSD'), sl = q.bid - 0.0010;
          const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, sl, dupOk: true });
          document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
          RP.jumpBy(span); while (RP.state === 'seeking') await new Promise(r => setTimeout(r, 20));
          const h = S.history.find(x => x.id === p.id);
          return { sl, h: h ? { close: h.close, exit: h.exit, reason: h.reason } : null, open: S.positions.length, toasts: [...document.querySelectorAll('#toasts .toast b')].map(b => b.textContent) };
        }, span);
        const page2 = await app();
        const g = await openReplay(page2, t, spec);
        const ref = await g.evaluate(({ sl, span }) => {
          const end = Engine.simTime + span;
          while (Engine.simTime < end) { Engine.stepFixed(1); const b = Engine.quote('EURUSD').bid; if (b <= sl) return { t: Engine.simTime, bid: b }; }
          return null;
        }, { sl: r.sl, span });
        if (ref) {
          hits++;
          t.ok(r.h, `seed ${seed}: the stop closed the position`);
          t.eq(r.h.close, ref.t, `seed ${seed}: closed at the first second the bid reached the stop`);
          t.near(r.h.exit, ref.bid, `seed ${seed}: exit at that second's bid`, 0, 6e-6);
          t.eq(r.h.reason, 'Stop loss', `seed ${seed}: reason`);
        } else t.eq(r.open, 1, `seed ${seed}: stop never reached, position still open`);
        t.ok(r.toasts.some(x => /^Jumped to/.test(x)), `seed ${seed}: one summary toast after the jump: ${r.toasts.join(' | ')}`);
        t.ok(!r.toasts.some(x => /^Stop loss/.test(x)), `seed ${seed}: no per-event toast during the jump`);
        t.noErrors(page);
      }
      t.ok(hits >= 1, 'at least one seed reaches the stop inside the jump: ' + hits);
    }
  },
  {
    name: 'R6 replay links are validated strictly',
    async run({ t, app }) {
      const page = await app();
      const r = await page.evaluate(() => {
        const ok = '?replay=sim&seed=4821&start=1760425230&r=0.89222,0.75491,157.98,0.83021,1.447,1.4207,1.7855&ev=1';
        const bad = ['?replay=sim&seed=abc&start=1760425200&r=1,1,1,1,1,1,1&ev=1', '?replay=sim&seed=4294967296&start=1760425200&r=1,1,1,1,1,1,1&ev=1',
          '?replay=sim&seed=1&start=1760425200&r=1,1,1,1,1,1&ev=1', '?replay=sim&seed=1&start=17&r=1,1,1,1,1,1,1&ev=1', '?replay=sim&seed=1&start=1760425200&r=1,1,1,1,1,1,1e9&ev=1',
          '?replay=sim&seed=1&start=1760425200&r=1,1,1,1,1,1,NaN&ev=1', '?replay=sim&seed=1&start=1760425200&r=1,1,1,1,1,1,1&ev=x'];
        return { ok: rpParseUrl(ok), bad: bad.map(rpParseUrl), none: rpParseUrl('?tab=calendar'), version: Engine.VERSION };
      });
      t.ok(r.ok.spec, 'a valid link parses');
      t.eq(r.ok.spec.start, 1760425200, 'start is rounded down to the minute');
      t.eq(r.ok.spec.seed, 4821, 'seed');
      t.eq(r.ok.spec.rates.length, 7, 'seven rates');
      r.bad.forEach((x, i) => t.ok(!x.spec && typeof x.error === 'string' && x.error.length > 0, 'bad link #' + i + ' refused'));
      t.eq(r.none, null, 'no replay parameter: nothing to do');
      // an older engine version is flagged in the launcher, a valid link opens it prefilled (no auto start)
      const p2 = await app('?replay=sim&seed=4821&start=1760425200&r=0.89222,0.75491,157.98,0.83021,1.447,1.4207,1.7855&ev=0');
      await p2.waitForFunction(() => { const d = document.getElementById('rpDlg'); return d && !d.hidden; }, null, { timeout: 5000 });
      const l = await p2.evaluate(() => ({ seed: document.getElementById('rpSeed').value, txt: document.getElementById('rpDlg').textContent, frame: !!document.querySelector('#rpHost iframe') }));
      t.eq(l.seed, '4821', 'launcher prefilled with the seed from the link');
      t.ok(/Opened from a replay link/.test(l.txt), 'launcher says where it came from');
      t.ok(/engine v0/.test(l.txt), 'launcher warns about the engine version');
      t.ok(!l.frame, 'a link never starts a replay by itself');
      t.noErrors(page); t.noErrors(p2);
    }
  },
  {
    name: 'R7 recorded 1-minute bars replay exactly; the future stays out of reach',
    async run({ t, app }) {
      const page = await app();
      const win = await page.evaluate(() => { const to = Math.floor(Engine.simTime / 60) * 60, start = to - 6 * 3600; return { start, to }; });
      const hostBars = await page.evaluate(({ start }) => Engine.PAIRS.map(p => Engine.candles[p.sym].filter(c => c.time >= start && c.time < start + 90 * 60).map(c => [c.time, c.open, c.high, c.low, c.close])), win);
      const f = await openReplay(page, t, { kind: 'bars', start: win.start });
      const r = await f.evaluate(async () => {
        const n0 = Engine.candles.EURUSD.length, mode = Engine.mode, jumped = (() => { const m = Engine.mid('EURUSD'); Engine.jump('EUR', 0.01); return Engine.mid('EURUSD') === m; })();
        Engine.stepFixed(90 * 60);
        // one-level scan: no own property of the obvious globals holds a typed array (the recorded future)
        const holders = [window, Engine, RP, CAL].flatMap(o => Object.keys(o).filter(k => { try { return ArrayBuffer.isView(o[k]); } catch (e) { return false; } }));
        return { n0, n: Engine.candles.EURUSD.length, mode, jumped, holders, feed: document.getElementById('feedPill').textContent,
          bars: Engine.PAIRS.map(p => Engine.candles[p.sym].filter(c => c.time >= Engine.replay.start).map(c => [c.time, c.open, c.high, c.low, c.close])) };
      });
      t.eq(r.mode, 'bars', 'bars feed');
      t.ok(r.jumped, 'news shocks do nothing on recorded bars');
      t.eq(r.n - r.n0, 90, 'one new bar per played minute');
      t.deep(r.holders, [], 'no typed array reachable from window, Engine, RP or CAL');
      t.ok(/REPLAY/.test(r.feed), 'feed pill: ' + r.feed);
      // the bar of every fully played minute equals the recorded one, all 16 pairs, exactly
      for (let i = 0; i < 16; i++) t.deep(r.bars[i].slice(0, 90), hostBars[i].slice(0, 90), 'recorded bars replayed exactly #' + i);
      t.noErrors(page);
    }
  },
  {
    name: 'R8 transport bar: toolbar, play/pause state, Space, slider, end of replay',
    async run({ t, app }) {
      const page = await app();
      const f = await openReplay(page, t, SPEC);
      const a = await f.evaluate(() => {
        const bar = document.getElementById('rpBar'), play = document.getElementById('rpPlay'), sl = document.getElementById('rpScrub');
        const s0 = { role: bar.getAttribute('role'), label: bar.getAttribute('aria-label'), pressed: play.getAttribute('aria-pressed'), now: +sl.value, min: +sl.min, max: +sl.max, live: !!bar.querySelector('[aria-live]') };
        play.click(); const s1 = { state: RP.state, pressed: play.getAttribute('aria-pressed'), name: play.getAttribute('aria-label') };
        document.body.focus(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        return { s0, s1, s2: { state: RP.state, pressed: play.getAttribute('aria-pressed') } };
      });
      t.eq(a.s0.role, 'toolbar', '#rpBar is a toolbar'); t.eq(a.s0.label, 'Replay controls', 'toolbar name');
      t.eq(a.s0.pressed, 'false', 'paused at start'); t.eq(a.s0.now, START, 'slider at the cursor'); t.eq(a.s0.min, START, 'slider min = start'); t.eq(a.s0.max, START + 259200, 'slider max = end (3 days)');
      t.ok(a.s0.live, 'a polite live region announces state changes');
      t.deep(a.s1, { state: 'playing', pressed: 'true', name: 'Pause' }, 'Play starts the replay');
      t.deep(a.s2, { state: 'paused', pressed: 'false' }, 'Space pauses');
      await f.evaluate(() => RP.jumpTo(Engine.replay.end));
      await f.waitForFunction(() => RP.state === 'ended', null, { timeout: 60000 });
      const e = await f.evaluate(() => ({ play: document.getElementById('rpPlay').disabled, step: document.getElementById('rpStep').disabled, more: Engine.stepFixed(10), t: Engine.simTime, end: Engine.replay.end }));
      t.ok(e.play && e.step, 'Play and Step disabled at the end');
      t.eq(e.more, 0, 'no step past the end'); t.eq(e.t, e.end, 'clock at the end');
      t.noErrors(page);
    }
  },
  {
    name: 'R9 live engine: seeded prices equal the v15 reference and repeat exactly in a second document',
    async run({ t, open }) {
      const run = async () => (await open('/tests/engine.html', { clock: true })).evaluate(async () => {
        Engine.setSeed(42); await Engine.init();
        for (let i = 0; i < 400; i++) Engine.tick(250);
        Engine.speed = 60; for (let i = 0; i < 300; i++) Engine.tick(250);
        const h = Engine.PAIRS.map(p => Engine.candles[p.sym].slice(-30).map(c => [c.time, c.open, c.high, c.low, c.close]));
        return { px: Engine.PAIRS.map(p => Engine.quote(p.sym).bid), regime: Engine.regime, t: Engine.simTime, n: Engine.candles.EURUSD.length, hsum: h.flat(2).reduce((a, b) => a + b, 0), mode: Engine.mode, v: Engine.VERSION };
      });
      const r = await run(), r2 = await run();
      t.deep(r2, r, 'same seed and clock: the same market in another document');
      t.eq(r.v, LIVE_REF.v, 'engine VERSION of the reference');
      t.eq(r.mode, 'live', 'live mode outside a replay document');
      t.eq(r.t, LIVE_REF.t, 'clock'); t.eq(r.n, LIVE_REF.n, 'bar count');
      r.px.forEach((v, i) => t.near(v, LIVE_REF.px[i], 'price #' + i, 1e-12, 0));
      t.near(r.regime, LIVE_REF.regime, 'vol regime', 1e-12, 0);
      t.near(r.hsum, LIVE_REF.hsum, 'last 30 bars of every pair', 1e-13, 0);
    }
  },
  {
    name: 'R10 replay on the 16 G8 pairs: the launcher names the snapshot (no ECB), a non-G8 main chart opens the replay on a G8 pair, other instruments are not offered',
    async run({ t, app }) {
      const page = await app('', { freeze: false, clock: new Date('2026-10-16T10:30:00Z') });
      await page.evaluate(() => { setSymbol('GOLD'); RP.launcher({ seed: 77, start: Math.floor(Engine.simTime / 60) * 60 - 3600 }); });
      const dlg = await page.evaluate(() => document.getElementById('rpRates').textContent);
      t.ok(!/ECB/.test(dlg) && /snapshot/i.test(dlg) && /G8/.test(dlg), 'launcher anchored to the platform snapshot, G8 pairs: ' + dlg);
      await page.evaluate(() => { document.getElementById('rpDlg').hidden = true; });
      const f = await openReplay(page, t, { kind: 'sim', seed: 77, start: START });
      const r = await f.evaluate(() => ({ sym: S.set.sym, pairs: Engine.PAIRS.map(p => p.sym), gold: tradeStatus('GOLD'), why: unavailableWhy('GOLD'), eur: tradeStatus('EURUSD'), q: Engine.quote('EURUSD').bid }));
      t.ok(r.pairs.includes(r.sym), 'the replay chart is on a G8 pair: ' + r.sym);
      t.eq(r.gold, 'off', 'GOLD is not offered in a replay'); t.ok(/16 G8 FX pairs/.test(r.why), 'the reason names the G8 pairs: ' + r.why);
      t.eq(r.eur, 'full', 'EUR/USD trades in the replay'); t.ok(Number.isFinite(r.q), 'EUR/USD quotes');
      t.noErrors(page);
    }
  }
];
