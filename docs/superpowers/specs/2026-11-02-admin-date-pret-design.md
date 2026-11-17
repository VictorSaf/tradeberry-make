# Administration › Price data: arhiva de bare, importul și golurile recorderului

Data: 02.11.2026 · Cerut de Victor: „un modul în Administration de unde să hotărâm importul de date istorice pe server din vechea platformă și un serviciu care să ruleze permanent… la o eventuală întrerupere de stream să putem importa datele lipsă”. Victor a ales B: golurile + importul complet.

## De ce
O copie proprie a istoricului platformei vechi, pe Mac mini, ca asigurare: dacă platforma dispare sau își pierde istoricul, prețurile rămân la noi. Golurile din înregistrarea tickurilor (recorder oprit, platformă căzută) se acoperă cu lumânări de 1 minut, singurul lucru pe care platforma îl are.

## Ce nu se schimbă
- Graficele și backtesterul citesc în continuare istoricul de la platformă (v15.25). Platforma rămâne sursa de adevăr; arhiva e copie. *(Decizia lui Claude: altfel am avea două surse care pot să nu se potrivească; trecerea graficelor pe arhivă e o decizie separată, mai târziu.)*
- Recorderul și comprimarea zilnică a tickurilor rămân cum sunt.

## Ce se construiește
1. **Importer** (`host/bars-import.mjs`, proces separat pe mini, launchd `com.victor.tradeberry-bars`, zilnic la 05:30 + pornit din Admin):
   - pentru toate instrumentele platformei (lista `symbol_info`, ~270): 1 minut cât are platforma (~9 luni) și 1 oră din 2022;
   - arhiva: `~/tradeberry/data/bars/1/SYM/AAAA-LL.csv.gz` (o lună pe fișier) și `bars/60/SYM/AAAA.csv.gz` (un an pe fișier); `t,o,h,l,c`, prețuri cum le dă platforma;
   - incremental: rulările următoare cer doar ce lipsește după ultima bară din arhivă; luna curentă se rescrie (scriere în `.tmp`, verificare, rename, ca la tickuri);
   - ritm propriu: 1 cerere/s, una singură în zbor, ca să nu încetinească aplicația (limitatorul din server e în alt proces); o eroare a platformei se reîncearcă de 3 ori, apoi instrumentul e marcat „failed”, fără să oprească restul;
   - starea în `data/bars/status.json`: rulează / ultima rulare, pentru fiecare instrument și rezoluție: prima și ultima bară, câte bare, eroarea dacă e.
   - Estimare primă rulare: ~5.500 de cereri ≈ 1,5–2 h; apoi câteva minute pe zi; spațiu estimat 0,5–1 GB.
2. **Golurile**: din tabelul `runs` al recorderului (golul = între `last` al unei rulări și `start` al următoarei). Un gol e „acoperit” când arhiva de 1 minut are barele lui (importerul le aduce oricum la rularea zilnică; „Fill gaps” pornește imediat o rulare doar pentru intervalele golurilor). Tickurile lipsă nu pot fi recuperate; Admin spune asta.
3. **API** `GET/POST /api/admin/data` (doar administratori, ca `/api/admin`):
   - GET: recorder (rulează? ultimul tick, tickuri azi, mărimea bazei și a arhivei, spațiu liber pe disc), golurile (ultimele 50, cu durata și „covered by 1-minute bars” / „not covered yet”), importul (rulează / ultima rulare, totaluri, instrumentele failed);
   - POST `{op: 'import'}` (tot), `{op: 'import', sym}` (un instrument), `{op: 'gaps'}`: pornește importerul ca proces separat; dacă rulează deja, răspunde „already running”.
4. **Admin UI**: în dialogul Administration, un al doilea tab „Price data” lângă conturi: trei blocuri (Recorder, Gaps, Archive), butoanele „Import all now”, „Import one…”, „Fill gaps”; progresul se actualizează la 5 s cât e deschis. Fiecare stare afișată e citită din fișiere/bază, nu presupusă.

## De spus echipei tehnice
Prima rulare face ~5.500 de cereri la datafeed în ~2 h (1/s). Merită anunțată.

## Teste
- importer: platformă falsă (ca `tests/server/history.mjs`): arhivă scrisă corect pe luni, rulare incrementală fără duplicate, eroare → failed fără oprire, două porniri → una;
- API: non-admin 403, cross-site 403, GET cu baze goale și pline;
- UI: tabul Price data arată stările reale; un test de zonă.
- Poarta completă (server) și `npm run deploy`.

## Lăsat constructorului
Formatul exact al `status.json`, layout-ul tabului în stilul terminalului (tabele cu border, fără pills).
