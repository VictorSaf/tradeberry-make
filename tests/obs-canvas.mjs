// Observatory canvases are drawn at the size they are shown: a canvas measured before a side panel or a table under
// it settled was stretched by the browser (Regime: round dots drawn as ellipses, text squashed; 24.10.2026).
const WED = new Date('2026-10-21T14:00:00Z');

export const tests = [
  {
    name: 'OCV1 every Observatory canvas has a bitmap matching its box (no stretched plot), at 1280 and 1700, after the view settles',
    async run({ t, app }) {
      const page = await app('', { clock: WED });
      await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
      for (const width of [1280, 1700]) {
        await page.setViewportSize({ width, height: 950 });
        const r = await page.evaluate(async () => {
          T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
          const out = {}, dpr = devicePixelRatio || 1;
          for (const v of ['const', 'regime', 'dc', 'deja', 'rp', 'drv', 'clock', 'tap']) {
            obsCfg().view = v; renderObs();
            await new Promise(r => setTimeout(r, 400)); // the refit runs one frame after the draw
            out[v] = [...document.querySelectorAll('#obsBody canvas')].filter(c => c.clientWidth)
              .map(c => ({ id: c.id, bw: c.width / dpr, bh: c.height / dpr, cw: c.clientWidth, ch: c.clientHeight }));
          }
          return out;
        });
        for (const [v, cvs] of Object.entries(r)) for (const c of cvs) {
          t.ok(Math.abs(c.bw - c.cw) <= 1 && Math.abs(c.bh - c.ch) <= 1, `${width}px ${v} ${c.id}: bitmap ${c.bw}×${c.bh} drawn for a ${c.cw}×${c.ch} box`);
        }
        t.ok(r.regime.length === 1, `Regime has its plot (${r.regime.length})`);
        // the per-pair table: folded by default; opened, the plot keeps a fixed box and is redrawn to it; the state survives a redraw
        const q = await page.evaluate(async () => {
          obsCfg().view = 'regime'; OBS.rgTblOpen = false; renderObs(); await new Promise(r => setTimeout(r, 400));
          const dpr = devicePixelRatio || 1, fit = () => { const c = document.getElementById('rgCv'); return Math.abs(c.width / dpr - c.clientWidth) <= 1 && Math.abs(c.height / dpr - c.clientHeight) <= 1; };
          const d = document.querySelector('#obsBody .rg-tbl-wrap'), folded = { tag: d.tagName, open: d.open, fit: fit(), h: document.getElementById('rgCv').clientHeight };
          d.querySelector('summary').click(); await new Promise(r => setTimeout(r, 400));
          const opened = { fit: fit(), h: document.getElementById('rgCv').clientHeight, rows: d.querySelectorAll('tbody tr').length };
          obsDraw(); await new Promise(r => setTimeout(r, 400));
          const kept = { open: document.querySelector('#obsBody .rg-tbl-wrap').open, fit: fit() };
          document.querySelector('#obsBody .rg-tbl-wrap summary').click(); await new Promise(r => setTimeout(r, 400));
          return { folded, opened, kept, closed: fit() };
        });
        t.ok(q.folded.tag === 'DETAILS' && !q.folded.open, `${width}px: the table is folded by default`);
        t.ok(q.folded.fit && q.opened.fit && q.kept.fit && q.closed, `${width}px: the plot fits its box folded, opened, redrawn open and folded again ${JSON.stringify(q)}`);
        t.ok(q.folded.h > q.opened.h, `${width}px: folded, the plot is taller (${q.folded.h} > ${q.opened.h})`);
        t.ok(q.opened.rows === 16 && q.kept.open, `${width}px: opened it lists the 16 pairs and stays open across a redraw`);
      }
      t.noErrors(page);
    }
  }
];
