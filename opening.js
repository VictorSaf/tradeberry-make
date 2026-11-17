/* opening.js — the Opening Note (Victor, 26.10.2026; design: opening-note.html). A full-screen note over the app while
   the terminal loads behind it. "Let's begin" (or Escape) plays the approved transition: background → main text →
   details → logo → black → terminal. Once a day (Victor, 09.11.2026, UX report F15 and its round 2): it shows at the
   first opening of the UTC day; reloads after "Let's begin" go straight to the terminal. Seen = 'tb-onote-seen' in
   localStorage: '<UTC day>|<edition day>:<n>|s<server ts>' ('-': the built-in note; a value it cannot read counts as an
   unseen day and is written again). The reference is server time only (round 3): the created_at (`ts`) of the edition
   seen or, when the built-in note was seen, of the latest edition the server had then (0: none; an answer still on its
   way is written when it arrives). An edition with a later ts is new; the client clock is never compared with it. A new
   edition shows the note again, but never over a terminal already on screen: on a day already seen the terminal is up
   at once, so it waits for the next opening ('tb-onote-next' = that UTC day), and stays due until it is actually on
   screen (if it answers late again, the built-in note shows and the edition comes at the opening after). Round 2
   values ('|<client unix s>') are still read as they were. Without storage it shows at every opening.
   "Don't show again today" ('tb-opening-skip' = 'utc:<UTC day>', the same day as the seen mark; an old local-date value
   is kept only when it is today's UTC day, otherwise dropped) also keeps new editions away until the next UTC day in
   this browser. Not shown to automated browsers (the tests) or inside the replay window. */
(() => {
  const KEY = 'tb-opening-skip', SEEN = 'tb-onote-seen', NEXT = 'tb-onote-next';
  const utcDay = () => new Date().toISOString().slice(0, 10);
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }; // storage blocked: as never seen
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* not kept: shown next time */ } };
  let skip = get(KEY);
  // before round 2 the skip held the local date of the click: kept only when that date is today's UTC day (west of UTC
  // in the evening the local date is yesterday's UTC day and must not be moved onto a day nobody skipped; round 3)
  if (skip && !skip.startsWith('utc:')) { skip = skip === utcDay() ? 'utc:' + utcDay() : null; put(KEY, skip); }
  // coming back from a guide (guides/guide.js): straight to the page the guide was opened from
  let fromGuide = false; try { fromGuide = sessionStorage.getItem('tb-from-guide') === '1'; sessionStorage.removeItem('tb-from-guide'); } catch (e) { /* no storage */ }
  if (navigator.webdriver || window.top !== window || skip === 'utc:' + utcDay() || fromGuide || !document.body) return;

  const edId = e => e && e.title ? `${e.day || '-'}:${e.n || 1}` : '-'; // '-': the built-in note (no edition)
  // 's<n>': server time (round 3); a bare number: the client moment of round 2; none: round 1 (only another edition counts)
  const m = /^(\d{4}-\d{2}-\d{2})\|(-|\d{4}-\d{2}-\d{2}:\d+)(?:\|(s?)(\d+))?$/.exec(get(SEEN) || '');
  const seenDay = m ? m[1] : '', seenEd = m ? m[2] : '';
  const ref = m && m[3] === 's' ? +m[4] : null, oldAt = m && m[4] && m[3] !== 's' ? +m[4] : null;
  // an edition the reader has not seen: one the server wrote after what was seen (an edition without ts: another one)
  const fresh = e => !!(e && e.title) && (ref != null ? (+e.ts > 0 ? +e.ts > ref : edId(e) !== seenEd)
    : edId(e) !== seenEd && (oldAt == null || !(+e.ts > 0) || +e.ts > oldAt));
  const ask = fetch('/api/edition', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok && (r.headers.get('Content-Type') || '').includes('json') ? r.json() : null).catch(() => null);
  const race = () => Promise.race([ask, new Promise(r => setTimeout(() => r('late'), 1800))]);
  if (seenDay !== utcDay() || get(NEXT) === utcDay()) show();
  // already seen today: the terminal is on screen at once, so a newer edition (whenever it answers) waits for the next opening
  else ask.then(j => { if (j && j.edition && fresh(j.edition)) put(NEXT, utcDay()); });

  function show() {

  const h = new Date().getHours(), hello = h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
  const date = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const el = document.createElement('section');
  el.className = 'onote'; el.id = 'onote';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'onoteTitle');
  el.innerHTML = `<div class="onote-art" aria-hidden="true"></div><div class="onote-shade" aria-hidden="true"></div>
  <header class="onote-head">
    <div class="onote-brand" aria-label="trade.Berry"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5.5" y="20" width="3.4" height="7" rx=".8" fill="#ff4757"/><rect x="11.5" y="15" width="3.4" height="12" rx=".8" fill="#f1c40f"/><rect x="17.5" y="10" width="3.4" height="17" rx=".8" fill="#3498db"/><rect x="23.5" y="5" width="3.4" height="22" rx=".8" fill="#7ac943"/></svg><span><span class="onote-t">trade</span><span class="onote-b">.Berry</span></span></div>
    <span class="onote-date">${date}</span>
  </header>
  <article class="onote-copy">
    <div class="onote-kicker"><span>Opening note</span><i></i><span>Trading psychology</span></div>
    <h1 id="onoteTitle">Patience is a position, too.</h1>
    <p>Some of the most expensive decisions are made not when markets move too quickly, but when we feel we must participate. Before your first trade today, ask yourself:</p>
    <blockquote>What new information makes this risk worth taking?</blockquote>
    <div class="onote-welcome"><span>${hello}</span><strong>trade.Berry is ready when you are.</strong></div>
    <div class="onote-actions"><button type="button" class="onote-begin" id="onoteBegin">Let’s begin <span aria-hidden="true">→</span></button><button type="button" class="onote-skip" id="onoteSkip">Don’t show again today</button></div>
    <div class="onote-meta"><span>18 sec read</span><span>Edition 01</span></div>
  </article>
  <a class="onote-credit" href="https://unsplash.com/@martinrajdl" target="_blank" rel="noopener">Photo by Martin Rajdl on Unsplash</a>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('onote-open');

  /* The edition of the day (functions/api/edition.js): one AI-written note for everyone each day, with its own
     photograph. Only the words, the picture and its credit change; the layout is the note above. The copy waits up to
     1.8 s for the edition and then plays its entrance; without the server (a static copy) the built-in note stays. */
  const copy = el.querySelector('.onote-copy'), $o = q => el.querySelector(q);
  copy.style.visibility = 'hidden';
  // the rest of the entrance (date, credit, photograph) is timed from here: .onote-in (styles.css v15.14.9)
  const reveal = () => { if (copy.style.visibility !== 'hidden') return; copy.style.animation = 'none'; void copy.offsetWidth; copy.style.animation = ''; copy.style.visibility = ''; el.classList.add('onote-in'); };
  let shown = null;
  // the server time of the latest edition the server had (0: none); undefined while its answer is on the way
  let known, mark = null;
  ask.then(j => {
    known = j && j.edition && +j.edition.ts > 0 ? +j.edition.ts : 0;
    // the built-in note was seen before the answer came: its reference is what the server had then
    if (mark && !shown && known && get(SEEN) === mark) put(SEEN, mark.replace(/\|s0$/, '|s' + known));
  });
  function apply(e) {
    if (!e || !e.title) return;
    shown = e;
    const k = $o('.onote-kicker span:last-child'); if (k && e.kicker) k.textContent = e.kicker;
    $o('#onoteTitle').textContent = e.title;
    $o('.onote-copy > p').textContent = e.body || '';
    $o('.onote-copy blockquote').textContent = e.quote ? e.quote + (e.quoteBy ? ` — ${e.quoteBy}` : '') : '';
    const words = [e.title, e.body, e.quote].join(' ').split(/\s+/).length, m = $o('.onote-meta');
    m.children[0].textContent = `${Math.max(10, Math.round(words / 3.6))} sec read`;
    m.children[1].textContent = `Edition ${String(e.n || 1).padStart(2, '0')}`;
    if (e.photo && e.photo.url) {
      $o('.onote-art').style.backgroundImage = `url("${String(e.photo.url).replace(/["\\]/g, '')}")`;
      const c = $o('.onote-credit'); c.textContent = `Photo by ${e.photo.by} on Unsplash`; c.href = /^https:\/\/unsplash\.com\//.test(String(e.photo.link || '')) ? e.photo.link : 'https://unsplash.com/'; // only an Unsplash page (audit F15)
    }
  }
  // administrators: write today's edition again (testing); a quiet link in the meta line, nothing else changes
  function adminTools() {
    const m = $o('.onote-meta'); if (!m || m.querySelector('.onote-regen')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'onote-regen'; b.textContent = 'New edition ↻';
    b.style.cssText = 'padding:0;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px';
    b.addEventListener('click', async () => {
      // the edition is written by Claude Code on the administrator's Mac (tools/edition.mjs), which picks the
      // request up within about two minutes; the note shows the new edition as soon as it is stored
      b.disabled = true; b.textContent = 'Asking for a new edition…';
      const from = shown && shown.ts || 0;
      try {
        const r = await fetch('/api/edition', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{"op":"regen"}' });
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || 'HTTP ' + r.status);
        b.textContent = 'Writing a new edition… (a few minutes)';
        for (let i = 0; i < 48 && document.body.contains(el); i++) {
          await new Promise(res => setTimeout(res, 10000));
          const j = await fetch('/api/edition', { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()).catch(() => null);
          if (j && j.edition && (j.edition.ts || 0) > from) { apply(j.edition); b.textContent = 'New edition ↻'; b.disabled = false; return; }
        }
        b.textContent = 'Not written yet · is the Mac job running? ↻';
      } catch (e) { b.textContent = e.message + ' · retry ↻'; }
      b.disabled = false;
    });
    m.appendChild(b);
  }
  race().then(j => {
    if (j && j !== 'late') { apply(j.edition); if (j.admin) adminTools(); }
    reveal();
    if (j === 'late') ask.then(x => { if (x && x.admin) adminTools(); });
  });

  let done = false;
  function go() {
    if (done) return; done = true;
    // seen: the server time of the edition on screen, or (built-in note) of the latest edition the server had then
    mark = `${utcDay()}|${edId(shown)}|s${shown ? (+shown.ts > 0 ? +shown.ts : 0) : (known || 0)}`;
    put(SEEN, mark);
    // the edition due ('tb-onote-next') stays due until it has been on screen (it answered late again: next opening)
    if (shown) { put(NEXT, null); put(NEXT + '-n', null); }
    else ask.then(x => {
      // the due edition never shows if the server has none to give (deleted, none today, offline): stop bringing the
      // built-in note back; an edition that keeps answering late gets two more tries, not the whole day (round 3 follow-up)
      const e = x && x.edition;
      if (!e || !e.title) { put(NEXT, null); put(NEXT + '-n', null); return; }
      const n = (+get(NEXT + '-n') || 0) + 1;
      if (n >= 3) { put(NEXT, null); put(NEXT + '-n', null); } else put(NEXT + '-n', String(n));
    });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // the entrance is staggered (CSS v15.14.8); an element may still be animating: freeze each one where it is, so the
    // exit transitions start from what is on screen (an animation with fill: both would otherwise hold it, and Chrome
    // skips a transition when the animation is dropped in the same change)
    for (const x of el.querySelectorAll('.onote-art, .onote-brand, .onote-date, .onote-credit, .onote-copy')) {
      const cs = getComputedStyle(x), o = cs.opacity, tf = cs.transform;
      x.style.animation = 'none'; x.style.opacity = o; x.style.transform = tf === 'none' ? '' : tf;
    }
    void el.offsetWidth;
    for (const x of el.querySelectorAll('.onote-art, .onote-brand, .onote-date, .onote-credit, .onote-copy')) { x.style.opacity = ''; x.style.transform = ''; }
    el.classList.add('leaving');
    // slower exit and a staggered entrance of the terminal (Victor, 31.10.2026; order and timings in styles.css v15.14.12)
    setTimeout(() => { el.classList.add('revealing'); document.documentElement.classList.remove('onote-open'); document.body.classList.add('onote-arrive'); }, reduced ? 40 : 2400);
    setTimeout(() => el.remove(), reduced ? 100 : 3800);
    setTimeout(() => document.body.classList.remove('onote-arrive'), reduced ? 100 : 5100);
  }
  el.querySelector('#onoteBegin').addEventListener('click', go);
  el.querySelector('#onoteSkip').addEventListener('click', () => { put(KEY, 'utc:' + utcDay()); go(); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') go(); });
  setTimeout(() => { if (!done) el.querySelector('#onoteBegin').focus({ preventScroll: true }); }, 900);
  }
})();
