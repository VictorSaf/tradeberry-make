/* Hint engine (front 16.11.2026): the common machinery of the hint cards for the whole app.
   A card is built at run time from the element itself and its live values; the look is the one of the Coach Journal (hints.js):
   a verdict on trading efficiency, the live value highlighted, "In plain words", a scale or a table, "Watch out", "Use it".

   ---- API (window.HX) ----
   Card pieces (strings of HTML):  head(title, chip, tone)  val(label, value, cls, sub)  sec(heading, body)  scale(bands, min, max, v, fmt)
     tbl(rows, headRow)  p(text)  use(text)  warn(text)  ex(text)  bars(rows)  plain(text)  card({title, chip, tone, value, vlabel, vcls, sub, plain, secs, watch, eg, use})
     tone: 'ok' (pos) | 'bad' (neg) | 'warn' (cau) | '' (neu). One written rule per verdict, in the chip.
   Helpers:  esc  U  nm(text)->first number  sgn(v)  cls(v)->'up'|'dn'|''  lbl(el)->visible text  stat.{num,sgn,cls,pc,clamp,band}
   HX.add(selector, builder, opts?)   a card for every element matching the selector.
       builder(el) -> card HTML (or null: the plain fallback card is shown, and the audit flags it as generic).
       An element that is not pressed (text, value, label, header, cell, canvas): the pointer becomes the yellow "?" and a click opens the modal (data-rich).
       A button, field, link, summary: its click is kept, the card shows on hover, anchored beside it (data-rich-tip).
       opts.control = true|false  forces the kind (default: buttons, fields, links, summary, details, [role=button] are controls);
       opts.empty = true  stamps elements without visible text (icon buttons, hit zones, svg regions);
       opts.when = () => boolean   the card is offered only while the function says true (one tool of a shared page); when false the element is left to the next registration.
       opts.go = 'Open ...' | el => text   the element opens a pair/page: its card is a modal with an "Open ..." button that does the original click.
   HX.tip(titleRegex, builder(el, title, body), {within})   elements that carry data-tip="Title|text" in the scope `within` (a selector; required in practice)
       whose title matches get a card built by builder; the first builder that returns a card wins; null falls through to the plain fallback.
   HX.go(selector, label)   same as opts.go, for elements stamped through HX.tip.
   HX.optout(selector)      the elements (and what is inside them) get no card and no hover: self-explanatory actions and what Victor removed.
                            The list is in hints-optouts.json at the project root (loaded here: build.mjs inlines it into the bundle as window.MFX_HINT_OPTOUTS).
   HX.silence(canvasId)     the plain readout CV_HOVER[canvasId] (brief.js) is muted while Hints is on (the canvas has its own hit zones with cards). Price readouts stay.
   HX.stampNow(root?)       synchronous full pass (the audit and tests use it); HX.cardFor(el) -> html|null; HX.info(el) -> {state, key, generic, optout}.

   ---- stamping ----
   One MutationObserver (element insertions only: text updates of live prices cost nothing), batched, run in idle time and cut into slices;
   it only touches the visible part of the page; hidden panes are stamped when they open (pane class change, click, key). Native title
   attributes are removed from stamped non-controls (the card replaces them). Nothing runs while the Hints switch is off. */
window.HX = (() => {
  const { esc, head, val, sec, scale, tbl, p, use, warn, ex, bars } = HT;
  const U = s => String(s).replace(/−/g, '-'), nm = s => { const m = U(s).match(/[+-]?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
  const lbl = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const plain = t => `<div class="rt-plain"><b>In plain words</b>${t}</div>`;
  const card = o => head(o.title, o.chip, o.tone) + (o.value != null ? val(o.vlabel || o.title, o.value, o.vcls, o.sub) : '') + (o.plain ? plain(o.plain) : '') + (o.secs || []).join('') + (o.watch ? warn(o.watch) : '') + (o.eg ? ex(o.eg) : '') + (o.use ? use(o.use) : '');
  const stat = { num: nm, sgn, cls, pc: (v, d = 0) => (v * 100).toFixed(d) + '%', clamp: (v, a, b) => Math.max(a, Math.min(b, v)), band: (v, cuts, names) => names[cuts.filter(c => v >= c).length] };

  // ---- fallback cards: they carry a marker so the audit can tell "a card" from "only the old text" ----
  const GEN = '<!--hx-generic-->';
  const generic = el => { const t = el.dataset.tip || '', i = t.indexOf('|'), title = i < 0 ? t : t.slice(0, i), body = i < 0 ? '' : t.slice(i + 1), b = el.querySelector('b'), v = b ? b.textContent : '';
    return GEN + card({ title: title || 'Element', chip: '', tone: '', value: v ? esc(v) : null, vlabel: title, plain: esc(body), use: 'See the Guide for this page for the full explanation.' }); };
  const textCard = el => GEN + card({ title: lbl(el).slice(0, 46) || 'Element', chip: '', tone: '', plain: esc(lbl(el)), use: 'See the Guide of this page for the full explanation.' });

  // ---- registries ----
  const ADD = [], TIPS = [], GOS = [], OFFS = [], SIL = new Set(), CTL = 'button,input,select,textarea,a,[role=button],[role=tab],[role=switch],[role=checkbox],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=radio],[role=slider],[role=combobox],details,summary';
  const bad = new Set(); // selectors the browser refuses: reported once, never retried
  const qsa = (root, sel) => { try { return root.querySelectorAll(sel); } catch (e) { if (!bad.has(sel)) { bad.add(sel); console.warn('[hints] bad selector', sel, e.message); } return []; } };
  const mt = (el, sel) => { try { return el.matches(sel); } catch (e) { return false; } };
  const goOf = el => { for (const g of GOS) if (mt(el, g.sel)) return g; return null; };
  const add = (selector, builder, o) => { ADD.push({ sel: selector, f: builder, o: o || {} }); if (o && o.go) GOS.push({ sel: selector, label: o.go }); wake(true); return ADD.length - 1; };
  const tip = (re, builder, o) => { TIPS.push({ re, f: builder, within: o && o.within }); wake(true); };
  const go = (selector, label) => { GOS.push({ sel: selector, label }); wake(true); };
  const optout = selector => { if (!OFFS.includes(selector)) OFFS.push(selector); wake(true); };
  const silence = id => { SIL.add(id); wake(); };

  // ---- one card ----
  const tipParts = el => { const t = el.dataset.tip || '', i = t.indexOf('|'); return [i < 0 ? t : t.slice(0, i), i < 0 ? '' : t.slice(i + 1)]; };
  const tipMatch = el => { const [title] = tipParts(el); return TIPS.filter(t => (!t.within || (el.closest && el.closest(t.within))) && t.re.test(title)); };
  const byTip = el => { const [title, body] = tipParts(el); for (const t of tipMatch(el)) { let h = null; try { h = t.f(el, title, body); } catch (e) { h = null; } if (h) return h; } return null; };
  const rowGo = (el, h, g) => { if (!h) return h; HX._go = el; const lab = typeof g.label === 'function' ? g.label(el) : g.label; return h + `<div class="rt-use"><b>Open it</b><button type="button" class="cta sm" data-hxgo="1">${esc(lab || 'Open')}</button></div>`; };
  // key: "<index of HX.add>" or "" (resolved from data-tip)
  const render = (key, el) => {
    try { let h = null; if (key !== '') { const e = ADD[+key]; if (e) { try { h = e.f(el); } catch (x) { h = null; } } } else h = byTip(el);
      if (!h) h = key !== '' ? textCard(el) : (el.dataset.tip ? generic(el) : textCard(el));
      const g = goOf(el); return g ? rowGo(el, h, g) : h; } catch (e) { return null; }
  };
  const cardFor = el => { const k = el.dataset.rich !== undefined ? el.dataset.rich : el.dataset.richTip; if (k == null || k.slice(0, 2) !== 'x:') return null; return render(k.slice(2), el); };

  // ---- stamping ----
  const off = () => document.body.classList.contains('no-hints');
  const isCtl = (e, o) => o && o.control != null ? !!o.control : mt(e, CTL) && !goOf(e);
  const mark = (e, key, ctl) => { if (!mt(e, 'button,input,select,textarea,a') && e.hasAttribute('title')) { if (e.title) e.dataset.hxTitle = e.title; e.removeAttribute('title'); } /* the native tooltip goes (the card replaces it); its text stays in data-hx-title */ if (ctl) e.dataset.richTip = 'x:' + key; else e.dataset.rich = 'x:' + key; };
  const shown = e => e.getClientRects().length > 0;
  const SKIP = '#brTip,#hintDlg,#toasts';
  let optLoaded = false;
  const applyOptouts = root => { for (const s of OFFS) for (const e of qsa(root, s)) if (!e.hasAttribute('data-hx-off')) { e.setAttribute('data-hx-off', ''); e.removeAttribute('data-rich'); e.removeAttribute('data-rich-tip'); } };
  const stepAdd = (root, i) => { const s = ADD[i]; if (!s) return;
    if (s.o.when) { let on = false; try { on = !!s.o.when(); } catch (x) { on = false; } if (!on) return; } // opts.when: a card that belongs to one tool is offered only while that tool is open
    for (const e of qsa(root, `:is(${s.sel}):not([data-rich],[data-rich-tip],[data-hx-off])`)) {
      if (e.closest('[data-hx-off],' + SKIP) || !shown(e)) continue; if (!(s.o.empty || lbl(e) || mt(e, 'canvas'))) continue;
      mark(e, i, isCtl(e, s.o)); }
    if (root.nodeType === 1 && !root.hasAttribute('data-rich') && !root.hasAttribute('data-rich-tip') && !root.closest('[data-hx-off],' + SKIP) && mt(root, s.sel) && shown(root) && (s.o.empty || lbl(root) || mt(root, 'canvas'))) mark(root, i, isCtl(root, s.o)); };
  const stepTips = root => { if (!TIPS.length) return;
    const list = [...qsa(root, '[data-tip]:not([data-rich],[data-rich-tip],[data-hx-off])')]; if (root.nodeType === 1 && root.hasAttribute('data-tip')) list.push(root);
    for (const e of list) { if (e.hasAttribute('data-rich') || e.hasAttribute('data-rich-tip') || e.closest('[data-hx-off],' + SKIP) || !shown(e) || !tipMatch(e).length) continue; mark(e, '', isCtl(e, null)); } };
  const silenceNow = () => { if (typeof CV_HOVER !== 'object') return; for (const id of SIL) { const f = CV_HOVER[id]; if (typeof f === 'function' && !f._hx) { const g = e => { if (off() || !e) return f(e); if (typeof brTipHide === 'function') brTipHide(); }; g._hx = 1; CV_HOVER[id] = g; } } };
  const pass = (root, deadline) => { // returns true when finished, false when the slice ran out (the caller continues later)
    const t0 = performance.now(); const budget = deadline ? Math.max(4, Math.min(12, deadline.timeRemaining())) : 1e9;
    if (!pass.st || pass.st.root !== root) pass.st = { root, i: -1 };
    const st = pass.st; // steps: -1 the opt-outs, 0..n-1 one per HX.add (in order: the first selector that matches wins), n the data-tip elements
    while (st.i <= ADD.length) {
      if (st.i === -1) { applyOptouts(root); silenceNow(); } else if (st.i === ADD.length) stepTips(root); else stepAdd(root, st.i);
      st.i++; if (performance.now() - t0 > budget && st.i <= ADD.length) return false;
    }
    pass.st = null; return true;
  };
  const stampNow = root => { pass.st = null; const r = root || document.body; pass(r, null); };

  // ---- when to run ----
  const roots = new Set(); let full = true, timer = 0, busy = false, lastRun = 0;
  const idle = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 700 }) : setTimeout(() => f({ timeRemaining: () => 8 }), 0));
  const wake = whole => { if (whole) full = true; if (timer || busy) return; timer = setTimeout(() => { timer = 0; idle(run); }, Math.max(60, 300 - (performance.now() - lastRun))); };
  const run = dl => {
    if (off() || !document.body) { roots.clear(); full = false; return; } busy = true;
    try { let list = full || roots.size > 24 ? [document.body] : [...roots]; if (!full && list.length === 0) { busy = false; return; }
      const done = []; for (const r of list) { if (r !== document.body && (!r.isConnected || !shown(r))) { done.push(r); continue; } if (!pass(r, dl)) { busy = false; timer = setTimeout(() => { timer = 0; idle(run); }, 30); return; } done.push(r); }
      if (full || roots.size > 24) { full = false; roots.clear(); } else done.forEach(r => roots.delete(r));
    } catch (e) { console.warn('[hints] pass failed', e); pass.st = null; }
    busy = false; lastRun = performance.now(); if (roots.size || full) wake();
  };
  const dirty = n => { for (const r of roots) { if (r.contains(n)) return; if (n.contains(r)) roots.delete(r); } roots.add(n); };
  const watch = () => {
    const cb = recs => { let any = false;
      for (const r of recs) {
        if (r.type === 'attributes') { any = true; full = true; continue; }
        let el = false; for (const n of r.addedNodes) if (n.nodeType === 1) { el = true; break; }
        if (!el) continue; const t = r.target; if (t.nodeType !== 1 || (t.closest && t.closest(SKIP))) continue; dirty(t); any = true;
      }
      if (any) wake(); };
    const mo = new MutationObserver(cb), mo2 = new MutationObserver(cb); // one node cannot carry two option sets on one observer: the second observe() would replace the first
    mo.observe(document.body, { childList: true, subtree: true });
    mo2.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-view'] }); // the Hints switch, a view change
    for (const e of document.querySelectorAll('.tab, .overlay, #views')) mo2.observe(e, { attributes: true, attributeFilter: ['class', 'hidden'] }); // a pane or a dialog shown
    for (const ev of ['click', 'keyup', 'toggle', 'resize']) addEventListener(ev, e => { if (ev !== 'keyup' || /^(Escape|Enter| )$/.test(e.key)) wake(true); }, { capture: true, passive: true });
  };

  // ---- the click on an element that opens a pair: the card first, its button does the original click ----
  document.addEventListener('click', e => {
    const g = e.target.closest && e.target.closest('[data-hxgo]');
    if (g) { e.preventDefault(); e.stopPropagation(); const el = HX._go; hintClose(); if (el && el.isConnected) { el._go = true; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); el._go = false; } return; }
    if (!GOS.length || off()) return; const r = e.target.closest && e.target.closest(GOS.map(x => `:is(${x.sel})[data-rich]`).join(','));
    if (r && !r._go) { e.preventDefault(); e.stopPropagation(); hintOpen(r.dataset.rich, r); }
  }, true);
  // the chart highlight of a level or a row keeps working on stamped elements
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('#brMain [data-k][data-rich]'); if (el && typeof brLight === 'function' && !off()) brLight(el.dataset.k); });
  document.addEventListener('mouseout', e => { const el = e.target.closest && e.target.closest('#brMain [data-k][data-rich]'); if (el && !(e.relatedTarget && el.contains(e.relatedTarget)) && typeof brLight === 'function') brLight(null); });

  // ---- the opt-out list: inlined by the build, read from hints-optouts.json in the source tree ----
  const takeOptouts = j => { if (Array.isArray(j)) for (const o of j) if (o && o.selector) optout(o.selector); optLoaded = true; };
  if (window.MFX_HINT_OPTOUTS) takeOptouts(window.MFX_HINT_OPTOUTS);
  else fetch('hints-optouts.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => takeOptouts(j && j.optouts)).catch(() => {});

  const info = el => { const k = el.dataset.rich !== undefined ? el.dataset.rich : el.dataset.richTip, anc = el.closest('[data-rich],[data-rich-tip]'), off1 = !!el.closest('[data-hx-off]'); const h = anc ? cardFor(anc) : null;
    return { state: off1 ? 'optout' : anc ? (h && h.includes(GEN) ? 'generic' : 'card') : 'none', key: k || null, own: !!(el.hasAttribute('data-rich') || el.hasAttribute('data-rich-tip')), via: anc && anc !== el ? anc : null, generic: !!(h && h.includes(GEN)), optout: off1 }; };

  const api = { head, val, sec, scale, tbl, p, use, warn, ex, bars, card, plain, esc, U, nm, sgn, cls, lbl, stat, add, tip, go, optout, silence, stampNow, cardFor, info, render, generic, textCard, GEN, _go: null, _reg: () => ({ add: ADD.length, tips: TIPS.length, go: GOS.length, optouts: OFFS.length, silenced: [...SIL], optLoaded }) };
  const start = () => { try { watch(); } catch (e) { console.warn('[hints] watch failed', e); } wake(true); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return api;
})();
