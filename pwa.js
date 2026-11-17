/* tradeBerry — installable app (PWA), deep links and haptic feedback */
// what a reload does to the account, for the update notice: only claim it is kept when the store really saves it
window.pwaUpdateText = () => {
  const st = typeof store === 'object' && store && typeof store.mode === 'function' ? store : null;
  return st && st.mode() !== 'session' && !st.unsaved()
    ? 'Reload to use it. Reload keeps your account (saved in this browser); this tab keeps running until then.'
    : 'Reload to use it — but reload loses this account: it is not saved in this browser. Export it first (Help → Export account).';
};
(function boot() {
  if (typeof S === 'undefined' || !S || !S.set || typeof setTab !== 'function') return setTimeout(boot, 150);
  const coarse = matchMedia('(pointer:coarse)').matches;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const topLevel = (() => { try { return window.top === window; } catch (e) { return false; } })();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  document.documentElement.classList.toggle('is-standalone', standalone);

  /* haptics: short, distinct patterns; silent where the Vibration API is missing (e.g. iOS Safari) */
  window.haptic = p => { if (!coarse || !navigator.vibrate) return; try { navigator.vibrate(p); } catch (e) {} };
  // fills: vibrate only when the trade actually happened (history/positions changed)
  const wrap = (name, pat) => { const f = window[name]; if (typeof f !== 'function') return; window[name] = function (...a) { const n0 = S.positions.length + S.history.length * 1000; const r = f.apply(this, a); if (r instanceof Promise) { r.then(x => { if (x) haptic(pat); }); return r; } if (S.positions.length + S.history.length * 1000 !== n0) haptic(pat); return r; }; };
  wrap('openPosition', 14); wrap('closePosition', [8, 40, 8]);
  const _toast = window.toast;
  if (typeof _toast === 'function') window.toast = function (title, body, kind) { if (kind === 'dn' && /rejected|blocked/i.test(title || '')) haptic([30, 50, 30]); return _toast.apply(this, arguments); };

  /* service worker: only for the built, hashed bundle served from a real origin */
  if ('serviceWorker' in navigator && window.MFX_LAZY && window.isSecureContext && topLevel) {
    const hadCtl = !!navigator.serviceWorker.controller;
    const reg = () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => {
      const check = () => { if (r && r.update) r.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadCtl) return; // first install, nothing to refresh
      const c = navigator.serviceWorker.controller; if (!c) return;
      // ask the new worker which build it serves; only nudge when this page is older
      const ch = new MessageChannel(); let done = false;
      const say = v => { if (done) return; done = true; if (v && window.MFX_BUILD && v !== window.MFX_BUILD) toast('New version available', pwaUpdateText(), 'info'); };
      ch.port1.onmessage = e => say(e.data); try { c.postMessage('version', [ch.port2]); } catch (e) { say(null); } setTimeout(() => say(null), 3000);
    });
    if (document.readyState === 'complete') setTimeout(reg, 1200); else addEventListener('load', () => setTimeout(reg, 1200));
  }

  /* install */
  let deferred = null;
  const btn = document.createElement('button');
  btn.className = 'icon-btn install-btn'; btn.id = 'installBtn'; btn.hidden = true;
  btn.title = 'Install tradeBerry as an app'; btn.setAttribute('aria-label', 'Install app');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
  const th = document.getElementById('themeBtn'); if (th) th.parentNode.insertBefore(btn, th);
  const canIOS = ios && !standalone && topLevel;
  function showInstall(on) { btn.hidden = !on; document.documentElement.classList.toggle('can-install', on); }
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; showInstall(true); });
  addEventListener('appinstalled', () => { deferred = null; showInstall(false); toast('tradeBerry installed', 'Open it from your home screen or app launcher.', 'up'); });
  if (canIOS) showInstall(true);
  window.installApp = async () => {
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; if (!r || r.outcome !== 'accepted') showInstall(!!canIOS); else showInstall(false); return; }
    if (canIOS) { toast('Install on iPhone or iPad', 'Tap the Share button, then “Add to Home Screen”.', 'info'); return; }
    if (!topLevel) { toast('Open the app in its own tab', 'Installation is available when tradeBerry runs outside the preview frame.', 'info'); return; }
    toast('Install from the browser menu', 'Use “Install app” or “Add to Home screen” in your browser menu.', 'info');
  };
  btn.addEventListener('click', () => installApp());

  /* deep links (manifest shortcuts): ?view=trade, ?tab=obs — only names that exist on the page; anything else is ignored */
  const q = new URLSearchParams(location.search);
  const v = q.get('view'), t = q.get('tab');
  const has = (sel, key, val) => [...document.querySelectorAll(sel)].some(b => b.dataset[key] === val);
  if (t) setTimeout(() => { if (has('#tabs button[data-tab]', 'tab', t)) setTab(t); }, 50);
  if (v) setTimeout(() => { if (window.mnavGo && has('button[data-mv]', 'mv', v)) mnavGo(v); }, 60);
})();

/* test phase (Victor, 10.11.2026): a deploy reaches every open session. The page asks the server which build it serves;
   when it differs, a floating notice names the new build and the page reloads. Remove when the test phase ends. */
(function () {
  const mine = window.MFX_BUILD; if (!mine || window.top !== window) return;
  let shown = false;
  function notice(v) {
    if (shown) return; shown = true;
    const d = document.createElement('div'); d.id = 'updNotice'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-live', 'assertive');
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:color-mix(in srgb,var(--bg,#000) 70%,transparent)';
    d.innerHTML = '<div style="min-width:300px;max-width:420px;padding:20px 22px;background:var(--s1);border:1px solid var(--acc);border-radius:var(--r-lg);box-shadow:var(--shadow);text-align:center;color:var(--tx)">'
      + '<b style="display:block;font-size:var(--fs-lg);margin-bottom:6px">tradeBerry was updated</b>'
      + '<div style="font-family:var(--mono);color:var(--tx2);margin-bottom:14px">build ' + mine + ' → <span style="color:var(--acc)">' + v + '</span></div>'
      + '<div style="color:var(--tx2);margin-bottom:14px">Reloading in <span id="updN">5</span> s. Open positions and orders stay on the server.</div>'
      + '<button class="btn" id="updGo" style="width:100%">Reload now</button></div>';
    document.body.appendChild(d);
    const go = () => location.reload();
    d.querySelector('#updGo').addEventListener('click', go);
    let n = 5; const t = setInterval(() => {
      if (document.body.classList.contains('tl-sending')) return; // an order is on its way: wait for the answer
      if (--n <= 0) { clearInterval(t); go(); } else d.querySelector('#updN').textContent = n;
    }, 1000);
  }
  async function check() {
    if (shown || document.visibilityState !== 'visible') return;
    try {
      const r = await fetch('./?_b=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' }); if (!r.ok) return;
      const m = /MFX_BUILD='([0-9a-f]+)'/.exec(await r.text()); if (m && m[1] !== mine) notice(m[1]);
    } catch (e) {}
  }
  setInterval(check, 20000);
  document.addEventListener('visibilitychange', check);
})();
