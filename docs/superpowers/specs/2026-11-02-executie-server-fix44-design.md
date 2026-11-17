# Execuția pe server prin FIX 4.4: broker temporar și gateway tradeBerry

Data: 02.11.2026. Cerut de Victor: conturile să trăiască pe server, cu mai multe sesiuni deschise pe același user, iar ordinele în așteptare, SL/TP și restul să se execute și când nu e deschisă nicio sesiune. Victor a cerut și FIX 4.4 implementat de acum. În varianta finală ordinele pleacă prin FIX la serverul real, care ține tot ce ține de conturi. Victor a ales abordarea A.

Inventarul codului de azi: `.mace/research/2026-11-02-inventar-executie.md`.

## De ce

Azi tot contul rulează în browser (`trade.js`, cu `checkTriggers` pe fiecare tick). Serverul doar păstrează o copie (`/api/state`) și dă unui singur dispozitiv dreptul de a scrie (`/api/lease`). Cu browserul închis nu se execută nimic:
- stopurile, ordinele pending, trailing-ul și stop-out-ul se execută abia la redeschidere;
- swap-ul nopților ratate se pierde de tot (`rollNext` se rearmează la boot).

A doua sesiune e oprită de dialogul „open on another device”.

Ținta: serverul ține contul și execută continuu. Browserul doar trimite comenzi și afișează. Granița dintre partea tradeBerry și partea de execuție e FIX 4.4 încă de acum, ca la trecerea pe serverul real să se schimbe doar adresa și identitățile sesiunii.

## Scopuri

1. Contul (sold, poziții, ordine, istoric, fills) e ținut și executat pe server, 24/7.
2. Oricâte sesiuni deschise simultan pe același user, toate cu aceeași stare live. Lease-ul dispare pentru conturile normale.
3. FIX 4.4 între gateway-ul tradeBerry (initiator) și brokerul temporar (acceptor). Brokerul temporar se poate înlocui cu serverul real fără ca gateway-ul să-și schimbe protocolul.
4. Niciun câmp, nicio funcție și nicio valoare afișată nu se pierde: multi-TP, break-even, trailing, OCO, stop-limit, TIF, netting, coșuri, time stop, challenge, alerte, chitanța de fill, pre-mortem, tilt, jurnalul.
5. Swap-ul nopților în care serverul a rulat se înregistrează întotdeauna. După o oprire a serverului, prețurile ratate sunt recuperate din barele de 1 minut (vezi §7).

## Ce nu se face (non-goals)

- Datele de piață nu trec pe FIX. Feed-ul rămâne cel de azi (platforma → relay/recorder). Feed-ul serverului real e o decizie separată, pentru mai târziu.
- Conectarea la serverul real nu face parte din acest proiect: nu avem nici specificația lui FIX, nici adresa.
- Replay, Coach și backtesterul rămân simulări locale în browser, fără ordine reale.
- Fără strategii automate noi. Azi nu există niciun bot care plasează ordine (cu excepția `demo.js`, unealtă de dev).

## Ce n-ar trebui să se întâmple (anti-goals)

- Două motoare care execută același cont. După migrare, browserul nu mai execută niciodată pe contul live.
- Interfața arată „filled” înainte de confirmarea brokerului. Fără UI optimist pe bani: un ordin e „sent” până vine `ExecutionReport`.
- Un execution report pierdut sau dublat. Sesiunea FIX are secvențe persistente și resend, iar fiecare `ClOrdID` e idempotent.
- O doua implementare a regulilor de execuție care se abate de prima. Regulile din `trade.js` se extrag o singură dată, într-un nucleu comun.

## Arhitectura

```
browser(e) ─WS /api/trade (JSON)─▶ GATEWAY (în host/server.mjs) ─FIX 4.4/TCP 127.0.0.1─▶ BROKER TEMPORAR (host/broker.mjs)
   view + comenzi                   OMS tradeBerry, permanent                             conturi + execuție, temporar
                                    metadate jurnal, push live                            broker.db
                 tickuri live (platformă, 100 ms) ──▶ gateway (OMS)   și  ──▶ broker (execuție)
```

### Nucleul comun (`core/`)
- Sursa unică a regulilor.
- `core/market.js`: din `engine.js` se extrag `quote`, `usd`, sesiuni, DST (`serverOffset`/`nyOffset`), off-quotes, spread de noapte/news și `META`. `catalog.js` se încarcă la fel în browser și în Node. Simularea de piață rămâne în `engine.js`.
- `core/account.js`: din `trade.js` se extrage matematica pură, cu `state` și `market` ca parametri, fără `toast`/`beep`/DOM:
  - `pipValue`, `posPnl`, `account()`, `posMargin`, `effLev`, `orderCaps`, `volWhy`;
  - `execFill`, cu RNG injectat;
  - swap/rollover, `buildTps`, `beSpec`, `trailNext`;
  - validările din `openPos`, `placeOrder` și `closePos`, cu motive de refuz structurate (`{code, text}`) în loc de texte construite în toast.
- Browserul folosește același nucleu în replay și în backtester. `trade.js` rămâne adaptorul de UI.

### Brokerul temporar (`host/broker.mjs`)
- Proces separat, serviciu launchd `com.victor.tradeberry-broker`. Ascultă FIX pe `127.0.0.1:9878`.
- Bază proprie: `data/broker.db`, cu tabelele `accounts`, `positions`, `orders`, `executions` (append-only, nimic nu se trunchiază), `trades` (istoric) și `fix_store`.
- Joacă rolul serverului real: ține contul și execută doar ce înțelege un broker standard.
  - Tipuri de ordin: market, limit, stop, stop-limit.
  - TIF: DAY/GTC/GTD.
  - Ordine de închidere legate de o poziție: SL = stop, TP = limit, cu cantitate parțială pentru TP-urile multiple. Sunt reduce-only. Când poziția se închide, brokerul anulează ordinele legate de ea. Când poziția scade, brokerul taie TP-urile care ar depăși cantitatea rămasă (`trimTps` de azi) și aduce SL-ul la cantitatea rămasă.
  - Grupurile OCO/OCA între ordine pending, printr-un tag de grup din dialect: la fill, brokerul anulează frații. *(Decizia lui Claude: tot ce poate produce o poziție dublă stă la broker. Așa protecția nu depinde de gateway, iar serverele reale acceptă de obicei OCO.)*
  - Netting pe ID de poziție: un `D` cu tag `721` pe aceeași parte mărește poziția, cu intrare medie, comision și marjă adunate, ca `netAdd`. Pe partea opusă o reduce sau o închide. Fără `721`, se deschide o poziție nouă (picioarele coșurilor).
  - Regulile: marja la fill, maximum deviation/requote, slippage-ul din setările contului, comisionul, fișa instrumentului (volume, sesiuni, close-only, distanța minimă pending), stop-out sub 50%, swap la 17:00 New York, protecția la sold negativ.
- Primește tickurile direct de la platformă, cu propria buclă de 100 ms, așa cum face recorderul.
- Hedging pe poziții cu ID, ca picioarele coșurilor să rămână separate.

### Gateway-ul (`host/gateway.mjs` + `host/gateway/`, proces separat)
- Rulează ca proces propriu, serviciu launchd `com.victor.tradeberry-gateway`, cu WS pe `127.0.0.1:8797`. `host/server.mjs` face proxy la upgrade-ul `/api/trade`, după autentificare. Un `deploy:ui` sau un restart al serverului web nu oprește gateway-ul, care repornește doar când i se schimbă codul.
- La repornire:
  - reconstruiește mirror-ul din rapoarte (resend FIX + `AF`/`AN`/`BB`);
  - evaluează imediat, pe prețurile curente, stopurile coșurilor, time stop-urile, regulile challenge și alertele;
  - trailing-ul și break-even-ul ratate se recuperează din barele de 1 minut ale pauzei, doar în direcția care strânge stopul.

  Un stop rămas pe vechiul nivel e mai larg decât trebuia, dar e tot la broker, deci poziția nu rămâne descoperită.
- Initiator FIX. O singură sesiune spre broker, care poartă toate conturile (tag 1 `Account`).
- Mirror al fiecărui cont, construit numai din rapoartele brokerului. Mirror-ul se trimite la toate socket-urile contului.
- OMS-ul funcțiilor proprii tradeBerry. Brokerul le vede doar ca ordine standard:
  - netting: alege ID-ul poziției. Un ordin pe un simbol cu poziție deschisă în cartea netă (fără coș) se trimite cu `721`-ul ei. Restul unei inversări devine o poziție nouă. ID-ul poziției rămâne cheia jurnalului.
  - multi-TP: mai multe ordine limit parțiale, legate de poziție;
  - break-even și trailing: `OrderCancelReplaceRequest` pe ordinul SL, limitat la cel mult o modificare pe secundă pe poziție, și doar când stopul se strânge;
  - stop-ul, ținta, trailing-ul și break-even-ul coșurilor; time stop (behav); flatten la încălcarea regulilor challenge; alertele de preț.
- Starea acestor funcții (`chal`, `bkPos`/`bkOrders`/`bkHist`/`bkAlerts`, `alerts`, `timeStop`) trece din blob în `tradeberry.db`, ca să ruleze 24/7.
- Metadatele jurnalului (`ctx`, `pm`, `sl0`/`tp0`, `news`, `mae`/`mfe`, `note`, `setup`, `basket`/`bgid`, `timeStop`) nu sunt date de broker. Rămân permanent la tradeBerry, în `tradeberry.db`, cheiate pe ID-ul poziției.
- Partea temporară e doar brokerul. Gateway-ul, OMS-ul și jurnalul rămân și după trecerea pe serverul real.

### Browserul
- `trade.js` și cele 15 module care apelează `openPosition`/`placeOrder`/`closePosition` păstrează semnăturile globale. În modul live, adaptorul trimite comanda la gateway și întoarce o promisiune a rezultatului. Wrapper-ele (behav, challenge, cloud, persist, pwa, chart) se mută pe evenimentele de execuție, nu pe apelul local.
- Editările directe de SL/TP/preț pending (`app.js`, `ui.js`, `chart.js`, dock-ul din ticket) trec printr-o funcție nouă: `modifyPosition` / `modifyOrder`.
- Afișarea folosește mirror-ul primit de la gateway. Contul nu se mai salvează în IndexedDB ca sursă, ci doar ca ultimă stare văzută, pentru pornire rapidă.
- Lease-ul și dialogul „another device” dispar pentru conturile normale. Conturile partajate (`users.shared`) păstrează comportamentul de azi: câte un portofoliu pe browser, adică un cont de broker pe (user, `tb-device`). Un browser nou pornește un portofoliu nou, exact ca acum.
- Ce rămâne în blob-ul `/api/state` sunt doar preferințele de interfață: setări de afișare, ticket, watchlist, desene, linii, pre-mortem și tilt (porți pe click, nu execuție). Se salvează pe chei, ultimul care scrie câștigă, fără dialogul 409 „pick a copy”. Contul (sold, poziții, ordine, istoric, fills, `ordLog`) iese din blob.

## Contractul FIX 4.4 (gateway ↔ broker)

- Header: `8=FIX.4.4`, `49` SenderCompID, `56` TargetCompID, `34` MsgSeqNum, `52` SendingTime, `43`/`122` la resend. Trailer: `10` checksum.

- **Sesiunea:**

  | MsgType | Mesaj |
  |---|---|
  | `A` | Logon (`98=0`, `108`, `553`/`554` user/parolă, `141` la reset) |
  | `0` | Heartbeat |
  | `1` | TestRequest |
  | `2` | ResendRequest |
  | `3` | Reject |
  | `4` | SequenceReset (cu și fără GapFill) |
  | `5` | Logout |

  Secvențele se păstrează în `fix_store` pe ambele părți, iar mesajele trimise rămân stocate pentru resend.

- **Ordine:**

  | MsgType | Mesaj | Taguri |
  |---|---|---|
  | `D` | NewOrderSingle | `11` ClOrdID, `1` Account, `55` Symbol, `54` Side, `60`, `38` OrderQty în loturi, `40` OrdType 1/2/3/4, `44` Price, `99` StopPx, `59` TIF 0/1/6, `126` ExpireTime |
  | `F` | OrderCancelRequest | `41` OrigClOrdID |
  | `G` | OrderCancelReplaceRequest | |
  | `H` | OrderStatusRequest | |
  | `AF` | OrderMassStatusRequest | |

  Răspunsuri:

  | MsgType | Mesaj | Taguri |
  |---|---|---|
  | `8` | ExecutionReport | `37`, `17`, `150` ExecType, `39` OrdStatus, `31`/`32`/`14`/`151`/`6`, `58` Text, `103` OrdRejReason |
  | `9` | OrderCancelReject | |
  | `j` | BusinessMessageReject | |

- **Poziții și cont:**

  | MsgType | Mesaj |
  |---|---|
  | `AN` | RequestForPositions, cu `263=1` pentru abonare |
  | `AO` | RequestForPositionsAck |
  | `AP` | PositionReport |
  | `BB` | CollateralInquiry |
  | `BA` | CollateralReport: sold, equity, marjă, free margin, margin level |
  | `AD` | TradeCaptureReportRequest |
  | `AE` | TradeCaptureReport, pentru istoric |

- **Dialect, izolat într-un singur modul (`host/gateway/dialect.mjs`):**
  - ID-ul poziției și închiderea unei poziții anume: tag `721` PosMaintRptID pe `D`/`8`/`AP`, ca la cTrader;
  - grupul OCO/OCA al ordinelor pending și legătura reduce-only a SL/TP de poziție;
  - detaliile de fill fără tag standard (slippage, latență, spread, gap, comision, swap): taguri custom în intervalul 5000–9999, documentate în dialect;
  - setările de cont ale brokerului temporar (jurisdicție, levier, slippage, comision): mesaj user-defined `U1`, doar pentru brokerul temporar. La serverul real, aceste setări vin de la el.

  La trecerea pe serverul real se schimbă doar acest modul, plus adresa, CompID-urile și credențialele.

- Stabilitatea ID-urilor:
  - `ClOrdID` = `tb-<cont>-<n>`, generat de gateway și persistent;
  - un `ClOrdID` repetat primește același rezultat, nu un al doilea ordin.

## Browser ↔ gateway (WS `/api/trade`)

- Autentificare cu cookie-ul de sesiune existent, ca `/api/stream`. Verificare same-origin.
- Comenzi `{op, cid, ...}`, cu `op` = `order`, `close`, `modify`, `cancel`, `closeAll`, `basket`, `settings`, `alert` sau `meta`. Răspunsul e `{cid, ok, id}` sau `{cid, ok: false, code, text}`. Textele de refuz sunt cele de azi.
- Evenimente: `snapshot` la conectare, apoi `exec` (fill/refuz/anulare, cu chitanța), `pos`, `ord` și `acct`.
- La reconectare: snapshot complet, nimic incremental.

## Recuperarea după oprire (§7)

Brokerul pornit după o pauză:
1. Cere barele de 1 minut pentru intervalul ratat (`/datafeed/history`, ca arhiva).
2. Parcurge barele în ordinea timpului, pentru fiecare ordin pending și fiecare SL/TP.
   Barele platformei sunt pe bid, ca tot feed-ul (pivot pe bid). Partea ask se calculează ca bid + spread-ul din fișă, cu regula de noapte/news pe care aplicația o folosește deja când lipsește un ask live.
3. Execută la nivelul ordinului, sau la deschiderea barei dacă bara a deschis dincolo de nivel. Fill-ul e marcat `gap`, cu motivul „filled after server downtime”.
4. Înregistrează swap-ul pentru rollover-urile ratate.

Stop-out-ul se verifică pe închiderile barelor. *(Decizia lui Claude: un minut e cea mai fină granulație pe care o are platforma. E mai corect decât azi, când contul se execută abia la redeschiderea browserului.)*

## Conturi demo: Reset, Import, demo history

Fiecare cont are un tip, `demo` sau `live`. Acum toate conturile sunt demo.
- **Reset account** (înapoi la 100.000 $) e disponibil pe orice cont demo (Victor, 02.11.2026). Gateway-ul trimite cererea brokerului printr-un mesaj din dialect. Brokerul închide tot, golește istoricul contului și pune soldul la valoarea inițială.
- Execuțiile unui cont demo sunt reale: prețuri live, fills de la broker. Niciun cont nu primește date fabricate (Victor, 02.11.2026). În consecință:
  - **Demo history** (`demo.js`) iese din aplicație. Rămâne doar ca unealtă în testele locale, fără drum spre conturile de pe server.
  - **Import** din Help încarcă doar preferințele de interfață (setări, watchlist, desene, linii). Nu mai atinge contul.
  - **Export** rămâne pe orice cont.
- Pe un cont live, Reset nu apare.
- La serverul real, dialectul trimite Reset pe mecanismul lui de demo, dacă există.

## Migrarea

- Un import unic, la deploy. Pentru fiecare cont, blob-ul din `state` intră în `broker.db`:
  - soldul și peak-ul;
  - pozițiile, cu intrarea, ora, swap-ul acumulat și comisionul;
  - ordinele pending;
  - istoricul, fills-urile și `ordLog`.
- Metadatele jurnalului merg în `tradeberry.db`.
- Blob-ul rămâne neatins, ca rollback. Un script de verificare compară, pentru fiecare cont, sold, equity, poziții și ordine, înainte și după.
- Istoricul nu mai e trunchiat la 500 pe server. Browserul primește paginat ce afișează.

## Teste

1. Codec FIX:
   - BodyLength și checksum;
   - mesaje reale FIX 4.4 de referință;
   - un mesaj corupt e respins.
2. Sesiunea:
   - logon și heartbeat;
   - gol de secvență → ResendRequest;
   - PossDup ignorat;
   - SequenceReset;
   - reconectare după kill pe oricare parte.
3. Brokerul: scenariile din `tests/orders.mjs`, `tests/account.mjs`, `tests/ds-trade.mjs` și `tests/challenge.mjs`, mutate pe nucleu și pe broker, cu RNG seeded.
4. Recuperarea: bare false cu gap peste SL, swap ratat.
5. Gateway-ul:
   - netting;
   - multi-TP;
   - BE, trailing, OCO;
   - coșuri;
   - idempotența ClOrdID;
   - mirror-ul egal cu rapoartele.
6. End-to-end (Playwright):
   - două browsere pe același user văd același fill;
   - SL executat cu ambele browsere închise;
   - restartul gateway-ului și al brokerului fără pierderi.
7. Suita completă existentă, plus `tests/server/run.mjs`.

## Livrare

O singură versiune (v16.0). Funcțiile proprii nu pot lipsi nicio zi, deci nu se livrează pe bucăți. Poarta completă și `npm run deploy` se aplică: atinge bani, persistență și server. Înainte de mutarea conturilor reale se face o repetiție pe o copie a bazei de pe mini.

## Lăsat constructorului

- Structura internă a fișierelor din `core/` și `host/gateway/`.
- Numerele tagurilor custom din intervalul 5000–9999.
- Throttling-ul exact al trailing-ului, în limita a cel mult o modificare pe secundă pe poziție.
- Paginarea istoricului.

## De cerut echipei tehnice (nu blochează)

Specificația FIX a serverului real (Rules of Engagement):
- versiunea;
- cum se identifică și se închide o poziție;
- cum se atașează SL/TP;
- ce mesaje de cont acceptă.

Cu ea, `dialect.mjs` se scrie direct pe dialectul lor.
