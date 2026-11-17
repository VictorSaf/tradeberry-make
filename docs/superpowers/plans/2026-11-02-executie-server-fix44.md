# Execuția pe server prin FIX 4.4: plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** contul (sold, poziții, ordine, istoric) trăiește și se execută pe server 24/7. Browserul doar trimite comenzi și afișează, din oricâte sesiuni simultane. Gateway-ul tradeBerry vorbește FIX 4.4 cu un broker temporar, ca ulterior să poată fi înlocuit de serverul real.

**Architecture:**
- Regulile de execuție din `trade.js` și `engine.js` se extrag într-un nucleu comun (`core/`), încărcat atât în browser cât și în Node.
- `host/broker.mjs` (FIX acceptor, temporar) ține conturile în `data/broker.db` și execută pe tickurile live.
- `host/gateway.mjs` (FIX initiator, permanent) ține mirror-ul conturilor și funcțiile proprii tradeBerry, apoi le servește browserului prin WS `/api/trade`, care trece prin proxy-ul din `host/server.mjs`.

**Tech Stack:** Node 22+ (`node:sqlite`, `node:net`), `ws` (există deja în host), scripturi clasice în browser, Playwright pentru e2e.

**Spec:** `docs/superpowers/specs/2026-11-02-executie-server-fix44-design.md` (inventarul codului de azi: `.mace/research/2026-11-02-inventar-executie.md`)

## Global Constraints

- FIX: `8=FIX.4.4`, delimitator SOH (`\x01`), checksum = suma octeților mod 256, în 3 cifre. Broker pe `127.0.0.1:9878`, gateway WS pe `127.0.0.1:8797`. Ambele ascultă doar pe loopback.
- CompID-uri: gateway `TB-GW`, broker `TB-BROKER`. Credențialele sesiunii (553/554) se citesc din env `TB_FIX_USER` / `TB_FIX_PASS` și nu intră niciodată în git sau în loguri.
- `ClOrdID` = `tb-<accountId>-<n>`, cu `n` persistent în gateway. Un `ClOrdID` repetat primește același rezultat, fără un al doilea ordin.
- Dialectul (tag 721 PosMaintRptID, grupul OCO, legătura reduce-only, detaliile de fill în taguri 5000–9999, `U1` pentru setări și Reset demo) se scrie numai în `host/fix/dialect.mjs`. Celelalte module îl folosesc prin numele lui.
- Textele de refuz și textele UI rămân cele de azi (în engleză), din `trade.js`. Nucleul întoarce `{code, text}`.
- Niciun câmp sau readout nu se pierde din interfață. Niciun cont nu primește date fabricate. Reset există doar pe conturile `demo`, iar acum toate conturile sunt demo.
- Execuția browserului pe contul live dispare complet. Replay, Coach și backtesterul folosesc nucleul local.
- Fără UI optimist pe bani: un ordin trimis apare ca „Sent” până la `ExecutionReport`.
- Nimic nu se trunchiază pe server: tabelele `executions` și `trades` sunt append-only.
- `LEGACY_API_KEY` nu se afișează și nu se loghează niciodată.
- Poarta completă la final (`node tests/run.mjs` + `node tests/server/run.mjs` + testele noi). Deploy cu `npm run deploy`. Versiunea v16.0.0. Merge în `master` și push doar cu acordul lui Victor.

## Review Focus

1. **Restart cu poziții deschise** (broker, gateway sau amândouă, oprite cu kill -9 în mijlocul unui fill): după repornire, contul are exact pozițiile și soldul de dinainte, nimic dublat și nimic pierdut. Testul: G9 / E3.
2. **Gol de prețuri peste SL** (serverul oprit 20 de minute, timp în care prețul trece de SL): fill la deschiderea barei care a sărit nivelul, marcat `gap`, cu un singur fill. Testul: B11.
3. **Două sesiuni care modifică același SL aproape simultan**: ultima comandă ajunsă la broker câștigă, iar ambele sesiuni afișează aceeași valoare. Testul: E2.
4. **Feed oprit** (platforma nu răspunde peste 10 s): niciun fill și niciun stop-out pe prețuri vechi. Ordinele așteaptă, iar contul arată „NO FEED”. Testul: B12.
5. **Migrarea unui cont cu poziții multi-TP, BE armat, trailing și coș deschis**: după import, equity și fiecare nivel sunt identice cu blob-ul de dinainte. Testul: M2.

---

### Task 1: `core/market.js`, piața comună browser + Node

**Files:**
- Create: `core/market.js`
- Modify: `engine.js` (folosește `core/market.js` pentru quote/usd/sesiuni/DST/off-quotes/spread de noapte și news/META), `index.html`, `build.mjs` (CORE: `catalog.js` → `core/market.js` → `engine.js`), `host/deploy.sh` (rsync `core` și `catalog.js` în `code/`)
- Test: `tests/server/market-core.mjs`, `tests/engine-market.mjs` (existent, trebuie să treacă neschimbat)

**Interfaces:**
- Produces: `MarketCore.create({ catalog, now: () => ms }) → market`, cu:
  - `market.META[sym]`;
  - `market.setQuotes([[sym, bid, ask, tMs], …])`;
  - `market.quote(sym) → {bid, ask, spread, open, t, off}`;
  - `market.usd(ccy)`;
  - `market.session(sym, tSec) → {open, opensAt}`;
  - `market.serverOffset(t)`, `market.nyOffset(t)`;
  - `market.feedAlive() → bool` (răspuns în ultimele 10 s).

  Export UMD: global `MarketCore` în browser, `export` în Node prin `core/market.mjs` (un wrapper de o linie care încarcă fișierul).

- [ ] **Step 1: Testul MC1-MC4 în `tests/server/market-core.mjs`**:
  - MC1: același set de cotații dat la `Engine` (în Playwright, `tests/engine.html`) și la `MarketCore` în Node dă aceleași `bid/ask/spread/open` pentru 20 de simboluri (FX, index, crypto, acțiune), la 6 momente (luni 08:00, vineri 21:59 / 22:01 UTC, sâmbătă, schimbarea DST din martie, rollover 17:00 NY);
  - MC2: `usd('JPY')` din cotația USDJPY = `1/mid`;
  - MC3: fără cotație de peste 120 s → `off: true`;
  - MC4: `feedAlive()` e false după 10 s fără `setQuotes`.
- [ ] **Step 2: Rulează `node tests/server/market-core.mjs`.** Expected: FAIL (modulul lipsește).
- [ ] **Step 3: Extrage în `core/market.js`.** `engine.js` devine consumator și își păstrează simularea și API-ul public `Engine.*` neschimbat.
- [ ] **Step 4: Rulează** `node tests/server/market-core.mjs` și `node tests/run.mjs engine`. Expected: PASS ambele.
- [ ] **Step 5: Commit** `feat(core): market core shared by browser and server`.

### Task 2: `core/account.js`, regulile contului fără UI

**Files:**
- Create: `core/account.js` (+ `core/account.mjs`, wrapper-ul Node)
- Modify: `trade.js` (delegă calculele și validările la nucleu și păstrează toast/beep/confirmări/texte de UI), `index.html`, `build.mjs`
- Test: `tests/server/account-core.mjs`; `tests/orders.mjs`, `tests/account.mjs`, `tests/ds-trade.mjs`, `tests/challenge.mjs` trebuie să treacă neschimbate

**Interfaces:**
- Consumes: `market` din Task 1.
- Produces: `AccountCore.create({ market, rng, now }) → core`. Toate funcțiile primesc `acct` (`{balance, peak, positions, orders, set, nextId, nextFill}`) și o mută doar prin rezultat:
  - `core.openMarket(acct, req) → {ok, fills[], pos, events[]} | {ok: false, code, text}`. `req` = `{sym, side, lots, sl, tp, trail, tps, be, posId?}`. Cu `posId` face netting pe acea poziție; fără `posId` deschide o poziție nouă.
  - `core.close(acct, posId, frac, reason, exec?)`;
  - `core.place(acct, req)` și `core.cancel(acct, orderId, why)`;
  - `core.modify(acct, {posId | orderId, sl?, tp?, tps?, price?, limit?, trail?, be?})`, cu aceleași validări ca `setLevel`/`validateLevel` de azi;
  - `core.onTick(acct, tSec) → events[]`: expirări, pending-uri, OCO, SL/TP/reduce-only/trim, stop-out sub 50%, NBP (protecția la sold negativ);
  - `core.rollover(acct, tSec) → events[]`: swap, inclusiv nopțile ratate de la `acct.rollLast` încoace;
  - `core.summary(acct) → {balance, equity, margin, free, level, fl}`;
  - `core.execFill(...)`, cu `rng` injectat. `execSeed` devine `rng` seeded.

  Evenimente: `{type: 'fill' | 'reject' | 'cancel' | 'expire' | 'stopout' | 'nbp' | 'swap', ...}`, cu chitanța de fill în forma de azi (`fid, t, sym, side, lots, pos, order, kind, reason, bid, ask, ref, refKind, px, slip, slipUsd, spread, spreadUsd, lat, comm, gap, model`). Codurile de refuz sunt un enum în `core/account.js` (`CLOSED`, `VOL_MIN`, `VOL_MAX`, `MARGIN`, `REQUOTE`, `SL_SIDE`, `SL_SPREAD`, `MIN_DIST`, `CLOSE_ONLY`, `MAX_WORKING`, `UNKNOWN_SYM`, `NOT_DEMO`, …), câte unul pentru fiecare text de azi.
- Trailing-ul și break-even-ul sunt în nucleu ca funcții pure (`trailNext`, `beLevel`). Le folosesc gateway-ul și replay-ul. `onTick` nu le aplică.

- [ ] **Step 1: Testul AC1-AC8:**
  - AC1: open market EURUSD 1 lot, cu rng seeded → fill `px = ask + slip`, comision debitat;
  - AC2: un add cu `posId` dă intrarea medie ponderată, iar `im` se adună;
  - AC3: opusul cu `posId` reduce poziția, iar restul unei inversări deschide o poziție nouă;
  - AC4: TP1/TP2 reduce-only, cu poziția redusă manual sub TP2 → TP2 e tăiat la cantitatea rămasă;
  - AC5: OCO, cu un pending executat → fratele anulat în același `onTick`;
  - AC6: stop-out, level 49% → se închide poziția cu cea mai mare pierdere, apoi recalculare;
  - AC7: `rollover` după 3 nopți ratate (miercuri triplă) → 5 nopți de swap;
  - AC8: fiecare cod de refuz are textul identic cu cel de azi din `trade.js` (comparare cu o listă extrasă din sursă).
- [ ] **Step 2: Rulează.** Expected: FAIL.
- [ ] **Step 3: Extrage, iar `trade.js` delegă.**
- [ ] **Step 4: Rulează** `node tests/server/account-core.mjs` și `node tests/run.mjs orders account ds-trade challenge`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): account rules without UI, shared by browser and server`.

### Task 3: codec FIX 4.4

**Files:**
- Create: `host/fix/codec.mjs`, `host/fix/dict.mjs` (tagurile și MsgType-urile folosite, cu numele lor)
- Test: `tests/server/fix-codec.mjs`

**Interfaces:**
- Produces:
  - `encode(msgType, fields: [[tag, value], …], header: {sender, target, seq, sendingTime, possDup?, origSendingTime?}) → Buffer`. Calculează `9` și `10`.
  - `Parser` (stream): `push(buf) → msgs[]`. Fiecare mesaj e `{type, seq, fields: Map<tag, value | value[]>, groups, raw}`, iar un mesaj invalid dă `{error, raw}`.
  - Grupuri repetate: `702` (NoPositions), `753` (NoPosAmt), `146` (NoRelatedSym).

- [ ] **Step 1: Testul FC1-FC6:**
  - FC1: un Logon cunoscut (exemplul din specificația FIX 4.4, cu `9` și `10` așteptate) e codat octet cu octet;
  - FC2: un mesaj tăiat în 3 bucăți de rețea iese întreg;
  - FC3: două mesaje lipite ies ca două;
  - FC4: un checksum greșit dă `error: 'checksum'`;
  - FC5: un BodyLength greșit dă `error: 'bodylength'`;
  - FC6: PositionReport cu 2 intrări `702` dă un grup de 2.
- [ ] **Step 2: Rulează.** Expected: FAIL. **Step 3: Implementează.** **Step 4: Rulează.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(fix): FIX 4.4 tag=value codec`.

### Task 4: sesiunea FIX 4.4

**Files:**
- Create: `host/fix/session.mjs`, `host/fix/store.mjs` (SQLite: `fix_seq(session, in_seq, out_seq)`, `fix_out(session, seq, raw)`)
- Test: `tests/server/fix-session.mjs`

**Interfaces:**
- Consumes: codec-ul din Task 3.
- Produces:
  - `createAcceptor({port, host, compId, auth(user, pass) → bool, store, onApp(msg, session)}) → {close()}`;
  - `createInitiator({port, host, compId, target, user, pass, heartBtInt: 30, store, onApp, onState(state)}) → {send(type, fields), close()}`, cu stările `connecting | logged-on | down` și reconectare la 1, 2, 5, 10 s, apoi tot la 10 s;
  - `session.send(type, fields)` persistă mesajul înainte să-l scrie pe socket;
  - mesajele admin (`A`, `0`, `1`, `2`, `3`, `4`, `5`) sunt tratate intern;
  - un `PossDupFlag=Y` cu seq deja procesat e ignorat;
  - la resend, mesajele admin se înlocuiesc cu `SequenceReset-GapFill`.

- [ ] **Step 1: Testul FS1-FS7:**
  - FS1: logon cu parolă bună → `logged-on`; cu parolă greșită → Logout și socket închis;
  - FS2: liniștea de `heartBtInt` duce la Heartbeat, iar un TestRequest primește Heartbeat cu `112` corect;
  - FS3: un gol de secvență produce ResendRequest și primește mesajele lipsă cu `43=Y`, în ordine;
  - FS4: kill pe acceptor în mijlocul a 50 de mesaje, restart, reconectare → toate 50 ajung o singură dată la `onApp`;
  - FS5: un duplicat cu seq vechi nu ajunge la `onApp`;
  - FS6: SequenceReset-GapFill sare peste mesajele admin;
  - FS7: credențialele nu apar în niciun log (grep pe ieșire).
- [ ] **Step 2–4: FAIL → implementare → PASS.**
- [ ] **Step 5: Commit** `feat(fix): FIX 4.4 session with persistent sequences and resend`.

### Task 5: dialectul și mesajele aplicației

**Files:**
- Create: `host/fix/dialect.mjs`
- Test: `tests/server/fix-dialect.mjs`

**Interfaces:**
- Produces, pe ambele direcții, conversia între obiectele nucleului și câmpurile FIX:
  - `orderToD(req, clOrdId, account)`, `dToOrder(msg)`;
  - `cancelToF`, `replaceToG`, `execToReport(event, ids) → fields` și `reportToExec(msg)`;
  - `posToAP` / `apToPos`, `summaryToBA` / `baToSummary`, `tradeToAE` / `aeToTrade`;
  - `settingsToU1` / `u1ToSettings` (jurisdicție, levier, slip, slipSd, latMs, comm, tip cont);
  - `resetToU1`.
- Constantele dialectului:
  - `TAG.POS_ID = 721`;
  - `TAG.OCO_GROUP = 5001`;
  - `TAG.LINK_POS = 5002` (reduce-only pe poziție);
  - `TAG.LEG = 5003` (`SL` / `TP1` … `TP4`);
  - `TAG.SLIP = 5010`, `TAG.SPREAD = 5011`, `TAG.LAT = 5012`, `TAG.GAP = 5013`, `TAG.COMM = 5014`, `TAG.SWAP = 5015`, `TAG.REASON = 5016`, `TAG.REJ_CODE = 5017`;
  - `MSG.ACCOUNT = 'U1'`.
- Cantitatea `38` e în loturi, cu zecimalele fișei. Prețurile au `M(sym).digits`.

- [ ] **Step 1: Testul FD1-FD4:**
  - FD1: dus-întors pentru fiecare tip (market, limit, stop, stop-limit, GTD cu `126`, close pe `721`, TP2 legat, OCO) dă obiectul inițial;
  - FD2: chitanța de fill completă trece prin `8` și revine identică;
  - FD3: un refuz cu `REJ_CODE` păstrează `code` și `text`;
  - FD4: niciun tag custom nu e în afara 5000–9999, cu excepția 721.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(fix): dialect mapping, the single place that changes for the real server`.

### Task 6: brokerul temporar

**Files:**
- Create: `host/broker.mjs`, `host/broker/db.mjs` (schema `data/broker.db`), `host/broker/feed.mjs` (bucla de 100 ms pe `quotes`, cu `parseQuotes` din `server/legacy.js`), `host/com.victor.tradeberry-broker.plist`
- Test: `tests/server/broker.mjs`

**Interfaces:**
- Consumes: `core/*`, `host/fix/*`.
- Schema:
  - `accounts(id TEXT PK, user_id, device, type 'demo'|'live', balance, peak, set_json, next_id, next_fill, roll_last, created)`;
  - `positions(id, account, json)`;
  - `orders(id, account, cl_ord_id UNIQUE, json)`;
  - `executions(seq PK AUTOINC, account, t, json)` (append-only);
  - `trades(id, account, close_t, json)` (append-only);
  - `clord(cl_ord_id PK, result_json)` (idempotență).
- Comportament:
  - la fiecare tick, `core.onTick` pe toate conturile cu poziții sau ordine pe simbolurile schimbate;
  - `rollover` la fiecare minut;
  - fiecare eveniment se scrie în aceeași tranzacție SQLite cu starea, apoi se trimite `8`;
  - răspunde la `AN` (cu abonare `263=1`, după care trimite `AP` la fiecare schimbare), `BB` (`BA`, la fiecare schimbare cel mult o dată pe secundă), `AF`, `H`, `AD`;
  - fără feed viu (`feedAlive()` false), nu execută nimic, iar refuzurile market primesc codul `CLOSED` cu textul de azi „no feed”.

- [ ] **Step 1: Testul B1-B10, B12** (broker real pe un port de test, feed fals, rng seeded, un initiator de test):
  - B1: `D` market dă `8` cu `150=F`, iar `AP` și `BA` reflectă fill-ul;
  - B2: același `11` trimis de două ori dă un singur fill, iar al doilea `8` e identic;
  - B3: SL legat se execută la tick fără niciun client conectat la gateway;
  - B4: TP1 parțial + SL redus la cantitatea rămasă;
  - B5: OCO;
  - B6: `G` pe SL (strângere);
  - B7: stop-out;
  - B8: GTD expiră;
  - B9: `U1` Reset pe un cont demo → zero poziții, sold 100000, istoric gol; pe un cont `live` → refuz `NOT_DEMO`;
  - B10: kill -9 între scrierea în DB și trimiterea `8`, apoi restart → `8` vine prin resend o singură dată, iar starea e consecventă;
  - B12: feed oprit 15 s → niciun fill; reluat → execuția continuă.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(broker): temporary FIX 4.4 broker holding demo accounts`.

### Task 7: recuperarea brokerului după oprire

**Files:**
- Create: `host/broker/recover.mjs`
- Modify: `host/broker.mjs` (la pornire: `recover(since = max(last tick seen, last execution))`)
- Test: în `tests/server/broker.mjs`, B11 și B13

**Interfaces:**
- `recover({db, core, market, fetchBars(sym, from, to) → [{t, o, h, l, c}], from, to}) → events[]`.
- Barele vin din `${TB_PLATFORM}/datafeed/history` (rezoluția 1). Bid-ul e din bară, iar ask = bid + spread-ul fișei (regula de noapte și news din `core/market.js`).
- Pe fiecare bară, ordinea e: deschidere (gap), apoi extremul nefavorabil, apoi cel favorabil.
- Fill-urile poartă `gap: true` și `reason: 'filled after server downtime'`.
- Rollover-urile ratate se înregistrează.
- Mai mult de 14 zile de pauză, sau barele indisponibile → nicio execuție, contul e marcat `recovery: 'pending'` și se loghează. *(Decizia lui Claude: nu inventăm prețuri.)*

- [ ] **Step 1:**
  - B11: un SL de 1.0800, pauză de 20 de minute și bare false cu o deschidere la 1.0790 → un fill la 1.0790, `gap: true`;
  - B13: o pauză peste un rollover → swap înregistrat o singură dată.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(broker): recover executions from 1-minute bars after downtime`.

### Task 8: gateway-ul, cu mirror, WS și comenzi

**Files:**
- Create: `host/gateway.mjs`, `host/gateway/mirror.mjs`, `host/gateway/ws.mjs`, `host/gateway/db.mjs` (în `tradeberry.db`, migrarea `migrations/0006_gateway.sql`), `host/com.victor.tradeberry-gateway.plist`
- Modify: `host/server.mjs` (proxy de upgrade pentru `/api/trade` spre `127.0.0.1:8797`, după middleware-ul de autentificare; gateway-ul primește `x-tb-user` și `x-tb-device` doar de la proxy, pe loopback, semnate cu un secret partajat din env `TB_GW_SECRET`), `functions/api/trade.js` (poarta de upgrade, ca `stream.js`)
- Test: `tests/server/gateway.mjs`

**Interfaces:**
- Consumes: sesiunea, dialectul, nucleul.
- Migrarea 0006:
  - `gw_clord(account, n)`;
  - `gw_meta(account, pos_id, json)`, pentru jurnal: `ctx, pm, sl0, tp0, news, mae, mfe, note, setup, basket, bgid, timeStop`;
  - `gw_state(account, key, json)`, pentru `chal`, `bkPos`, `bkOrders`, `bkHist`, `bkAlerts` și `alerts`;
  - `gw_accounts(user_id, device, account_id)`.
- WS: comenzi `{op, cid, ...}` cu `op` ∈ `order | close | modify | cancel | closeAll | basket | settings | alert | meta | reset | history`. Răspunsurile sunt `{cid, ok, id?, code?, text?}`. Evenimentele: `snapshot` (la conectare: cont, poziții cu meta, ordine, ultimele 200 de execuții, starea funcțiilor gateway-ului), `exec`, `pos`, `ord`, `acct`, `gw` (stare challenge, coșuri, alerte), `link` (`up` / `down` față de broker).
- Mirror: numai din `8`/`AP`/`BA`/`AE`. La logon se reconstruiește cu `AF` + `AN` + `BB`.
- Când brokerul e `down`, comenzile sunt refuzate cu „Execution server unreachable”.

- [ ] **Step 1: Testul G1-G6, G9:**
  - G1: două socket-uri pe același user primesc același `exec` pentru un ordin trimis de unul;
  - G2: un user nu primește evenimentele altui user;
  - G3: un `cid` repetat după reconectare produce un singur `ClOrdID` și un singur fill;
  - G4: brokerul oprit → `link down`, iar comanda e refuzată cu textul de mai sus;
  - G5: o cerere WS fără proxy (direct pe 8797, fără secret) e refuzată;
  - G6: `history` e paginat (200 pe pagină) și complet;
  - G9: kill -9 pe gateway în timpul unui fill, restart → mirror-ul e egal cu `AN`/`BB` de la broker.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(gateway): FIX initiator, account mirror and live WS for every session`.

### Task 9: OMS-ul gateway-ului (funcțiile tradeBerry)

**Files:**
- Create: `host/gateway/oms.mjs`
- Modify: `host/gateway.mjs`
- Test: în `tests/server/gateway.mjs`, G7, G8, G10-G14

**Interfaces:**
- Consumes: `core.trailNext` și `core.beLevel`, mirror-ul, feed-ul (aceeași buclă ca la broker, `host/broker/feed.mjs` refolosit).
- Netting: un ordin pe un simbol cu poziție în cartea netă (fără `bgid`) poartă `721`-ul ei. Restul unei inversări merge fără `721`.
- Trailing și BE: `G` pe ordinul SL, numai când stopul se strânge și cel mult o dată pe secundă pe poziție.
- Coșuri (logica din `basket.js` `bkMonitor`, mutată aici), time stop (`behav.js` `bhTick`), flatten la încălcarea regulilor challenge (`challenge.js` `chFlatten`) și alerte, toate pe tick.
- Partea din aceste module care e doar afișare rămâne în browser.
- La repornire: pe prețurile curente evaluează coșurile, time stop-urile, challenge-ul și alertele, iar trailing-ul și BE-ul ratate le recuperează din barele pauzei, doar în direcția care strânge stopul.

- [ ] **Step 1:**
  - G7: un add pe aceeași parte merge cu `721`, iar brokerul raportează intrarea medie;
  - G8: o inversare 1 → −0,5 dă un close pe `721` și o poziție nouă de 0,5;
  - G10: trailing de 20 pips pe 5 s de tickuri crescătoare → cel mult 5 `G`, iar stopul nu coboară niciodată;
  - G11: BE după TP1;
  - G12: un coș cu stop pe index, atins → toate picioarele închise, `reason: 'Basket stop'`;
  - G13: challenge cu pierderea zilnică depășită → flatten și ordine noi refuzate;
  - G14: gateway oprit 10 minute cu trailing activ și o alertă trecută → la repornire stopul e strâns din bare, iar alerta e marcată.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(gateway): tradeBerry order features as standard orders`.

### Task 10: browserul ca vedere

**Files:**
- Create: `tradelink.js` (clientul WS `/api/trade`: comenzi cu promisiuni, aplicarea snapshot-ului și a evenimentelor în `S`, starea legăturii)
- Modify:
  - `trade.js`: în documentul live, `openPosition`/`placeOrder`/`closePosition`/`closeVia`/`cancelOrder` trimit prin `tradelink` și întorc o promisiune; noile `modifyPosition(id, ch)` și `modifyOrder(id, ch)`; `checkTriggers` și `rolloverTick` nu mai rulează pe contul live;
  - `app.js`, `ui.js`, `chart.js`, `ticket.js`: editările directe de SL/TP/preț trec prin `modify*`. La drag, comanda pleacă la eliberare, iar până la confirmare linia arată „Sent”;
  - `behav.js`, `challenge.js`, `basket.js`, `pwa.js`, `chart.js`: wrapper-ele trec pe evenimentele `exec`, iar logica automată mutată în Task 9 iese de aici;
  - `cloud.js`: lease-ul și dialogul „another device” se scot pentru conturile normale; `/api/state` păstrează doar preferințele, cu merge pe chei, fără 409;
  - `persist.js`: contul nu mai e sursă, IndexedDB ține doar ultimul snapshot pentru pornire;
  - `demo.js`: iese din build-ul aplicației, rămâne doar în `tests/fixtures`;
  - Help: Import încarcă doar preferințele;
  - Reset account: doar pe conturile demo, prin `reset`;
  - `index.html`, `build.mjs`.
- Modify server: `functions/api/state.js` (PUT pe chei: `{base, prefs}`, merge per cheie), `functions/api/lease.js` se scoate (conturile partajate nu-l foloseau nici azi; tabelul `lease` rămâne în bază, nefolosit).
- Test: `tests/trade-link.mjs` (Playwright)

**Interfaces:**
- Consumes: protocolul WS din Task 8.
- Semnăturile globale rămân, dar cu rezultat asincron. Toți apelanții din inventar §3 (`mc.js`, `gestures.js`, `pro.js`, `ticket.js`, `app.js`) tratează promisiunea. Un refuz arată toast-ul de azi, cu textul venit din `text`.

- [ ] **Step 1: Testul TL1-TL6:**
  - TL1: un click Buy arată „Sent”, apoi poziția, după `exec`;
  - TL2: un refuz de marjă arată exact textul de azi;
  - TL3: drag pe SL → un singur `modify`, iar linia rămâne la noul nivel după confirmare;
  - TL4: legătura căzută → bannerul onest „Execution server unreachable” și butoanele de ordin dezactivate;
  - TL5: Help › Import nu schimbă soldul sau pozițiile;
  - TL6: Reset pe un cont demo → 100000, iar pe un cont live butonul lipsește.
- [ ] **Step 2: Rulează** `node tests/run.mjs trade-link`. Expected: FAIL.
- [ ] **Step 3: Implementează.** Testele vechi care plasau ordine prin execuția locală (`orders`, `account`, `ds-trade`, `challenge`, `bk-*`, `flows`, `migration`) se adaptează să ruleze pe un broker și un gateway de test, pornite de `tests/run.mjs`. Aserțiunile lor rămân aceleași.
- [ ] **Step 4: Rulează** `node tests/run.mjs`. Expected: PASS (în afara instabililor cunoscuți: R7, A11Y-6, O8 sub încărcare).
- [ ] **Step 5: Commit** `feat(app): browser becomes a view over the server account`.

### Task 11: migrarea conturilor

**Files:**
- Create: `tools/migrate-accounts.mjs` (citește `state` / `dstate` din `tradeberry.db` și scrie în `broker.db` și `gw_*`; `--dry-run`, `--verify`)
- Test: `tests/server/migrate-accounts.mjs`

**Interfaces:**
- Pentru fiecare user, blob-ul trece prin `sanitizeState`, mutat în `core/` sau importat din `app.js` printr-un shim Node.
- Ce scrie:
  - în `accounts`: soldul, peak-ul, setările și `type: 'demo'`;
  - în `positions`: pozițiile, cu `swap`, `comm`, `im`, `open`, `tps`, `be`, `trail`;
  - în `orders`: ordinele, cu ClOrdID nou și grupurile OCO păstrate;
  - în `trades`: istoricul;
  - în `executions`: `fills` și `ordLog`;
  - în `gw_meta` / `gw_state`: metadatele și stările.
- Blob-ul rămâne neatins.
- `--verify` compară, pentru fiecare cont, soldul, equity la aceleași cotații, numărul și nivelurile pozițiilor și ale ordinelor. Raportează diferențele și iese cu cod nenul.

- [ ] **Step 1:**
  - M1: un cont simplu → `--verify` fără diferențe;
  - M2: un cont cu multi-TP, BE armat, trailing, coș deschis și challenge activ → identic după import;
  - M3: o a doua rulare nu dublează nimic (idempotent pe user);
  - M4: conturile partajate dau câte un cont de broker pentru fiecare rând `dstate`.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(tools): migrate accounts from the state blob to the broker`.

### Task 12: e2e, servicii, deploy, versiune

**Files:**
- Create: `tests/e2e-server.mjs`
- Modify:
  - `host/deploy.sh`: rsync `core`, `catalog.js` și pornirea, în ordine, broker → gateway → server, cu health check pe fiecare; `--ui` nu restartează brokerul și gateway-ul;
  - `tests/server/run.mjs`: rulează testele noi din `tests/server/`;
  - `tests/run.mjs`: pornește brokerul și gateway-ul de test;
  - `fit.js`, `package.json`: 16.0.0;
  - `3-documentatie/Istoric-versiuni-README.md`, `CITESTE-MA.md`, `MeridianFX/CLAUDE.md`: serviciile noi, porturile, `broker.db`, faptul că brokerul e temporar;
  - învățătura din `teach.js`, unde turul vorbește despre execuție.

- [ ] **Step 1: Testul E1-E3:**
  - E1: SL atins cu ambele browsere închise → la deschidere, istoricul arată ieșirea la ora atingerii;
  - E2: două browsere modifică SL-ul în aceeași secundă → ambele afișează valoarea ultimei comenzi confirmate;
  - E3: restart la broker și gateway cu poziții deschise → aceleași poziții și același sold, nimic dublat.
- [ ] **Step 2: Poarta completă:** `node tests/server/run.mjs` și `node tests/run.mjs`. Expected: PASS.
- [ ] **Step 3: Repetiție pe mini** pe o copie a bazei: `tools/migrate-accounts.mjs --dry-run --verify` pe `tradeberry.db` copiată în `/tmp` pe mini. Expected: zero diferențe.
- [ ] **Step 4: Deploy** (după acordul lui Victor pentru momentul trecerii): `npm run deploy`, migrarea cu `--verify`, `launchctl` pentru broker și gateway, apoi verificare pe tb.oneaigency.com: două sesiuni pe același user, un ordin, un SL.
- [ ] **Step 5: Commit** `release: v16.0.0 execution on the server via FIX 4.4`.
