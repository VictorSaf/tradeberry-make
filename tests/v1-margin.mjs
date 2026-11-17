// Valul 1, v1-margin (.mace/design/wave1-honest-stats.md, contract C2; decision 35): the initial margin is fixed per
// position (p.im, ESMA Q&A 5.8) at the open, scaled on partial closes, computed at p.entry for states saved without it;
// account() and the stop-out read Σ im. costModel(sym) is the pure cost model of the sheet for the backtester.
// Expected values are worked out here from the raw sheet (Engine.META[sym].p), not read back from trade.js.
const TUE = new Date('2026-10-20T10:00:00Z'); // Tuesday, EEST (server UTC+3), New York EDT: FX open
const fresh = () => { T.reset(); S.set.jur = 'eu'; S.set.lev = 30; S.set.comm = 0; };

export const tests = [
  {
    name: 'M1 EURUSD 1 lot at 1.1000 under EU 1:30: im 3666.67, unchanged at 1.2000, ½ closed → 1833.33',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        T.move('EURUSD', 1.1);
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true });
        const out = { im: p && p.im, mg0: account().mg, pm0: posMargin(p) };
        T.move('EURUSD', 1.2);
        out.mg1 = account().mg; out.lv1 = account().level; out.eq1 = account().eq;
        closePosition(p.id, 'Partial close', .5);
        out.im2 = p.im; out.mg2 = account().mg; out.lots2 = p.lots;
        return out;
      }, fresh.toString());
      t.near(r.im, 100000 * 1.1 / 30, 'p.im = 1 lot × 100,000 × 1.1000 / 30', 1e-9, 1e-6);
      t.near(r.im, 3666.67, 'im 3666.67', 0, .005);
      t.near(r.mg0, r.im, 'account().mg = Σ im', 1e-12, 1e-9);
      t.near(r.pm0, r.im, 'posMargin(p) = p.im', 1e-12, 1e-9);
      t.near(r.mg1, 3666.67, 'price 1.2000: used margin stays at the initial margin', 0, .005);
      t.near(r.lv1, r.eq1 / r.im * 100, 'margin level = equity / Σ im', 1e-12, 1e-9);
      t.eq(r.lots2, .5, 'half left');
      t.near(r.im2, 1833.33, 'after ½ closed: im 1833.33', 0, .005);
      t.near(r.mg2, r.im2, 'account().mg follows the scaled im', 1e-12, 1e-9);
      t.noErrors(page);
    }
  },
  {
    name: 'M2 stop-out at equity ≤ 50% × Σ im (not the margin at the current price)',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        T.move('EURUSD', 1.1);
        const p = openPosition({ sym: 'EURUSD', side: 'sell', lots: 1, dupOk: true });
        const im = p.im;
        // the price rises 100 pips: a loss on the short; the margin at the current price would be 100,000 × 1.11 / 30
        T.move('EURUSD', 1.11);
        const cur = notionalUsd('EURUSD', 1) / effLev('EURUSD');
        S.balance = im * .5 + 8 - posPnl(p).pnl; // equity = 50% of im + $8: above the stop-out on im, below it on cur
        const lvA = account().level; checkTriggers();
        const out = { im, cur, lvA, openA: S.positions.length };
        S.balance = im * .5 - 8 - posPnl(p).pnl;
        const lvB = account().level; checkTriggers();
        Object.assign(out, { lvB, openB: S.positions.length, reason: S.history[0] && S.history[0].reason });
        return out;
      }, fresh.toString());
      t.ok(r.cur > r.im + 20, `the current-price margin (${r.cur}) is above im (${r.im})`);
      t.ok(r.lvA > 50, 'level on im just above 50%: ' + r.lvA);
      t.eq(r.openA, 1, 'no stop-out above 50% of Σ im (a current-price margin would have stopped it out)');
      t.ok(r.lvB < 50, 'level on im below 50%: ' + r.lvB);
      t.eq(r.openB, 0, 'stop-out under 50% of Σ im');
      t.eq(r.reason, 'Stop-out', 'closed by the stop-out');
      t.noErrors(page);
    }
  },
  {
    name: 'M3 a position saved without im is margined at p.entry (displayed convention); the backfill fixes it',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        T.move('EURUSD', 1.1);
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true });
        delete p.im; p.entry = 1.05;
        const out = { pm: posMargin(p) };
        T.move('EURUSD', 1.2);
        out.pm2 = posMargin(p); out.mg = account().mg; out.im = p.im;
        out.order = posMargin({ sym: 'EURUSD', lots: 1 });
        out.cur = notionalUsd('EURUSD', 1) / 30;
        out.text = typeof MARGIN_TEXT === 'string' ? MARGIN_TEXT : '';
        out.help = document.querySelector('#help')?.textContent || '';
        out.tip = document.getElementById('mMargin')?.closest('[title]')?.title || '';
        return out;
      }, fresh.toString());
      t.near(r.pm, 100000 * 1.05 / 30, 'no im: margin at the entry price', 1e-9, 1e-6);
      t.near(r.pm2, r.pm, 'no im: the current price does not move it', 1e-12, 1e-9);
      t.near(r.mg, r.pm, 'account() on the entry margin', 1e-12, 1e-9);
      t.near(r.im, r.pm, 'account() backfills p.im once', 1e-12, 1e-9);
      t.near(r.order, r.cur, 'an order (no entry) is margined at the current price (decision 13)', 1e-12, 1e-9);
      t.ok(/initial margin/i.test(r.text) && /entry/i.test(r.text), 'MARGIN_TEXT states the convention: ' + r.text);
      t.ok(r.help.includes(r.text), 'Settings shows the convention');
      t.eq(r.tip, r.text, 'the Used margin figure carries the convention as its tooltip');
      t.noErrors(page);
    }
  },
  {
    name: 'M4 a leverage profile change rescales im; its preview and the result agree',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        T.move('EURUSD', 1.1);
        const e = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }), a = openPosition({ sym: 'AUDUSD', side: 'buy', lots: 1, dupOk: true });
        const im0 = [e.im, a.im], set = { ...S.set, jur: 'none', lev: 100 };
        const pre = [posMargin(e, set), posMargin(a, set)];
        applyProfile('none:100');
        return { im0, pre, im1: [e.im, a.im], mg: account().mg };
      }, fresh.toString());
      t.near(r.pre[0], r.im0[0] * 30 / 100, 'preview EURUSD: im × 30 / 100', 1e-12, 1e-9);
      t.near(r.pre[1], r.im0[1] * 20 / 100, 'preview AUDUSD: im × 20 / 100', 1e-12, 1e-9);
      t.near(r.im1[0], r.pre[0], 'applied EURUSD = preview', 1e-12, 1e-9);
      t.near(r.im1[1], r.pre[1], 'applied AUDUSD = preview', 1e-12, 1e-9);
      t.near(r.mg, r.pre[0] + r.pre[1], 'account margin after the change', 1e-12, 1e-9);
      t.noErrors(page);
    }
  },
  {
    name: 'M5 costModel(sym): commission round turn, swap per rollover (×3 Wednesday FX / Friday the rest, 0 weekend), Night spread at 23:30 server, news not in the spread',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const r = await page.evaluate(fresh => {
        eval(fresh)(); S.set.comm = 7;
        const Z = s => Date.parse(s) / 1000;
        const out = {};
        for (const sym of ['EURUSD', 'US.500', 'BTCUSD']) {
          const c = costModel(sym), m = Engine.META[sym];
          out[sym] = {
            keys: Object.keys(c).sort(), p: m.p, point: m.point, size: m.size, usdQ: Engine.usd(m.quote),
            comm2: c.commRT(2), news: c.newsInSpread,
            day: c.spreadAt(Z('2026-10-20T10:00:00Z')), night: c.spreadAt(Z('2026-10-20T20:30:00Z')), sat: c.spreadAt(Z('2026-10-24T20:30:00Z')),
            tue: c.swapNight('buy', 1, 100, Z('2026-10-20T21:00:00Z')), wed: c.swapNight('buy', 1, 100, Z('2026-10-21T21:00:00Z')),
            fri: c.swapNight('buy', 1, 100, Z('2026-10-23T21:00:00Z')), satSw: c.swapNight('buy', 1, 100, Z('2026-10-24T21:00:00Z')),
            short2: c.swapNight('sell', 2, 200, Z('2026-10-20T21:00:00Z'))
          };
        }
        // pure: news on the instrument's currency and a moved clock do not change it
        const c = costModel('EURUSD'), before = c.spreadAt(Z('2026-10-20T10:00:00Z'));
        Engine.setNewsMult('EUR', 3, Engine.simTime + 3600);
        out.newsQuote = Engine.quote('EURUSD').sp; out.pure = costModel('EURUSD').spreadAt(Z('2026-10-20T10:00:00Z')) === before;
        out.unknown = costModel('NOPE');
        return out;
      }, fresh.toString());
      const keys = ['commRT', 'newsInSpread', 'spreadAt', 'swapNight'];
      for (const sym of ['EURUSD', 'US.500', 'BTCUSD']) {
        const x = r[sym], [l, s, u] = x.p.swap;
        t.deep(x.keys, keys, sym + ': the C2 keys');
        t.near(x.comm2, (x.p.comm + 7) * 2, sym + ': commRT(2) = (sheet + account extra) × 2', 1e-12, 1e-9);
        t.eq(x.news, false, sym + ': news widening is not in spreadAt');
        const sp = k => (x.p.spread[k] + (x.p.jit ? (x.p.jit[k][0] + x.p.jit[k][1]) / 2 : 0)) * x.point;
        t.near(x.day, sp(0), sym + ': spreadAt by day = the Default spread × point', 1e-12, 1e-12);
        t.near(x.night, sp(1), sym + ': spreadAt at 23:30 server on a weekday = the Night spread', 1e-12, 1e-12);
        t.near(x.sat, sp(0), sym + ': Saturday 23:30 server is not Night', 1e-12, 1e-12);
        const night = (v, lots, px) => u === 'pts' ? v * x.point * x.size * lots * x.usdQ : lots * x.size * px * x.usdQ * v / 360;
        const n1 = night(l, 1, 100);
        if (sym === 'BTCUSD') {
          t.deep([x.tue, x.wed, x.fri, x.satSw].map(v => +v.toFixed(9)), [n1, n1, n1, n1].map(v => +v.toFixed(9)), 'crypto: every night, no triple');
        } else if (sym === 'EURUSD') {
          t.deep([x.tue, x.wed / 3, x.fri, x.satSw].map(v => +v.toFixed(9)), [n1, n1, n1, 0].map(v => +v.toFixed(9)), 'FX: ×3 on Wednesday, 0 on Saturday');
        } else {
          t.deep([x.tue, x.wed, x.fri / 3, x.satSw].map(v => +v.toFixed(9)), [n1, n1, n1, 0].map(v => +v.toFixed(9)), 'CFD: ×3 on Friday, 0 on Saturday');
        }
        t.ok(n1 !== 0, sym + ': the sheet swap is not zero');
        t.near(x.short2, night(s, 2, 200), sym + ': short 2 lots at px 200 on the short rate', 1e-12, 1e-9);
      }
      t.eq(r.newsQuote, 'news', 'the live quote is on the News spread');
      t.ok(r.pure, 'costModel is pure: the live news does not reach spreadAt');
      t.eq(r.unknown, null, 'unknown symbol → null');
      t.noErrors(page);
    }
  }
];
