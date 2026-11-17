// UX 09.11.2026 · dock (panels.js): F9 the position's ✕ in view at 1086 / 1243 / 1440, F8 'BE' and F10 '½' grey with
// the reason when they cannot act, F12 Orders SL/TP as prices, F14 History costs (Costs, Net, UTC), F17 targets >= 24 px.
// Layout is measured after it settles (waitForFunction), not after a fixed wait (lesson 2026-10-25).
const OPEN = async (page, w) => {
  await page.setViewportSize({ width: w, height: 900 });
  await page.evaluate(() => {
    T.reset();
    openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.01, dupOk: true });
    openPosition({ sym: 'GBPUSD', side: 'sell', lots: 0.1, dupOk: true });
    setTab('positions'); dirty.pos = true; renderPositions();
  });
  // the dock unfolds once it holds a position: wait until the rows have a real height and the pane stops resizing
  await page.waitForFunction(() => {
    const tab = document.querySelector('.dock .tab.on[data-pane=positions]'), x = document.querySelector('#posBody tr [data-act=close]');
    if (!tab || !x) return false;
    const r = tab.getBoundingClientRect(), k = `${r.width}|${r.height}|${x.getBoundingClientRect().right}`;
    const same = window.__uxpK === k; window.__uxpK = k; return r.height > 60 && same;
  }, null, { timeout: 10000, polling: 150 });
};

export const tests = [
  {
    name: 'UXP1 dock F9: the position ✕ stays inside the dock at 1086, 1243 and 1440 px (sticky action column, nothing hidden)',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      for (const w of [1086, 1243, 1440]) {
        await OPEN(page, w);
        const r = await page.evaluate(() => {
          const dock = document.querySelector('.dock').getBoundingClientRect(), tab = document.querySelector('.dock .tab.on').getBoundingClientRect();
          return [...document.querySelectorAll('#posBody tr[data-id]')].map(tr => {
            const x = tr.querySelector('[data-act=close]'), b = x.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2, hit = document.elementFromPoint(cx, cy);
            const acts = [...tr.querySelectorAll('.acts button')].map(e => { const q = e.getBoundingClientRect(); return q.left >= tab.left - 1 && q.right <= tab.right + 1; });
            return { x: [Math.round(b.left), Math.round(b.right)], dock: [Math.round(dock.left), Math.round(dock.right)], tab: Math.round(tab.right),
              inside: b.left >= dock.left - 1 && b.right <= dock.right + 1 && b.right <= tab.right + 1, hit: hit === x || x.contains(hit), acts: acts.every(Boolean),
              cells: tr.children.length, heads: tr.closest('table').tHead.rows[0].cells.length, pos: getComputedStyle(x.closest('td')).position };
          });
        });
        t.ok(r.length === 2, `${w}px: two position rows`);
        for (const x of r) {
          t.ok(x.inside, `${w}px: ✕ inside the dock: ${JSON.stringify(x)}`);
          t.ok(x.hit, `${w}px: ✕ is the element at its own centre (not covered)`);
          t.ok(x.acts, `${w}px: ½, BE, Rev and ✕ all inside the pane`);
          t.eq(x.cells, x.heads, `${w}px: no column removed (one cell per head)`);
          t.eq(x.pos, 'sticky', `${w}px: the action column is sticky`);
        }
      }
      t.noErrors(page);
    }
  },
  {
    name: 'UXP2 dock F8/F10: BE grey until the price is past entry, ½ grey at the minimum size; a grey ½ closes nothing',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      await OPEN(page, 1440);
      const r = await page.evaluate(async () => {
        const row = sym => document.querySelector(`#posBody tr[data-id="${S.positions.find(p => p.sym === sym).id}"]`);
        const st = (sym, act) => { const b = row(sym).querySelector(`[data-act=${act}]`); return { off: b.getAttribute('aria-disabled') === 'true', tip: b.dataset.tip, label: b.getAttribute('aria-label'), col: getComputedStyle(b).color }; };
        renderPositions();
        const out = { be0: st('EURUSD', 'be'), half0: st('EURUSD', 'half'), half1: st('GBPUSD', 'half'), tx3: getComputedStyle(document.documentElement).getPropertyValue('--tx3').trim() };
        // the price moves past the entry: BE can act
        const p = S.positions.find(x => x.sym === 'EURUSD');
        T.move('EURUSD', p.entry + 30 * M('EURUSD').pip); renderPositions();
        out.be1 = st('EURUSD', 'be');
        // the stop at entry: BE grey again, with that reason
        p.sl = p.entry; renderPositions(); out.be2 = st('EURUSD', 'be');
        // a click on the grey ½ keeps the position and says why
        T.clearToasts(); const n = S.positions.length;
        row('EURUSD').querySelector('[data-act=half]').click(); await new Promise(r => setTimeout(r, 60));
        out.afterHalf = { n: S.positions.length, was: n, lots: S.positions.find(x => x.sym === 'EURUSD')?.lots, toasts: T.toasts().map(x => x.title) };
        return out;
      });
      t.ok(r.be0.off && /not past entry/i.test(r.be0.tip) && /not past entry/i.test(r.be0.label), 'BE grey with "Price is not past entry yet": ' + JSON.stringify(r.be0));
      t.ok(r.half0.off && /Minimum size: use Close/.test(r.half0.tip) && /minimum size/i.test(r.half0.label), '½ grey at 0.01 lots with the reason: ' + JSON.stringify(r.half0));
      t.ok(!r.half1.off && /0\.05 of 0\.10/.test(r.half1.tip), '½ active at 0.10 lots, says how much: ' + JSON.stringify(r.half1));
      t.ok(!r.be1.off, 'BE active once the price is past the entry: ' + JSON.stringify(r.be1));
      t.ok(r.be2.off && /already at break-even/i.test(r.be2.tip), 'BE grey when the stop is already at entry: ' + JSON.stringify(r.be2));
      t.ok(r.afterHalf.n === r.afterHalf.was && r.afterHalf.lots === 0.01, 'the grey ½ closed nothing: ' + JSON.stringify(r.afterHalf));
      t.ok(r.afterHalf.toasts.some(x => /Can't close half/.test(x)), 'it says why: ' + JSON.stringify(r.afterHalf.toasts));
      t.noErrors(page);
    }
  },
  {
    name: 'UXP3 dock F12/F14/F17: Orders SL/TP as prices; History Closed (UTC), P&L (gross), Costs, Net; action targets >= 24 px',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      await OPEN(page, 1243);
      const r = await page.evaluate(async () => {
        const m = M('EURUSD'), q = Engine.quote('EURUSD'), price = +(q.ask - 50 * m.pip).toFixed(m.digits);
        placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price, lots: 0.1, slPips: 20, tpPips: 40 });
        setTab('orders'); dirty.ord = true; renderOrders(); await new Promise(r => requestAnimationFrame(r));
        const o = S.orders[0], tr = document.querySelector(`#ordBody tr[data-id="${o.id}"]`);
        const ord = { sl: tr.querySelector('[data-c=sl]').firstChild.textContent, tp: tr.querySelector('[data-c=tp]').firstChild.textContent, slTitle: tr.querySelector('[data-c=sl]').title,
          wantSl: fp('EURUSD', o.price - 20 * m.pip), wantTp: fp('EURUSD', o.price + 40 * m.pip) };
        const ordBtn = tr.querySelector('[data-act=cancel]').getBoundingClientRect();
        // history: one row with commission and swap, one without commission (older save)
        S.history = [
          { id: 801, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.101, open: Engine.simTime - 7200, close: Engine.simTime - 3600, pnl: 98, pips: 10, r: 1, reason: 'Manual', note: '', setup: '', swap: -2, comm: 7, slip: .2 },
          { id: 802, sym: 'EURUSD', side: 'sell', lots: 1, entry: 1.1, exit: 1.099, open: Engine.simTime - 7200, close: Engine.simTime - 3000, pnl: 100, pips: 10, r: 1, reason: 'Manual', note: '', setup: '', swap: 0 }
        ];
        setTab('history'); dirty.hist = true; renderHistory(); await new Promise(r => requestAnimationFrame(r));
        const heads = [...document.querySelector('#histBody').closest('table').tHead.rows[0].cells].map(c => c.textContent);
        const rows = [...document.querySelectorAll('#histBody tr')].map(tr => ({ n: tr.children.length, gross: tr.children[8].textContent, reason: tr.children[9].textContent, costs: tr.querySelector('[data-c=costs]').textContent, net: tr.querySelector('[data-c=net]').textContent, tip: tr.querySelector('[data-c=costs]').title }));
        // a second render keeps one set of heads
        dirty.hist = true; renderHistory(); const heads2 = document.querySelector('#histBody').closest('table').tHead.rows[0].cells.length;
        setTab('positions'); renderPositions(); await new Promise(r => requestAnimationFrame(r));
        const pos = [...document.querySelectorAll('#posBody tr[data-id] .acts button')].map(b => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; });
        return { ord, ordBtn: [Math.round(ordBtn.width), Math.round(ordBtn.height)], heads, heads2, rows, pos, usd: [usdFmt(100, true), usdFmt(-9, true), usdFmt(91, true)] };
      });
      t.deep([r.ord.sl, r.ord.tp], [r.ord.wantSl, r.ord.wantTp], 'Orders SL/TP shown as prices (order price ± distance)');
      t.ok(/20 pips from the fill/.test(r.ord.slTitle), 'the distance stays in the tip: ' + r.ord.slTitle);
      t.deep([r.heads[0], r.heads[8], r.heads[9], r.heads[10], r.heads[11]], ['Closed (UTC)', 'P&L (gross)', 'Reason', 'Comm + swap', 'Net'], 'History heads: ' + r.heads.join(' | '));
      t.eq(r.heads2, 12, 'heads added once');
      const [a, b] = r.rows;
      t.eq(a.n, 12, 'one cell per head');
      t.deep([a.gross, a.costs, a.net], r.usd, 'gross = pnl − swap, costs = swap − commission, net = pnl − commission');
      t.ok(/Commission/.test(a.tip) && /swap/.test(a.tip) && /slippage/.test(a.tip), 'the costs tip itemises them: ' + a.tip);
      t.deep([b.costs, b.net], ['—', '—'], 'no commission recorded: costs and net are "—", nothing invented');
      t.ok(r.ordBtn[0] >= 24 && r.ordBtn[1] >= 24, 'Orders Cancel >= 24 × 24: ' + r.ordBtn);
      t.ok(r.pos.every(([w, h]) => w >= 24 && h >= 24), 'every position action >= 24 × 24: ' + JSON.stringify(r.pos));
      // the ticket's "On EURUSD now" table: Close #N >= 24 × 24
      const tk = await page.evaluate(async () => {
        setSymbol('EURUSD'); if (typeof tkOnSymRender === 'function') tkOnSymRender('EURUSD');
        await new Promise(r => requestAnimationFrame(r));
        const bs = [...document.querySelectorAll('#tkOnBody .acts button')].filter(b => b.offsetParent);
        return bs.map(b => { const x = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), Math.round(x.width), Math.round(x.height)]; });
      });
      t.ok(tk.length > 0, 'the ticket shows the EURUSD position actions: ' + JSON.stringify(tk));
      t.ok(tk.every(([, w, h]) => w >= 24 && h >= 24), 'ticket Close #N and its neighbours >= 24 × 24: ' + JSON.stringify(tk));
      t.noErrors(page);
    }
  },
  // round 2 (09.11.2026): the testers' defects on the dock, the ticket's "On <symbol> now" table and the margin calculator
  {
    name: 'UXP4 round 2: margin calculator says "no EU limit (ESMA caps …)", never "no jurisdiction cap"; ½ names exactly halfLots(p)',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      await OPEN(page, 1440);
      const r = await page.evaluate(async () => {
        S.set.jur = 'none'; $('#pvSym').value = 'EURUSD'; $('#pvLots').value = '1';
        renderCalcs(); const lv = $('#pvLev'), eff = effLev('EURUSD');
        lv.value = String(eff === 10 ? 20 : 10); renderCalcs();
        const out = { title: lv.title, note: $('#pvOut').textContent, eff, lev: lv.value, esma: esmaCapText('EURUSD') };
        // ½: the tip names halfLots(p), the size the close sends; a different halfLots shows in the tip at once
        const p = S.positions.find(x => x.sym === 'GBPUSD'), row = document.querySelector(`#posBody tr[data-id="${p.id}"]`), hb = () => row.querySelector('[data-act=half]');
        renderPositions(); out.tip0 = hb().dataset.tip; out.want0 = `Close half: ${lotsFmt(p.sym, halfLots(p))} of ${lotsFmt(p.sym, p.lots)} lots`;
        const orig = window.halfLots; window.halfLots = () => 0.03; renderPositions(); out.tip1 = hb().dataset.tip; out.lab1 = hb().getAttribute('aria-label');
        window.halfLots = () => 0; renderPositions(); out.off2 = hb().getAttribute('aria-disabled');
        window.halfLots = orig; renderPositions(); out.tip3 = hb().dataset.tip;
        return out;
      });
      t.ok(r.lev !== String(r.eff), 'a what-if leverage is set: ' + r.lev);
      t.ok(!/jurisdiction cap/i.test(r.title) && r.title.includes(`No EU limit (ESMA caps ${r.esma})`), 'leverage tip: ' + r.title);
      t.ok(!/jurisdiction cap/i.test(r.note) && r.note.includes(`no EU limit (ESMA caps ${r.esma})`), 'what-if note: ' + r.note);
      t.eq(r.tip0, r.want0, '½ tip = halfLots(p)');
      t.ok(/^Close half: 0\.03 of /.test(r.tip1) && /close 0\.03 of/.test(r.lab1), '½ follows halfLots (no other rule): ' + r.tip1 + ' | ' + r.lab1);
      t.eq(r.off2, 'true', 'halfLots 0 → ½ grey');
      t.eq(r.tip3, r.want0, 'restored');
      t.noErrors(page);
    }
  },
  {
    name: 'UXP5 round 2: History Costs and Net in the mono figure font at 1086 and 1440 (Reason stays proportional)',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      for (const w of [1086, 1440]) {
        await OPEN(page, w);
        await page.evaluate(() => {
          S.history = [{ id: 801, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.101, open: Engine.simTime - 7200, close: Engine.simTime - 3600, pnl: 98, pips: 10, r: 1, reason: 'Manual', note: '', setup: '', swap: -2, comm: 7 },
            { id: 802, sym: 'EURUSD', side: 'sell', lots: 1, entry: 1.1, exit: 1.099, open: Engine.simTime - 7200, close: Engine.simTime - 3000, pnl: 100, pips: 10, r: 1, reason: 'Manual', note: '', setup: '', swap: 0 }];
          setTab('history'); dirty.hist = true; renderHistory();
        });
        await page.waitForFunction(() => { const c = document.querySelector('#histBody tr [data-c=costs]'); return c && c.getBoundingClientRect().width > 0; }, null, { timeout: 10000 });
        const r = await page.evaluate(() => [...document.querySelectorAll('#histBody tr')].map(tr => { const f = e => getComputedStyle(e).fontFamily; return { gross: f(tr.children[8]), reason: f(tr.children[9]), costs: f(tr.querySelector('[data-c=costs]')), net: f(tr.querySelector('[data-c=net]')), num: getComputedStyle(tr.querySelector('[data-c=costs]')).fontVariantNumeric }; }));
        for (const x of r) {
          t.eq(x.costs, x.gross, `${w}px: Costs in the figure font (${x.costs})`);
          t.eq(x.net, x.gross, `${w}px: Net in the figure font`);
          t.ok(x.reason !== x.costs, `${w}px: Reason stays in the text font (${x.reason})`);
          t.ok(/tabular-nums/.test(x.num), `${w}px: Costs tabular: ${x.num}`);
        }
      }
      t.noErrors(page);
    }
  },
  {
    name: 'UXP6 round 2 phone 375: History card big number = Net (up/dn, mono, labelled), Gross on its own line, close time in UTC; Positions total does not overlap',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
      await page.evaluate(() => {
        T.reset();
        for (const s of ['EURUSD', 'GBPUSD', 'USDJPY']) openPosition({ sym: s, side: 'buy', lots: s === 'USDJPY' ? 1.01 : 1, dupOk: true });
        setTab('positions'); dirty.pos = true; renderPositions();
      });
      await page.waitForFunction(() => { const a = document.querySelector('#posFoot th'), b = document.querySelector('#posFoot [data-c=tlots]'); return a && b && b.getBoundingClientRect().width > 0 && /3 positions/.test(a.textContent); }, null, { timeout: 10000 });
      const foot = await page.evaluate(() => { const g = s => { const e = document.querySelector('#posFoot ' + s), b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: e.textContent, over: e.scrollWidth > e.clientWidth + 1 }; }; return { th: g('th'), lots: g('[data-c=tlots]'), pnl: g('[data-c=tpnl]'), vw: innerWidth }; });
      t.ok(foot.th.r <= foot.lots.l + 0.5, 'TOTAL label ends before the lots: ' + JSON.stringify(foot));
      t.ok(foot.lots.r <= foot.pnl.l + 0.5 && foot.pnl.r <= foot.vw, 'lots before the P&L, inside the screen');
      t.ok(!foot.th.over && foot.lots.t === '3.01', 'label whole, lots 3.01: ' + JSON.stringify(foot));
      await page.evaluate(() => {
        S.history = [{ id: 801, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.101, open: Engine.simTime - 7200, close: Engine.simTime - 3600, pnl: 98, pips: 10, r: 1, reason: 'Manual', note: '', setup: '', swap: -2, comm: 7 },
          { id: 802, sym: 'EURUSD', side: 'sell', lots: 1, entry: 1.1, exit: 1.1015, open: Engine.simTime - 7200, close: Engine.simTime - 3000, pnl: -150, pips: -15, r: -1, reason: 'Manual', note: '', setup: '', swap: 0, comm: 7 }];
        setTab('history'); dirty.hist = true; renderHistory();
      });
      await page.waitForFunction(() => { const c = document.querySelector('#histBody tr [data-c=net]'); return c && c.getBoundingClientRect().width > 0; }, null, { timeout: 10000 });
      const h = await page.evaluate(() => {
        const col = v => { const d = document.createElement('i'); d.style.color = `var(${v})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
        return { up: col('--up'), dn: col('--dn'), rows: [...document.querySelectorAll('#histBody tr')].map(tr => {
          const g = tr.children[8], n = tr.querySelector('[data-c=net]'), c0 = tr.children[0], gs = getComputedStyle(g), ns = getComputedStyle(n), mono = getComputedStyle(tr.children[3]).fontFamily;
          return { gFs: parseFloat(gs.fontSize), nFs: parseFloat(ns.fontSize), nW: ns.fontWeight, nCol: ns.color, nFam: ns.fontFamily, mono, gLab: getComputedStyle(g, '::before').content, nLab: getComputedStyle(n, '::before').content,
            utc: getComputedStyle(c0, '::after').content, c0vis: c0.getBoundingClientRect().width > 0, net: n.textContent, cls: n.className, nTop: Math.round(n.getBoundingClientRect().top), symTop: Math.round(tr.children[1].getBoundingClientRect().top) };
        }) };
      });
      t.eq(h.rows.length, 2, 'two history cards');
      for (const x of h.rows) {
        t.ok(x.nFs > x.gFs && +x.nW >= 600, 'Net is the large number: ' + JSON.stringify(x));
        // round 3: Net has its own line, right under the symbol line (beside it, 7-digit amounts ran into the R and the side)
        t.ok(x.nTop > x.symTop + 4, `Net on its own line under the symbol (${x.symTop} → ${x.nTop})`);
        t.eq(x.nCol, x.cls.includes('dn') ? h.dn : h.up, `Net coloured ${x.cls} (${x.net})`);
        t.eq(x.nFam, x.mono, 'Net in the mono figure font');
        t.ok(/Gross/.test(x.gLab) && /Net/.test(x.nLab), 'both labelled: ' + x.gLab + ' / ' + x.nLab);
        t.ok(/UTC/.test(x.utc) && x.c0vis, 'the close time says UTC: ' + x.utc);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'UXP7 round 2 ticket "On <symbol> now": Entry · SL / TP whole at 1086 and 1440, nothing cut, actions 24 px',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      for (const w of [1086, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.evaluate(() => {
          T.reset(); setSymbol('EURUSD');
          openPosition({ sym: 'EURUSD', side: 'sell', lots: 10, dupOk: true, slPips: 20, tpPips: 40 });
          const m = M('EURUSD'), q = Engine.quote('EURUSD');
          placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(q.ask - 50 * m.pip).toFixed(m.digits), lots: 0.1 });
          tkOnSymRender('EURUSD');
        });
        await page.waitForFunction(() => {
          const c = document.querySelector('#tkOnBody tr[data-pos] [data-act=close]'); if (!c) return false;
          const k = JSON.stringify(c.getBoundingClientRect()); const same = window.__uxp7 === k; window.__uxp7 = k; return same && c.getBoundingClientRect().width > 0;
        }, null, { timeout: 10000, polling: 150 });
        const r = await page.evaluate(() => {
          const tb = document.querySelector('#tkOnBody .tk-on-tbl'), tbl = tb.getBoundingClientRect(), p = S.positions[0];
          const cut = e => e.scrollWidth > e.clientWidth + 1;
          const tr = tb.querySelector('tr[data-pos]'), th = tb.tHead.rows[0];
          return { tw: tbl.width, heads: [...th.cells].map(c => c.textContent), cells: tr.children.length, entry: tr.children[2].textContent, want: `${fp(p.sym, p.entry)}${fp(p.sym, p.sl)} / ${fp(p.sym, p.tp)}`,
            cut: [...th.cells].slice(0, 4).concat([...tr.children]).filter(cut).map(c => c.textContent), entryW: tr.children[2].getBoundingClientRect().width,
            inside: [...tr.children].every(c => { const b = c.getBoundingClientRect(); return b.left >= tbl.left - 1 && b.right <= tbl.right + 1; }),
            btns: [...tb.querySelectorAll('.acts button')].map(b => { const x = b.getBoundingClientRect(); return [b.dataset.act, Math.round(x.width), Math.round(x.height)]; }),
            ord: [...tb.querySelectorAll('tr.ord > td')].filter(cut).map(c => c.textContent) };
        });
        t.deep(r.heads, ['Side', 'Size', 'Entry · SL / TP', 'P&L', 'Actions'], `${w}px: every head kept`);
        t.eq(r.cells, 5, `${w}px: every cell kept`);
        t.eq(r.entry, r.want, `${w}px: entry and SL / TP in full`);
        t.deep(r.cut, [], `${w}px: no head or cell cut (table ${Math.round(r.tw)} px, entry ${Math.round(r.entryW)} px)`);
        t.deep(r.ord, [], `${w}px: the order row is not cut`);
        t.ok(r.inside, `${w}px: every cell inside the table`);
        t.ok(r.btns.length >= 4 && r.btns.every(([, a, b]) => a >= 24 && b >= 24), `${w}px: actions >= 24 × 24: ` + JSON.stringify(r.btns));
      }
      t.noErrors(page);
    }
  },
  {
    name: 'UXP8 round 2-3: the real #demoPill hidden stays hidden at every width (html[data-demo] does not beat [hidden])',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      for (const w of [900, 1086, 1440, 375]) {
        await page.setViewportSize({ width: w, height: 812 });
        await page.waitForFunction(w => document.body.classList.contains('mnav-on') === (w <= 720), w, { timeout: 30000 });
        // round 3: the real #demoPill of index.html (its own place; persist.js gives it .demo-flag on an example-trades
        // account, S.demo), not a synthetic span; its state is restored
        await page.evaluate(() => { S.demo = true; });
        await page.waitForFunction(() => /demo-flag/.test(document.getElementById('demoPill')?.className || ''), null, { timeout: 5000 });
        const r = await page.evaluate(() => {
          const el = document.getElementById('demoPill'), de = document.documentElement;
          if (!el) return { missing: true };
          const was = { hidden: el.hidden, demo: de.hasAttribute('data-demo') };
          de.setAttribute('data-demo', ''); el.hidden = true;
          const hid = getComputedStyle(el).display; el.hidden = false; const shown = getComputedStyle(el).display;
          el.hidden = was.hidden; if (!was.demo) de.removeAttribute('data-demo'); S.demo = false;
          return { hid, shown, cls: el.className, mnav: document.body.classList.contains('mnav-on') };
        });
        t.ok(!r.missing && /demo-flag/.test(r.cls), `${w}px: #demoPill is in the page with .demo-flag (${r.cls})`);
        t.eq(r.hid, 'none', `${w}px (mnav ${r.mnav}): hidden flag not displayed`);
        t.ok(r.shown !== 'none', `${w}px: without hidden it shows (${r.shown})`);
      }
      t.noErrors(page);
    }
  },
  // round 3 (09.11.2026): the testers' defects of round 2 on the phone History card, the phone total, the ticket table
  {
    name: 'UXP9 round 3 phone History card: 200 rows with 7-digit amounts, nothing overlaps (gap >= 2 px) or spills at 320, 375 and 430 px',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      for (const w of [320, 375, 430]) {
        await page.setViewportSize({ width: w, height: 812 });
        await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
        await page.evaluate(() => {
          T.reset();
          const syms = ['EURUSD', 'USDJPY', 'GBPUSD', 'BTCUSD', 'XAUUSD', 'US500'].filter(s => M(s)), now = Engine.simTime;
          // amounts up to 7 digits, both signs; pips, R and sizes at their widest too; long and short reasons
          S.history = Array.from({ length: 200 }, (_, i) => {
            const sym = syms[i % syms.length], m = M(sym), big = [9999999.99, 1234567.89, 98765.43, 12.5][i % 4], sg = i % 3 ? -1 : 1, px = m.pip * 10000 * (1 + (i % 7));
            return { id: 9000 + i, sym, side: i % 2 ? 'sell' : 'buy', lots: [0.01, 999.99, 12.34, 100][i % 4], entry: +px.toFixed(m.digits), exit: +(px * 1.01).toFixed(m.digits),
              open: now - 7200 - i * 60, close: now - 3600 - i * 60, pnl: sg * big, pips: sg * [99999.9, 1234.5, 3.2][i % 3], r: sg * [99.99, 3.25, 0.08][i % 3],
              reason: i % 5 ? 'Manual' : 'Stop-loss hit after the trailing stop moved twice', note: '', setup: '', swap: -[123456.78, 0, 2][i % 3], comm: [7654321.98, 7, 0][i % 3] };
          });
          setTab('history'); dirty.hist = true; renderHistory();
        });
        await page.waitForFunction(() => {
          const rows = document.querySelectorAll('#histBody tr'), last = rows[rows.length - 1]; if (rows.length !== 200 || !last) return false;
          const k = JSON.stringify(last.querySelector('[data-c=net]').getBoundingClientRect()); const same = window.__uxp9 === k; window.__uxp9 = k; return same && last.getBoundingClientRect().height > 40;
        }, null, { timeout: 15000, polling: 150 });
        const r = await page.evaluate(() => {
          const bad = [], spill = [];
          let minGap = Infinity;
          for (const tr of document.querySelectorAll('#histBody tr')) {
            const tb = tr.getBoundingClientRect(), cs = getComputedStyle(tr), pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
            const cells = [...tr.children].map((c, i) => ({ i, c, b: c.getBoundingClientRect() })).filter(x => x.b.width > 0 && x.b.height > 0);
            for (const x of cells) {
              if (x.c.scrollWidth > x.c.clientWidth + 1 || x.b.left < tb.left + pl - 1 || x.b.right > tb.right - pr + 1) spill.push([tr.rowIndex, x.i, x.c.textContent, Math.round(x.b.left), Math.round(x.b.right), Math.round(tb.right)]);
            }
            for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
              const A = cells[a].b, B = cells[b].b;
              if (Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) <= 1) continue; // not on the same line
              const gap = Math.max(B.left - A.right, A.left - B.right); minGap = Math.min(minGap, gap);
              if (gap < 2) bad.push([tr.rowIndex, cells[a].c.textContent, cells[b].c.textContent, Math.round(gap)]);
            }
          }
          return { bad: bad.slice(0, 6), nBad: bad.length, spill: spill.slice(0, 6), nSpill: spill.length, minGap, sw: document.documentElement.scrollWidth, vw: innerWidth };
        });
        t.eq(r.nBad, 0, `${w}px: no two cells on one line closer than 2 px (min gap ${r.minGap}): ${JSON.stringify(r.bad)}`);
        t.eq(r.nSpill, 0, `${w}px: no cell spills out of itself or the card: ${JSON.stringify(r.spill)}`);
        t.ok(r.sw <= r.vw, `${w}px: no sideways page scroll (${r.sw} > ${r.vw})`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'UXP10 round 3 phone 320: Positions total "Total · 12 positions" whole beside 1199.88 lots and the P&L, nothing overlaps',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      for (const w of [320, 375]) {
        await page.setViewportSize({ width: w, height: 812 });
        await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
        await page.evaluate(() => {
          T.reset(); S.balance = 1e9; // 1199.88 lots need the margin: no stop-out may close them under the test
          // the account nets per symbol: twelve positions are twelve FX pairs
          const syms = Engine.INSTR.map(m => m.sym || m.id).filter(s => s && M(s) && /^[A-Z]{6}$/.test(s)).slice(0, 12);
          for (const sym of syms) openPosition({ sym, side: 'buy', lots: 1, dupOk: true });
          for (const p of S.positions) p.lots = 99.99; // 12 × 99.99 = 1199.88 lots: the widest total of the report
          T.move('EURUSD', S.positions.find(p => p.sym === 'EURUSD').entry - 55 * M('EURUSD').pip);
          setTab('positions'); dirty.pos = true; renderPositions();
        });
        await page.waitForFunction(() => {
          const a = document.querySelector('#posFoot th'), p = document.querySelector('#posFoot [data-c=tpnl]'); if (!a || !p || !/12 positions/.test(a.textContent)) return false;
          const k = JSON.stringify([a.getBoundingClientRect(), p.getBoundingClientRect()]); const same = window.__uxp10 === k; window.__uxp10 = k; return same && p.getBoundingClientRect().width > 0;
        }, null, { timeout: 10000, polling: 150 });
        const r = await page.evaluate(() => {
          const els = ['th', '[data-c=tlots]', '[data-c=tpnl]'].map(s => document.querySelector('#posFoot ' + s));
          const bs = els.map(e => e.getBoundingClientRect()), tr = document.querySelector('#posFoot tr').getBoundingClientRect();
          const over = [];
          for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
            const A = bs[a], B = bs[b];
            if (Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 1 && Math.max(B.left - A.right, A.left - B.right) < 2) over.push([a, b]);
          }
          return { txt: els.map(e => e.textContent), cut: els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent), ell: getComputedStyle(els[0]).textOverflow,
            over, inside: bs.every(b => b.left >= tr.left - 0.5 && b.right <= tr.right + 0.5), vw: innerWidth, pnlR: bs[2].right, trR: tr.right };
        });
        t.eq(r.txt[0], 'Total · 12 positions', `${w}px: label text`);
        t.eq(r.txt[1], '1199.88', `${w}px: total lots`);
        t.ok(/^−\$/.test(r.txt[2]), `${w}px: a loss in the total: ${r.txt[2]}`);
        t.deep(r.cut, [], `${w}px: nothing cut (text-overflow ${r.ell})`);
        t.deep(r.over, [], `${w}px: label, lots and P&L never overlap`);
        t.ok(r.inside && r.trR <= r.vw, `${w}px: all inside the row and the screen`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'UXP11 round 3 ticket "On <symbol> now": a real table (no display change), Entry · SL / TP >= 60 px and whole at 1086 and 1440, a large P&L whole',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      for (const w of [1086, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.evaluate(() => {
          T.reset(); setSymbol('EURUSD');
          openPosition({ sym: 'EURUSD', side: 'sell', lots: 10, dupOk: true, slPips: 300, tpPips: 400 });
          T.move('EURUSD', S.positions[0].entry + 120 * M('EURUSD').pip); // −$12,000-ish on the 10 lots: a wide amount
          tkOnSymRender('EURUSD');
        });
        await page.waitForFunction(() => {
          const c = document.querySelector('#tkOnBody tr[data-pos] [data-act=close]'); if (!c) return false;
          const k = JSON.stringify(c.getBoundingClientRect()); const same = window.__uxp11 === k; window.__uxp11 = k; return same && c.getBoundingClientRect().width > 0;
        }, null, { timeout: 10000, polling: 150 });
        const r = await page.evaluate(() => {
          const tb = document.querySelector('#tkOnBody .tk-on-tbl'), d = e => getComputedStyle(e).display, tbl = tb.getBoundingClientRect();
          const rows = [...tb.rows], cells = rows.flatMap(r => [...r.cells]);
          const tr = tb.querySelector('tr[data-pos]'), cut = e => e.scrollWidth > e.clientWidth + 1;
          const btns = [...tb.querySelectorAll('.acts button')].map(b => b.getBoundingClientRect());
          let overlap = 0; for (let a = 0; a < btns.length; a++) for (let b = a + 1; b < btns.length; b++) { const A = btns[a], B = btns[b]; if (Math.min(A.right, B.right) - Math.max(A.left, B.left) > 0.5 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 0.5) overlap++; }
          return { table: d(tb), groups: [tb.tHead, ...tb.tBodies].map(d), rows: [...new Set(rows.map(d))], cells: [...new Set(cells.map(d))], cols: getComputedStyle(tb.querySelector('colgroup')).display,
            entryW: tr.children[2].getBoundingClientRect().width, cut: cells.filter(cut).map(c => c.textContent), pnl: [...tb.querySelectorAll('tr[data-pos] [data-c=pnl]')].map(c => c.textContent),
            inside: cells.every(c => { const b = c.getBoundingClientRect(); return b.left >= tbl.left - 1 && b.right <= tbl.right + 1; }), overlap, n: btns.length };
        });
        t.eq(r.table, 'table', `${w}px: the table keeps display:table`);
        t.deep(r.groups, ['table-header-group', 'table-row-group'], `${w}px: thead / tbody keep their display`);
        t.deep(r.rows, ['table-row'], `${w}px: every row is a table-row`);
        t.deep(r.cells, ['table-cell'], `${w}px: every cell is a table-cell`);
        t.ok(r.cols !== 'none', `${w}px: the colgroup is used (${r.cols})`);
        t.ok(r.entryW >= 60, `${w}px: Entry · SL / TP column >= 60 px (${Math.round(r.entryW)})`);
        t.deep(r.cut, [], `${w}px: no cell cut, P&L ${r.pnl.join(' / ')}`);
        t.ok(r.inside, `${w}px: every cell inside the table`);
        t.ok(r.n >= 3 && r.overlap === 0, `${w}px: ${r.n} actions, none over another`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'UXP12 round 3 contracts: .tk-on-tbl aria-disabled button grey .45 not-allowed with a visible focus; #userKind looks as .user-hd',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => { T.reset(); setSymbol('EURUSD'); openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.01, dupOk: true }); tkOnSymRender('EURUSD'); });
      await page.waitForFunction(() => { const b = document.querySelector('#tkOnBody [data-act=half][aria-disabled="true"]'); return b && b.getBoundingClientRect().width > 0; }, null, { timeout: 10000 });
      const r = await page.evaluate(() => {
        // the rule must hold on its own: ticket3 drops the button's inline style this round
        const b = document.querySelector('#tkOnBody [data-act=half][aria-disabled="true"]'); b.removeAttribute('style');
        const tx3 = (() => { const i = document.createElement('i'); i.style.color = 'var(--tx3)'; document.body.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c; })();
        const s0 = getComputedStyle(b), off = { op: s0.opacity, cur: s0.cursor, col: s0.color, tx3 };
        b.focus(); const s1 = getComputedStyle(b), focus = { fv: b.matches(':focus-visible'), os: s1.outlineStyle, ow: s1.outlineWidth };
        b.blur();
        // #userKind: without its inline style it takes .user-hd's padding, ground, rule and text size
        const k = document.getElementById('userKind'), h = document.querySelector('.user-hd');
        if (!k || !h) return { off, focus, missing: true };
        k.removeAttribute('style'); const wasHidden = k.hidden; k.hidden = false; if (!k.textContent) k.textContent = 'Demo account';
        const pick = e => { const s = getComputedStyle(e); return [s.paddingTop, s.paddingLeft, s.borderBottomWidth, s.borderBottomStyle, s.borderBottomColor, s.backgroundColor]; };
        const out = { off, focus, kind: pick(k), hd: pick(h), kFs: getComputedStyle(k).fontSize, spanFs: getComputedStyle(h.querySelector('span')).fontSize };
        k.hidden = wasHidden; return out;
      });
      t.eq(r.off.op, '0.45', 'disabled ticket action at opacity .45');
      t.eq(r.off.cur, 'not-allowed', 'cursor not-allowed');
      t.eq(r.off.col, r.off.tx3, 'grey text (--tx3), not amber');
      t.ok(r.focus.fv && r.focus.os === 'solid' && parseFloat(r.focus.ow) >= 1, 'keyboard focus visible on it: ' + JSON.stringify(r.focus));
      t.ok(!r.missing, '#userKind and .user-hd in the account menu');
      t.deep(r.kind, r.hd, '#userKind padding, rule and ground = .user-hd');
      t.eq(r.kFs, r.spanFs, '#userKind text at the .user-hd line size');
      t.noErrors(page);
    }
  }
];
