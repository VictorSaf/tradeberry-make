# UX sample audit (portat din Figma Make, 16.11.2026)

Sursa: directiva Figma Make pe baza `afb56f9`. Commit-urile de referință (`e686ed7`, `b27f8b7`, `da22391`) nu există în repo și nu au putut fi inspectate; portul e făcut din descrierea textuală, verificat pe codul nostru. Build-ul Figma (`fdead387`) nu corespunde build-ului nostru (`cc5840fa`).

## Suprafețe verificate
Workspace navigation, dock tabs, taburile panoului de piață, Observatory, segmented, Backtester templates, ticket (Guided/Pro, order type, presets, chips), Monitor › Panels, Calendar (filtre), Behaviour, tour prompt.

## Constatări implementate

| # | Constatare | Severitate | Rezoluție |
|---|---|---|---|
| 1 | Monitor: accesul la Positions și Market panel nu spunea starea | Medie | Grup etichetat „Panels”; stare textuală `Show` / `Shown`; contorul pozițiilor rămâne; `aria-pressed`, `aria-controls` (`dockPane`, `railPane`), `aria-label` și `title` se actualizează la fiecare schimbare; ON = accent solid (`index.html`, `shell.js`, `styles.css`) |
| 2 | Invitația „Take the 60-second tour” acoperea workspace-ul | Medie | Pe desktop, pe toate paginile workspace (Trade, Monitor, Research, Lab, Coach), cât timp e vizibilă, rezervă un lane de 54 px deasupra barei de status (`body.tour-lane`); la dismiss sau auto-hide spațiul se recuperează; mobilul neschimbat (`ui.js`, `styles.css`) |
| 3 | Behaviour fără istoric eligibil arăta „Download report” (nu are ce descărca) | Joasă | Fără istoric (`score == null`): o singură acțiune `Open Trade`, care deschide Trade și mută focusul pe primul control Buy/Sell vizibil (ticket, altfel `#qBuy`); cu istoric revine `Download report` (`behav.js`) |

## Criterii de acceptare (verificate pe 1273 × 797, tema dark)
- Monitor: click pe `Positions` deschide dock-ul efectiv; `aria-pressed`, textul `Show`/`Shown` și `aria-label` se schimbă; fără overflow orizontal.
- Tour: cu invitația vizibilă, bara ei nu intersectează grid-ul (marginea de jos a grid-ului 743, vârful invitației 745, la 797 înălțime); după dismiss grid-ul revine la 797.
- Behaviour pe stare curată: există `Open Trade`, nu există `Download report`; după click view = Trade, focus pe `#qBuy`.
- Testele zonelor atinse (DSR, FL4, V1B, VBT) trec; `npm run build` trece.

## Verificat în plus
- 1220 × 800 și 1440 × 900, dark și light: fără overflow orizontal pe Trade, Monitor, Research, Lab, Coach.
- Mobil (390 px): aplicația arată „App available on desktop only”, deci nu există navigație sau focus de verificat acolo.
- Focus ring: regula globală `:focus-visible` (2 px accent) e neschimbată; nu s-a verificat vizual cu tastatura reală (`.focus()` din script nu activează `:focus-visible`).

## Netestat
Bara de status e ascunsă pe desktop (`display:none !important`): lane-ul invitației se ajustează la înălțimea ei reală, dar cazul cu bara vizibilă nu a fost exersat.

## Contractul de accent (aplicat, aprobat de Victor 16.11.2026)
Tokenuri `--acc-tint`, `--acc-line`, `--acc-hover`, `--acc-pressed`; segmented = tentă; tab curent = text normal + linie de 2 px; acțiune primară = accent solid (inclusiv OK-ul neutru din confirmări); focus ring 2 px neschimbat. Buy/Sell, P&L, avertisment, eroare și distructiv au rămas pe culorile lor. Standardul vechi (`docs/ui-controls.md` §3.5, §3.6, §3.7 primar) e înlocuit; vezi §10 de acolo. Testele care codificau varianta veche (DSC6, DSG2, DSG5, DSL2, DSP7, DSS3, DSS6, DTR9, DSW1) au fost adaptate la contract.

Verificat pe 1440 × 900 dark (selecții, tab-uri) și pe light (tab, Run backtest). Constatare în drum: eliberarea lane-ului invitației la tur imediat, la pointerdown, muta layout-ul sub cursor și pierdea click-ul pe butoanele din josul paginii (a picat PV1); lane-ul se eliberează acum după fade-out.

## Corecție de aplicare (17.11.2026)
Prima aplicare a contractului lăsase accentul pe titluri statice, pe simboluri și pe controale secundare solide. Corectat în blocul „front · accent correction” din `styles.css`; regulile sunt în `docs/ui-controls.md` §10.1. Selectori modificați: `.ticket>.ph h2`, `.chart-top #symName`, `.watch .wl-row.on` (+ `.wl-nm`, `::before`), `.watch .wd-h>b`, `.watch .wd-rg i i`, `.rail>.pv-tkbar`, `.rail>#isw>button(.on)`, `.pv-edge`, `.wl-hide`, `#dockMin`, `#wlColsBtn`, contoarele din `#tabs`.

