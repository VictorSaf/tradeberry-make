/* tradeBerry guides: the contents follow the chapter on screen, a thin bar shows how far the page is read.
   Back to the terminal returns to the page the guide was opened from: the terminal's tab (still on that page) comes
   to the front and the guide's tab closes; a guide opened from a link reloads the terminal, which reopens the page
   and tool used last. */
(function () {
  document.querySelectorAll('.g-back, .g-brand').forEach(back => back.addEventListener('click', e => {
    // back in the terminal from a guide: no Opening Note in between (opening.js reads this once)
    try { sessionStorage.setItem('tb-from-guide', '1'); } catch (x) { /* storage blocked: the note may show */ }
    let op = null; try { op = window.opener && !window.opener.closed && window.opener.location.origin === location.origin ? window.opener : null; } catch (x) { op = null; }
    if (!op) return;
    e.preventDefault(); op.focus(); window.close();
    setTimeout(() => { location.href = back.href; }, 300); // the browser refused to close this tab
  }));
})();
(function () {
  const links = [...document.querySelectorAll('.g-toc a[href^="#"]')];
  const secs = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const bar = document.querySelector('.g-prog');
  let tick = false;
  function update() {
    tick = false;
    const y = scrollY + innerHeight * 0.3;
    let cur = secs[0];
    for (const s of secs) if (s.offsetTop <= y) cur = s;
    links.forEach(a => a.classList.toggle('on', cur && a.getAttribute('href') === '#' + cur.id));
    const h = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.width = (h > 0 ? Math.min(100, scrollY / h * 100) : 0) + '%';
  }
  addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
})();
