// Economic calendar: the real week from ForexFactory while prices are live (server/calendar.js, panels.js calLoad);
// the simulated calendar only on the simulated market.
export const tests = [
  {
    name: 'CAL1 server: the ForexFactory rows normalize (times with their offset, impact, published forecast/previous text); bad rows are skipped',
    async run({ t }) {
      const { normalize } = await import('../server/calendar.js');
      const ev = normalize([
        { title: 'Non-Farm Employment Change', country: 'USD', date: '2026-11-06T08:30:00-05:00', impact: 'High', forecast: '120K', previous: '98K' },
        { title: 'German ifo Business Climate', country: 'EUR', date: '2026-10-26T05:00:00-04:00', impact: 'Low', forecast: '90.0', previous: '89.9' },
        { title: 'Bank Holiday', country: 'NZD', date: '2026-10-25T15:00:00-04:00', impact: 'Holiday', forecast: '', previous: '' },
        { title: 'x', country: 'usd', date: '2026-10-26T05:00:00-04:00', impact: 'High' }, { title: 'y', country: 'USD', date: 'soon' }, null
      ]);
      t.eq(ev.length, 3, 'three good rows, three bad ones skipped');
      t.deep(ev.map(e => e.ccy), ['NZD', 'EUR', 'USD'], 'sorted by time');
      const nfp = ev.find(e => e.ccy === 'USD');
      t.eq(nfp.t, Date.parse('2026-11-06T13:30:00Z') / 1000, 'the time keeps its UTC offset');
      t.deep([nfp.impact, nfp.fc, nfp.prev], ['hi', '120K', '98K'], 'impact and the published figures');
      t.ok(ev[0].holiday && ev[0].impact === 'lo', 'a holiday is a low-impact row marked holiday');
      let e = ''; try { normalize({}); } catch (x) { e = x.message; } t.ok(/Unexpected/.test(e), 'a non-list answer is an error: ' + e);
      // a hostile feed (security audit 09.11.2026, F01): no markup character passes, the words stay
      const [h] = normalize([{ title: 'S&P PMI <img src=x onerror=alert(1)>', country: 'USD', date: '2026-11-06T08:30:00-05:00', impact: 'High', forecast: '<svg onload=alert(1)>', previous: '"\'`1.2%' }]);
      t.ok(!/[<>"'`]/.test(h.name + h.fc + h.prev) && /^S&P PMI/.test(h.name) && h.prev === '1.2%', 'markup characters are dropped: ' + JSON.stringify([h.name, h.fc, h.prev]));
    }
  },
  {
    name: 'CAL2 live prices: the real calendar replaces the simulated one (no generated events, no price effect), past releases stay quiet, a due high-impact release says so',
    async run({ t, app }) {
      const page = await app(''); // the wall clock: the release has to come due while the test waits
      await page.waitForFunction(() => window.setView && typeof calTick === 'function', null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        const sim = CAL.events.length, now = Math.floor(Date.now() / 1000);
        const sample = { at: Date.now(), src: 'ForexFactory', events: [
          { t: now - 7200, ccy: 'EUR', name: 'German ifo Business Climate', impact: 'lo', fc: '90.0', prev: '89.9' },
          { t: now + 2, ccy: 'USD', name: 'Non-Farm Employment Change', impact: 'hi', fc: '120K', prev: '98K' },
          { t: now + 7200, ccy: 'USD', name: 'ISM Services PMI', impact: 'md', fc: '52.1', prev: '51.8' }] };
        const f0 = window.fetch; window.fetch = (u, o) => String(u).includes('/api/calendar') ? Promise.resolve(new Response(JSON.stringify(sample), { status: 200, headers: { 'Content-Type': 'application/json' } })) : f0(u, o);
        let jumps = 0; const j0 = Engine.jump; Engine.jump = (...a) => { jumps++; return j0(...a); };
        Engine.setFeed({ realTime: true, has: s => s === 'EURUSD', onTicks() {}, alive: () => true, want() {} });
        const m0 = Math.floor(now / 60) * 60; Engine.feedHistory('EURUSD', [{ time: m0 - 60, open: 1.1, high: 1.1, low: 1.1, close: 1.1 }, { time: m0, open: 1.1, high: 1.1, low: 1.1, close: 1.1 }]);
        calTick(); await new Promise(r => setTimeout(r, 300));
        const loaded = { n: CAL.events.length, src: CAL.src, real: CAL.events.every(e => e.real), past: CAL.events.filter(e => e.done).map(e => [e.name, e._bh]) };
        await new Promise(r => setTimeout(r, 2500)); calTick();
        const toasts = [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent);
        setView('research'); setTab('calendar'); renderCalendar();
        const rows = [...document.querySelectorAll('#calBody tr')].map(x => x.innerText);
        const foot = document.getElementById('calFoot').textContent;
        Engine.setFeed(null); window.fetch = f0; Engine.jump = j0;
        return { sim, loaded, toasts, rows, foot, jumps };
      });
      t.ok(r.sim > 0, 'the simulated market starts with the simulated calendar (' + r.sim + ')');
      t.deep([r.loaded.n, r.loaded.src, r.loaded.real], [3, 'live', true], 'live: only the real events');
      t.deep(r.loaded.past, [['German ifo Business Climate', 1]], 'a release already out at load is history (no news tag)');
      t.ok(r.toasts.some(x => /Non-Farm Employment Change/.test(x) && /Scheduled release now/.test(x)) && !r.toasts.some(x => /Actual/.test(x)), 'the due release is announced, with no invented figure: ' + r.toasts.join(' / '));
      t.eq(r.jumps, 0, 'no price jump from a real release');
      t.ok(r.rows.length === 3 && /120K/.test(r.rows[1]) && /98K/.test(r.rows[1]), 'the table shows the published forecast and previous: ' + r.rows[1]);
      t.ok(/Real economic calendar/.test(r.foot) && /ForexFactory/.test(r.foot), 'the footnote names the source: ' + r.foot);
      t.noErrors(page);
    }
  },
  {
    name: 'CAL3 a hostile calendar answer renders as text: no element is made from its forecast, previous or name (audit F01)',
    async run({ t, app }) {
      const page = await app('');
      await page.waitForFunction(() => window.setView && typeof calTick === 'function', null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        window.__xss = 0; const now = Math.floor(Date.now() / 1000);
        const bad = '<img src=x onerror="window.__xss=1">';
        const sample = { at: Date.now(), src: 'ForexFactory', events: [{ t: now + 3600, ccy: 'EUR', name: 'CPI ' + bad, impact: 'hi', fc: bad, prev: '<svg onload="window.__xss=1">' }] };
        const f0 = window.fetch; window.fetch = (u, o) => String(u).includes('/api/calendar') ? Promise.resolve(new Response(JSON.stringify(sample), { status: 200, headers: { 'Content-Type': 'application/json' } })) : f0(u, o);
        Engine.setFeed({ realTime: true, has: s => s === 'EURUSD', onTicks() {}, alive: () => true, want() {} });
        const m0 = Math.floor(now / 60) * 60; Engine.feedHistory('EURUSD', [{ time: m0 - 60, open: 1.1, high: 1.1, low: 1.1, close: 1.1 }, { time: m0, open: 1.1, high: 1.1, low: 1.1, close: 1.1 }]);
        calTick(); await new Promise(r => setTimeout(r, 300));
        setView('research'); setTab('calendar'); renderCalendar();
        await new Promise(r => setTimeout(r, 300));
        const made = document.querySelectorAll('#calBody img, #calBody svg[onload]').length, row = document.querySelector('#calBody tr')?.innerText || '';
        Engine.setFeed(null); window.fetch = f0;
        return { xss: window.__xss, made, row, src: CAL.src };
      });
      t.eq(r.src, 'live', 'the live calendar is shown');
      t.eq(r.made, 0, 'no element from the feed text');
      t.eq(r.xss, 0, 'nothing ran');
      t.ok(/CPI/.test(r.row), 'the row is still there: ' + r.row);
      t.noErrors(page);
    }
  }
];
