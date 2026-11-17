// Multi-asset UI on the v15 catalog (.mace/design/catalog.md §5): the watchlist groups the 265 instruments of the sheet
// (Favourites, FX, Indices, Commodities, Crypto, Stocks), folds them, searches symbol / name / sector / exchange, keeps
// the favourites, shows the session, close-only and jurisdiction-cap badges, renders only open groups and keeps only the
// rows on screen hot; the Specifications panel shows every field of the sheet (grouped, with a key-figure strip; the price
// source only with live prices); on a phone the search sticks and the Specifications open as a bottom sheet.
// The last tests sweep every screen on non-FX instruments (no 'null', 'undefined' or 'NaN').
const BAD = /\b(null|undefined|NaN)\b/;
// the visible text of a node plus the titles and labels inside it
const textOf = () => `(el => el ? el.innerText + ' ' + [...el.querySelectorAll('[title],[aria-label]')].map(x => (x.getAttribute('title') || '') + ' ' + (x.getAttribute('aria-label') || '')).join(' ') : '')`;
const lazy = page => page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof runBacktest === 'function' && !!document.getElementById('tabsTitle'), null, { timeout: 30000 });
// the test runner's platform feed (T.feed) for syms, with the backtest history of `load` fetched, so a run is synchronous
const feed = (page, syms, load = syms) => page.evaluate(async ([syms, load]) => { T.feed(syms); for (const s of load) await btLoad(s, btCfg().hist || 8); }, [syms, load]);
// Friday 10:30 UTC: FX, indices and crypto quote, US stocks are closed (cash session 13:35–19:55 UTC)
const FRI = new Date('2026-10-16T10:30:00Z');
// Tuesday 14:00 UTC: every instrument of the set is in session
const OPEN = new Date('2026-10-20T14:00:00Z');
// no jurisdiction cap, sheet leverage (T.reset sets EU retail)
const NONE = () => { T.reset(); S.set.jur = 'none'; S.set.lev = null; S.set.fav = []; S.set.wl = 'all'; delete S.set.wlOpen; document.querySelector('#wlSearch').value = ''; buildWatch(); renderWatch(); };

export const tests = [
  {
    name: 'MAU1 watchlist: All lists every category open under a plain band with its catalog count (no folded list repeating the tabs; Fav is its own tab)',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      const r = await page.evaluate(NONE => {
        eval(NONE)();
        const cat = { fx: 0, index: 0, commodity: 0, crypto: 0, stock: 0 }, CAT = { fx: 'fx', index: 'index', rates: 'index', metal: 'commodity', energy: 'commodity', agri: 'commodity', crypto: 'crypto', stock: 'stock' };
        for (const m of CATALOG.instr) cat[CAT[m.group]]++;
        const rows = () => [...document.querySelectorAll('#wl .wl-row')].map(x => x.dataset.sym);
        const heads = () => [...document.querySelectorAll('#wl .wl-grp')].map(b => [b.dataset.g, b.querySelector('.wl-n').textContent, b.getAttribute('aria-expanded')]);
        const out = { cat, heads: heads(), rows: rows(), subs: [...document.querySelectorAll('#wl .wl-sub[data-c="fx"]')].map(x => x.querySelector('.wl-sub-n').textContent) };
        out.g8 = rows().slice(0, 16).join() === Engine.PAIRS.map(p => p.sym).join();
        out.buttons = document.querySelectorAll('#wl button.wl-grp').length;
        out.page = [document.documentElement.scrollHeight, innerHeight];
        out.sectors = [...document.querySelectorAll('#wl .wl-sub[data-c="stock"]')].map(x => x.querySelector('.wl-sub-n').textContent);
        // a sector closed as a whole says it once, as text of its own row (not only a title)
        out.sesNote = [...document.querySelectorAll('#wl .wl-sub[data-c="stock"] .wl-sub-ses')].map(x => x.textContent);
        // exchange chips inside Stocks
        document.querySelector('#wl .wl-chips button[data-x="NASDAQ"]').click();
        const st = rows().filter(s => M(s).group === 'stock');
        out.nasdaq = [st.length, CATALOG.instr.filter(m => m.group === 'stock' && m.exch === 'NASDAQ').length, st.every(s => M(s).exch === 'NASDAQ')];
        out.chipPressed = document.querySelector('#wl .wl-chips button[data-x="NASDAQ"]').getAttribute('aria-pressed');
        document.querySelector('#wl .wl-chips button[data-x="all"]').click();
        // the class filter shows one category, open
        document.querySelector('#wlCls button[data-wl="index"]').click();
        out.idx = rows(); out.wl = S.set.wl; out.live = document.querySelector('#wlLive').textContent; out.pressed = document.querySelector('#wlCls button[data-wl="index"]').getAttribute('aria-pressed');
        document.querySelector('#wlCls button[data-wl="fx"]').click(); out.fx = rows().length;
        document.querySelector('#wlCls button[data-wl="all"]').click();
        // US retail: no CFDs, only the FX group and filter
        applyProfile('us'); renderWatch(); out.us = heads().map(h => h[0]); out.usRows = rows().length;
        out.usBtns = [...document.querySelectorAll('#wlCls button')].filter(b => !b.hidden).map(b => b.dataset.wl);
        applyProfile('none'); renderWatch();
        return out;
      }, NONE.toString());
      t.deep(r.cat, { fx: 38, index: 14, commodity: 15, crypto: 12, stock: 186 }, 'catalog: 265 = 38 + 14 + 15 + 12 + 186');
      t.deep(r.heads, [['fx', '38', null], ['index', '14', null], ['commodity', '15', null], ['crypto', '12', null], ['stock', '186', null]], 'plain bands with the catalog counts, nothing to fold, no Favourites band');
      t.eq(r.buttons, 0, 'the bands are not fold buttons'); t.eq(r.rows.length, 265, 'All renders every instrument: 265 rows');
      t.ok(r.g8, 'the 16 G8 pairs first');
      t.deep(r.subs, ['Majors (G8)', 'Crosses', 'Exotics'], 'FX subgroups');
      t.ok(r.page[0] <= r.page[1], 'the page does not grow with the list (it scrolls inside): ' + r.page);
      t.ok(r.sectors.length >= 10 && r.sectors.includes('Technology') && r.sectors.includes('Financials'), 'stocks by sector: ' + r.sectors.slice(0, 6));
      t.ok(r.sesNote.length > 0 && r.sesNote.every(x => /^Closed · opens /.test(x)), 'US stocks closed: the sector rows keep the closed note: ' + r.sesNote.slice(0, 2));
      t.eq(r.nasdaq[0], r.nasdaq[1], 'NASDAQ chip: every NASDAQ stock'); t.ok(r.nasdaq[2], 'and only them'); t.eq(r.chipPressed, 'true', 'chip pressed');
      t.eq(r.idx.length, 14, 'Indices filter: 14 rows (12 indices + 2 rates)');
      t.eq(r.wl, 'index', 'filter kept in S.set.wl'); t.eq(r.live, '14 instruments shown', 'count announced'); t.eq(r.pressed, 'true', 'aria-pressed on the active class');
      t.eq(r.fx, 38, 'FX filter: Engine.FX');
      t.deep(r.us, ['fx'], 'US retail: only the FX band under All (Favourites is its tab)'); t.eq(r.usRows, 38, 'US: the 38 pairs'); t.deep(r.usBtns, ['all', 'fav', 'fx'], 'US: filters All, Favourites, FX');
      t.noErrors(page);
    }
  },
  {
    name: 'MAU2 search on symbol, name, sector and exchange ignores folding; favourites persist across a reload',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      const r = await page.evaluate(NONE => {
        eval(NONE)();
        const rows = () => [...document.querySelectorAll('#wl .wl-row')].map(x => x.dataset.sym);
        const find = q => { const s = document.querySelector('#wlSearch'); s.value = q; s.dispatchEvent(new Event('input', { bubbles: true })); return rows(); };
        const out = { apple: find('apple'), nasdaq: find('nasdaq'), eur: find('eur/usd'), sector: find('pharma').length, none: find('zzzz'), empty: document.querySelector('#wl .wl-empty')?.textContent };
        out.nasdaqWant = Engine.INSTR.filter(m => /NASDAQ/i.test(m.desc + ' ' + m.exch)).map(m => m.sym).sort();
        out.pharmaWant = Engine.INSTR.filter(m => m.sector === 'Pharma').length;
        find('');
        // favourites: the star in the chart header
        setSymbol('AAPL.US'); const fb = document.querySelector('#favBtn');
        out.favLabel0 = fb.getAttribute('aria-label') + '|' + fb.getAttribute('aria-pressed');
        fb.click(); setSymbol('GOLD'); document.querySelector('#favBtn').click(); setSymbol('EURUSD');
        out.fav = S.set.fav.slice(); out.favLabel1 = (setSymbol('AAPL.US'), document.querySelector('#favBtn').getAttribute('aria-pressed'));
        document.querySelector('#wlCls button[data-wl="fav"]').click();
        out.favHead = String(document.querySelectorAll('#wl .wl-row[data-c="fav"]').length);
        out.favRows = [...document.querySelectorAll('#wl .wl-row[data-c="fav"]')].map(x => x.dataset.sym);
        document.querySelector('#wlCls button[data-wl="all"]').click();
        // a cap of 50
        S.set.fav = Engine.INSTR.slice(0, 50).map(m => m.sym); setSymbol('ZM.US'); document.querySelector('#favBtn').click();
        out.cap = [S.set.fav.length, S.set.fav.includes('ZM.US'), T.toasts().map(x => x.title).join()];
        S.set.fav = out.fav.slice(); buildWatch(); persistNow();
        return out;
      }, NONE.toString());
      t.deep(r.apple, ['AAPL.US'], 'apple → AAPL.US (name)');
      t.deep(r.nasdaq.slice().sort(), r.nasdaqWant, 'nasdaq → US.100 and the NASDAQ stocks');
      t.ok(r.nasdaq.includes('US.100') && r.nasdaq.length > 50, 'nasdaq: ' + r.nasdaq.length);
      t.deep(r.eur, ['EURUSD'], 'EUR/USD typed with the slash');
      t.eq(r.sector, r.pharmaWant, 'sector search');
      t.deep(r.none, [], 'no match'); t.ok(/No instrument matches/.test(r.empty), 'empty state');
      t.eq(r.favLabel0, 'Add AAPL.US to favourites|false', 'star named and not pressed');
      t.deep(r.fav, ['AAPL.US', 'GOLD'], 'favourites in S.set.fav'); t.eq(r.favLabel1, 'true', 'pressed on a favourite');
      t.eq(r.favHead, '2', 'Favourites count'); t.deep(r.favRows, ['AAPL.US', 'GOLD'], 'Favourites rows');
      t.eq(r.cap[0], 50, 'no more than 50 favourites'); t.ok(!r.cap[1], 'the 51st is refused'); t.ok(/Favourites full/.test(r.cap[2]), 'and says why: ' + r.cap[2]);
      await page.waitForTimeout(400);
      await page.reload();
      await page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
      const after = await page.evaluate(() => { document.querySelector('#wlCls button[data-wl="fav"]').click(); return { fav: S.set.fav, rows: [...document.querySelectorAll('#wl .wl-row[data-c="fav"]')].map(x => x.dataset.sym) }; });
      t.deep(after.fav, ['AAPL.US', 'GOLD'], 'favourites survive a reload');
      t.deep(after.rows, ['AAPL.US', 'GOLD'], 'and the Fav tab lists them');
      t.noErrors(page);
    }
  },
  {
    name: 'MAU3 badges: a closed stock says "Closed · opens …" on its last price, CLOSE ONLY rows, 1:x only where the cap cuts; chart header',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      const r = await page.evaluate(async NONE => {
        eval(NONE)();
        const row = s => document.querySelector(`#wl .wl-row[data-sym="${s}"]`);
        const bdg = s => [...row(s).querySelectorAll('.wl-bdg .tag')].map(x => x.querySelector('.ses-l') ? x.querySelector('.ses-l').textContent : x.textContent.replace('max leverage ', ''));
        document.querySelector('#wl .wl-grp[data-g="stock"]').click();
        row('AAPL.US').scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 150)); renderWatch();
        const a = row('AAPL.US'), ses = a.querySelector('.wl-ses');
        const out = { aapl: bdg('AAPL.US'), closed: a.classList.contains('closed'), sesTitle: ses && ses.title, bid: a.querySelector('[data-f=bid]').textContent, last: fp('AAPL.US', Engine.quote('AAPL.US').bid), short: ses && ses.querySelector('.ses-s').textContent };
        out.open = Engine.session('AAPL.US').opensAt; out.local = new Date(out.open * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        out.eur = bdg('EURUSD'); out.eurClosed = row('EURUSD').classList.contains('closed');
        out.try = bdg('EURTRY'); out.fb = bdg('FB.US');
        // the leverage of a row: its own tag when it differs from its group, else the group header's (market watch v2)
        const lev = s => { const r = row(s), tg = r.querySelector('.wl-lev'); if (tg) return tg.textContent.replace('max leverage ', ''); let p = r.previousElementSibling; while (p && !p.classList.contains('wl-sub')) p = p.previousElementSibling; return p && p.querySelector('.wl-sub-lev') ? p.querySelector('.wl-sub-lev').textContent : null; };
        applyProfile('eu'); renderWatch(); out.euAapl = [lev('AAPL.US')]; out.euEur = [lev('EURUSD')];
        out.euTitle = levTagText('AAPL.US').title; out.euSr = row('AAPL.US').querySelector('.wl-sym').textContent;
        setSymbol('AAPL.US'); out.head = document.querySelector('#symCls').textContent; out.headTitle = document.querySelector('#symCls').title;
        applyProfile('none:default'); setSymbol('US.500'); out.headIdx = document.querySelector('#symCls').textContent;
        setSymbol('EURUSD'); out.headFx = document.querySelector('#symCls').hidden;
        return out;
      }, NONE.toString());
      t.ok(r.closed, 'closed stock row is dimmed');
      t.eq(r.aapl.length, 1, 'one badge: ' + r.aapl);
      t.eq(r.aapl[0], `Closed · opens Fri ${r.local}`, 'session badge in local time');
      t.ok(/13:35 UTC/.test(r.sesTitle) && /local/.test(r.sesTitle), 'UTC in the tooltip: ' + r.sesTitle);
      t.eq(r.short, `Opens ${r.local}`, 'short form for the phone');
      t.eq(r.bid, r.last, 'shows the last price');
      t.deep(r.eur, [], 'EURUSD under no cap: no badge'); t.ok(!r.eurClosed, 'FX quotes on Friday');
      t.deep(r.try, ['Close only'], 'EURTRY is CLOSE ONLY on the sheet');
      t.ok(r.fb.includes('Close only') && r.fb.some(x => /^Closed/.test(x)), 'FB.US: close only and closed: ' + r.fb);
      t.ok(r.euAapl.includes('1:5'), 'EU caps a stock at 1:5: ' + r.euAapl);
      t.ok(r.euEur.includes('1:30'), 'EU caps EURUSD (sheet 1:500) at 1:30: ' + r.euEur);
      t.ok(/1:5 under EU retail/.test(r.euTitle) && /sheet 1:40/.test(r.euTitle), 'cap tooltip: ' + r.euTitle);
      t.ok(/max leverage 1:5/.test(r.euSr), 'the row still names its leverage for a screen reader: ' + r.euSr);
      t.eq(r.head, 'Stock · Closed · 1:5', 'chart header on a closed stock under EU');
      t.ok(/opens Fri/.test(r.headTitle), 'header title says when it opens: ' + r.headTitle);
      t.eq(r.headIdx, 'Index · 1:100', 'index under no cap: its sheet leverage');
      t.ok(r.headFx, 'no tag on an open pair without a cap');
      t.noErrors(page);
    }
  },
  {
    name: 'MAU4 Specifications: every field for EURUSD, US.500, AAPL.US and BTCUSD, key strip, groups, sessions table; Price source only with live prices',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await lazy(page); await page.waitForTimeout(300); // the shell's first layout pass (a resize closes open menus)
      const FIELDS = ['Description', 'Type', 'Exchange', 'Currencies', 'Trade status', 'Market', 'Digits', 'Contract', 'Leverage', 'Margin per lot', 'Min pending distance', 'Volume', 'Spread', 'Swap', 'Triple swap', 'Commission'];
      const out = {};
      for (const sym of ['EURUSD', 'US.500', 'AAPL.US', 'BTCUSD', 'BTCEUR']) {
        out[sym] = await page.evaluate(async ([sym, NONE]) => {
          eval(NONE)(); setSymbol(sym);
          document.querySelector('#insBtn').click(); await new Promise(r => setTimeout(r, 50));
          const pop = document.querySelector('#insPop');
          const card = Object.fromEntries([...pop.querySelectorAll('dl dt')].map(d => [d.textContent, d.nextElementSibling.textContent]));
          const sess = [...pop.querySelectorAll('.ins-sess tbody tr')].map(tr => [...tr.children].map(c => c.textContent));
          const head = [...pop.querySelectorAll('.ins-sess thead th')].map(x => x.textContent);
          const r = { open: !pop.hidden, card, sess, head, text: pop.innerText, active: pop.querySelector('.ins-sp-on')?.textContent,
            keys: [...pop.querySelectorAll('.ins-k > div > span')].map(x => x.textContent), groups: [...pop.querySelectorAll('.ins-gh')].map(x => x.textContent), foot: pop.querySelector('.ins-f')?.textContent };
          pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); r.closed = pop.hidden; r.focus = document.activeElement && document.activeElement.id;
          return r;
        }, [sym, NONE.toString()]);
      }
      for (const [sym, r] of Object.entries(out)) {
        t.ok(r.open, `${sym}: Specifications open`);
        for (const f of FIELDS) t.ok(r.card[f] && r.card[f].trim(), `${sym}: field ${f}: ${JSON.stringify(r.card[f])}`);
        t.ok(!BAD.test(r.text), `${sym}: no null/undefined/NaN: ${(r.text.match(new RegExp('.{0,60}' + BAD.source + '.{0,30}')) || [''])[0]}`);
        t.ok(!/ECB|always open/i.test(r.text), `${sym}: no ECB, no "always open"`);
        t.ok(!('Price source' in r.card), `${sym}: no Price source row without live prices: ${r.card['Price source']}`);
        t.ok(!Object.keys(r.card).some(k => /simulation/i.test(k)), `${sym}: no "Not applied in this simulation" row`);
        t.ok(!/simulat|synthetic|zero drift/i.test(r.text), `${sym}: no simulated / zero-drift wording`);
        t.deep(r.keys, ['Spread now', 'Leverage', r.keys[2], 'Volume', 'Status', 'Market'], `${sym}: key-figure strip`); t.ok(/^Margin \/ (lot|share)$/.test(r.keys[2]), `${sym}: margin key: ${r.keys[2]}`);
        t.deep(r.groups, ['Instrument', 'Trading', 'Costs', 'Sessions this week'], `${sym}: group heads (no Data group offline)`);
        t.eq(r.foot, 'Every figure comes from the instrument sheet (Default profile).', `${sym}: footer`);
        t.deep(r.head, ['Day', 'Server (EET)', 'UTC', 'Local'], `${sym}: sessions table header`);
        t.ok(r.active, `${sym}: the active spread is marked`);
        t.ok(r.closed && r.focus === 'insBtn', `${sym}: Esc closes and returns focus`);
      }
      const e = out.EURUSD.card, u = out['US.500'].card, a = out['AAPL.US'].card, b = out.BTCUSD.card;
      t.eq(e.Contract, '1 lot = 100,000 EUR', 'EURUSD contract');
      t.eq(e.Digits, '5 · point 0.00001 · pip 0.0001', 'EURUSD digits');
      t.ok(/^1:500 \(sheet default; maximum 1:500\)/.test(e.Leverage), 'EURUSD leverage: ' + e.Leverage);
      t.ok(/Default 12 · Night 24 · News 36 points/.test(e.Spread) && /1\.2 · 2\.4 · 3\.6 pips/.test(e.Spread), 'EURUSD spread: ' + e.Spread);
      t.ok(/−9\.217 pts long \/ −8\.771 pts short a night/.test(e.Swap) && /\$/.test(e.Swap), 'EURUSD swap: ' + e.Swap);
      t.ok(/Wednesday/.test(e['Triple swap']), 'FX triple on Wednesday');
      t.eq(out.EURUSD.sess.length, 7, 'EURUSD: a row per day'); t.ok(/Closed/.test(out.EURUSD.sess.find(x => x[0] === 'Sat').join()), 'FX closed on Saturday');
      t.eq(u.Contract, '1 lot = $50 per 1.00 move · 1 pt (0.01) = $0.50', 'US.500 contract: a whole move and one pt, never "per point" for a 0.01 pt');
      t.ok(/Index · Financials/.test(u.Type), 'US.500 type: ' + u.Type);
      t.ok(/−5\.00% long \/ −5\.00% short a year/.test(u.Swap), 'US.500 swap in % a year: ' + u.Swap);
      t.ok(/Friday/.test(u['Triple swap']), 'non-FX triple on Friday');
      t.eq(a.Contract, '1 share', 'AAPL.US contract');
      t.ok(/^Stock · Technology$/.test(a.Type) && /^NASDAQ · US$/.test(a.Exchange), 'AAPL.US type and exchange');
      t.ok(/Closed — opens Fri/.test(a.Market), 'AAPL.US market closed on Friday morning: ' + a.Market);
      t.ok(/^min 1 · max 10,000 · step 1 shares$/.test(a.Volume), 'AAPL.US volume: ' + a.Volume);
      t.ok(/16:35–22:55/.test(out['AAPL.US'].sess.find(x => x[0] === 'Mon').join()) && /13:35–19:55/.test(out['AAPL.US'].sess.find(x => x[0] === 'Mon').join()), 'AAPL.US Monday in server and UTC time: ' + out['AAPL.US'].sess.find(x => x[0] === 'Mon'));
      t.eq(b.Contract, '1 lot = $1 per 1.00 move · 1 pt (0.01) = $0.01', 'BTCUSD contract');
      t.ok(/every night, no triple/i.test(b['Triple swap']), 'crypto: no triple');
      t.deep(out.BTCUSD.sess, [['Every day', 'Open 24/7', 'Open 24/7', 'Open 24/7']], 'BTCUSD trades 24/7');
      t.ok(/variation −600…\+600 pts/.test(out.BTCEUR.card.Spread), 'BTCEUR spread variation: ' + out.BTCEUR.card.Spread);
      // with live prices the card names the source in a Data group
      const live = await page.evaluate(() => {
        const d = Object.getOwnPropertyDescriptor(Engine, 'feedOn'); Object.defineProperty(Engine, 'feedOn', { get: () => true, configurable: true });
        try { const b = document.createElement('div'); b.innerHTML = instrCard('EURUSD'); return { card: Object.fromEntries([...b.querySelectorAll('dl dt')].map(x => [x.textContent, x.nextElementSibling.textContent])), groups: [...b.querySelectorAll('.ins-gh')].map(x => x.textContent) }; }
        finally { Object.defineProperty(Engine, 'feedOn', d); }
      });
      t.eq(live.card['Price source'], 'Live from the broker platform; chart history from the platform', 'live: Price source row');
      t.deep(live.groups, ['Instrument', 'Trading', 'Costs', 'Data', 'Sessions this week'], 'live: Data group holds it');
      t.noErrors(page);
    }
  },
  {
    name: 'MAU5 phone 390 px: no horizontal overflow, sticky search, Favourites first, Specifications as a bottom sheet',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on') && document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 });
      const over = [];
      await page.evaluate(() => { S.set.fav = ['AAPL.US']; buildWatch(); });
      for (const [mv, sym] of [['chart', 'BTCUSD'], ['markets', 'DE.30'], ['chart', 'AAPL.US'], ['markets', 'IND50-NIF'], ['markets', 'BRK.B.US']]) {
        await page.evaluate(([mv, sym]) => { setSymbol(sym); document.querySelector(`.mnav button[data-mv="${mv}"]`).click(); }, [mv, sym]);
        await page.waitForTimeout(300);
        const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
        if (sw > 390) over.push(`${mv}/${sym}: ${sw}px`);
      }
      const m = await page.evaluate(() => {
        const e = document.querySelector('#wlCls'), ph = document.querySelector('.watch .ph');
        return { sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX, h: Math.min(...[...e.querySelectorAll('button')].filter(b => !b.hidden).map(b => b.getBoundingClientRect().height)),
          sticky: getComputedStyle(ph).position, first: document.querySelector('#wl .wl-grp').dataset.g, folded: [...document.querySelectorAll('#wl .wl-grp')].filter(b => b.getAttribute('aria-expanded') === 'true').map(b => b.dataset.g), sw2: document.documentElement.scrollWidth,
          grpH: document.querySelector('#wl .wl-grp').getBoundingClientRect().height, short: getComputedStyle(document.querySelector('#wl .wl-row[data-sym="AAPL.US"] .ses-s')).display };
      });
      await page.evaluate(() => { document.querySelector('.mnav button[data-mv="chart"]').click(); setSymbol('AAPL.US'); });
      await page.waitForTimeout(200);
      await page.evaluate(() => document.querySelector('#insBtn').click());
      await page.waitForTimeout(200);
      const sh = await page.evaluate(() => { const p = document.querySelector('#insPop'), r = p.getBoundingClientRect(), nav = document.querySelector('.mnav').getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { l: r.left, w: r.width, b: r.bottom, nav: nav.top, vh: innerHeight, h: r.height, oy: getComputedStyle(p).overflowY, vis: !p.hidden, seen: !!top && p.contains(top) }; });
      t.ok(!over.length, 'page wider than the phone: ' + over.join(', '));
      const sw3 = await page.evaluate(() => { document.querySelector('#wl .wl-grp[data-g="stock"]').click(); return document.documentElement.scrollWidth; });
      t.ok(m.sw2 <= 390 && sw3 <= 390, 'no overflow with Stocks open: ' + sw3);
      t.ok(m.ox === 'auto', 'class filter scrolls sideways inside itself');
      t.ok(m.h >= 32, 'class filter targets at least 32 px high: ' + m.h);
      t.ok(m.grpH >= 32, 'group headers at least 32 px high: ' + m.grpH);
      t.eq(m.sticky, 'sticky', 'search sticks to the top');
      t.eq(m.first, 'fav', 'Favourites first');
      t.deep(m.folded, ['fav'], 'with favourites, only Favourites is open on a phone');
      t.ok(m.short !== 'none', 'short session badge on the phone');
      t.ok(sh.seen, 'the sheet is painted on top (not clipped or covered)');
      t.ok(sh.vis && sh.l <= 1 && sh.w >= 388, `Specifications span the width: left ${sh.l}, width ${sh.w}`);
      t.ok(Math.abs(sh.b - sh.nav) <= 2 && sh.h <= sh.vh * .8 && sh.oy === 'auto', `bottom sheet above the tab bar: bottom ${sh.b}, nav ${sh.nav}, height ${sh.h}`);
      t.noErrors(page);
    }
  },
  {
    name: 'MAU6 performance: every group open, only rows on screen are hot (Engine.hot), mean frame JS under 6 ms at speed 60',
    async run({ t, app }) {
      const page = await app('', { freeze: false, clock: OPEN });
      await lazy(page);
      const r = await page.evaluate(async NONE => {
        eval(NONE)();
        for (const g of ['index', 'commodity', 'crypto', 'stock']) document.querySelector(`#wl .wl-grp[data-g="${g}"]`).click();
        const rows = document.querySelectorAll('#wl .wl-row').length;
        await new Promise(r => setTimeout(r, 300));
        const hot1 = Engine.hotSet, vis1 = wlVisible();
        // scroll the list to the stocks: the hot set follows
        const wl = document.querySelector('#wl'); wl.scrollTop = wl.scrollHeight;
        await new Promise(r => setTimeout(r, 300));
        const hot2 = Engine.hotSet, vis2 = wlVisible();
        Engine.speed = 60;
        for (let i = 0; i < 8; i++) { Engine.tick(250); frame(false, false); }
        const n = 40, t0 = performance.now();
        for (let i = 0; i < n; i++) { Engine.tick(250); frame(i % 8 === 0, false); }
        const ms = (performance.now() - t0) / n;
        Engine.speed = 0;
        const stock = a => a.some(s => M(s).group === 'stock');
        return { rows, hot1, hot2, vis1, vis2, ms, nx: Engine.CFDS.length, st2: stock(vis2) && stock(hot2) };
      }, NONE.toString());
      t.eq(r.rows, 265, 'every row rendered with every group open');
      t.ok(r.vis1.length > 5 && r.vis1.length < 80, 'a screenful of rows is visible: ' + r.vis1.length);
      t.ok(r.hot1.length < 40, 'top of the list: few non-FX instruments hot: ' + r.hot1.length);
      t.ok(r.st2, 'scrolled to the stocks: they are visible and hot');
      t.ok(r.hot2.length < 80, 'and the hot set stays small: ' + r.hot2.length + ' of ' + r.nx);
      console.log(`       MAU6: mean frame JS ${r.ms.toFixed(2)} ms, hot ${r.hot1.length} / ${r.hot2.length}, visible ${r.vis1.length}`);
      t.ok(r.ms < 6, `mean frame JS ${r.ms.toFixed(2)} ms`);
      t.noErrors(page);
    }
  },
  {
    name: "MAU7 every screen on non-FX instruments: no 'null', 'undefined' or 'NaN'",
    async run({ t, app }) {
      const page = await app('', { clock: OPEN });
      await lazy(page);
      const bad = [];
      for (const sym of ['DE.30', 'GOLD', 'BTCUSD', 'AAPL.US']) {
        await page.evaluate(s => {
          T.reset(); S.set.jur = 'none'; S.set.lev = null; setSymbol(s);
          const q = Engine.quote(s), m = M(s), lots = m.p.vol[0] * (m.p.vol[0] >= 1 ? 5 : 50);
          openPosition({ sym: s, side: 'buy', lots, dupOk: true, pmDone: true });
          openPosition({ sym: 'EURUSD', side: 'sell', lots: 1, slPips: 20, dupOk: true, pmDone: true });
          placeOrder({ sym: s, side: 'buy', ot: 'limit', price: +(q.bid * .98).toFixed(m.digits), lots });
          addAlert(s, +(q.mid * 1.01).toFixed(m.digits));
          const p = S.positions.find(x => x.sym === s); if (p) closePosition(p.id, 'test');
          openPosition({ sym: s, side: 'sell', lots, dupOk: true, pmDone: true });
        }, sym);
        for (const tab of ['positions', 'orders', 'history', 'alerts']) {
          await page.evaluate(n => setTab(n), tab);
          await page.waitForTimeout(120);
          const txt = await page.evaluate(`${textOf()}(document.querySelector('.tab.on'))`);
          if (BAD.test(txt)) bad.push(`${sym} ${tab}: …${txt.match(new RegExp('.{0,60}' + BAD.source + '.{0,30}'))[0]}…`);
        }
        const other = await page.evaluate(`(() => { const t = ${textOf()}; document.querySelector('#insBtn').click(); const r = ['#wlDet', '#wl', '#insPop', '.chart-top'].map(q => q + ': ' + t(document.querySelector(q))).join(' | '); document.querySelector('#insBtn').click(); return r; })()`);
        if (BAD.test(other)) bad.push(`${sym} panels: ${other.match(new RegExp('.{0,60}' + BAD.source + '.{0,30}'))[0]}`);
        await page.evaluate(() => document.querySelector('#views button[data-view="monitor"]').click());
        await page.waitForTimeout(2300);
        const mon = await page.evaluate(`${textOf()}(document.querySelector('#monitor'))`);
        if (BAD.test(mon)) bad.push(`${sym} monitor: ${mon.match(new RegExp('.{0,60}' + BAD.source + '.{0,30}'))[0]}`);
        await page.evaluate(() => document.querySelector('#views button[data-view="trade"]').click());
      }
      t.ok(!bad.length, bad.join('\n'));
      t.noErrors(page);
    }
  },
  {
    name: 'MAU8 symbol details and quote monitor read the session from the engine; the monitor ticks only tiles on screen',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      const r = await page.evaluate(async () => {
        T.reset(); S.set.jur = 'none'; S.set.lev = null;
        setSymbol('AAPL.US'); await new Promise(r => setTimeout(r, 2200));
        const det = document.querySelector('#wlDet').innerText;
        setSymbol('EURUSD'); await new Promise(r => setTimeout(r, 2200));
        const detFx = document.querySelector('#wlDet').innerText;
        document.querySelector('#views button[data-view="monitor"]').click();
        document.querySelector('#monFilter button[data-f="stock"]').click();
        await new Promise(r => setTimeout(r, 2300));
        const tiles = [...document.querySelectorAll('#monBoard .mq')], aapl = document.querySelector('#monBoard .mq[data-sym="AAPL.US"]');
        const stockSub = document.querySelector('#monSub').hidden;
        document.querySelector('#monFilter button[data-f="fx"]').click();
        const fxSub = [...document.querySelectorAll('#monSub button')].map(b => b.dataset.s), fxN = document.querySelectorAll('#monBoard .mq').length;
        document.querySelector('#monSub button[data-s="Crosses"]').click();
        const crossN = document.querySelectorAll('#monBoard .mq').length;
        document.querySelector('#monFilter button[data-f="stock"]').click();
        const out = { stockSub, fxSub, fxN, crossN, det, detFx, tiles: tiles.length, ses: aapl.title, label: !!aapl.querySelector('.mq-ses'), closed: aapl.classList.contains('closed'), filled: tiles.filter(x => x.querySelector('.mq-s span').textContent).length, btns: [...document.querySelectorAll('#monFilter button')].map(b => b.dataset.f) };
        document.querySelector('#monFilter button[data-f="all"]').click();
        document.querySelector('#views button[data-view="trade"]').click();
        return out;
      });
      t.ok(/Session\s*Closed · opens Fri/i.test(r.det), 'details: a closed stock says when it opens: ' + r.det.replace(/\s+/g, ' '));
      t.ok(!/nothing closes/i.test(r.det + r.detFx), 'no "nothing closes" text');
      t.ok(/Session\s*Open/i.test(r.detFx), 'details: FX open on Friday: ' + r.detFx.replace(/\s+/g, ' '));
      t.eq(r.tiles, 186, 'Stocks filter: 186 tiles');
      t.ok(!r.btns.includes('USD') && !r.btns.includes('cross') && r.btns.includes('fx'), 'monitor filters by category, not by currency: ' + r.btns);
      t.eq(r.fxSub.join(), 'all,Majors (G8),Crosses,Exotics', 'FX subfilters'); t.eq(r.fxN, 38, 'FX: 38 tiles'); t.eq(r.crossN, 9, 'FX · Crosses: 9 tiles');
      t.ok(r.stockSub, 'no subfilters on Stocks');
      t.ok(r.btns.includes('fav') && r.btns.includes('index') && r.btns.includes('commodity') && r.btns.includes('crypto') && r.btns.includes('stock'), 'monitor filters on the catalog groups: ' + r.btns);
      t.ok(/closed/i.test(r.ses) && !r.label, 'a closed stock tile carries no label; the reason is its tooltip: ' + r.ses); t.ok(r.closed, 'and is dimmed');
      t.ok(r.filled > 0 && r.filled < 186, `only tiles on screen are filled: ${r.filled} of 186`);
      t.noErrors(page);
    }
  },
  {
    name: 'MAU9 backtest on GOLD: sizes on the sheet step, about 1% risk per trade; FX sizes unchanged',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await feed(page, ['GOLD', 'EURUSD']);
      const r = await page.evaluate(() => {
        const c = JSON.parse(JSON.stringify(btCfg())); Object.assign(c, { tpl: c.tpl, risk: 1, comm: 7, slip: 0, slMode: 'atr', slK: 2 });
        const one = sym => {
          const res = runBacktest(c, sym), tr = res.trades;
          return { n: tr.length, lots: tr.map(x => x.lots), loss: tr.filter(x => x.reason === 'Stop loss').map(x => x.r), pnl: tr.map(x => x.pnl), st: res.stats };
        };
        return { x: one('GOLD'), f: one('EURUSD') };
      });
      for (const [k, v] of [['GOLD', r.x], ['EURUSD', r.f]]) {
        t.ok(v.n > 0, `${k}: trades`);
        t.ok(v.lots.every(l => l >= .01 - 1e-9 && Math.abs(l * 100 - Math.round(l * 100)) < 1e-6), `${k}: whole 0.01 lots: ${v.lots.slice(0, 5)}`);
        t.ok(v.pnl.every(p => p > -3000), `${k}: no loss beyond 3% of the $100k start at 1% risk: ${Math.min(...v.pnl).toFixed(0)}`);
        // about 1R; the 8-week history has weekends, and a stop jumped by the reopening gap fills beyond it (the gap fill is the rule)
        const mid = v.loss.slice().sort((a, b) => a - b)[v.loss.length >> 1];
        if (v.loss.length) t.ok(mid < -.8 && mid > -1.6 && v.loss.every(x => x > -4), `${k}: a stop-loss exit costs about 1R (median ${mid && mid.toFixed(2)}, worst ${Math.min(...v.loss).toFixed(2)})`);
        t.ok(Object.values(v.st).every(x => typeof x !== 'number' || !Number.isNaN(x)), `${k}: no NaN in the stats`);
      }
      t.noErrors(page);
    }
  },
  {
    name: "MAU10 news on the instrument's currencies: behaviour flag and position news tag use newsCcy (DE.30: EUR)",
    async run({ t, app }) {
      const page = await app('', { clock: OPEN });
      await lazy(page);
      const r = await page.evaluate(() => {
        T.reset(); S.set.jur = 'none'; S.set.lev = null;
        const now = Engine.simTime;
        CAL.events = [{ id: 'x1', t: now + 1800, ccy: 'EUR', name: 'CPI Flash', impact: 'hi', unit: '%', fc: 2, prev: 2, sd: .2, done: false, actual: null }];
        const o = sym => ({ sym, side: 'buy', lots: .1, slPips: 50 });
        const f = pmFlags(o('DE.30'), pmRisk(o('DE.30'))).map(x => x[0]), g = pmFlags(o('OIL'), pmRisk(o('OIL'))).map(x => x[0]);
        openPosition({ sym: 'DE.30', side: 'buy', lots: .1, slPips: 200, dupOk: true, pmDone: true });
        CAL.events[0].done = true; bhTick();
        return { de: f.includes('news'), oil: g.includes('news'), tag: S.positions[0] && S.positions[0].news, ccy: M('DE.30').newsCcy };
      });
      t.deep(r.ccy, ['EUR'], 'DE.30 news currency: EUR');
      t.ok(r.de, 'a EUR release flags a DE.30 trade');
      t.ok(!r.oil, 'and does not flag OIL (USD)');
      t.deep(r.tag, ['EUR CPI Flash'], 'the open DE.30 position is tagged with the release');
      t.noErrors(page);
    }
  }
];
