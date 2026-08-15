# Changelog

Versionare [SemVer](https://semver.org/lang/ro/): `MAJOR.MINOR.PATCH`.

Cat timp suntem pe `0.x`, `MINOR` creste la functionalitate noua si poate aduce
schimbari incompatibile, iar `PATCH` doar la corectii. Prima versiune `1.0.0` se
da cand formatul librariei de pe disc devine stabil.

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
