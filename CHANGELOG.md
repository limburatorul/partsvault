# Changelog

Versionare [SemVer](https://semver.org/lang/ro/): `MAJOR.MINOR.PATCH`.

Cat timp suntem pe `0.x`, `MINOR` creste la functionalitate noua si poate aduce
schimbari incompatibile, iar `PATCH` doar la corectii. Prima versiune `1.0.0` se
da cand formatul librariei de pe disc devine stabil.

## [0.4.0] - 2026-08-16

### Adaugat

- **Cautare printr-un Chromium adevarat.** Electron are un browser complet
  inauntru, iar `fetch()` nu executa JavaScript si n-are cookie-uri, asa ca era
  recunoscut si servit degradat. Aceleasi interogari, randate acum intr-o
  fereastra ascunsa, intorc rezultatele intregi: pentru `Logitech Z5500`,
  de la **0 la 37 de rezultate in 11 secunde**. Variantele pe `fetch` raman ca
  rezerva, fiindca sunt mult mai ieftine cand functioneaza.
- **Rezultatele de la furnizori intr-un singur tabel**, cu denumirea gasita la
  furnizor, daca e sau nu in stoc, si pretul.
- **API TME si DigiKey**, ca toate cele patru distribuitoare mari sa poata
  intoarce stoc si pret. TME semneaza cererile cu HMAC, DigiKey cere OAuth --
  ambele se configureaza in Setari, unde e si link-ul de unde se ia cheia.

### Note

- Citirea automata a paginilor de magazin **nu** e o alternativa la API: Mouser,
  DigiKey, TME si Farnell raspund toate cu verificare anti-bot, pe care
  aplicatia nu incearca sa o ocoleasca. Fara cheie, furnizorul apare in tabel ca
  link catre cautarea lui.

## [0.3.1] - 2026-08-16

### Corectat

- **Cautarea la furnizori nu avea de unde sa porneasca.** Butonul exista doar pe
  un rand din tabel, adica doar pentru componentele pe care le ai deja -- fix
  invers fata de cerinta, care era sa cauti ce *nu* ai. Campul de sus filtra
  doar inventarul si, cand nu gasea nimic, se termina intr-o fundatura.
  Acum: buton **Cauta la furnizori** langa campul de cautare, Enter face acelasi
  lucru, iar cand filtrul nu gaseste nimic apare direct optiunea de a cauta la
  furnizori sau de a adauga piesa in inventar.

### Adaugat

- **Din rezultatul furnizorului direct in inventar**, cu part number, producator
  si descriere deja completate.

## [0.3.0] - 2026-08-15

### Adaugat

- **Inventar de componente.** Ce ai in sertare, cu categorie, tip, cantitate si
  locatie fizica (depozitare, rand, coloana). Cautarea merge si dupa locatie,
  deci poti intreba "ce am in cutia A".
- **Campuri definite de utilizator.** Peste nucleul fix iti definesti singur
  caracteristicile: tip text, numar, lista de optiuni sau da/nu, cu unitate de
  masura, optional restranse la anumite categorii. Campurile propuse implicit
  pot fi sterse in intregime -- schema e a ta.
- **Alerta de stoc**: prag pe componenta si filtru pentru ce e pe terminate.
- **Cautare la furnizori**: Mouser, Farnell, TME, DigiKey, RS, Optimus Digital
  si Cleste. Fara configurare deschide cautarea in browser cu codul completat;
  cu o cheie API in Setari, Mouser si Farnell intorc pret, stoc si datasheet
  direct in aplicatie.
- **Export CSV** al inventarului, cu BOM ca Excel sa prinda diacriticele.

## [0.2.0] - 2026-08-15

### Adaugat

- **Cautare dupa aparat, nu doar dupa piesa.** Scrii `Logitech Z5500` si iti
  cauta schema si manualul de service. Aplicatia detecteaza singura despre ce e
  vorba si comuta filtrele.
- **Elektrotanya** ca sursa proprie, interogata prin motorul ei intern.
- **SearXNG** ca motor principal de cautare web. Agrega Google si Bing, deci
  vede ce vede si omul cand cauta manual.
- **Import manual de PDF-uri** in librarie, cu aceeasi verificare si indexare ca
  la descarcarile automate. Necesar pentru sursele care nu permit descarcare
  automata.
- Varianta **portabila**: un singur `.exe`, cu toate datele in
  `PartsVault-Date/` langa el.

### Corectat

- `Logitech Z5500` devenea tokenul `LOGITECHZ5500` si nu gasea nimic. Numele de
  aparate nu mai sunt tratate ca part number-uri.
- Detectorul de raspunsuri false cerea doar *un* termen din interogare, deci
  trecea cand Bing servea pagina de start a marcii. Acum cere numarul de model.
- O singura interogare fara rezultate scotea toate motoarele din rotatie pentru
  tot restul cautarii. Un raspuns gol nu mai e tratat ca esec de motor.

## [0.1.0] - 2026-08-15

### Adaugat

- Cautare in cascada pe niveluri: librarie locala, tipare directe de la
  producatori, cautare web, agregatoare, arhive.
- Tabele de echivalente pentru piese est-europene: CDB4xx, MMC, seriile
  sovietice 155/555/1533 si 176/561/564, Tesla, RFT, CEMI.
- Normalizare de part number cu extragere de radacina si variante.
- Verificarea documentelor descarcate: validare PDF, extragere text, confirmarea
  part number-ului, clasificare si nivel de incredere.
- Librarie locala organizata pe disc, cu deduplicare pe hash.
- Harness de diagnostic pentru sanatatea surselor.
