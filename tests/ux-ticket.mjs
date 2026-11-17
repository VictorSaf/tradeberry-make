// UX test of the Trade page, 09.11.2026 (.mace/research/ux-2026-11-09-trade/04-report.md), the ticket's part:
// F4 plausible SL/TP when ticked, F5 a unit change converts the value, F6 figures on every key, F11 R:R '—' on an
// invalid exit, F13 a validation row under Volume (no NaN, no silent correction), F7 the preview only while the user
// works in the ticket, F10 '½' grey when half the position is below the minimum size.
const TUE_FX = new Date('2026-10-20T10:00:00Z'); // Tuesday 10:00 UTC: FX open
const setup = () => {
  T.reset(); setSymbol('EURUSD');
  Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: .01, useSL: false, useTP: false, useTrail: false, price: null });
  syncTicketInputs(); renderTicket();
};
const typeIn = (sel, v) => { const e = document.querySelector(sel); e.focus(); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); return e; };
const tick = (sel, on) => { const c = document.querySelector(sel); if (c.checked !== on) c.click(); };
const unit = (sel, v) => { const s = document.querySelector(sel); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
// the CSS rule panels3 adds for a grey button in the 'On <SYM> now' table (round 3 contract), present or not
const tkGreyCss = () => [...document.styleSheets].some(sh => { try { return [...sh.cssRules].some(r => /tk-on-tbl/.test(r.selectorText || '') && /aria-disabled="true"/.test(r.selectorText || '')); } catch { return false; } });

export const tests = [
  {
    name: 'UXTK1 F4: a remembered 824-pip stop is not reused when ticked: SL = 1.5 × ATR 1H, TP = 2R, and the ticket says where they come from; a plausible distance is kept',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const tick = ${tick}, atr = tkAtr1h('EURUSD');
        S.tk.sl = 824; S.tk.tp = 1648; syncTicketInputs(); renderTicket();
        tick('#useSL', true); renderTicket();
        const a = { sl: S.tk.sl, src: document.querySelector('#slSrc')?.textContent || '' };
        tick('#useTP', true); renderTicket();
        const b = { tp: S.tk.tp, src: document.querySelector('#tpSrc')?.textContent || '' };
        tick('#useSL', false); tick('#useTP', false); S.tk.sl = +(2 * atr).toFixed(1); syncTicketInputs();
        tick('#useSL', true); renderTicket();
        const c = { sl: S.tk.sl, src: document.querySelector('#slSrc')?.textContent || '' };
        S.tk.sl = +(S.tk.sl + 7).toFixed(1); syncTicketInputs(); renderTicket(); // a distance the user changed (never equal to the kept one)
        const d = { src: document.querySelector('#slSrc')?.textContent || '', hidden: document.querySelector('#slSrc')?.hidden };
        return { atr, a, b, c, d };
      })()`);
      t.ok(r.atr > 0, 'ATR 1H known in the test market: ' + r.atr);
      t.near(r.a.sl, +(1.5 * r.atr).toFixed(1), '824 pips is beyond 5 × ATR: the stop is 1.5 × ATR', 0, .051);
      t.eq(r.a.src, 'default: 1.5 × ATR (1H)', 'the SL row says where the value comes from');
      t.near(r.b.tp, +(2 * r.a.sl).toFixed(1), 'the target is 2R', 0, .051);
      t.eq(r.b.src, 'default: 2R', 'the TP row says where the value comes from');
      t.near(r.c.sl, +(2 * r.atr).toFixed(1), 'a 2 × ATR distance is plausible and kept', 0, .051);
      t.eq(r.c.src, 'your last distance', 'kept: the ticket says it is the last distance');
      t.ok(r.d.hidden || r.d.src === '', 'once the stop is changed the source note goes: ' + r.d.src);
      t.noErrors(page);
    }
  },
  {
    name: 'UXTK2 F5: switching the stop unit from Price to Pips converts the value (the field is not emptied)',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const tick = ${tick}, typeIn = ${typeIn}, unit = ${unit};
        tick('#useSL', true); unit('#tkSlBy', 'price'); renderTicket();
        const q = Engine.quote('EURUSD'), m = M('EURUSD'), px = +(q.ask - 30 * m.pip).toFixed(m.digits);
        typeIn('#tkSlPx', px); renderTicket();
        unit('#tkSlBy', 'pips');
        const f = document.querySelector('#tkSL');
        const pips = { v: f.value, active: document.activeElement === f, sl: S.tk.sl };
        unit('#tkSlBy', 'atr');
        const g = document.querySelector('#tkSlAtr'), atr = tkAtr1h('EURUSD');
        return { pips, atr: { v: g.value, want: (S.tk.sl / atr).toFixed(2) } };
      })()`);
      t.near(+r.pips.v, 30, 'Pips shows the distance of the price typed', 0, .051);
      t.ok(r.pips.v !== '', 'the Pips field is not empty');
      t.near(r.pips.sl, 30, 'the stop stays 30 pips', 0, .051);
      t.eq(r.atr.v, r.atr.want, 'ATR × shows the same stop in ATR multiples');
      t.noErrors(page);
    }
  },
  {
    name: 'UXTK3 F6: margin, risk and the order buttons follow the volume on the key, not on the next frame',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn};
        typeIn('#tkLots', '1');
        const want = usdFmt(tkCalc().margin), fm = document.querySelector('#tkFootM').textContent;
        typeIn('#tkLots', '0.001');
        const go = [...document.querySelectorAll('#tkGo [data-go]')].map(b => b.disabled), sub = document.querySelector('#tkSubmit').disabled;
        return { want, fm, go, sub };
      })()`);
      t.ok(r.fm.includes(r.want), `margin ${r.want} shown right after the key: ${r.fm}`);
      t.deep(r.go, [true, true], 'Sell / Buy blocked at once on an invalid size');
      t.ok(r.sub, 'order button blocked at once');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK4 F11: R:R is '—' while the take profit is invalid (price on the wrong side)",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const tick = ${tick}, typeIn = ${typeIn}, unit = ${unit};
        S.tk.sl = 15; S.tk.tp = 30; syncTicketInputs();
        tick('#useSL', true); tick('#useTP', true); renderTicket();
        const ok = document.querySelector('#tkFootM').textContent;
        unit('#tkTpBy', 'price');
        const q = Engine.quote('EURUSD'), m = M('EURUSD');
        typeIn('#tkTpPx', +(q.bid - 50 * m.pip).toFixed(m.digits)); renderTicket();
        const rrRow = [...document.querySelectorAll('#tkFootM .fm-row')].find(x => /R : R/.test(x.textContent));
        return { ok, err: document.querySelector('#tpPx').textContent, rr: rrRow ? rrRow.textContent : '', cap: document.querySelector('#tkRrCap').textContent, sum: document.querySelector('#tkSum').textContent };
      })()`);
      t.ok(/1 : 2\.00/.test(r.ok), 'valid exits: 1 : 2.00 — ' + r.ok);
      t.ok(/Take profit must be above/.test(r.err), 'the TP error is shown: ' + r.err);
      t.ok(/—/.test(r.rr) && !/1 : /.test(r.rr), "R:R row says '—': " + r.rr);
      t.ok(!/1 : /.test(r.cap), 'the R:R caption has no ratio: ' + r.cap);
      t.ok(!/1 : /.test(r.sum), 'the summary has no ratio: ' + r.sum);
      t.noErrors(page);
    }
  },
  {
    name: 'UXTK5 F13: an invalid volume gets a row under Volume with the cause and the way out; no silent fix on blur, no NaN',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn}, tick = ${tick};
        S.tk.sl = 15; S.tk.tp = 30; syncTicketInputs(); tick('#useSL', true); tick('#useTP', true);
        const f = typeIn('#tkLots', '0.001');
        const e = document.querySelector('#tkVolErr'), small = { msg: e ? e.textContent : null, cls: e ? e.className : '', inv: f.getAttribute('aria-invalid') };
        f.blur(); renderTicket();
        const blur = { msg: e ? e.textContent : null, val: f.value, lots: S.tk.lots };
        const nan = /NaN/.test(document.querySelector('.ticket').textContent);
        typeIn('#tkLots', '50');
        const big = e ? e.textContent : null, free = account().free, per = tkCalc().margin / 50, st = volOf('EURUSD')[2];
        typeIn('#tkLots', '0.05');
        const okv = { msg: e ? e.textContent : null, hidden: e ? e.hidden || getComputedStyle(e).display === 'none' : true };
        return { small, blur, nan, big, maxL: lotsWord('EURUSD', +Math.min(Math.floor(free / per / st + 1e-9) * st, Math.floor(MAX_NOTIONAL_X * account().eq / notionalUsd('EURUSD', 1) / st + 1e-9) * st).toFixed(lotDec('EURUSD'))), okv };
      })()`);
      t.eq(r.small.msg, 'Minimum 0.01 lots', 'too small: the minimum');
      t.ok(/\btk3-err\b/.test(r.small.cls), 'same class as the take-profit message: ' + r.small.cls);
      t.eq(r.small.inv, 'true', 'the field is marked invalid');
      t.eq(r.blur.msg, 'Minimum 0.01 lots', 'after blur the message stays');
      t.eq(r.blur.val, '0.001', 'the value is not corrected silently on blur');
      t.ok(!r.nan, 'no NaN anywhere in the ticket');
      t.ok(/^Needs \$[\d,]+ margin · free \$[\d,]+ · max ≈ [\d,.]+ lots$/.test(r.big), 'margin: cause and next step — ' + r.big);
      t.ok(r.big.endsWith(`max ≈ ${r.maxL}`), `max ≈ ${r.maxL} (down to the step, round 2 #5): ${r.big}`);
      t.ok(r.okv.msg === '' || r.okv.hidden, 'a valid size clears the row: ' + r.okv.msg);
      t.noErrors(page);
    }
  },
  {
    name: 'UXTK6 F7: tkPreviewActive() is false at load and after a fill, true while the user works in the ticket; "Adds to position" only then',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn};
        const fn = typeof tkPreviewActive === 'function';
        if (!fn) return { fn };
        const atLoad = tkPreviewActive();
        dirty.lines = false; typeIn('#tkLots', '0.02');
        const afterInput = tkPreviewActive(), lines1 = dirty.lines;
        document.activeElement.blur(); // round 2 #6: a fill turns the preview off only while no ticket field has the focus
        openPosition({ sym: 'EURUSD', side: 'buy', lots: .02 }); dirty.lines = false;
        const afterFill = tkPreviewActive(), lines2 = dirty.lines; renderTicket();
        const net = document.querySelector('#tkNet');
        const netOff = !net || net.hidden || !/Adds to position/.test(net.textContent);
        document.querySelector('.panel.ticket #tkLots').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        renderTicket();
        const again = tkPreviewActive(), netOn = !!net && !net.hidden && /Adds to position/.test(net.textContent);
        return { fn, atLoad, afterInput, lines1, afterFill, lines2, netOff, again, netOn };
      })()`);
      t.ok(r.fn, 'tkPreviewActive is a global function');
      t.eq(r.atLoad, false, 'false at load');
      t.eq(r.afterInput, true, 'true after typing in the ticket'); t.eq(r.lines1, true, 'the change asks the chart to redraw');
      t.eq(r.afterFill, false, 'false after a fill'); t.eq(r.lines2, true, 'the change asks the chart to redraw');
      t.ok(r.netOff, '"Adds to position" not shown after the fill');
      t.eq(r.again, true, 'back on focus in the ticket'); t.ok(r.netOn, '"Adds to position" shown while working in the ticket');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK7 F10: '½' in the ticket's 'On <SYM> now' table is grey at the minimum size, with the reason in data-tip and aria-label",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const p1 = openPosition({ sym: 'EURUSD', side: 'buy', lots: .01 }); renderTicket();
        const b1 = document.querySelector('#tkOnBody tr[data-pos] [data-act=half]');
        const one = { dis: b1.getAttribute('aria-disabled') === 'true' && !b1.disabled, title: b1.dataset.tip || '', aria: b1.getAttribute('aria-label') };
        closePosition(p1.id); openPosition({ sym: 'EURUSD', side: 'buy', lots: .1 }); renderTicket();
        const b2 = document.querySelector('#tkOnBody tr[data-pos] [data-act=half]');
        return { one, two: { dis: b2.getAttribute('aria-disabled') === 'true' || b2.disabled, aria: b2.getAttribute('aria-label') } };
      })()`);
      t.eq(r.one.dis, true, '0.01 lots: ½ grey (aria-disabled, round 2 #12)');
      t.ok(/minimum/i.test(r.one.title) && /Close/.test(r.one.title), 'data-tip gives the reason: ' + r.one.title);
      t.ok(/minimum/i.test(r.one.aria), 'aria-label gives the reason: ' + r.one.aria);
      t.eq(r.two.dis, false, '0.10 lots: ½ enabled');
      t.ok(/0\.05/.test(r.two.aria), 'aria-label says how much it closes: ' + r.two.aria);
      t.noErrors(page);
    }
  },
  /* ---- round 2 (testers, 09.11.2026): the defects left in the ticket and in the order paths that read S.tk ---- */
  {
    name: "UXTK8 #1: a size off the step (0.015) is written on blur as the size that goes (0.02), and the row says 'Rounded to 0.02 lots (step 0.01)'",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn};
        const f = typeIn('#tkLots', '0.015'), e = document.querySelector('#tkVolErr'), typing = e.textContent;
        f.blur(); renderTicket();
        return { typing, val: f.value, msg: e.textContent, inv: f.getAttribute('aria-invalid'), lots: S.tk.lots, btn: document.querySelector('#tkSubmit').textContent, k: tkCalc().lots };
      })()`);
      t.ok(/steps of 0\.01/.test(r.typing), 'while typing: the step rule: ' + r.typing);
      t.eq(r.val, '0.02', 'on blur the field shows the size that goes');
      t.eq(r.msg, 'Rounded to 0.02 lots (step 0.01)', 'the row says it was rounded');
      t.eq(r.inv, 'false', 'a rounding is not an error');
      t.eq(r.lots, .02, 'the state holds 0.02'); t.eq(r.k, .02, 'the order is 0.02');
      t.ok(/Buy 0\.02 EURUSD/.test(r.btn), 'the order button says 0.02: ' + r.btn);
      t.noErrors(page);
    }
  },
  {
    name: 'UXTK9 #2: chart long-press and the depth ladder do not offer an order with another size than the one typed: they say Minimum / Maximum',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (async () => {
        const typeIn = ${typeIn};
        for (let i = 0; i < 50 && typeof window.chartLongPress !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
        const mx = volOf('EURUSD')[1], big = String(mx * 10), pop = () => document.querySelector('.lp-pop');
        const out = { mx };
        for (const [k, v] of [['big', big], ['small', '0.001']]) {
          typeIn('#tkLots', v); document.activeElement.blur();
          window.chartLongPress(innerWidth / 2, 200);
          const p = pop(); out[k] = { orderBtns: p ? p.querySelectorAll('.lp-b[data-sd]').length : -1, text: p ? p.textContent.replace(/\\s+/g, ' ') : '', alert: !!(p && p.querySelector('[data-al]')) };
          p?.querySelector('.lp-x')?.click();
        }
        // the depth ladder, one-click on: the click is refused with the reason, nothing is sent
        S.set.oneClick = true; T.clearToasts(); renderDom();
        const row = [...document.querySelectorAll('#dom .dom-row.bid')].find(x => x.dataset.price);
        domClick({ target: row, shiftKey: false });
        out.dom = { orders: S.orders.length, toasts: T.toasts() };
        typeIn('#tkLots', big); document.activeElement.blur(); T.clearToasts(); domClick({ target: row, shiftKey: false });
        out.domBig = { orders: S.orders.length, toasts: T.toasts() };
        S.set.oneClick = false;
        return out;
      })()`);
      t.eq(r.big.orderBtns, 0, 'above the maximum: no order button in the long-press pop-up');
      t.ok(/Maximum/.test(r.big.text) && !r.big.text.includes((r.mx * 10).toLocaleString('en-US') + ' lots'), 'it says the maximum, not a size it cannot send: ' + r.big.text);
      t.ok(r.big.alert, 'the alert still works');
      t.eq(r.small.orderBtns, 0, 'below the minimum: no order button');
      t.ok(/Minimum 0\.01 lots/.test(r.small.text), 'it says the minimum: ' + r.small.text);
      t.eq(r.dom.orders, 0, 'depth ladder: nothing placed at 0.001');
      t.ok(r.dom.toasts.some(x => /blocked/i.test(x.title) && /Minimum 0\.01 lots/.test(x.body)), 'depth ladder: the reason: ' + JSON.stringify(r.dom.toasts));
      t.eq(r.domBig.orders, 0, 'depth ladder: nothing placed above the maximum');
      t.ok(r.domBig.toasts.some(x => /Maximum/.test(x.body)), 'depth ladder: the maximum: ' + JSON.stringify(r.domBig.toasts));
      t.noErrors(page);
    }
  },
  {
    name: "UXTK10 #3: TP ticked with the stop unticked: TP = 3 × ATR 1H and the row says 'default: 3 × ATR (1H)', not 2R",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const tick = ${tick}, atr = tkAtr1h('EURUSD');
        S.tk.tp = 5000; syncTicketInputs(); tick('#useTP', true); renderTicket();
        return { atr, tp: S.tk.tp, src: document.querySelector('#tpSrc').textContent, useSL: S.tk.useSL };
      })()`);
      t.eq(r.useSL, false, 'the stop stays off');
      t.near(r.tp, +(3 * r.atr).toFixed(1), 'TP = 3 × ATR', 0, .051);
      t.eq(r.src, 'default: 3 × ATR (1H)', 'the source says ATR, not R');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK11 #4: a small risk in the Risk % unit reads with 3 decimals (0.025), not '0.00'; the held value stays exact",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const tick = ${tick}, unit = ${unit};
        tick('#useSL', true); S.tk.sl = 25; S.tk.lots = .1; syncTicketInputs(); renderTicket();
        const k = tkCalc(), rp = k.riskUsd / k.a.eq * 100;
        unit('#tkSlBy', 'rpct'); document.activeElement.blur(); renderTicket();
        return { rp, v: document.querySelector('#tkSlRp').value, held: TKH.slRp, risk: document.querySelector('#tkRisk').value };
      })()`);
      t.ok(r.rp > 0 && r.rp < .1, 'a risk under 0.1%: ' + r.rp);
      t.ok(r.v !== '0.00' && +r.v > 0, 'not 0.00: ' + r.v);
      t.eq(r.v, r.rp.toFixed(3), 'three decimals');
      t.near(r.held, r.rp, 'the held value is exact', 1e-9, 1e-9);
      t.eq(r.risk, r.rp.toFixed(3), 'the Risk % of the volume row too: ' + r.risk);
      t.noErrors(page);
    }
  },
  {
    name: 'UXTK12 #6: the preview stays on through fills on another instrument, an older fill from a snapshot and any fill while a ticket field has the focus',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn};
        const f = typeIn('#tkLots', '0.02'), out = {};
        openPosition({ sym: 'GBPUSD', side: 'buy', lots: .01, dupOk: true }); out.other = tkPreviewActive();
        const old = { ...S.fills[0], fid: 99999, sym: 'EURUSD', t: S.fills[0].t - 3600 }; S.fills = [old, ...S.fills]; out.snap = tkPreviewActive();
        openPosition({ sym: 'EURUSD', side: 'buy', lots: .01, dupOk: true }); out.focused = tkPreviewActive();
        f.blur(); openPosition({ sym: 'EURUSD', side: 'sell', lots: .01, dupOk: true }); out.mine = tkPreviewActive();
        return out;
      })()`);
      t.eq(r.other, true, 'a fill on another instrument: on');
      t.eq(r.snap, true, 'an older fill from a snapshot: on');
      t.eq(r.focused, true, 'a fill on the ticket symbol while a field has the focus: on');
      t.eq(r.mine, false, 'a new fill on the ticket symbol, no field focused: off');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK13 #7: switching to risk sizing after a wrong size: the first frame shows the risk size, not 'Minimum 0.01 lots'",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn}, tick = ${tick};
        tick('#useSL', true); S.tk.sl = 20; syncTicketInputs();
        typeIn('#tkLots', '0.001'); document.activeElement.blur();
        const sb = document.querySelector('#tkSizeBy'); sb.value = 'pct'; sb.dispatchEvent(new Event('change', { bubbles: true }));
        const k = renderTicket();
        return { msg: document.querySelector('#tkVolErr').textContent, field: document.querySelector('#tkLots').value, want: lotsFmt('EURUSD', k.lots) };
      })()`);
      t.ok(!/Minimum/.test(r.msg), 'no stale minimum message: ' + r.msg);
      t.eq(r.field, r.want, 'the field shows the size of the risk');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK14 #8: a size above the new instrument's maximum is lowered with a message, not silently",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      // the testers' case: 4,000 typed on EUR/USD (over its maximum, kept as typed), then GBP/USD (same size key)
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn}, b = 'GBPUSD', mxB = volOf(b)[1];
        S.balance = 1e9; // margin for 400 lots, so the row has nothing else to say
        typeIn('#tkLots', String(volOf('EURUSD')[1] * 10)); document.activeElement.blur(); T.clearToasts();
        setSymbol(b); renderTicket();
        return { b, mxB, lots: S.tk.lots, field: document.querySelector('#tkLots').value, msg: document.querySelector('#tkVolErr').textContent, toasts: T.toasts(), word: lotsWord(b, mxB), name: pretty(b) };
      })()`);
      t.eq(r.lots, r.mxB, 'the size is the maximum of ' + r.b);
      t.eq(+r.field, r.mxB, 'the field shows it');
      t.eq(r.msg, `Size lowered to ${r.word} (maximum for ${r.name})`, 'the row says so');
      t.ok(r.toasts.some(x => x.body === `Size lowered to ${r.word} (maximum for ${r.name})`), 'and a toast: ' + JSON.stringify(r.toasts));
      t.noErrors(page);
    }
  },
  {
    name: 'UXTK15 #9: a negative size typed stays in the field only; the state keeps the last valid size',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn};
        const f = typeIn('#tkLots', '0.05'); f.blur(); typeIn('#tkLots', '-1'); // round 3 #1: 0.05 confirmed, then the edit
        const typing = { lots: S.tk.lots, msg: document.querySelector('#tkVolErr').textContent, sub: document.querySelector('#tkSubmit').disabled };
        f.blur(); renderTicket();
        const saved = JSON.parse(JSON.stringify(S.tk));
        return { typing, lots: S.tk.lots, saved: saved.lots, val: f.value };
      })()`);
      t.eq(r.typing.lots, .05, 'while typing: the state keeps 0.05');
      t.eq(r.typing.msg, 'Minimum 0.01 lots', 'the row says the minimum'); t.ok(r.typing.sub, 'the order is blocked');
      t.eq(r.lots, .05, 'after blur: the state keeps 0.05'); t.eq(r.saved, .05, 'what is saved is 0.05');
      t.eq(r.val, '-1', 'the field shows what was typed');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK16 #10: an emptied size stays empty on blur, with 'Minimum 0.01 lots' and the order blocked",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn};
        const f = typeIn('#tkLots', '0.05'); f.blur(); typeIn('#tkLots', ''); // round 3 #1: 0.05 confirmed, then the edit
        f.blur(); renderTicket();
        return { val: f.value, msg: document.querySelector('#tkVolErr').textContent, sub: document.querySelector('#tkSubmit').disabled, lots: S.tk.lots, inv: f.getAttribute('aria-invalid') };
      })()`);
      t.eq(r.val, '', 'the field stays empty');
      t.eq(r.msg, 'Minimum 0.01 lots', 'the row says the minimum'); t.eq(r.inv, 'true', 'marked invalid');
      t.ok(r.sub, 'the order is blocked'); t.eq(r.lots, .05, 'the state keeps the last valid size');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK17 #12: a grey '½' in 'On <SYM> now' is aria-disabled (focusable), and a click says why instead of closing",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        openPosition({ sym: 'EURUSD', side: 'buy', lots: .01 }); renderTicket(); T.clearToasts();
        const b = document.querySelector('#tkOnBody tr[data-pos] [data-act=half]');
        b.focus(); const focused = document.activeElement === b;
        b.click();
        return { dis: b.disabled, aria: b.getAttribute('aria-disabled'), focused, open: S.positions.length, lots: S.positions[0]?.lots, toasts: T.toasts(), op: getComputedStyle(b).opacity, css: (${tkGreyCss})() };
      })()`);
      t.eq(r.dis, false, 'not disabled'); t.eq(r.aria, 'true', 'aria-disabled=true');
      t.ok(r.focused, 'it takes the focus, so the reason is reachable from the keyboard');
      t.eq(r.open, 1, 'the position stays open'); t.eq(r.lots, .01, 'nothing closed');
      t.ok(r.toasts.some(x => /minimum/i.test(x.body)), 'the click says why: ' + JSON.stringify(r.toasts));
      // round 3 #8: the grey comes from the shared rule of panels3 (styles.css), not an inline style
      if (r.css) t.eq(r.op, '0.45', 'grey at .45'); else console.log('       note: no .tk-on-tbl button[aria-disabled="true"] rule in styles.css yet (task panels3): opacity not checked');
      t.noErrors(page);
    }
  },
  /* ---- round 3 (testers, 09.11.2026) ---- */
  {
    name: "UXTK18 r3#1: the saved size changes only on a confirmed valid value: 0.05, then '7', Backspace, Tab leaves 0.05 (also after a reload); '7' then Tab confirms 7",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn};
        S.balance = 1e9;
        const f = typeIn('#tkLots', '0.05'); f.blur(); renderTicket(); // 0.05 confirmed
        typeIn('#tkLots', '7'); const mid = S.tk.lots; typeIn('#tkLots', '');
        f.blur(); renderTicket();
        return { mid, lots: S.tk.lots, val: f.value, msg: document.querySelector('#tkVolErr').textContent, sub: document.querySelector('#tkSubmit').disabled };
      })()`);
      t.eq(r.mid, 7, 'while typing, the figures follow 7');
      t.eq(r.lots, .05, 'blur on an empty field: the state is the one at focus (0.05), not the last key (7)');
      t.eq(r.val, '', 'the field stays empty'); t.eq(r.msg, 'Minimum 0.01 lots', 'with its reason'); t.ok(r.sub, 'and the order blocked');
      await page.waitForTimeout(900); // the debounced save (400 ms) has run
      await page.reload(); await page.waitForFunction(() => typeof S === 'object' && S && typeof renderTicket === 'function' && document.querySelector('#tkLots'));
      await page.waitForTimeout(800);
      const b = await page.evaluate(() => ({ lots: S.tk.lots, val: document.querySelector('#tkLots').value }));
      t.eq(b.lots, .05, 'after a reload the ticket holds 0.05'); t.eq(b.val, '0.05', 'and shows 0.05');
      const c = await page.evaluate(`(() => {
        const typeIn = ${typeIn};
        const f = typeIn('#tkLots', '7'); f.blur(); renderTicket();
        return { lots: S.tk.lots, val: f.value };
      })()`);
      t.eq(c.lots, 7, "'7' then Tab: 7 is confirmed"); t.eq(c.val, '7.00', 'and shown as 7.00');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK19 r3#2: 'Rounded to …' and 'Size lowered …' do not come back after EURUSD → GOLD → EURUSD; tkVolClear ends them",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn}, msg = () => (renderTicket(), document.querySelector('#tkVolErr').textContent);
        S.balance = 1e9;
        const f = typeIn('#tkLots', '0.015'); f.blur(); const a = msg();
        setSymbol('GOLD'); const b = msg(); setSymbol('EURUSD'); const c = msg();
        typeIn('#tkLots', '0.015'); document.activeElement.blur(); const d1 = msg(); tkVolClear(); const d2 = msg();
        S.tk.lotsBy = { ...(S.tk.lotsBy || {}), GOLD: 1e6 }; setSymbol('GOLD'); const e = msg();
        setSymbol('EURUSD'); const g = msg(); setSymbol('GOLD'); const h = msg();
        return { a, b, c, d1, d2, e, g, h, lots: S.tk.lots };
      })()`);
      t.ok(/^Rounded to 0\.02 lots/.test(r.a), 'the rounding is said: ' + r.a);
      t.ok(!/Rounded/.test(r.b), 'not on GOLD: ' + r.b);
      t.eq(r.c, '', 'back on EUR/USD the old note does not come back');
      t.ok(/^Rounded/.test(r.d1), 'a new rounding is said'); t.eq(r.d2, '', 'tkVolClear ends it');
      t.ok(/^Size lowered to 100 lots/.test(r.e), 'lowered on GOLD: ' + r.e);
      t.eq(r.g, '', 'not on EUR/USD');
      t.eq(r.h, '', 'back on GOLD (100 lots kept, nothing lowered now): no old note');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK20 r3#3: one 'Size lowered' toast per lowering, whatever path makes it",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn}, n = () => T.toasts().filter(x => x.title === 'Size lowered').length, out = {};
        S.balance = 1e9;
        T.clearToasts(); S.tk.lotsBy = { GOLD: 1e6 }; setSymbol('GOLD'); out.kept = n();
        setSymbol('EURUSD'); T.clearToasts(); typeIn('#tkLots', volOf('EURUSD')[1] * 10); document.activeElement.blur(); setSymbol('GBPUSD'); out.carry = n();
        setSymbol('EURUSD'); S.tk.lots = volOf('EURUSD')[1]; S.tk.lotsBy.GOLD = 1e6; T.clearToasts(); setSymbol('GOLD'); syncTicketInputs(); out.group = n();
        T.clearToasts(); tkVolClear(); tkLotsLowered('GOLD'); tkLotsLowered('GOLD'); out.twice = n(); // a fresh lowering said by two paths
        return out;
      })()`);
      t.eq(r.kept, 1, 'a kept size over the maximum: one toast');
      t.eq(r.carry, 1, 'a typed size carried to a pair with the same size: one toast');
      t.eq(r.group, 1, 'a group change then another sync: one toast');
      t.eq(r.twice, 1, 'two paths saying the same lowering in one change: one toast');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK21 r3#4: quick trade with one-click off and a size over the maximum: the ticket says 'Size lowered to … (maximum for …)'",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        S.balance = 1e9; S.set.oneClick = false; T.clearToasts();
        const q = document.querySelector('#qLots'); q.value = '1000';
        quickTrade('buy'); renderTicket();
        const mx = volOf('EURUSD')[1];
        return { lots: S.tk.lots, mx, msg: document.querySelector('#tkVolErr').textContent, want: 'Size lowered to ' + lotsWord('EURUSD', mx) + ' (maximum for ' + pretty('EURUSD') + ')', toasts: T.toasts(), open: S.positions.length };
      })()`);
      t.eq(r.lots, r.mx, 'the ticket holds the maximum');
      t.eq(r.msg, r.want, 'the row says it was lowered');
      t.ok(r.toasts.some(x => x.body.includes(r.want)), 'a toast says it: ' + JSON.stringify(r.toasts));
      t.eq(r.toasts.filter(x => x.body.includes(r.want)).length, 1, 'once');
      t.eq(r.open, 0, 'nothing sent');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK22 r3#5: tkPctFmt is continuous (0.0999 → 0.10 = 0.1), 2 significant figures under 0.1%, never a row of zeros ('<0.000001')",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const v = [1e-7, 9.9e-7, 1e-6, 0.0000123, 0.00123, 0.0253, 0.0999, 0.09996, 0.1, 0.5, 2.345, 0].map(x => [x, tkPctFmt(x)]);
        const tick = ${tick};
        S.balance = 1e13; S.tk.sl = 1; S.tk.lots = .01; syncTicketInputs(); tick('#useSL', true); document.activeElement.blur(); renderTicket();
        const rk = document.querySelector('#tkRisk'), rp = document.querySelector('#tkSlRp');
        return { v, risk: { val: rk.value, ph: rk.placeholder }, slrp: { val: rp.value, ph: rp.placeholder } };
      })()`);
      const m = Object.fromEntries(r.v.map(([x, s]) => [String(x), s]));
      t.eq(m['1e-7'], '<0.000001', '1e-7 %'); t.eq(m['9.9e-7'], '<0.000001', '9.9e-7 %');
      t.eq(m['0.000001'], '0.0000010', '1e-6 %: two significant figures'); t.eq(m['0.0000123'], '0.000012', '1.23e-5 %');
      t.eq(m['0.00123'], '0.0012', '0.00123 %'); t.eq(m['0.0253'], '0.025', '0.0253 %');
      t.eq(m['0.0999'], '0.10', '0.0999 % reads as 0.1 does'); t.eq(m['0.09996'], '0.10', '0.09996 %'); t.eq(m['0.1'], '0.10', '0.1 %');
      t.eq(m['0.5'], '0.50', '0.5 %'); t.eq(m['2.345'], '2.35', '2.345 %'); t.eq(m['0'], '0.00', '0');
      for (const [x, s] of r.v) t.ok(!/e/i.test(s) && (x === 0 || !/^0\.0+$/.test(s)), 'no exponent, no row of zeros: ' + s);
      t.eq(r.risk.val, '', 'a number field cannot hold "<": the Risk % field is empty'); t.eq(r.risk.ph, '<0.000001', 'and says <0.000001 in its placeholder');
      t.eq(r.slrp.ph, '<0.000001', 'the SL risk % field too');
      t.noErrors(page);
    }
  },
  {
    name: 'UXTK23 r3#6: a fill on the ticket symbol while a field has the focus keeps the preview on until the focus leaves the ticket, then turns it off',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn}, out = {};
        const f = typeIn('#tkLots', '0.02');
        openPosition({ sym: 'EURUSD', side: 'buy', lots: .01, dupOk: true }); out.focused = tkPreviewActive();
        document.querySelector('#tkSL').focus(); out.inside = tkPreviewActive(); // still in the ticket
        document.activeElement.blur(); out.left = tkPreviewActive();
        typeIn('#tkLots', '0.03'); out.back = tkPreviewActive(); document.activeElement.blur(); out.leftNoFill = tkPreviewActive();
        return out;
      })()`);
      t.eq(r.focused, true, 'a fill while typing: on');
      t.eq(r.inside, true, 'focus moves inside the ticket: on');
      t.eq(r.left, false, 'the focus leaves the ticket: off (the fill made while typing is not forgotten)');
      t.eq(r.back, true, 'back to work in the ticket: on');
      t.eq(r.leftNoFill, true, 'leaving without a new fill: stays on');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK24 r3#7: a new fill is found by its identity, not by comparing the server's fill time with the client clock",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn}, out = {};
        openPosition({ sym: 'GBPUSD', side: 'buy', lots: .01, dupOk: true }); const proto = { ...S.fills[0] }; S.fills.length = 0;
        const f = typeIn('#tkLots', '0.02'); f.blur(); out.on = tkPreviewActive();
        // the server's clock is 5 minutes behind the client's: its fill time is before the moment the preview came on
        S.fills = [{ ...proto, fid: 7001, sym: 'EURUSD', t: Engine.simTime - 300000 }]; out.behind = tkPreviewActive();
        typeIn('#tkLots', '0.03'); f.blur(); out.on2 = tkPreviewActive();
        // a server fill ahead of the client clock, on another instrument: no effect
        S.fills = [{ ...proto, fid: 7002, sym: 'GBPUSD', t: Engine.simTime + 300000 }, ...S.fills]; out.other = tkPreviewActive();
        // the same list again (a snapshot with nothing new): no effect
        S.fills = S.fills.map(x => ({ ...x })); out.same = tkPreviewActive();
        return out;
      })()`);
      t.eq(r.on, true, 'on after working in the ticket');
      t.eq(r.behind, false, 'a new fill with a server time behind the client clock turns it off');
      t.eq(r.on2, true, 'on again');
      t.eq(r.other, true, 'a fill on another instrument: on');
      t.eq(r.same, true, 'the same fills, new objects: on');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK25 r3#8: the grey '½' has no inline style; its reason is in data-tip (as in the dock) and the grey comes from the shared CSS rule",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        openPosition({ sym: 'EURUSD', side: 'buy', lots: .01 }); renderTicket();
        const b = document.querySelector('#tkOnBody tr[data-pos] [data-act=half]');
        const one = { style: b.getAttribute('style'), title: b.getAttribute('title'), tip: b.dataset.tip || '', aria: b.getAttribute('aria-label'), match: b.matches('.tk-on-tbl button[aria-disabled="true"]'), op: getComputedStyle(b).opacity };
        closePosition(S.positions[0].id); openPosition({ sym: 'EURUSD', side: 'buy', lots: .1 }); renderTicket();
        const b2 = document.querySelector('#tkOnBody tr[data-pos] [data-act=half]');
        return { ...one, tip2: b2.dataset.tip || '', title2: b2.getAttribute('title'), css: (${tkGreyCss})() };
      })()`);
      t.eq(r.style, null, 'no inline style');
      t.eq(r.title, null, 'no title (the reason is in data-tip, shown on focus too)');
      t.ok(/minimum/i.test(r.tip) && /Close/.test(r.tip), 'data-tip gives the reason: ' + r.tip);
      t.ok(/minimum/i.test(r.aria), 'aria-label gives the reason');
      t.ok(r.match, 'the selector of the shared rule matches it');
      t.ok(/^Close 0\.05/.test(r.tip2) && r.title2 === null, "an enabled '½' says what it closes in data-tip: " + r.tip2);
      if (r.css) t.eq(r.op, '0.45', 'grey at .45 from styles.css'); else console.log('       note: no .tk-on-tbl button[aria-disabled="true"] rule in styles.css yet (task panels3): opacity not checked');
      t.noErrors(page);
    }
  },
  {
    name: "UXTK26 r3#8 repair: the '½' data-tip is really shown, on keyboard focus and on hover (grey and active), and goes away on leave",
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const tipNow = () => page.evaluate(() => { const e = document.querySelector('#brTip'); if (!e) return { on: false, txt: '' }; const cs = getComputedStyle(e); return { on: cs.display !== 'none' && e.offsetWidth > 0, txt: e.textContent, pos: cs.position }; });
      await page.evaluate(`(${setup})(), openPosition({ sym: 'EURUSD', side: 'buy', lots: .01 }), renderTicket()`);
      const half = '#tkOnBody tr[data-pos] [data-act=half]';
      await page.evaluate(`document.querySelector('${half}').scrollIntoView({ block: 'center' })`);
      // keyboard: Tab from the button before it lands on '½'
      await page.evaluate(`document.querySelector('#tkOnBody tr[data-pos] td:first-child').setAttribute('tabindex', '-1'), document.querySelector('#tkOnBody tr[data-pos] td:first-child').focus()`);
      await page.keyboard.press('Tab');
      const foc = await page.evaluate(`document.activeElement === document.querySelector('${half}')`);
      t.ok(foc, "Tab reaches the grey '½' (aria-disabled keeps it focusable)");
      const a = await tipNow();
      t.ok(a.on, 'the tip shows on keyboard focus');
      t.ok(/minimum/i.test(a.txt) && /Close/.test(a.txt), 'it gives the reason: ' + a.txt);
      t.eq(a.pos, 'fixed', 'styled by the shared #brTip rule');
      await page.keyboard.press('Tab');
      t.eq((await tipNow()).on, false, 'gone when the focus leaves');
      // hover on an active '½'
      await page.evaluate(`closePosition(S.positions[0].id), openPosition({ sym: 'EURUSD', side: 'buy', lots: .1 }), renderTicket(), document.activeElement.blur()`);
      await page.hover(half);
      const b = await tipNow();
      t.ok(b.on && /^Close 0\.05/.test(b.txt), "hover on the active '½' shows what it closes: " + b.txt);
      await page.mouse.move(2, 2);
      t.eq((await tipNow()).on, false, 'gone when the pointer leaves');
      // a re-render that removes the button does not leave the tip behind
      await page.hover(half);
      await page.evaluate(`closePosition(S.positions[0].id), renderTicket()`);
      t.eq((await tipNow()).on, false, 'gone when the row is removed');
      t.noErrors(page);
    }
  }
  ,
  {
    name: 'UXTK30 #1 (tester follow-up): a valid size still being typed is not saved; leaving the page writes the size at focus',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(`(${setup})(), (() => {
        const typeIn = ${typeIn};
        const f = typeIn('#tkLots', '0.05'); f.blur(); // 0.05 confirmed
        let saves = 0; const s0 = save; window.save = function () { saves++; return s0.apply(this, arguments); };
        typeIn('#tkLots', '7');                     // valid, not confirmed
        const typing = { lots: S.tk.lots, saves };
        window.dispatchEvent(new Event('pagehide')); // the tab goes away mid-edit
        const out = { typing, afterHide: S.tk.lots, field: f.value };
        window.save = s0; return out;
      })()`);
      t.eq(r.typing.lots, 7, 'the figures follow the typed size while editing');
      t.eq(r.typing.saves, 0, 'nothing is saved on a keystroke');
      t.eq(r.afterHide, .05, 'leaving the page mid-edit keeps the confirmed 0.05 in the state');
      t.eq(r.field, '7', 'the typed text stays in the field');
      t.noErrors(page);
    }
  }
];
