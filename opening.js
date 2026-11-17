'use strict';
/* trade.Berry Opening Note — a calm editorial threshold before the terminal. */
(function openingNote() {
  const note = document.getElementById('openingNote');
  if (!note) return;
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem('tb-opening-skip') === day) {
      note.hidden = true;
      return;
    }
  } catch (e) { /* private mode: show the note */ }

  const date = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  document.getElementById('openingDate').textContent = date;
  const hour = new Date().getHours();
  document.getElementById('openingHello').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}.`;
  const enter = document.getElementById('openingEnter');
  window.replayOpening = () => {
    note.hidden = false;
    note.classList.remove('leaving', 'transitioning', 'revealing');
    try { localStorage.removeItem('tb-opening-skip'); } catch (e) { /* private mode */ }
    window.setTimeout(() => enter.focus({ preventScroll: true }), 80);
  };
  const close = remember => {
    if (remember) {
      try { localStorage.setItem('tb-opening-skip', day); } catch (e) { /* private mode */ }
    }
    note.classList.add('leaving');
    window.setTimeout(() => { note.hidden = true; }, 520);
  };
  const openDesk = () => {
    note.classList.add('transitioning');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      document.body.classList.add('terminal-arrive');
      note.classList.add('revealing');
      window.setTimeout(() => document.body.classList.remove('terminal-arrive'), reduced ? 100 : 1300);
    }, reduced ? 60 : 2450);
    window.setTimeout(() => {
      note.hidden = true;
      note.classList.remove('transitioning', 'revealing');
    }, reduced ? 140 : 3400);
  };
  enter.addEventListener('click', openDesk);
  document.getElementById('openingSkip').addEventListener('click', () => close(true));
  note.addEventListener('keydown', e => { if (e.key === 'Escape') close(false); });
  window.setTimeout(() => enter.focus({ preventScroll: true }), 900);
})();
