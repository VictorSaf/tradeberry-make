# /front — fișa tradeBerry

Citită de skill-ul global `/front` (~/.claude/skills/front), din `docs/front.md`. Aici stă doar ce e specific proiectului.

## Standard
Orice element pe care se poate da click (căsuțe, dropdown-uri și listele lor, butoane, taburi, câmpuri, linkuri) urmează `docs/ui-controls.md`: galbenul înseamnă „aici poți acționa”. Pagina de probă: `docs/ui-controls.html`. Un control nou sau modificat se face după tipul lui de acolo; dacă tipul e „de aplicat”, se aplică pe tot tipul, nu doar pe elementul cerut, doar cu acordul lui Victor.

## Unde
- Sursa: `2-cod-sursa/` (repo git, branch `mace-integration`). Nu se editează `dist/` și `../1-aplicatie-publicabila/` (generate).
- CSS: un bloc nou la finalul `styles.css`, cu `/* front · ce face */`.
- Log: `2-cod-sursa/.front-log.md`.

## Previzualizare
- Aplicația: `preview_start {name: "meridian-src"}` → http://localhost:8765 (fișiere separate, fără build).
- Reîncărcare: `await Promise.all([<fișiere>].map(f => fetch(f, {cache: 'reload'}))); location.reload()`.
- Opening Note acoperă pagina: `document.getElementById('onote')?.remove()`.
- Un tab dintr-un workspace: `setTab('<pane>')` (calendar, positions, orders, history, alerts, journal, calc, corr, vol, brief, obs, lab, bt, behav).
- Paginile servite de server (Sign in din `functions/_middleware.js`, constanta `LOGIN`) nu sunt pe 8765. Le randezi din șablon:
  `node --input-type=module -e "import fs from 'fs';const s=fs.readFileSync('functions/_middleware.js','utf8'),i=s.indexOf('const LOGIN = \`')+15;fs.writeFileSync('_login-preview.html',eval('\`'+s.slice(i,s.indexOf('\`;',i))+'\`'))"`
  apoi deschizi http://localhost:8765/_login-preview.html și ștergi fișierul după captură.

## Harta zonelor → fișier
| Zona | Fișier (funcția) |
|---|---|
| Header, workspace-uri (Trade/Monitor/Research/Strategy Lab/Coach), toolbar grafic | `index.html`, `shell.js` |
| Boot screen, siglă în app | `index.html` (`#boot`, `.brand`), `styles.css` (`.logo`, `.wordmark`) |
| Grafic, watchlist | `chart.js` (`renderWatch`), unelte de desen `draw.js`, multi-chart `mc.js` |
| New order (tichet), bara de comenzi, chitanța | `ticket.js` (`renderTicket`, `renderCmd`, `renderReceipt`) — afișaj da, logica de ordin nu |
| Positions / Orders / History / Alerts / Account | `panels.js` (`renderPositions`, `renderOrders`, `renderHistory`, `renderAlerts`, `renderAccount`) |
| Fereastra SL/TP pe poziții | `app.js` (`exitPop`, `exitWhy`, `applyExit`) |
| Calendar, Correlation, Volatility, Journal, Calculators, Strength, Exposure, Sessions | `panels.js` (`renderCalendar`, `renderCorr`, `renderVol`, `renderJournal`, `renderCalcs`, …) |
| Market Brief, scanner | `brief.js` |
| Observatory | `obs.js`; Edge check și uneltele v6 `lab.js` |
| Backtester | `bt.js`; Basket `basket.js` |
| Coach, DOM, sparklines | `pro.js`; Behaviour / pre-mortem `behav.js`; Challenge `challenge.js` |
| Telefon (≤720 px) | `mnav.js`, `gestures.js` |
| Meniul contului, Administration, preferințe | `ui.js`, `cloud.js` (afișaj) |
| Teach me (tururile paginilor) | `teach.js` — se actualizează când se schimbă interfața unei pagini |
| Opening Note | `opening.js` (formatul notei nu se atinge) |
| Pagina Sign in | `functions/_middleware.js` (`LOGIN`) |

## Găsirea fișierului
1. Element selectat de Victor (`<launch-selected-element>`): caută după cel mai rar token din el (id, clasă, culoare hex, text):
   `grep -rln '<token>' . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.claude --exclude-dir=vendor`
   (în zsh nu folosi `--include=*.x` fără ghilimele: globul se extinde și comanda pică).
2. Fără selecție: harta de mai sus, apoi grep după textul vizibil.

## Zone cu poartă completă (nu în /front)
Logica de bani și ordine (`trade.js`, `core/`, logica din `ticket.js`, `engine.js`, `tradelink.js`), persistența (`persist.js`, `cloud.js` sincronizare, `sanitizeState`), serverul (`functions/api/`, `server/`, `host/`, `migrations/`).
Excepție: CSS și text într-un șablon de pagină din `functions/` (ex. `LOGIN`) merg pe calea rapidă: `deploy:ui` copiază `functions/` și repornește serverul web.

## Deploy („deploy” / „deploy rapid”)
`zsh tools/front-deploy.sh` — face tot: testele zonei, `npm run deploy:ui`, build id în `../CITESTE-MA.md`, un commit cu rândurile din `.front-log.md`, log golit. Fără push.
- `--dry` arată ce ar rula, fără să schimbe ceva.
- `--no-tests` pentru „deploy rapid” când schimbarea e doar CSS/text și nu atinge selectori testați (scriptul spune dacă îi atinge).
- Versiune: deploy-urile /front **nu** schimbă versiunea (Victor, 04.11.2026). Versiunea nouă (fit.js, package.json, istoric) se face când se strâng mai multe, la cerere.
