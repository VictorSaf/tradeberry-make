/* tradeBerry: every request needs a signed-in user, except the login call and the icons.
   Not signed in: a page load gets the login page (status 401, so the service worker never caches it as the app),
   an API call gets 401 JSON, anything else (scripts, styles) a plain 401. */
import { sessionUser, json, flagCookie } from '../server/auth.js';

// /api/csp: the browser's CSP reports come without cookies (functions/api/csp.js reads them as untrusted)
const OPEN = p => p === '/api/login' || p === '/api/csp' || /^\/icons\/[A-Za-z0-9_-]+\.(png|svg)$/.test(p) || p === '/manifest.webmanifest';

export async function onRequest(ctx) {
  const { request, env } = ctx, p = new URL(request.url).pathname;
  if (OPEN(p)) return ctx.next();
  const user = await sessionUser(env, request);
  if (user) {
    ctx.data.user = user;
    const res = await ctx.next();
    // the page itself is per user: never kept by a shared cache
    // tb_u=1 (readable, no secret) tells the page it is served with the account server, so cloud.js wakes up
    // a page load (also a 304 revalidation, which carries no Content-Type)
    if ((res.headers.get('Content-Type') || '').includes('text/html') || (request.headers.get('Accept') || '').includes('text/html')) { const r = new Response(res.body, res); r.headers.set('Cache-Control', 'private, no-cache'); r.headers.append('Set-Cookie', flagCookie(request, true)); return r; }
    return res;
  }
  if (p.startsWith('/api/')) return json({ error: 'Signed out' }, 401);
  const accept = request.headers.get('Accept') || '';
  if (request.method === 'GET' && (accept.includes('text/html') || p === '/' || p.endsWith('.html'))) return new Response(LOGIN, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https://images.unsplash.com; form-action 'self'; frame-ancestors 'none'" } });
  return new Response('Sign in required', { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

const LOGIN = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>tradeBerry — Sign in</title><link rel="icon" href="/icons/favicon-32.png">
<style>
/* the sign-in in the Opening Note's own look (opening.js / styles.css .onote): the same photograph, shade, brand and type */
:root{--ink:#f3f5f7;--acc:#e8b04a;--bad:#ff8a8a;--ease:cubic-bezier(.2,.8,.2,1)}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;display:flex;flex-direction:column;min-height:100%;padding:clamp(24px,4vw,64px);overflow:hidden;isolation:isolate;position:relative;background:#090c10;color:var(--ink);font-family:Inter,"Helvetica Neue",Arial,sans-serif}
.art{position:absolute;z-index:-3;inset:-3% -3% -3% 38%;background:url("https://images.unsplash.com/photo-1728930684281-103d3e6a5032?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=86&w=1800") center 42%/cover no-repeat;filter:grayscale(1) contrast(1.08) blur(1.5px);opacity:.52;transform:scale(1.025);animation:drift 16s ease-out both}
.shade{position:absolute;z-index:-2;inset:0;background:linear-gradient(90deg,#090c10 0%,#090c10 28%,rgba(9,12,16,.92) 43%,rgba(9,12,16,.32) 72%,rgba(9,12,16,.62) 100%),linear-gradient(0deg,#090c10 0%,transparent 42%,rgba(9,12,16,.25) 100%)}
body::after{content:"";position:absolute;z-index:-1;inset:0;opacity:.17;background:radial-gradient(circle at 72% 42%,rgba(232,176,74,.24),transparent 24%);pointer-events:none}
header{display:flex;align-items:center;justify-content:space-between;gap:20px}
.brand{display:flex;align-items:center;gap:18px;font-size:32px;letter-spacing:.02em}.brand svg{width:56px;height:56px}@media (max-width:600px){.brand{gap:9px;font-size:16px}.brand svg{width:28px;height:28px}}.t{font-weight:300}.b{font-weight:700}
.date{color:rgba(255,255,255,.55);font:10px ui-monospace,monospace;letter-spacing:.07em;text-transform:uppercase}
main{width:min(460px,100%);margin:auto 0;padding:clamp(40px,7vh,90px) 0;animation:copy-in .8s .2s var(--ease) both}
.kicker{display:flex;align-items:center;gap:10px;margin-bottom:16px;color:rgba(255,255,255,.58);font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}
.kicker span:first-child{color:var(--acc)}.kicker i{width:20px;height:1px;background:rgba(255,255,255,.25)}
h1{margin:0 0 14px;font-size:clamp(38px,4.6vw,64px);font-weight:500;line-height:1.02;letter-spacing:-.045em}
main>p{margin:0 0 28px;color:rgba(255,255,255,.66);font-size:clamp(14px,1.1vw,16px);line-height:1.65}
label{display:block;margin:0 0 6px;color:rgba(255,255,255,.58);font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}
input{width:100%;height:46px;margin:0 0 18px;padding:0 14px;border:1px solid rgba(255,255,255,.24);border-radius:0;background:rgba(9,12,16,.72);color:#fff;font:15px ui-monospace,monospace;letter-spacing:.02em}
input:focus{outline:none;border-color:var(--acc);background:rgba(9,12,16,.9)}
button{display:inline-flex;align-items:center;justify-content:space-between;gap:32px;width:100%;min-height:46px;padding:0 14px;border:1px solid rgba(255,255,255,.24);border-radius:0;background:var(--ink);color:#0b0e12;font:700 12px/1 Inter,"Helvetica Neue",Arial,sans-serif;letter-spacing:.04em;cursor:pointer}
button span{font-size:15px}
button:hover{border-color:var(--acc);background:var(--acc)}
button:focus-visible{outline:2px solid var(--acc);outline-offset:3px}
button[disabled]{opacity:.65;cursor:wait}
#err{min-height:20px;margin:-6px 0 12px;color:var(--bad);font-size:13px}
.meta{margin-top:22px;color:rgba(255,255,255,.42);font-size:11.5px;line-height:1.6;max-width:420px}
.credit{position:absolute;right:clamp(24px,4vw,64px);bottom:clamp(24px,4vw,48px);color:rgba(255,255,255,.38);font-size:10px;text-decoration:none}
.credit:hover{color:rgba(255,255,255,.72)}
@keyframes copy-in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes drift{from{transform:scale(1.055) translateX(8px)}to{transform:scale(1.025)}}
@media (max-width:720px){body{padding:24px 20px 30px}.art{inset:0 0 38% 12%;opacity:.4;background-position:center 38%}.shade{background:linear-gradient(0deg,#090c10 0%,#090c10 45%,rgba(9,12,16,.72) 72%,rgba(9,12,16,.3) 100%)}main{margin-top:auto;margin-bottom:0;padding:26vh 0 0}.credit{display:none}}
@media (prefers-reduced-motion:reduce){.art,main{animation:none}}
</style></head><body>
<div class="art" aria-hidden="true"></div><div class="shade" aria-hidden="true"></div>
<header><div class="brand" aria-label="trade.Berry"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5.5" y="20" width="3.4" height="7" rx=".8" fill="#ff4757"/><rect x="11.5" y="15" width="3.4" height="12" rx=".8" fill="#f1c40f"/><rect x="17.5" y="10" width="3.4" height="17" rx=".8" fill="#3498db"/><rect x="23.5" y="5" width="3.4" height="22" rx=".8" fill="#7ac943"/></svg><span><span class="t">trade</span><span class="b">.Berry</span></span></div><span class="date" id="d"></span></header>
<main>
<div class="kicker"><span>Sign in</span><i></i><span>Trading terminal</span></div>
<h1>Welcome back.</h1>
<p>Use the username and password you were given. Your account, trades and settings are saved under your user.</p>
<form id="f" novalidate>
<label for="u">Username</label><input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="32" autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required maxlength="256">
<div id="err" role="alert" aria-live="assertive"></div>
<button id="b" type="submit"><b>Sign in</b><span aria-hidden="true">→</span></button>
</form>
<p class="meta">Demo account: no real money. Orders are executed on the server at the broker platform’s live prices. Accounts are created by the administrator. You stay signed in until you close the browser.</p>
</main>
<a class="credit" href="https://unsplash.com/@martinrajdl" target="_blank" rel="noopener">Photo by Martin Rajdl on Unsplash</a>
<script>
document.getElementById('d').textContent=new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(new Date());
const f=document.getElementById('f'),err=document.getElementById('err'),b=document.getElementById('b'),bl=b.querySelector('b');
f.addEventListener('submit',async e=>{e.preventDefault();err.textContent='';
const u=f.username.value.trim(),p=f.password.value;if(!u||!p){err.textContent='Enter your username and password.';return}
b.disabled=true;bl.textContent='Signing in…';
try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p}),credentials:'same-origin'});
if(r.ok){location.reload();return}
const j=await r.json().catch(()=>({}));err.textContent=j.error||('Sign-in failed ('+r.status+')');f.password.value='';f.password.focus()}
catch(x){err.textContent='No connection to the server. Check your internet and try again.'}
b.disabled=false;bl.textContent='Sign in'});
</script>
<script>/* desktop only for now (Victor, 09.11.2026): a phone sees one message, not the sign-in */
(function(){var ua=navigator.userAgent||'',ph=/iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari/i.test(ua)||matchMedia('(max-width:720px) and (pointer:coarse)').matches;if(!ph||navigator.webdriver)return;
document.querySelector('main').innerHTML='<div class="kicker"><span>Desktop</span><i></i><span>Trading terminal</span></div><h1>App available on desktop only</h1><p>tradeBerry is a trading terminal built for a large screen. Open <b style="color:var(--acc)">tb.oneaigency.com</b> on a computer to continue.</p>';})();
</script>
</body></html>`;
