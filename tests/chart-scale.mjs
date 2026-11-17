// The main chart's price axis after a symbol change: a hand-zoomed axis (auto-scale off) must not keep the old
// instrument's price window, or the new candles sit outside it and the chart looks empty. Frozen market.
export const tests = [
  {
    name: 'CS1 a price axis zoomed by hand on EUR/USD does not hide AUD/NZD: auto-scale comes back on a new symbol; a zoom on the same symbol stays',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        const raf = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        setSymbol('EURUSD'); await raf();
        candle.priceScale().setVisibleRange({ from: 1.0, to: 1.01 }); // auto-scale off, away from the price
        const off = candle.priceScale().options().autoScale;
        setSymbol('AUDNZD'); await raf();
        const q = Engine.quote('AUDNZD'), vr = candle.priceScale().getVisibleRange();
        const inView = vr && q.bid >= vr.from && q.bid <= vr.to;
        candle.priceScale().setVisibleRange({ from: q.bid - .05, to: q.bid + .05 });
        fullChart(false); await raf();
        const kept = candle.priceScale().getVisibleRange();
        return { off, inView, vr, bid: q.bid, kept: kept && Math.abs(kept.from - (q.bid - .05)) < 1e-9 };
      });
      t.eq(r.off, false, 'setting a range by hand turns auto-scale off (as dragging the axis does)');
      t.ok(r.inView, `AUD/NZD bid ${r.bid} is inside the price axis after the switch: ${JSON.stringify(r.vr)}`);
      t.ok(r.kept, 'a redraw of the same symbol keeps the zoom the user chose');
    },
  },
];
