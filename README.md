# PartsVault

Aplicatie desktop pentru atelierul de electronica. Face doua lucruri:

1. **Cauta si arhiveaza documentatie** -- datasheet-uri, scheme, note de
   aplicatie si manuale de service -- le descarca si le tine local, organizate
   si cautabile.
2. **Tine evidenta componentelor** din sertare: ce ai, cat mai ai si unde e. Iar
   ce nu ai, il cauta la furnizori.

Accentul e pe ce e **greu sau imposibil de gasit**: integrate scoase din
productie, clone est-europene, cipuri din anii '70-'90 care nu mai au pagina la
niciun producator.

## Pornire

```bash
npm install
npm run dev
```

La prima pornire aplicatia intreaba unde sa tina librăria. Fisierele raman
PDF-uri obisnuite pe disc, organizate ca
`<librarie>/<tip>/<producator>/<PART_NUMBER>/`, deci sunt utilizabile si direct
din Explorer, fara aplicatie.

## Varianta portabila

```bash
npm run dist
```

Produce `release/PartsVault-0.1.0-portabil.exe` — un singur fisier, fara
instalare. La prima pornire isi creeaza langa el folderul `PartsVault-Date/`, in
care tine tot: `config.json`, indexul si documentele descarcate. Nu scrie nimic
in alta parte din sistem, deci poate fi mutat pe stick sau pe alt calculator cu
tot cu librarie.

In varianta portabila nu mai apare ecranul care intreaba unde sa salveze —
raspunsul e intotdeauna "langa executabil". Calea ramane schimbabila din Setari.

## Cum gaseste piesele greu de gasit

Valoarea aplicatiei nu sta in a interoga Google, ci in ce face **inainte** si
**dupa** cautare.

### Inainte: intelege ce ai tastat

Un datasheet e indexat pe web sub radacina piesei, nu sub codul complet de
comanda. `analyzePart()` (`src/main/partnumber.ts`) sparge inputul in variante
ordonate dupa specificitate:

| Ai tastat | Aplicatia cauta |
|---|---|
| `LM358ADGKR` | LM358ADGK, LM358AD, ... **LM358** |
| `STM32F103C8T6` | STM32F103C8T6, STM32F103C8, **STM32F103** |
| `C945` | **2SC945** (marcajul de pe capsula omite prefixul JIS) |

Apoi intra **tabelul de echivalente** (`src/main/equivalents.ts`), care e
adevarata solutie pentru piesele imposibile. Nimeni nu publica fisa tehnica a
lui CDB400E, dar e acelasi cip cu SN7400:

| Piesa | Echivalent gasit | De ce |
|---|---|---|
| `CDB400E` | SN7400, 7400 | CDB4xx = seria TTL 74xx de la Microelectronica Bucuresti |
| `MMC4011` | CD4011, HEF4011B | MMC = seria CMOS 4000 fabricata in Romania |
| `K155LA3` | SN7400 | seria sovietica 155 = TTL 74xx; codul de functie ЛА3 = poarta SI-NU cuadrupla |
| `К561ЛА7` | CD4011 | acelasi tabel, seria CMOS; se accepta si input cirilic |
| `MAA741` | UA741, LM741 | Tesla MAA741 = amplificatorul operational clasic |

Codurile sovietice **nu** se traduc aritmetic — `ЛА3` inseamna "SI-NU, tipul 3",
nu "numarul 3" — asa ca sunt rezolvate printr-un tabel de coduri de functie, nu
prin regula. Tabelul contine doar corespondentele bine documentate: o intrare
gresita e mai daunatoare decat una lipsa, fiindca trimite cautarea pe o piesa
fara legatura in loc sa cada elegant pe cautarea generica.

### Dupa: verifica ce ai descarcat

Agregatoarele returneaza frecvent pagini de eroare sau HTML de captcha cu
`Content-Type` mincinos. `verifyDocument()` (`src/main/verify.ts`) deschide
fiecare PDF descarcat, extrage textul si confirma ca part number-ul chiar apare
in el. Nimic nu ajunge pe disc inainte de verificare.

Textul fiselor sovietice e scris cu chirilice (in PDF scrie `К155ЛА3`), deci
verificarea transliterează inainte de comparatie — altfel n-ar confirma
niciodata piesa cautata.

Fiecare document primeste un nivel de incredere:

- **verificat** — part number-ul apare in document
- **probabil** — documentul acopera familia sau echivalentul piesei
- **nesigur** — PDF scanat, fara strat de text

## Inventarul de componente

Nucleul e fix -- part number, categorie, tip, cantitate si locatie fizica
(depozitare, rand, coloana) -- fiindca pe el se sprijina cautarea, sortarea si
alertele de stoc. Restul il definesti tu: campuri de caracteristici de tip text,
numar, lista de optiuni sau da/nu, cu unitate de masura, optional restranse la
anumite categorii, ca formularul unui rezistor sa nu ceara frecventa de ceas.

Campurile propuse la prima pornire (valoare, toleranta, tensiune, putere,
capsula, montaj) sunt o sugestie, nu o structura impusa: pot fi sterse toate.

Cautarea merge si dupa locatie, deci poti intreba "ce am in cutia A". Pe fiecare
componenta poti pune un prag sub care e semnalata ca fiind pe terminate.

### Furnizori

| Furnizor | Regiune | Integrare |
|---|---|---|
| Mouser | International | API (pret, stoc, datasheet) |
| Farnell | Romania | API (pret, stoc, datasheet) |
| TME | Romania | cautare in browser |
| DigiKey | International | cautare in browser |
| RS Components | Romania | cautare in browser |
| Optimus Digital | Romania | cautare in browser |
| Cleste | Romania | cautare in browser |

Fara nicio configurare, butonul **Furnizori** deschide cautarea fiecarui magazin
cu codul completat -- merge intotdeauna si nu se strica. Daca pui o cheie API in
Setari, Mouser si Farnell intorc pret, stoc si link la datasheet direct in
aplicatie. Cheile stau local, in fisierul de configurare.

DigiKey si TME cer autentificare mai complicata decat o simpla cheie (OAuth,
respectiv semnatura HMAC), asa ca deocamdata sunt doar cautare in browser.

## Cascada de surse

Sursele sunt interogate pe niveluri, de la ieftin si sigur catre scump si
incert. Daca un nivel superior da rezultate bune si nu ai bifat *cautare
profunda*, cautarea se opreste acolo.

| Nivel | Sursa | Note |
|---|---|---|
| local | Libraria ta | verificata prima, ca sa nu descarci de doua ori |
| producator | Tipare directe de URL | TI, ST, onsemi, ADI, Nexperia, Diodes, Espressif |
| web | Bing (RSS) + DuckDuckGo | `filetype:pdf`, cu rotatie intre motoare |
| agregator | Datasheet4U, The Datasheet Archive | pentru piese obsolete |
| arhiva | Internet Archive, Bitsavers, World Radio History, Elektrotanya | databook-uri si manuale scanate |

**Tiparele directe sunt cea mai valoroasa categorie**: nu au rate limiting, deci
fiecare tipar functional valoreaza cat zece interogari de motor de cautare.

### Despre motoarele de cautare

Motoarele fara cheie de API nu suporta rafale, iar felul in care cedeaza e o
capcana. Masurat pe viu:

- DuckDuckGo intoarce o pagina de *anomaly* dupa cateva interogari;
- Bing e mai perfid — continua sa raspunda `200` cu zece rezultate, dar complet
  nerelevante (linii aeriene, forumuri de mail) in loc sa semnaleze eroarea.

De aceea aplicatia **valideaza relevanta** raspunsurilor: daca niciun rezultat
nu mentioneaza piesa, motorul e marcat epuizat si nu mai e folosit in rularea
curenta. Fara verificarea asta, un raspuns fals ar arata exact ca unul reusit.

Consecinta practica: bugetul de interogari e limitat deliberat (3 in cautare
rapida, 7 in cea profunda). Nu creste limitele fara sa masori — se ajunge rapid
la blocare.

## Diagnostic

Sursele de datasheet-uri se strica in timp: domenii care expira, Cloudflare care
se strange, tipare de URL care se schimba. Cand cautarea incepe sa dea gres,
asta e primul lucru de rulat — arata exact ce a cazut, ca sa nu cauti bug-ul in
cod cand de fapt a murit un site:

```bash
npm run probe:sources
```

Pentru o cautare cap-coada pe o piesa anume, in afara interfetei:

```bash
node scripts/run.mjs probe CDB400E
```

Surse verificate si scoase intentionat: **AllDatasheet** si **AllTransistors**
dau `403` (Cloudflare), **DatasheetsPDF** si **DatasheetCatalog** nu mai rezolva
DNS-ul. Nu au adaptoare, ca sa nu piardem timp pe surse care esueaza garantat.

## Structura

```
src/
  main/                 procesul Electron: motorul si datele
    partnumber.ts       normalizare, variante, producator din prefix
    equivalents.ts      tabele de echivalente RO / URSS / Tesla / RFT
    verify.ts           validare PDF, extragere text, clasificare, incredere
    download.ts         descarcare cu limita de marime si deduplicare pe hash
    import.ts           import manual, pentru sursele fara descarcare automata
    library.ts          index JSON + organizare pe disc
    inventory.ts        componente, schema definita de utilizator, export CSV
    suppliers.ts        link-out la magazine + API Mouser si Farnell
    http.ts             User-Agent de browser, throttling per host, retry
    search/
      orchestrator.ts   cascada pe niveluri, scoring, oprire timpurie
      sources/          cate un adaptor per sursa
  preload/              puntea IPC, singura suprafata expusa interfetei
  renderer/             interfata React
scripts/                harness de diagnostic, ruleaza in afara Electron
```

Diagnostic pentru inventar si furnizori, fara sa deschizi interfata:

```bash
node scripts/run.mjs probe-inventory
```

Libraria foloseste un index JSON, nu SQLite, ca sa nu existe dependinte native —
aplicatia trebuie sa se instaleze fara build tools. La zeci de mii de documente
ar merita schimbat.

## Note

Datasheet-urile si notele de aplicatie sunt distribuite liber de producatori.
Manualele de service (Elektrotanya) sunt de regula sub drept de autor — sursa e
inclusa pentru uz personal offline si poate fi dezactivata din Setari, ca
oricare alta.

Aplicatia respecta o pauza intre cereri catre acelasi domeniu (implicit 900 ms).
Sub 500 ms risti sa fii blocat temporar de agregatoare.
