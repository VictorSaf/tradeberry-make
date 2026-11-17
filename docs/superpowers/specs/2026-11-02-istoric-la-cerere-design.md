# Istoric de prețuri la cerere — design

Data: 02.11.2026. Hotărât cu Victor într-un brainstorming. Abordarea aleasă: **B, la cerere peste tot**.

## De ce

tradeBerry primește acum prețuri live din platforma veche. Graficele trebuie să poată merge mai adânc în trecut. Backtester-ul trebuie să ruleze pe prețuri reale: azi, cu excepția pilotului DASHEUR, rulează pe 8 săptămâni modelate.

Victor nu vrea să ținem un duplicat al istoricului. Platforma veche îl are și rămâne sursa de adevăr. Cât timp așteptăm răspunsul echipei tehnice despre tickuri, câteva secunde de așteptare la cerere sunt acceptate.

## Ce s-a hotărât

1. **Istoricul vine doar din platforma veche, la cerere**, pentru grafice și backtester. Nu salvăm pe disc, nu facem import în bloc, nu folosim R2 și nu înregistrăm tickuri.
2. **Streamul live rămâne cum e** (`host/relay.mjs`): citește platforma la 100 ms doar cât e cineva conectat. Fără serviciu separat.
3. **La deschidere se încarcă la fel ca acum:** 7 zile de 1 minut și 90 de zile de 1 oră pe instrument (`livefeed.js`). Pornirea nu are voie să devină mai lentă.
4. **Graficul aduce pagina următoare de la platformă doar când utilizatorul derulează sau micșorează dincolo de datele încărcate.**
5. **Backtester-ul cere exact instrumentul și perioada alese, când pornește rularea, cu un indicator de progres** cât timp descarcă. Asta e valabil pentru orice instrument cu feed live, nu doar pentru DASHEUR.
6. **Backtester-ul folosește doar date reale venite la cerere** (Victor, 02.11.2026). Săptămânile modelate (`btSynth`, `BT_HC`, eticheta „model”, linia „modelled weeks | live”) se scot. Dacă perioada cerută trece de ce are platforma, dacă instrumentul nu are feed sau dacă feed-ul e căzut, backtester-ul spune deschis ce lipsește (de exemplu „platforma are 1 minut pentru EURUSD doar din februarie 2026”). Nu umple golul și nu rulează pe altceva.
7. **Replay-ul la nivel de tick e amânat** până răspunde echipa tehnică dacă tickurile sunt salvate și pot fi expuse. Designul trebuie să permită adăugarea ulterioară a unei surse de tickuri, fără să o construiască acum.

## Ce nu intră

- Nu stocăm istoricul pe disc, pe mini sau în browser, dincolo de cache-ul în memorie care există deja.
- Nu construim lumânări proprii din stream.
- Nu folosim feed-uri externe (Dukascopy etc.).
- Nu schimbăm formatul și sursa streamului live.

## Ce ar face lucrul un eșec chiar dacă „merge”

- Pornirea aplicației devine mai lentă sau cere mai mult de la platformă decât acum.
- Platforma e bombardată: mulți utilizatori care derulează simultan nu au voie să depășească ritmul pe care platforma îl suportă. Măsurat: cam 2 cereri/s fără probleme; ferestrele mici răspund repede, cele mari (30.000 de lumânări de 1 minut, 3,6 MB) durează peste 60 s.
- Interfața minte. Backtester-ul nu are voie să cadă în tăcere pe date modelate prezentate ca reale. Graficul nu are voie să arate un gol ca și cum ar fi „începutul istoricului” când, de fapt, cererea a eșuat. Utilizatorul trebuie să vadă trei stări distincte: se încarcă, a eșuat (cu reîncercare), nu mai există istoric mai vechi.

## Constrângeri

**Limitele platformei** (măsurate, `.mace/research/2026-11-01-import-istoric.md` și `2026-10-30-history-depth.md`):

| Rezoluție | Cât de departe ajunge | Detalii |
|---|---|---|
| 1 minut | FX, indici, aur: din ~feb. 2026; acțiuni: din ≤ iunie 2025; crypto: din ~iunie 2026 | |
| 1 oră | din 2022–2023 | |
| zilnic | de la listare | |

- Cam 30.000 de lumânări pe cerere, care se termină la `to`.
- Nu există tickuri și nici secunde.

**Ce există deja în cod:**

- **Server:**
  - `/api/history?sym=&days=&res=` (`functions/api/history.js`). `server/legacy.js history()` pagină înapoi de la „acum” pe `days` zile, cu plafon de 98 de zile pentru 1 minut și 1.600 de zile pentru 1 oră.
  - `host/server.mjs` are un cache în memorie de 48 MB care respectă `cf.cacheTtl`: paginile vechi stau o zi, cea mai nouă 30 s (1 minut) sau 5 min (1 oră). Pe mini funcționează deja.
- **Client:**
  - `livefeed.js`: `load` (7 zile), `hourly` (90 de zile, iar pentru `DEEP` 1.600 de zile), `liveMinutes(sym, days)` pentru backtester. Setul `DEEP = {DASHEUR}` și `liveDeep` sunt pilotul care trebuie generalizat și apoi scos.
  - `engine.js`: `feedHistory` și `feedHourly` primesc lumânările. Lipirea lor cu tickurile live funcționează azi.
  - `bt.js`: `BT_REAL`, `btWantsReal` și `btBars` lipesc lumânările reale cu săptămâna live. Altfel folosesc `btSynth`.

**Poarta de livrare:** schimbarea atinge `functions/` și `server/`, deci trece prin poarta completă de teste (`node tests/run.mjs` și `node tests/server/run.mjs`) și se livrează cu `npm run deploy`, nu cu `deploy:ui`.

## Abordări cântărite

- **A. Pilotul extins la toate instrumentele.** Fiecare instrument deschis își ia tot istoricul de 1 oră la încărcare. Respinsă: încetinește pornirea și cere ani de istoric pe care nimeni nu îi derulează.
- **B. La cerere peste tot. Aleasă.** Pornirea rămâne cum e. Graficul paginează înapoi la derulare. Backtester-ul cere perioada aleasă când pornește rularea. Costul: încărcarea graficului „pe măsură ce derulezi” trebuie scrisă de la zero.
- **Înregistrarea streamului sau un serviciu separat.** Respinsă: platforma are deja minutele și orele, iar lumânările noastre s-ar putea abate de la ale ei. Câștigul ar fi doar sub un minut, iar acela e amânat.

## Decizii luate după verificarea constructorului (decizia lui Claude; Victor le poate corecta)

- **Unde ajung lumânările aduse la derulare:** doar în buffer-ul graficului care le-a cerut. `Engine.candles`, `hourly`, `trim()` și `feedHistory` rămân neschimbate, deci indicatorii, scorurile, Observatory, Brief și replay lucrează pe aceleași date ca azi. Buffer-ul are un plafon. Când îl depășește, se aruncă lumânările cele mai vechi, iar o derulare ulterioară le cere din nou (cache-ul serverului le are încă).
- **Ce acoperă bugetul de ~2 cereri/s:** doar datafeed-ul de istoric (`/gcp/datafeed/history`, fără cheie). Cititorul de cotații al relay-ului folosește alt endpoint și nu intră în buget. Limitatorul de pe server e comun tuturor utilizatorilor și dă prioritate cererilor de la pornire (7 zile și 90 de zile) față de derulare și backtester.
- **Cât așteaptă backtester-ul:** cererile merg pe ferestre mici, nu pe ferestre de 30.000 de lumânări, care sunt lente. 12 săptămâni de 1 minut înseamnă ~90.000 de lumânări, adică ~9–10 ferestre de ~10.000, deci în jur de 5–10 s la 2 cereri/s, cu progres afișat. Execuția rămâne pe 1 minut, cum promite Help.
- **Ce grafice primesc paginarea:** fiecare grafic care afișează lumânări cu feed live, adică graficul principal și panourile multi-chart. Panourile care arată același instrument și aceeași rezoluție folosesc aceleași cereri. Coșul și timpul intrinsec rămân pe ce primesc azi.

## Ce e decizia constructorului

Cât timp hotărârile de mai sus rămân valabile, constructorul alege:

- **Forma paginării pe server:** de exemplu `to` sau `before` pe `/api/history`, cu ferestre mici, ca să rămână rapide și cache-uibile. Contează și cum se aliniază ferestrele, astfel încât cererile repetate să lovească cache-ul.
- **Plafoanele:** cât de adânc lasă serverul să se ceară pentru 1 minut, în limita a ce are platforma.
- **Protecția platformei:** o coadă sau un limitator pe server, comun tuturor utilizatorilor.
- **Rezoluția folosită de grafic la fiecare nivel de zoom**, inclusiv dacă vederile zilnice sau săptămânale folosesc lumânările zilnice ale platformei.
- **Cum arată cele trei stări** în grafic și în backtester, în stilul existent de terminal.
- **Ce perioade oferă backtester-ul** și cum arată mesajul când o perioadă nu e disponibilă (regula e la punctul 6).
- **Testele** care dovedesc toate cele de mai sus.
