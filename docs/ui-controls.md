# Standard UI: elementele pe care se poate da click

Versiunea 1, 06.11.2026, decisă cu Victor. **Contractul de accent din 16.11.2026 (audit Figma) înlocuiește §3.5 (alegerea curentă), §3.6 (tabul curent) și butonul principal din §3.7; vezi §10.** Pagina de probă cu toate stările, care se pot și folosi: `docs/ui-controls.html` (pe 8765: http://localhost:8765/docs/ui-controls.html). Interfața e în engleză; termenii de UI rămân în engleză.

## 1. Principiul

**Galbenul înseamnă un singur lucru: aici poți acționa.**

- În repaus, un control are **un singur indiciu galben**, mic: textul, săgeata, o linie de 1 px sau chenarul căsuței.
- Datele (prețuri, valori, etichete) nu sunt niciodată galbene. Un număr galben s-ar citi ca un buton.
- Avertismentele nu folosesc galbenul (vezi §6).
- Roșu și verde rămân pentru Sell/Buy și P&L. Butoanele de ordin sunt singura excepție de la galben.
- Regula se aplică **pe tip de element, în toată aplicația**, nu ecran cu ecran.

## 2. Cele cinci stări

| Stare | Aspect | Valoare |
|---|---|---|
| Repaus | un indiciu galben mic | `--acc` (#e8b04a; în tema light #87570f) |
| Hover | tentă galbenă în spate | `color-mix(in srgb, var(--acc) 15%, <fundalul controlului>)` |
| Pornit / deschis / ales | fundal galben plin, conținut negru | fundal `--acc`, text și bife `#000` / `--acc-ink` |
| Focus de la tastatură | contur galben de 2 px, la distanță | `outline: 2px solid var(--acc)` |
| Dezactivat | gri, fără pic de galben | săgeți și chenare `--tx3`, opacitate .45 la căsuțe |

## 3. Pe tipuri de element

### 3.1 Căsuță (checkbox)
SL și TP din New order, căsuțele din liste (Indicators, Multi-chart).
- Debifată: pătrat cu chenar galben de 1 px pe fundal negru.
- Bifată: pătrat galben plin, cu bifă neagră centrată.
- Pătrat, fără colțuri rotunjite. 20 px în New order, 12 px în liste.
- Bifa e desenată la fel peste tot: un „L” de 6×3 px cu linie de 1,6 px, rotit −45°, la 3 px de marginea stângă a căsuței, centrat pe verticală.
- Hover: tentă galbenă. Checkbox-ul nativ rămâne în pagină (`appearance:none`), ca să meargă tastatura și cititorul de ecran.

### 3.2 Comutator (switch)
O setare care pornește sau oprește o funcție pe loc: Fast trade (meniul contului), One-click trading (Help), Guard on, Ask before risky trades, always without a stop (Coach › Behaviour), alerta din Strategy Lab. Căsuța (§3.1) rămâne pentru alegeri din liste și formulare.
- Șină pătrată de 34×18 px, chenar galben de 1 px, fundal negru, buton galben de 12 px în stânga.
- Pornit: șina galbenă plină, butonul negru în dreapta.
- Hover: tentă galbenă. Dezactivat: chenar și buton gri.
- Checkbox-ul nativ rămâne (`appearance:none`), ca la căsuță. Fast trade își păstrează textul On/Off, iar comutatorul e desenat după el.

### 3.3 Buton de dropdown
Candles, Indicators, Layout, unitățile SL/TP, `<select>`-urile din toată aplicația.
- **Valoarea rămâne în culoarea textului** (e o dată). **Săgeata ▾ e indiciul galben.**
- Hover: tentă galbenă, plus linie galbenă unde butonul are chenar.
- Deschis: fundal galben, conținut negru, săgeata întoarsă.
- Dezactivat: săgeată gri.
- Dropdown cu iconiță în loc de text (Layout): iconița e gri în repaus, iar lângă ea stă o săgeată galbenă mică. Fără fundal sau chenar propriu dacă vecinii din bară nu au.
- Butoanele aceleiași bare arată la fel: același fundal (transparent în bara graficului), aceleași separatoare.
- `<select>` nativ: aceeași săgeată galbenă, desenată de noi. Lista lui deschisă e desenată de sistem și nu se poate stiliza.

### 3.4 Lista unui dropdown
Un singur format pentru toate listele desenate de aplicație:
- rânduri pe toată lățimea, înălțime 30 px, padding 0 12 px, despărțite de linii de 1 px `--line`;
- fără spațiu interior în jurul rândurilor și fără rânduri cu fundal propriu;
- hover: tentă galbenă;
- iconițele, unde există, stau în stânga textului;
- fără chenarul galben de focus pe opțiunea care primește focusul la deschidere (focusul se vede prin tentă).

**Semnul din stânga spune ce fel de alegere e:**

| Alegere | Semn | Rândul ales | La click |
|---|---|---|---|
| Un singur element (Candles, Layout, unitățile SL/TP) | bară galbenă de 2 px în stânga | fundal `--s3`, text galben | lista se închide |
| Mai multe elemente (Indicators, Multi-chart) | căsuța din §3.1 | căsuță plină, text galben | lista rămâne deschisă |
| Acțiune (Fill with related pairs, Reset pane sizes) | săgeată → galbenă | — | face acțiunea |

**Secțiuni într-o listă** (Multi-chart în Layout): titlul de secțiune e o bandă, nu un rând. Are fundal `--bg`, linie de 2 px deasupra, litere mari mici (10 px, spațiere .1em, `--tx3`), fără hover și nu se poate apăsa.

**Închiderea:**
- lista cu alegere unică se închide la alegere;
- lista cu alegere multiplă, sau una care deschide o secțiune nouă (Layout cu mai multe grafice → Multi-chart), rămâne deschisă;
- orice listă se închide la click în afara ei, la click pe butonul ei și la Esc, cu focusul înapoi pe buton.

### 3.5 Grup de alegere (segmented)
Aplicat 06.11.2026 pe `.seg` și `.mini-seg`, în toată aplicația: timeframe, filtrele Market watch și Monitor, Market / Pending, Brief 1H/4H, Correlation, Volatility, Observatory, paginile din Behaviour.
- Doar alegerea curentă e plină de galben, cu text negru.
- Celelalte au text gri, care devine galben, cu tentă, la hover.
- Nu intră aici grupurile de iconițe (`#toolSeg`, `#drawSeg`, §3.8) și lista Layout (`#mcSeg`, §3.4).
- Un grup cu **alegere multiplă** nu e grup de alegere, ci un rând de căsuțe (§3.1). Exemplu: filtrul Impact din Calendar.
- Paginile din Behaviour (Habits, Pre-mortem, Red flags) arată ca un grup, dar sunt taburi (§3.6).

### 3.6 Tab de navigare
Aplicat 06.11.2026. Un tab schimbă **ce vezi** (altă pagină sau alt panou), nu o valoare. De aceea e un tip separat de grupul de alegere (§3.5), deși și la tab alegi unul din mai multe.
- Unde: bara de pagini (`#views`: Trade, Monitor, Research, Strategy Lab, Coach), bara de jos cu subtaburile paginii (`#tabs`: Positions…, Market Brief…, Backtester…, Journal…), paginile din Behaviour (`.bh-pgs`), Administration (`.adm-tabs`).
- Repaus: text gri, fără fundal propriu (bara de pagini își păstrează fundalul `--s1`, pentru că liniile dintre butoane sunt fundalul barei).
- Hover: tentă galbenă, text deschis.
- Activ: **text galben și linie galbenă de 2 px dedesubt, fără fundal plin**. Fundalul plin e semnul grupului de alegere.
- Nu intră aici taburile de margine ale panourilor ascunse (Depth, Stats, New order pe marginea din dreapta).
- Excepție (Victor, 06.11.2026): banda verticală din dreapta (New order · Depth · Stats) își păstrează celulele pline. Sunt comutatoare de panou și trebuie să fie evidente și când panoul e închis, ca Hide/Show panel. Varianta „tab fără fundal” a fost încercată și respinsă.

### 3.7 Buton text
Aplicat 06.11.2026 pe `.ghost`, `.es-b`, `.cv-tg`, `.brief-btn`, `.tk-hide`, `.coach-more`, `.btn-pri`. Eticheta e una singură: majuscule, 11 px, greutate 600, spațiere .04em.

| Variantă | Când | Repaus | Hover | Apăsat |
|---|---|---|---|---|
| Secundar | aproape toate: Hide, Show/Expand panel, Brief, Data, Add alert, Refresh, Copy, Alert, Details, butoanele din stările goale | text galben, fără chenar și fără fundal | tentă galbenă | galben plin, text negru |
| Principal | o singură acțiune principală pe ecran: Run backtest, Start practice attempt, Place a limit order, OK-ul neutru din dialogurile de confirmare (Stop attempt, Go back, Close replay) | chenar galben 1 px + text galben | tentă galbenă | galben plin, text negru |
| Distructiv | Close all, Reset, Delete (`.danger`) | toată celula nuanțată roșu + text roșu (culoarea e semnificația); fără chenar sau spațiu în celulă | roșu plin, text alb | — |

Dezactivat: text gri, fără chenar galben; distructivul dezactivat păstrează un chenar roșu stins. În dialogurile de confirmare, OK-ul unei acțiuni distructive sau de ordin (`kind: 'sell'`/`'buy'`) își păstrează culoarea; Cancel e secundar.

Butoanele dintr-o bară stau în celule separate prin linii de 1 px (bara de jos: Expand panel | Close all | Hide/Show panel). **Nu se pun chenare sau spații în interiorul unei celule**: un buton dintr-o bară umple celula, iar accentul vine din fundalul celulei. Un buton care comută între două stări arată la fel în ambele, cu textul și săgeata potrivite. Excepție de vizibilitate: comutatorul de panou „HIDE PANEL ▾” / „SHOW PANEL ▴” are toată celula galben plin, cu text negru (sub 1680 px doar săgeata, centrată, în ambele stări).

Butoanele de ordin (Sell/Buy) sunt §3.11, nu butoane text.

### 3.8 Iconiță din bară
Aplicat 06.11.2026: bara de sus (Command bar, sonificare, sunet, instalare, temă, replay, ecran complet, cont), săgețile și zoom-ul graficului (‹ › − +), banda de unelte (Level, Alert, Measure, uneltele de desen, Magnet), + coloane din Market watch, Brief (doar iconiță).
- Repaus: iconiță gri, fără fundal și fără chenar. 15 iconițe galbene ar fi zgomot; locul lor într-o bară e indiciul.
- Hover: tentă galbenă, iconiță galbenă.
- Activ / pornit (unealta aleasă, Magnet, o opțiune comutată): galben plin, iconiță neagră.
- Excepții: comutatoarele de panou («  Hide market watch, Hide/Show panel) sunt galben plin tot timpul (§3.7). Steaua de favorit e galbenă când instrumentul e favorit, fără fundal.
- O iconiță fără text are `aria-label`. Tooltip-ul (`title`) e opțional; Brief nu are.

### 3.9 Câmp și celulă editabilă
Toate câmpurile de text, număr și dată, plus zonele de text: New order, Help, Strategy Lab, Coach, Administration, căutarea din Market watch.
- Valoarea rămâne albă (e dată). Placeholder-ul e gri.
- Hover: linie galbenă de 1 px sub câmp.
- Cât se scrie (focus): linie galbenă de 2 px sub câmp, fără chenar galben întreg și fără contur.
- Dezactivat: text gri.
- Fiecare câmp își păstrează mărimea și linia sau chenarul din repaus.
- Excepție: valoarea fixată de utilizator în New order (`.held`, cu eticheta „set”) își păstrează chenarul galben, iar la focus primește și linia de 2 px.
- O celulă **goală care așteaptă o valoare** (SL/TP din Positions) are chenar galben întreg (aplicat 03.11).

### 3.10 Link în text
Receipt, butoanele `.link` (Coach, Strategy Lab, coșuri), sursele „Research: …”, linkurile `<a>` din Help și Challenge.
- Text galben, fără subliniere în repaus; subliniat la hover. Dezactivat: gri.
- Prefixul „Research:” rămâne gri; doar titlul sursei e galben.
- Excepții: Reset demo account rămâne roșu (distructiv), dar se subliniază la fel la hover. Creditul foto din Opening Note și sigla TradingView de pe grafic rămân neatinse (formatul notei e fix; sigla e atribuire de licență). Linkurile „Skip to …” rămân galbene pline.

### 3.11 Butoanele de ordin (excepția)
Sell roșu, Buy verde, fără galben. Hover: puțin mai luminoase.

### 3.12 Notă (text care explică, nu se apasă)
Decisă cu Victor pe 10.11.2026. Un text scurt care spune ce urmează să se întâmple (de exemplu „Adds to position…” din New order).
- Fond propriu cu tentă caldă: `--note-bg` (12% `--acc` în `--s1`), text `--note-tx` (`--tx`). Tokenii sunt în `:root`, valabili în toată aplicația.
- Fără bară colorată în stânga și fără chenar. Padding 8px 10px.
- Nu e un control: fără cursor de mână, fără hover. E singurul loc în care galbenul apare ca tentă pe ceva ce nu se apasă; tenta e mai slabă decât cea de hover (15%) și nu are niciodată text galben.
- Clasa comună e `.note`. Aplicată azi: `.tk-net` (New order). De trecut pe aceeași clasă, pe rând: `.w-info`, `.foot-note`, notele din Depth și Lab.

## 4. Explicații la hover
Opțiunile unei liste a căror semnificație nu e evidentă au explicație la hover (`title`). Exemplu: unitățile SL/TP din New order (`TK_UNIT_TIP` în `ticket.js`). O opțiune dezactivată își arată motivul.

## 5. Cum se implementează
- CSS: blocuri la finalul `styles.css`, cu comentariul `/* front · … */`.
- `!important` doar pentru stările hover / deschis, acolo unde reguli vechi cu id-uri (bara graficului) le-ar bate. Se pune doar pe proprietățile stării respective.
- Săgeata `<select>`-urilor: SVG ca `background-image`, câte un URI pentru tema dark, tema light și starea dezactivată.
- Comportamentul de închidere al listelor stă în `shell.js` (`dropdown()` și handlerele `#typeSeg`, `#indSeg`, `#mcSeg`) și în `ticket.js` (`mkPick`).

## 6. Avertismente (propus, neaplicat)
`--warn` (#f5a524) e aproape la fel cu `--acc` (#e8b04a): un avertisment pare un buton, iar un buton pare un avertisment. Propunerea e ca avertismentele să treacă pe portocaliu (`--alert` #ff8a3d, cu o iconiță ▲), inclusiv impactul Medium din calendar. Decizia îi aparține lui Victor.

## 7. Stare
| Tip | Stare |
|---|---|
| Căsuțe (SL/TP, liste) | aplicat (06.11.2026) |
| Butoane de dropdown, `<select>` | aplicat (06.11.2026) |
| Liste de dropdown, secțiuni, închidere | aplicat (06.11.2026) |
| Celule goale SL/TP în Positions | aplicat (03.11.2026) |
| Grupuri de alegere; filtrul Impact din Calendar cu căsuța standard | aplicat (06.11.2026) |
| Taburi de navigare | aplicat (06.11.2026) |
| Butoane text | aplicat (06.11.2026) |
| Iconițe din bare | aplicat (06.11.2026) |
| Comutatoare | aplicat (06.11.2026) |
| Câmpuri | aplicat (06.11.2026) |
| Linkuri | aplicat (06.11.2026) |
| Avertismente pe `--alert` | propus |

## 8. Diferențe față de draftul din 31.10.2026
Draftul `UI-Standard.md` (standardul UI din 31.10, doar în worktree-ul `.claude/worktrees/wf_24b0a3d2-af7-1`, necomis, neaplicat) spune altceva în trei puncte. Pentru elementele clickabile are prioritate documentul de față:
- §4.6 din draft: „`--acc` nu e o culoare de buton, doar de selecție”. Aici galbenul marchează tot ce se poate acționa.
- §4.8 din draft: segmentul activ pe `--s3` cu text galben. Aici devine fundal galben plin.
- §4.12 din draft: rânduri de meniu de 24 px. Aici au 30 px, ca lista Layout aleasă de Victor.

## 9. Cifre mereu vizibile
Cifrele contului din bara de sus (Balance, Equity, Floating P&L, Free margin, Margin level) stau toate în bară, la orice lățime de desktop. Nu se ascund într-un dropdown (Victor, 06.11.2026); sub 1680 px celulele se strâng.

## 10. Contractul de accent (16.11.2026, audit Figma, aprobat de Victor)

Înlocuiește, acolo unde diferă, §2 (Pornit), §3.5, §3.6 și varianta „Principal” din §3.7. Restul standardului rămâne.

| Rol | Aspect | Tokenuri |
|---|---|---|
| Acțiune primară neutră | accent solid, text `--acc-ink`; hover `--acc-hover`, apăsat `--acc-pressed`; dezactivat gri, fără fundal | `.btn-pri`, `.es-b.pri`, OK-ul neutru din confirmări (`.cf-actions .cta.sm`) |
| Comutator binar pornit | accent solid, text `--acc-ink` | Monitor › Panels, uneltele de desen, comutatoarele de panou |
| Opțiunea aleasă dintr-un grup de alegere (segmented) | tentă discretă `--acc-tint` + linie fină `--acc-line`, text normal; hover tentă mai slabă | `.seg`, `.mini-seg`, Market / Pending (marker), Backtester templates |
| Tabul curent | text normal + linie de accent de 2 px dedesubt, fără fundal | `#views`, `#tabs`, `.bh-pgs`, `.adm-tabs`, `.obs-nav` |
| Focus de la tastatură | contur de accent de 2 px | `:focus-visible` |
| Link / acțiune terțiară | text de accent (butonul secundar din §3.7 rămâne așa) | `.link`, `.ghost`, … |
| Semantice | Buy/Sell, P&L, avertisment, eroare, distructiv păstrează culorile lor | niciodată accent |

Tokenuri derivate (în `:root`, calculate din `--acc`, deci urmează tema): `--acc-tint` (18%), `--acc-line` (55%), `--acc-hover`, `--acc-pressed`. Pe light, `--acc` rămâne `#87570f`, iar `--acc-ink` `#fff`.

Excepția din §3.6 (banda verticală New order · Depth · Stats cu celule pline) rămâne. Implementarea e blocul „front · accent contract” de la finalul `styles.css`.

### 10.1 Corecție (17.11.2026): galbenul nu decorează
Galbenul arată intenția sau starea utilizatorului, nu împodobește suprafețele.
- **Panouri:** bordura panoului e neutră (`--line2`); niciun panou nu are cadru galben.
- **Titluri și simboluri:** titlul panoului (`New order`), `EUR/USD` din bara graficului și titlul din detaliile instrumentului sunt în `--tx`. Prețurile și valorile nu sunt galbene (inclusiv markerul „prețul în range”).
- **Simbolul selectat în Market watch:** text normal, fundal `--acc-tint`, linie de 2 px în stânga.
- **Taburi, și cele verticale (New order · Depth · Stats):** inactiv = fundal neutru `--s2`, text `--tx2`; activ = fundal neutru `--s3`, text normal, linie de accent de 2 px pe latura dinspre panou. Excepția cu celule pline din §3.6 nu se mai aplică.
- **Grup de alegere:** `--acc-tint`, text `--tx`, cel mult 1 px `--acc-line` (45%).
- **Controale secundare** (Hide market watch, `+` coloane, fold-ul de lângă Close all, tabul care readuce Market watch): neutre; tentă la hover și cât meniul e deschis (`aria-expanded=true`); inel galben doar la focus de la tastatură.
- **Accent solid:** doar pentru o singură acțiune primară într-o regiune și pentru un comutator binar efectiv ON (de ex. `Place a practice trade`, Sound ON, Magnet ON).
- Contoarele (Positions / Orders / Alerts) sunt valori: neutre.
- Rămân neschimbate: Buy/Sell, P&L, avertismente, erori, Close all și celelalte acțiuni distructive. Textul de accent pentru acțiuni terțiare și linkuri (Brief, Receipt, Details, Hide ›) rămâne.

