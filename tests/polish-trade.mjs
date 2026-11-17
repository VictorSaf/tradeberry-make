// Ticket on the instrument sheet (.mace/design/catalog.md §5, Ticket): sizes on the sheet's min/max/step with their
// unit (lots of 100,000 EUR, shares, lots · $50 per point), default stop and target per symbol from the simulated
// hourly volatility, the order button blocked with its reason (market closed with the opening time, close only, too
// close for a pending order), leverage and swap words from the sheet, and the command bar on dotted symbols.
// Expected values are worked out here from CATALOG and raw quotes.
const TUE_FX = new Date('2026-10-20T10:00:00Z');  // Tuesday, EEST: FX, GOLD and US.500 open, US stocks closed (13:35–19:55 UTC)
const TUE_STK = new Date('2026-10-20T15:00:00Z'); // US stocks open
const raw = `s => CATALOG.instr.find(r => r.sym === s)`;

export const tests = [
  {
    name: 'PT1 sheet instruments are a martingale: mean price over 2000 short paths stays at the start (GOLD, US.500, BTCUSD)',
    async run({ t, open }) {
      const page = await open('/tests/engine.html?seed=7', { clock: TUE_FX });
      const r = await page.evaluate(async () => {
        await Engine.init();
        return Object.fromEntries(['GOLD', 'US.500', 'BTCUSD'].map(s => [s, Engine.probeX(s, 2000, 60, 5)]));
      });
      for (const [s, p] of Object.entries(r)) {
        t.ok(p && p.n === 2000 && p.se > 0, `${s}: probe ran 2000 paths`);
        t.ok(Math.abs(p.mean) <= 3 * p.se, `${s}: mean ${p.mean.toExponential(2)} within 3 SE (${p.se.toExponential(2)})`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'PT2 AAPL.US ticket: step, min and max from the sheet on #tkLots and #qLots, whole shares, unit "shares", the stepper moves by one share',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_STK });
      const r = await page.evaluate(() => {
        T.reset();
        setSymbol('AAPL.US');
        Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 2.4, useSL: false, useTP: false, useTrail: false });
        syncTicketInputs(); renderTicket();
        const L = document.querySelector('#tkLots'), Q = document.querySelector('#qLots');
        const attrs = e => ({ step: e.step, min: e.min, max: e.max });
        const a = { tk: attrs(L), q: attrs(Q), val: L.value, lots: S.tk.lots, label: document.querySelector('#tkCtr').textContent, hint: document.querySelector('#sizeHint').textContent };
        document.querySelector('[data-step="lots:1"]').click(); renderTicket();
        const up = { lots: S.tk.lots, val: L.value, btn: document.querySelector('#tkSubmit').textContent };
        document.querySelector('[data-step="lots:-1"]').click(); document.querySelector('[data-step="lots:-1"]').click(); document.querySelector('[data-step="lots:-1"]').click();
        const floor = S.tk.lots;
        S.tk.lots = 3; syncTicketInputs(); renderTicket(); submitTicket();
        const p = S.positions[0] && { sym: S.positions[0].sym, lots: S.positions[0].lots };
        if (S.positions[0]) closePosition(S.positions[0].id); // netting: an open position would make the ticket size an add to it
        // risk sizing gives whole shares
        Object.assign(S.tk, { sm: 'risk', risk: 1, useSL: true, sl: 500 }); syncTicketInputs(); const k = renderTicket();
        setSymbol('EURUSD'); renderTicket();
        const fx = { tk: attrs(L), q: attrs(Q), val: L.value, label: document.querySelector('#tkCtr').textContent };
        setSymbol('XRPUSD'); S.tk.sm = 'lots'; S.tk.lots = 1; syncTicketInputs();
        const xrp = { lots: S.tk.lots, step: L.step, min: L.min };
        return { a, up, floor, p, risk: k.lots, fx, xrp };
      });
      t.deep(r.a.tk, { step: '1', min: '1', max: '10000' }, '#tkLots on the AAPL.US sheet');
      t.deep(r.a.q, { step: '1', min: '1', max: '10000' }, '#qLots on the AAPL.US sheet');
      t.eq(r.a.lots, 2, '2.4 shares become 2 (the step)'); t.eq(r.a.val, '2', 'shown without decimals');
      t.ok(/shares/.test(r.a.label), 'size label in shares: ' + r.a.label);
      t.ok(/^2 shares/.test(r.a.hint), 'size hint in shares: ' + r.a.hint);
      t.eq(r.up.lots, 3, 'the + button adds one share'); t.eq(r.up.val, '3', 'field 3');
      t.eq(r.up.btn, 'Buy 3 shares AAPL.US', 'order button in shares');
      t.eq(r.floor, 1, 'the − button stops at the sheet minimum (1 share)');
      t.deep(r.p, { sym: 'AAPL.US', lots: 3 }, 'the ticket opens 3 shares');
      t.ok(Number.isInteger(r.risk) && r.risk >= 1, 'risk sizing in whole shares: ' + r.risk);
      t.deep(r.fx.tk, { step: '0.01', min: '0.01', max: '400' }, '#tkLots on EURUSD');
      t.deep(r.fx.q, { step: '0.01', min: '0.01', max: '400' }, '#qLots on EURUSD');
      t.ok(/\.\d\d$/.test(r.fx.val), 'two decimals on FX: ' + r.fx.val);
      t.ok(/lots \(100,000 EUR\)/.test(r.fx.label), 'FX size label: ' + r.fx.label);
      t.deep(r.xrp, { lots: 100, step: '100', min: '100' }, 'XRPUSD: 1 becomes the minimum of 100');
      t.noErrors(page);
    }
  },
  {
    name: 'PT3 order button blocked with the reason: AAPL.US at night names the opening time, CLOSE ONLY names the rule, quick trade too',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(() => {
        T.reset();
        setSymbol('AAPL.US');
        Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 1, useSL: false, useTP: false, useTrail: false });
        syncTicketInputs(); renderTicket();
        const b = document.querySelector('#tkSubmit'), qb = document.querySelector('#qBuy');
        const night = { text: b.textContent, disabled: b.disabled, q: qb.disabled, qt: qb.title, why: marketWhy('AAPL.US'), warn: document.querySelector('#tkMkt').textContent };
        submitTicket(); const sent = S.positions.length;
        setSymbol('EURTRY'); renderTicket();
        const co = { text: b.textContent, disabled: b.disabled, q: qb.disabled };
        setSymbol('EURUSD'); renderTicket();
        return { night, sent, co, open: { disabled: b.disabled, q: qb.disabled } };
      });
      t.ok(/^Market closed — opens Tue \d\d:\d\d \(local\) \/ 13:35 UTC$/.test(r.night.text), 'button names the opening: ' + r.night.text);
      t.eq(r.night.text, r.night.why, 'same words as the refusal');
      t.ok(r.night.disabled, 'button inactive'); t.ok(r.night.q, 'quick buy inactive'); t.eq(r.night.qt, r.night.why, 'quick buy says why');
      t.ok(r.night.warn.includes(r.night.why), 'said once at the top of the ticket (C v3: not repeated in the list)');
      t.eq(r.sent, 0, 'nothing sent');
      t.ok(/close only/.test(r.co.text) && r.co.disabled && r.co.q, 'CLOSE ONLY: blocked with the rule: ' + r.co.text);
      t.ok(!r.open.disabled && !r.open.q, 'EURUSD open: not blocked');
      t.noErrors(page);
    }
  },
  {
    name: 'PT4 ticket blocks a stop inside the spread on GOLD (market and pending), openPosition gives the same reason',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(() => {
        T.reset();
        setSymbol('GOLD');
        Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: .1, sl: 20, useSL: true, useTP: false, useTrail: false });
        syncTicketInputs(); renderTicket();
        const q = Engine.quote('GOLD'), btn = document.querySelector('#tkSubmit');
        const mk = { text: btn.textContent, disabled: btn.disabled, spread: q.spread };
        S.tk.ot = 'stop'; S.tk.price = null; syncTicketInputs(); renderTicket();
        const pend = { text: btn.textContent, disabled: btn.disabled, price: S.tk.price, ask: q.ask };
        S.tk.ot = 'market'; S.tk.price = null; syncTicketInputs();
        const p = openPosition({ sym: 'GOLD', side: 'buy', lots: .1, sl: q.ask - 20 * .01, dupOk: true });
        const rej = lastReject;
        S.tk.sl = 400; renderTicket();
        return { mk, pend, p, rej, wide: { text: btn.textContent, disabled: btn.disabled } };
      });
      const why = `Stop inside the spread (${r.mk.spread.toFixed(1)} pt) — widen it`;
      t.eq(r.mk.text, why, 'market ticket: button names the reason'); t.ok(r.mk.disabled, 'market ticket: blocked');
      t.ok(r.pend.price - r.pend.ask >= 225 * .01 - 1e-9, `default stop price ${r.pend.price} clears the minimum pending distance from the ask ${r.pend.ask}`);
      t.eq(r.pend.text, why, 'stop order ticket: same reason'); t.ok(r.pend.disabled, 'stop order ticket: blocked');
      t.eq(r.p, null, 'openPosition refuses it'); t.ok(r.rej.includes(why), 'openPosition: inside-the-spread reason, got ' + r.rej);
      t.ok(!r.wide.text.includes('inside the spread') && !r.wide.disabled, 'a stop wider than the spread goes: ' + r.wide.text);
      t.noErrors(page);
    }
  },
  {
    name: 'PT5 default stop per symbol = max(2 × hourly σ × price, 3 × spread), target 2 × stop; the G8 pairs keep the FX values; explicit values remembered',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(raw => {
        const R = eval(raw); T.reset();
        const vals = () => ({ sl: S.tk.sl, tp: S.tk.tp, trail: S.tk.trail });
        const want = s => { const c = R(s), q = Engine.quote(s), m = Engine.META[s]; const sl = Math.ceil(Math.max(3 * Math.max(m.spread, q.spread), 2 * c.seed.sIn * q.bid / m.pip)); return { sl, tp: 2 * sl, trail: sl }; };
        setSymbol('EURUSD'); renderTicket(); const eu = vals();
        const out = { eu };
        for (const s of ['GOLD', 'US.500', 'AAPL.US', 'USDTRY', 'BTCUSD']) { setSymbol(s); renderTicket(); out[s] = { got: vals(), want: want(s), text: document.querySelector('#tkSubmit').textContent }; }
        setSymbol('GBPUSD'); out.gbp = vals();
        setSymbol('GOLD'); S.tk.sl = 777; syncTicketInputs();
        setSymbol('EURUSD'); out.eu3 = S.tk.sl;
        setSymbol('GOLD'); out.gold2 = S.tk.sl; out.by = S.tk.bySym && S.tk.bySym.GOLD;
        // a multi-chart pane on another instrument uses that instrument's distances
        out.dist = { eu: tkDistFor('EURUSD').sl, gold: tkDistFor('GOLD').sl, us: tkDistFor('US.500'), usWant: want('US.500') };
        return out;
      }, raw);
      t.deep(r.eu, { sl: 20, tp: 40, trail: 15 }, 'EURUSD keeps the FX defaults');
      for (const s of ['GOLD', 'US.500', 'AAPL.US', 'USDTRY', 'BTCUSD']) {
        t.deep(r[s].got, r[s].want, `${s}: default from the sheet volatility`);
        t.ok(!/spread/.test(r[s].text), `${s}: the default stop is not inside the spread: ${r[s].text}`);
      }
      t.deep(r.gbp, r.eu, 'GBPUSD (G8) shares the FX values');
      t.eq(r.eu3, 20, 'EURUSD not affected by the gold stop'); t.eq(r.gold2, 777, 'the explicit gold stop is remembered');
      t.ok(r.by && r.by.sl === 777, 'stored in S.tk.bySym under GOLD');
      t.eq(r.dist.eu, 20, 'an EURUSD pane uses the FX stop while the ticket is on gold'); t.eq(r.dist.gold, 777, 'the ticket symbol uses the ticket values');
      t.deep(r.dist.us, r.dist.usWant, 'a US.500 pane gets its own default');
      t.noErrors(page);
    }
  },
  {
    name: 'PT6 US.500 ticket: "lots · 1 pt (0.01) = $0.50", leverage and swap words from the sheet, jurisdiction cap named when it cuts',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(() => {
        T.reset(); S.set.jur = 'none'; S.set.lev = null;
        setSymbol('US.500'); Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 1 }); syncTicketInputs(); renderTicket();
        const stats = () => Object.fromEntries([...document.querySelectorAll('#tkStats dt')].map(d => [d.textContent, d.nextElementSibling.textContent]));
        const a = { label: document.querySelector('#tkCtr').textContent, hint: document.querySelector('#sizeHint').textContent, st: stats(), btn: document.querySelector('#tkSubmit').textContent };
        S.set.jur = 'eu'; renderTicket(); const eu = stats();
        setSymbol('EURUSD'); renderTicket(); const fx = stats();
        return { a, eu, fx };
      });
      t.ok(/lots · 1 pt \(0\.01\) = \$0\.50/.test(r.a.label), 'size label: what one pt is worth per lot: ' + r.a.label);
      t.ok(/1 pt \(0\.01\) = \$/.test(r.a.hint), 'size hint: one pt for this size: ' + r.a.hint);
      t.eq(r.a.btn, 'Buy 1.00 US.500', 'order button');
      t.ok(/^\S+ 1:100 · sheet, major index$/.test(r.a.st['Margin required']), 'leverage from the sheet: ' + r.a.st['Margin required']);
      t.ok(/−5\.00%\/yr/.test(r.a.st['Swap / night']), 'swap in % a year: ' + r.a.st['Swap / night']);
      t.ok(/−5\.00% long \/ −5\.00% short a year/.test(r.a.st['Swap basis']) && /triple on Friday/.test(r.a.st['Swap basis']), 'swap basis: ' + r.a.st['Swap basis']);
      t.ok(/1:20 · EU retail cap for major index/.test(r.eu['Margin required']), 'jurisdiction cap named: ' + r.eu['Margin required']);
      t.ok(/−9\.217 pts\/night/.test(r.fx['Swap / night']), 'FX swap in points: ' + r.fx['Swap / night']);
      t.ok(/triple on Wednesday/.test(r.fx['Swap basis']), 'FX triple: ' + r.fx['Swap basis']);
      t.noErrors(page);
    }
  },
  {
    name: 'PT7 command bar: dotted symbols and their aliases, "buy 1 US.500" opens one lot, shares in whole steps, closed market blocks',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(() => {
        T.reset();
        const fs = ['us.500', 'US.500', 'us500', 'aapl', 'aapl.us', 'de30', 'de.30', 'brk.b', 'eurusd', 'eur/usd', 'sl', 'be', 'at', 'nothing'].map(x => [x, findSym(x)]);
        const c = parseCmd('buy 1 US.500'), d = { desc: c.desc, block: c.block };
        c.run(); const p = S.positions[0];
        const a = parseCmd('buy 3 aapl');
        return { fs: Object.fromEntries(fs), d, p: p && { sym: p.sym, lots: p.lots }, aapl: { desc: a.desc, block: a.block }, sym: S.set.sym };
      });
      t.deep(r.fs, { 'us.500': 'US.500', 'US.500': 'US.500', us500: 'US.500', aapl: 'AAPL.US', 'aapl.us': 'AAPL.US', de30: 'DE.30', 'de.30': 'DE.30', 'brk.b': 'BRK.B.US', eurusd: 'EURUSD', 'eur/usd': 'EURUSD', sl: null, be: null, at: null, nothing: null }, 'findSym');
      t.eq(r.d.desc, 'Buy 1.00 US.500 at market', 'description'); t.ok(!r.d.block, 'not blocked: ' + r.d.block);
      t.deep(r.p, { sym: 'US.500', lots: 1 }, 'one lot of US.500 opened');
      t.eq(r.aapl.desc, 'Buy 3 shares AAPL.US at market', 'shares in the description');
      t.ok(/^Market closed — opens Tue \d\d:\d\d \(local\) \/ 13:35 UTC$/.test(r.aapl.block), 'closed market blocks with the opening: ' + r.aapl.block);
      const pg = await app('', { clock: TUE_STK });
      const s = await pg.evaluate(() => { T.reset(); const a = parseCmd('buy 2.4 aapl'), b = parseCmd('buy 0.4 aapl'); a.run(); return { a: a.desc, ab: a.block, b: b.block, p: S.positions[0] && S.positions[0].lots }; });
      t.eq(s.a, 'Buy 2 shares AAPL.US at market', '2.4 shares on the step'); t.ok(!s.ab, 'open market: ' + s.ab); t.eq(s.p, 2, '2 shares opened');
      t.eq(s.b, 'Minimum size is 1 share', 'under the minimum: ' + s.b);
      t.noErrors(page); t.noErrors(pg);
    }
  },
  {
    name: 'PT8 pending orders: the minimum distance from the sheet is hinted, and a price inside it blocks the button',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(() => {
        T.reset();
        setSymbol('GOLD'); Object.assign(S.tk, { side: 'buy', ot: 'limit', sm: 'lots', lots: .1, useSL: false, useTP: false, useTrail: false, price: null }); syncTicketInputs(); renderTicket();
        const h = document.querySelector('#tkPendHint'), b = document.querySelector('#tkSubmit'), q = Engine.quote('GOLD');
        const ok = { hint: h && h.textContent, hidden: h && h.hidden, disabled: b.disabled };
        S.tk.price = +(q.ask - 1).toFixed(2); syncTicketInputs(); renderTicket();
        const near = { text: b.textContent, disabled: b.disabled };
        S.tk.ot = 'market'; S.tk.price = null; syncTicketInputs(); renderTicket();
        return { ok, near, mk: { hidden: h.hidden } };
      });
      t.eq(r.ok.hint, 'At least 225 pt (2.25) from the ask', 'hint'); t.eq(r.ok.hidden, false, 'shown for a pending order'); t.ok(!r.ok.disabled, 'default price is valid');
      t.eq(r.near.text, 'Too close to the market: at least 225 pt from the ask', 'too close: blocked'); t.ok(r.near.disabled, 'button inactive');
      t.ok(r.mk.hidden, 'hidden for a market order');
      t.noErrors(page);
    }
  },
  {
    name: 'PT9 the size is kept per instrument: a symbol switch never inflates the size set on EURUSD (ticket and quick trade)',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_STK });
      const r = await page.evaluate(() => {
        T.reset(); S.set.oneClick = true; syncOneClick();
        setSymbol('EURUSD');
        Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: .1, useSL: false, useTP: false, useTrail: false }); syncTicketInputs(); renderTicket();
        const L = document.querySelector('#tkLots'), Q = document.querySelector('#qLots');
        Q.value = '0.10';
        const seen = [];
        const at = s => { setSymbol(s); renderTicket(); seen.push({ s, tk: S.tk.lots, L: L.value, Q: Q.value }); };
        at('AAPL.US'); at('EURUSD'); at('XRPUSD'); at('EURUSD'); at('XRPUSD'); at('BTCUSD'); at('GOLD'); at('DE.30'); at('EURUSD');
        document.querySelector('#qBuy').click();
        const p = S.positions[0];
        return { seen, p: p && { sym: p.sym, lots: p.lots }, mn: { btc: volOf('BTCUSD')[0], gold: volOf('GOLD')[0], de: volOf('DE.30')[0] } };
      });
      const g = s => r.seen.filter(x => x.s === s);
      for (const x of g('EURUSD')) { t.eq(x.tk, .1, 'EURUSD ticket size comes back as 0.10'); t.eq(x.L, '0.10', '#tkLots 0.10'); t.eq(x.Q, '0.10', '#qLots 0.10'); }
      t.eq(g('AAPL.US')[0].tk, 1, 'AAPL.US: the sheet minimum (1 share)');
      for (const x of g('XRPUSD')) { t.eq(x.tk, 100, 'XRPUSD: its minimum, 100 lots'); t.eq(x.Q, '100', '#qLots 100'); }
      for (const [s, k] of [['BTCUSD', 'btc'], ['GOLD', 'gold'], ['DE.30', 'de']]) { const x = g(s)[0]; t.eq(x.tk, r.mn[k], `${s} seen first: its sheet minimum, not the size of the symbol left`); t.eq(+x.Q, r.mn[k], `${s} quick size: its minimum`); }
      t.deep(r.p, { sym: 'EURUSD', lots: .1 }, 'one-click buy opens the 0.10 lots set, not 1.00 or 100');
      t.noErrors(page);
    }
  },
  {
    name: 'PT10 one-click quick trade sends the size typed: outside the sheet it is refused with the reason, never clamped; the instrument card renders',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_STK });
      const r = await page.evaluate(() => {
        T.reset(); S.set.oneClick = true; syncOneClick();
        const Q = document.querySelector('#qLots'), out = [];
        for (const [s, v] of [['BCHEUR', '30'], ['EURUSD', '0.001'], ['XRPUSD', '0.5'], ['EURUSD', '5000']]) {
          setSymbol(s); renderTicket(); Q.value = v; lastReject = '';
          document.querySelector('#qBuy').click();
          out.push({ s, v, n: S.positions.length, why: lastReject.toLowerCase(), Q: Q.value });
        }
        // the Specifications panel (instrCard) has a 'Triple swap' row: FX Wednesday, the rest Friday, crypto none
        const tri = sym => { const d = document.createElement('div'); d.innerHTML = instrCard(sym); const r = [...d.querySelectorAll('.ins-g > div')].find(x => x.querySelector('dt').textContent === 'Triple swap'); return r ? r.querySelector('dd').textContent : null; };
        let triple = null, err = '';
        try { triple = ['EURUSD', 'GOLD', 'US.500', 'AAPL.US', 'BTCUSD'].map(tri); } catch (e) { err = String(e); }
        return { out, err, triple };
      });
      const want = { BCHEUR: 'maximum size is 10 lots per order', EURUSD: 'minimum size is 0.01 lots', XRPUSD: 'minimum size is 100 lots' };
      for (const x of r.out) {
        t.eq(x.n, 0, `${x.s} ${x.v}: no position opened`);
        t.eq(x.Q, x.v, `${x.s}: #qLots still shows ${x.v}`);
      }
      for (const x of r.out.slice(0, 3)) t.ok(x.why.includes(want[x.s]), `${x.s} ${x.v}: refused with "${want[x.s]}" (${x.why})`);
      t.ok(r.out[3].why.includes('maximum size is 400 lots per order'), `EURUSD 5000: refused with the sheet maximum (${r.out[3].why})`);
      t.eq(r.err, '', 'instrCard does not throw');
      t.deep((r.triple || []).map(x => x && x.split(';')[0]), ['Triple on Wednesday', 'Triple on Friday', 'Triple on Friday', 'Triple on Friday', 'Every night, no triple (crypto convention)'], 'Specifications name the triple-swap day: FX Wednesday, the rest Friday, crypto none');
      t.noErrors(page);
    }
  }
];
