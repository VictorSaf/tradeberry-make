# Istoric de prețuri la cerere — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** graficele paginează înapoi în istoricul platformei la derulare, iar backtester-ul rulează doar pe lumânări reale cerute la pornirea rulării. Fără stocare proprie.

**Architecture:**
- **Serverul** servește istoricul pe ferestre mici, aliniate, ca să fie cache-uibile (`server/legacy.js historyWindow`). Un limitator comun tuturor utilizatorilor protejează datafeed-ul platformei și dă prioritate încărcării de la pornire.
- **Clientul** are o singură funcție de date, `liveRange` (în `livefeed.js`), pe care o folosesc graficul, panourile multi-chart și backtester-ul.
- **Graficul** ține lumânările mai vechi într-un buffer propriu (`histpage.js`). Motorul (`Engine.candles`, `hourly`, `feedHistory`) nu se schimbă.

**Tech Stack:**
- Aplicația: JS clasic cu globale; ordinea scripturilor e în `index.html` și `build.mjs`. Graficele: lightweight-charts v5.
- Serverul: Node (`host/server.mjs`), plus Pages Functions în `functions/api`.
- Testele: Playwright (`tests/run.mjs`) și testele de server (`tests/server/`).

**Spec:** `docs/superpowers/specs/2026-11-02-istoric-la-cerere-design.md`

## Global Constraints

- Istoricul vine doar din platforma veche, la cerere. Nu se stochează pe disc (nici pe mini, nici în browser), nu se fac importuri în bloc, nu se folosesc R2 sau tickuri.
- Streamul live (`host/relay.mjs`) rămâne neschimbat.
- La deschidere rămâne ce e acum: 7 zile de 1 minut și 90 de zile de 1 oră (`livefeed.js`, `DAYS`, `H_DAYS`). Pornirea nu are voie să devină mai lentă.
- Datafeed-ul platformei: cel mult ~2 cereri/s, comun tuturor utilizatorilor. Cererile de la pornire au prioritate.
- Backtester-ul folosește doar date reale. `btSynth`, `BT_HC`, eticheta „model” și orice text despre săptămâni modelate sau simulate se scot din cod, din Help și din Teach me.
- Trei stări vizibile, distincte: „se încarcă”, „a eșuat” (cu Retry) și „începutul istoricului platformei”. Un eșec nu are voie să arate ca un început de istoric.
- Lumânările aduse la derulare intră doar în buffer-ul graficului care le-a cerut. Coșul (basket) și timpul intrinsec (`type === 'it'`) rămân neschimbate.
- Interfața aplicației e în engleză.
- Poarta: atinge `server/` și `functions/`, deci rulează `node tests/run.mjs` și `node tests/server/run.mjs` complet înainte de livrare. Livrarea se face cu `npm run deploy`. Fără push.

## Review Focus

1. **Instrument sau rezoluție schimbate cât se încarcă o pagină:** răspunsul întârziat nu are voie să fie lipit pe alt grafic. Testul e în Task 3: `HP4`.
2. **Weekend sau sărbătoare:** o fereastră goală nu e „începutul istoricului”. Începutul se declară abia după două ferestre goale consecutive. Testul e în Task 2: `LR3`.
3. **Platforma cade:** starea devine „a eșuat” cu Retry. Nu există reîncercare automată în buclă. Testul e în Task 3: `HP3`.
4. **Replay activ, Heikin-Ashi, timp intrinsec:** în replay și în timp intrinsec paginarea e oprită. În Heikin-Ashi lumânările vechi trec prin `haAt` ca toate celelalte. Testul e în Task 3: `HP5`.
5. **Mulți utilizatori derulează deodată:** limitatorul pune cererile la coadă, nu le respinge. Încărcarea de la pornire trece înaintea derulării. Testul e în Task 1: `SH3`.

---

### Task 1: Serverul: ferestre de istoric și limitator

**Files:**
- Modify: `server/legacy.js` (`history()` la liniile ~76–99; adaugă `historyWindow` și limitatorul)
- Modify: `functions/api/history.js`
- Create: `tests/server/history.mjs`, un test Node fără browser care înlocuiește `globalThis.fetch`
- Modify: `package.json`: scriptul `test:server` (dacă există) sau notă în `tests/server/run.mjs` ca să ruleze și `history.mjs`

**Interfaces:**
- Produces: `GET /api/history?sym=&res=1|60&before=<sec>&p=bg`
  - răspunde cu o fereastră aliniată: `{...packBars, from, to, more}`, unde `from` și `to` sunt în secunde, iar `more: false` înseamnă că platforma nu a dat nicio lumânare în fereastră;
  - `p=bg` pune cererea în coada cu prioritate mică;
  - fără `before`, endpoint-ul răspunde exact ca acum (`days`), pentru încărcarea de la pornire.
- Produces: `historyWindow(sym, res, before, prio) -> Promise<packed & {from, to, more}>`, exportat din `server/legacy.js`.

**Valori fixate:**

| Rezoluție | Lățimea ferestrei | Aliniere |
|---|---|---|
| 1 minut | 7 zile (`W1 = 604800`) | `from = floor((before - 1) / W) * W` și `to = min(from + W, now)` |
| 1 oră | 365 de zile (`W60 = 31536000`) | aceeași |

- **Cache:** 30 s pentru fereastra care conține „acum”; o zi (`86400`) pentru celelalte. Se folosește `cf.cacheTtl`, pe care `host/server.mjs` îl respectă deja.
- **Limitator:** cel mult 2 cereri pornite pe secundă către `/datafeed/history`, comun pentru `history()` și `historyWindow()`. Sunt două cozi: `history()` fără `before` are prioritate 0, `p=bg` are prioritate 1. Coada de prioritate 1 pornește doar când cea de 0 e goală. O intrare care așteaptă mai mult de 45 s în coadă e respinsă cu 503 „Platform busy, try again”.
- **Plafoane pentru `before`:** 1 minut nu mai vechi de 400 de zile în urmă; 1 oră nu mai vechi de 2022-01-01. Dincolo de ele: `more: false`, fără cerere către platformă.

- [ ] **Step 1: Verifică pe platformă dacă datafeed-ul respectă `from`.** Comentariul din `legacy.js` spune că nu; nota din 01.11 spune că da, pe ferestre. Comanda:

  `curl -s "https://trade.capitalsvision.com/gcp/datafeed/history?symbol=EUR%20A0-FX&resolution=1&from=1761868800&to=1762473600" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['s'],len(d['t']),d['t'][0],d['t'][-1])"`

  Rezultatul e corect dacă primul timestamp e ≥ `from`. Dacă nu e, `historyWindow` trimite cererea cu `countback`, sau taie local în afara `[from, to)`. Notează în comentariul din `legacy.js` care dintre cele două e adevărat.
- [ ] **Step 2: Scrie testele care pică** în `tests/server/history.mjs`, cu un `fetch` fals care numără cererile și le întoarce timestamp-urile:
  - `SH1`: `historyWindow('EURUSD', 1, T)` cere `from = floor((T-1)/604800)*604800` și `to = from + 604800`. Două apeluri cu `before` diferite din aceeași fereastră fac o singură cerere către platformă (cache).
  - `SH2`: un răspuns gol dă `more === false`, iar `bars.length === 0`. Un `before` mai vechi decât plafonul nu face nicio cerere.
  - `SH3`: 6 cereri `p=bg` plus 2 cereri de pornire puse în același tic. Cele de pornire pornesc primele, iar în orice fereastră de 1000 ms pornesc cel mult 2 cereri.
  - `SH4`: o intrare care așteaptă peste 45 s (cu ceasul fals) e respinsă cu `status 503`.
- [ ] **Step 3: Rulează** `node tests/server/history.mjs`. Rezultatul așteptat: pică, pentru că `historyWindow` nu există.
- [ ] **Step 4: Implementează** `historyWindow` și limitatorul în `server/legacy.js`. Trece și `history()` prin limitator, cu prioritate 0. În `functions/api/history.js` adaugă `before`, care se validează ca întreg pozitiv ≤ acum, și `p`.
- [ ] **Step 5: Rulează** `node tests/server/history.mjs`, apoi `node tests/server/run.mjs`. Rezultatul așteptat: ambele trec.
- [ ] **Step 6: Commit:** `feat(history): ferestre aliniate de istoric și limitator comun pentru datafeed`.

### Task 2: Clientul: `liveRange` și `liveHas`

**Files:**
- Modify: `livefeed.js`. Scoate `DEEP`, `liveDeep`, `liveMinutes` și ramura `hDays` (`hourly` cere mereu `H_DAYS`). Adaugă funcțiile de mai jos.
- Create: `tests/hist-range.mjs`, cu `page.route('**/api/history**', …)` pentru răspunsuri controlate

**Interfaces:**
- Produces: `window.liveHas(sym) -> boolean`: feed pornit și instrumentul cotat.
- Produces: `window.liveRange(sym, res, from, to, { onProgress, signal }) -> Promise<{ bars, start, from, to }>`
  - `res` e 1 sau 60; `from` și `to` sunt în secunde;
  - `bars` sunt `{time, open, high, low, close}`, crescătoare și fără duplicate;
  - `start` e `true` dacă s-a atins începutul istoricului platformei;
  - `onProgress(done, total)` se cheamă după fiecare fereastră;
  - la eșec, promisiunea e respinsă cu `Error` (`status` din răspuns). Nu există reîncercare automată.
- Ferestrele se cer cu `before`, de la `to` înapoi, câte una, cu `p=bg`. Cache-ul din pagină e un `Map` cu cheia `sym|res|before` și valoarea promisiunea, ca două grafice cu același instrument să nu ceară de două ori. O promisiune respinsă se scoate din cache.
- Regula pentru început: două ferestre consecutive cu `more === false` înseamnă `start = true`, iar mersul înapoi se oprește.

- [ ] **Step 1: Scrie testele care pică** în `tests/hist-range.mjs`. Folosește un generator determinist de lumânări în ruta falsă, iar o sărbătoare înseamnă o fereastră goală la mijloc:
  - `LR1`: `liveRange('EURUSD', 1, to - 21*86400, to)` face 3 sau 4 cereri `before`, întoarce lumânări crescătoare și unice, iar `onProgress` ajunge la `done === total`.
  - `LR2`: un al doilea apel identic nu mai face nicio cerere.
  - `LR3`: o fereastră goală între două pline nu dă `start`. Două ferestre goale la capăt dau `start === true`, iar `bars` conține tot ce era mai nou.
  - `LR4`: un 503 respinge promisiunea. Un apel ulterior cere din nou fereastra (nu a rămas în cache).
- [ ] **Step 2: Rulează** `node tests/run.mjs LR`. Rezultatul așteptat: pică.
- [ ] **Step 3: Implementează** în `livefeed.js`. `liveHas` citește `on && have.has(sym)`.
- [ ] **Step 4: Rulează** `node tests/run.mjs LR`, apoi `node tests/run.mjs EM7`. Rezultatul așteptat: trec.
- [ ] **Step 5: Commit:** `feat(history): liveRange la cerere în livefeed; pilotul DASHEUR generalizat și scos`.

### Task 3: Paginarea graficului principal

**Files:**
- Create: `histpage.js`, un pager per grafic, refolosit de Task 4
- Modify: `chart.js`: `fullChart` (linia ~97) și abonarea la intervalul vizibil
- Modify: `index.html` și `build.mjs`: `histpage.js` intră în CORE, după `livefeed.js` și înainte de `chart.js`
- Modify: `styles.css`: un bloc nou la final pentru eticheta de stare de la marginea stângă a graficului
- Modify: `teach.js`, dacă turul paginii Trade descrie graficul
- Create: `tests/hist-page.mjs`

**Interfaces:**
- Consumes: `liveHas`, `liveRange` (Task 2).
- Produces: `makePager({ host, getKey, onOlder }) -> { older(), state, reset(), retry(), maybeLoad(range) }`
  - `host` e elementul graficului pe care se pune eticheta;
  - `getKey()` întoarce `{sym, tf}` curent sau `null` dacă paginarea e oprită;
  - `onOlder(bars)` se cheamă cu lumânări deja agregate la `tf`, mai vechi decât tot ce e afișat;
  - `state` e una din `'idle' | 'loading' | 'failed' | 'start'`;
  - `older()` întoarce buffer-ul de lumânări vechi pentru cheia curentă.

**Valori fixate:**
- Încărcarea pornește când `range.from < 30`, adică mai puțin de 30 de lumânări rămase la stânga, iar starea e `idle`.
- O pagină înseamnă o fereastră de server: `res = tf >= 60 ? 60 : 1`. Agregarea la `tf` se face cu aceeași regulă de găleți ca `Engine.aggregate`.
- Plafonul buffer-ului: 20.000 de lumânări pentru `tf < 60`, 40.000 pentru `tf >= 60`. La depășire se aruncă cele mai vechi, iar starea revine la `idle`.
- Paginarea e oprită (`getKey` întoarce `null`) când `!liveHas(sym)`, când `S.set.type === 'it'` sau când un replay e activ.
- Etichetele, în engleză, la marginea stângă a graficului, în stilul terminalului:
  - `Loading older prices…`;
  - `Older prices unavailable` + buton `Retry`;
  - `Start of platform history`.
- `fullChart`: `bars = older().concat(aggregate)`. Nu există suprapunere: din `older` se păstrează doar lumânările cu `time < aggregate[0].time`. Nu există nici gol: dacă între ultima lumânare veche și `aggregate[0]` lipsesc găleți, pager-ul cere din nou acel interval înainte de lipire.
- După lipire, vederea rămâne pe loc: intervalul logic se deplasează cu numărul de lumânări adăugate, la fel ca în `chartTick` la reconstruire.
- Un răspuns care sosește după ce `getKey()` s-a schimbat se aruncă (`AbortController` și verificarea cheii).
- `chartTick` și reconstrucția la `BARS_MAX + BARS_SLACK` păstrează buffer-ul vechi.

- [ ] **Step 1: Scrie testele care pică** în `tests/hist-page.mjs`. Ruta falsă `/api/history` vine din Task 2. Ca instrumentul să fie tratat ca alimentat, testul suprascrie `window.liveHas` și leagă `Engine.feedHistory` de lumânările false, ca în `EM7b`.
  - `HP1`: derularea la stânga (`setVisibleLogicalRange({from: 5, to: 165})`) adaugă lumânări mai vechi. Primul `time` scade, lumânările rămân crescătoare și unice, fără găleți lipsă la cusătură, iar lumânarea din dreapta vederii rămâne aceeași.
  - `HP2`: la capătul istoricului fals, eticheta arată `Start of platform history` și nu mai pleacă nicio cerere la derulare.
  - `HP3`: un 503 dă `Older prices unavailable`. Nicio cerere nu mai pleacă până la `Retry`. `Retry` reîncarcă și eticheta dispare.
  - `HP4`: schimbarea instrumentului cât o cerere e în aer (ruta întârzie 500 ms) nu lipește nimic pe noul instrument.
  - `HP5`: în replay și în timp intrinsec nu pleacă nicio cerere. În Heikin-Ashi, lumânările vechi apar transformate.
- [ ] **Step 2: Rulează** `node tests/run.mjs HP`. Rezultatul așteptat: pică.
- [ ] **Step 3: Implementează** `histpage.js`, legătura din `chart.js` și eticheta din `styles.css`.
- [ ] **Step 4: Rulează** `node tests/run.mjs HP`, apoi zonele graficului: `node tests/run.mjs chart`, `LWC`, `R` (replay) și `A11Y`. Rezultatul așteptat: trec. R7 pică doar în weekend (instabil cunoscut).
- [ ] **Step 5: Verifică în browser** pe 8765, cu feed-ul real pe un `host/server.mjs` local cu cheia din `.dev.vars`: EURUSD 1m și 1H, derulare până la capăt, cele trei etichete. Fă o captură.
- [ ] **Step 6: Commit:** `feat(chart): paginare înapoi în istoricul platformei la derulare`.

### Task 4: Paginarea în panourile multi-chart

**Files:**
- Modify: `mc.js`: `mcFull` (linia ~128), câte un pager per panou
- Modify: `tests/hist-page.mjs`

**Interfaces:**
- Consumes: `makePager` (Task 3). `getKey` întoarce `{sym: p.cfg.sym, tf: p.cfg.tf}` din panou.

- [ ] **Step 1: Scrie testul care pică:** `HP6`. Două panouri cu același instrument și aceeași rezoluție, derulate amândouă la stânga, fac o singură serie de cereri (cache-ul din `liveRange`) și primesc aceleași lumânări vechi. Un panou cu alt instrument își face propriile cereri.
- [ ] **Step 2: Rulează** `node tests/run.mjs HP6`. Rezultatul așteptat: pică.
- [ ] **Step 3: Implementează** în `mc.js`. `p.bars = pager.older().concat(Engine.aggregate(...))`, cu aceleași reguli de cusătură și de păstrare a vederii ca în Task 3.
- [ ] **Step 4: Rulează** `node tests/run.mjs HP` și `node tests/run.mjs MC`. Rezultatul așteptat: trec.
- [ ] **Step 5: Commit:** `feat(mc): paginare înapoi în panourile multi-chart`.

### Task 5: Backtester-ul doar pe date reale

**Files:**
- Modify: `bt.js`:
  - `btBars` (linia ~215), `btRunAll` (linia ~576), `renderBtResults`;
  - scoate `btSynth`, `BT_HC`, `btWantsReal` și cheile `simW`/`liveFrom` folosite doar pentru partea modelată;
  - `BT_REAL` se păstrează ca cache al rulării.
- Modify: textele din Help și din Teach me care vorbesc despre săptămâni modelate. Le găsești cu `grep -rn "modelled\|simulated week\|model" bt.js help*.js teach.js index.html`.
- Modify: `tests/bt-hist.mjs` (rescris), `tests/v1-bt.mjs`, `tests/polish-bt.mjs`, `tests/ds-lab.mjs`, `tests/multiasset-ui.mjs`, `tests/v1-state.mjs`
- Modify: `tests/run.mjs`: helper-ul `T.feed(syms)` în obiectul `window.T`

**Interfaces:**
- Consumes: `liveHas`, `liveRange` (Task 2).
- Produces: `btBars(sym, tf, weeks) -> { bars, from, to, why }`. `why` e una din `null | 'no-feed' | 'loading' | 'failed' | 'short'`.
- Produces: `T.feed(syms)` în teste. Suprascrie `liveHas` pentru `syms` și `liveRange` cu un generator determinist (seed fix, aceeași formă de lumânare ca `Engine.candles`). Leagă și `Engine.feedHistory`, ca săptămâna curentă să fie „reală” în test.

**Comportament fixat:**
- **1 săptămână:** `Engine.candles[sym]` dacă `liveHas(sym)` (cele 7 zile de la platformă plus tickurile). Altfel `why: 'no-feed'`.
- **4, 8 sau 12 săptămâni** (`BT_HIST`): la `Run`, `liveRange(sym, 1, now - weeks*7*86400, primulTimpDinEngine)`, lipit de `Engine.candles[sym]` fără duplicate. Pe durata descărcării, `#btOut` arată `Loading <n> weeks of <SYM> prices from the platform… <done>/<total>`.
- **Mesaje:**
  - `no-feed`: `Backtests run on the platform's prices. <SYM> has no live feed right now.` Rularea nu pornește.
  - `failed`: `Could not load <SYM> history from the platform.` + `Retry`. Rularea nu pornește.
  - `short`: prima lumânare reală e mai nouă decât începutul cerut cu peste o zi. Rularea pornește pe partea reală și, deasupra rezultatelor, scrie `The platform has 1-minute <SYM> prices only from <date>; this run covers <d> days.`. Așa s-a hotărât (decizia lui Claude, în spiritul spec-ului): datele sunt reale, iar lipsa e spusă deschis, nu umplută.

- [ ] **Step 1: Rescrie testele.** În `tests/bt-hist.mjs`, `BTH1` (proprietățile săptămânilor simulate) se înlocuiește cu:
  - `BTH1`: cu `T.feed(['EURUSD'])`, 8 săptămâni se lipesc de săptămâna live fără duplicate. Prima lumânare e la ±1 zi de `now - 56 zile`. Nu există `BT_HC` și nici `btSynth` (`typeof btSynth === 'undefined'`).
  - `BTH1b`: fără feed, `#btOut` conține `has no live feed`, iar `BT.res` rămâne `null`.
  - `BTH1c`: un generator care începe acum 20 de zile, la o cerere de 8 săptămâni, dă mesajul `only from`, iar rularea acoperă ~20 de zile.
  - `BTH1d`: `liveRange` respins dă `Could not load`. `Retry` rulează.

  În celelalte fișiere din listă, fiecare test care rulează backtester-ul cheamă `T.feed([sym])` înainte. Aserțiunile despre „modelled weeks” se scot.
- [ ] **Step 2: Rulează** `node tests/run.mjs BTH`. Rezultatul așteptat: pică.
- [ ] **Step 3: Implementează** în `bt.js` și curăță textele.
- [ ] **Step 4: Rulează** `node tests/run.mjs BT`, `V1`, `POL`, `DSL`, `MA` (zonele backtester-ului și laboratorului; numele exacte ale filtrelor sunt în `name` din fiecare fișier). Rezultatul așteptat: trec.
- [ ] **Step 5: Verifică în browser** cu feed-ul real (ca în Task 3, Step 5): un backtest EURUSD pe 12 săptămâni. Progresul trebuie să se vadă, iar mesajul `only from` să apară, pentru că FX are 1 minut doar din ~feb. 2026. Fă o captură.
- [ ] **Step 6: Commit:** `feat(bt): backtester doar pe prețurile platformei, cerute la rulare; săptămânile modelate scoase`.

### Task 6: Versiune și livrare

**Files:**
- Modify: `fit.js` și `package.json` (v15.25), `3-documentatie/Istoric-versiuni-README.md`, `CITESTE-MA.md`
- Modify: `~/.claude/projects/-Users-victorsafta-Projects-MeridianFX/memory/history-import-parked.md`: planul cu R2 e înlocuit de istoricul la cerere

- [ ] **Step 1: Rulează poarta completă:** `node tests/run.mjs` și `node tests/server/run.mjs`. Rezultatul așteptat: totul trece, cu excepția instabililor cunoscuți R7 (weekend) și A11Y-6 (sub încărcare, trece singur la reluare).
- [ ] **Step 2: Fă pașii de versiune** din `CLAUDE.md`: eticheta, istoricul, `npm run release`, apoi `CITESTE-MA.md` cu `MFX_BUILD`.
- [ ] **Step 3: Livrează:** `npm run deploy`. Verifică pe tb.oneaigency.com: derulare EURUSD 1H până la `Start of platform history` și un backtest de 12 săptămâni.
- [ ] **Step 4: Commit:** `release: v15.25 istoric la cerere`. Fără push.
