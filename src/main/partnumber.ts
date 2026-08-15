import type { PartAnalysis, QueryType } from '../shared/types'
import { findEquivalents, hasCyrillic, transliterateCyrillic } from './equivalents'

/**
 * Analiza part number-ului introdus de utilizator.
 *
 * Scopul e sa transform "ce a tastat omul" intr-o lista ordonata de siruri de
 * cautat. Un datasheet e indexat pe web sub radacina piesei (LM358), nu sub
 * codul complet de comanda (LM358ADGKR), asa ca trebuie sa incerc ambele.
 */

/**
 * Prefix -> producator. Ordinea conteaza: prefixele lungi trebuie verificate
 * inaintea celor scurte (STM32 inainte de ST, LTC inainte de LT).
 */
const MANUFACTURER_PREFIXES: Array<[RegExp, string]> = [
  // Texas Instruments
  [/^(SN74|SN65|SN75|CD74|CD40|TPS|TLV|TLC|THS|TPA|TPD|TCA|TXB|TXS|UCC|CSD|DRV|BQ2|BQ3|INA|OPA|ADS|DAC8|REF5|LMV|LMC|LMH|LMP|MSP430|TMS320|TL0|TL4|TL7|UA7|UAF|LM3|LM2|LM1|LP2|LP5|ISO7|PCM|SN54)/, 'Texas Instruments'],
  // STMicroelectronics
  [/^(STM32|STM8|ST7|STP|STW|STB|STGW|L78|L79|L60|L62|L64|L29|L20|VIPER|VNH|VN5|TDA7|TDA2|M24C|M95|LIS3|LSM6|LSM3|ESDA|SG3|STEVAL|TS9|TS4|BAT54)/, 'STMicroelectronics'],
  // onsemi (+ Fairchild, Motorola)
  [/^(MC14|MC33|MC34|MC78|MC79|MC1|NCP|NCV|NTD|NTM|FAN|FDS|FDD|FQP|KA7|KA3|MBR|MUR|MMBT|MJE|MJ2|CS51|LM4)/, 'onsemi'],
  // NXP (+ Philips, Freescale)
  [/^(PCF|PCA|PCM|SAA|TEA|TDA|HEF|LPC|MK[0-9]|MPX|MMA|MFRC|PN5|BUK|BT13|NE5|NE55|SA6|74HC|74HCT|74LVC|74AHC)/, 'NXP / Philips'],
  // Microchip (+ Atmel)
  [/^(PIC|DSPIC|ATMEGA|ATTINY|ATSAM|ATXMEGA|AT89|AT24|AT25|MCP|24LC|25LC|93C|ENC28|ENC624|TC7|MIC2|MIC5|KSZ|LAN9|SST|CAP1)/, 'Microchip / Atmel'],
  // Analog Devices (+ Linear, Maxim)
  [/^(ADUM|ADXL|ADIS|ADG|ADM|ADP|ADC|ADA|AD5|AD7|AD8|AD9|OP0|OP1|OP2|OP4|LTC|LTM|LT1|LT3|LT8|MAX|DS18|DS13|DS32|DS24|HMC)/, 'Analog Devices'],
  // Infineon (+ IR, Cypress)
  [/^(IRF|IRL|IRG|IR21|IR22|IR25|BSS|BSC|BSZ|IPP|IPD|IPB|SPP|SPW|SPD|TLE|TLI|TLV49|BTS|BTN|ICE|XMC|SAK|SAF|CY7|CY8|CYW|CYBLE)/, 'Infineon / Cypress'],
  // Renesas (+ Intersil, IDT, NEC)
  [/^(R5F|R7F|RX6|RL78|RA[0-9]|ISL|ICL|HA1|HD6|HD7|UPD|UPC|EL7|IDT7|ICS)/, 'Renesas / Intersil'],
  // Toshiba
  [/^(TLP|TD62|TA7|TA8|TB6|TC4|TC7|TC9|2SK|2SJ|2SC|2SA|2SD|2SB|TPCA)/, 'Toshiba'],
  // Vishay
  [/^(SIHF|SI[0-9]|SIA|SIR|VS-|TSOP|TSAL|BZX|BZV|1N4|1N5)/, 'Vishay'],
  // Diodes Inc / Zetex
  [/^(AP[0-9]|AZ[0-9]|ZXCT|ZXMN|DMN|DMP|DMG|BAT4|BAV|74AHC1)/, 'Diodes Inc.'],
  // Nexperia
  [/^(PMV|PBSS|PMEG|BUK9|74LVC1|74AUP)/, 'Nexperia'],
  // Rohm
  [/^(BA[0-9]|BD[0-9]{4}|BU[0-9]{4}|BH[0-9]|RB[0-9]|BR24)/, 'Rohm'],
  // Sanyo / onsemi
  [/^(LA[0-9]|LB[0-9]|LC[0-9]|STK[0-9])/, 'Sanyo'],
  // JRC / Nisshinbo
  [/^(NJM|NJU|NJW)/, 'JRC / Nisshinbo'],
  // Silicon Labs
  [/^(EFM|EFR|SI[0-9]{4}|CP210)/, 'Silicon Labs'],
  // Espressif / Nordic / Realtek / Winbond
  [/^(ESP32|ESP8266|ESP-)/, 'Espressif'],
  [/^NRF/, 'Nordic Semiconductor'],
  [/^RTL[0-9]/, 'Realtek'],
  [/^W25Q|^W25X/, 'Winbond'],
  // senzori
  [/^(BMP[0-9]|BME[0-9]|BMI[0-9]|BNO[0-9]|BMA[0-9])/, 'Bosch Sensortec'],
  [/^(SHT[0-9]|SGP[0-9]|SPS[0-9])/, 'Sensirion'],
  [/^MLX[0-9]/, 'Melexis'],
  [/^(ACS7|A13|A11)/, 'Allegro'],
  [/^(HT[0-9]{4})/, 'Holtek'],
  [/^(CS4|CS8|WM8)/, 'Cirrus Logic / Wolfson'],
  // logica generica: nu identifica producatorul, dar e utila ca semnal
  [/^(74[A-Z]{0,4}[0-9]{2,4}|54[A-Z]{0,4}[0-9]{2,4})$/, 'logica standard 74xx'],
  [/^(CD4[0-9]{3}|MC14[0-9]{3})/, 'CMOS 4000 standard'],
  // discrete generice
  [/^(BC[0-9]{3}|BD[0-9]{3}|BF[0-9]{3}|BU[0-9]{3}|TIP[0-9]{2,3}|2N[0-9]{3,4}|1N[0-9]{3,4})/, 'discret standard']
]

/**
 * Sufixe de comanda care nu apar in datasheet: tape&reel, ambalare, RoHS,
 * grad de temperatura. Se taie inainte de orice alta procesare.
 */
const ORDER_SUFFIXES = [
  /-ND$/,          // numar de catalog DigiKey lipit din greseala
  /-E[0-9]$/,      // variante de ambalare
  /#PBF$/,         // Analog Devices lead-free
  /#TRPBF$/,
  /[-/]TR[0-9]?$/, // tape and reel
  /[-/]T[0-9]?$/,
  /[-/]RL$/,
  /[-/]REEL$/,
  /,?\s*CT-ND$/
]

/** Familii cu structura proprie, unde taierea generica de sufixe ar strica numele. */
const FAMILY_ROOTS: Array<[RegExp, (m: RegExpMatchArray) => string[]]> = [
  // STM32F103C8T6 -> STM32F103C8, STM32F103, STM32F1
  [/^(STM32[FLGHWU])(\d{3})([A-Z]\d)?/, (m) => [m[1] + m[2] + (m[3] ?? ''), m[1] + m[2], m[1]]],
  // PIC16F877A-I/P -> PIC16F877A, PIC16F877
  [/^(PIC\d{2}[A-Z]{1,2}\d{2,4})([A-Z]?)/, (m) => [m[1] + (m[2] ?? ''), m[1]]],
  // ATMEGA328P-PU -> ATMEGA328P, ATMEGA328
  [/^(ATMEGA\d{2,4})([A-Z]{0,2})/, (m) => [m[1] + (m[2] ?? ''), m[1]]],
  [/^(ATTINY\d{2,4})([A-Z]{0,2})/, (m) => [m[1] + (m[2] ?? ''), m[1]]],
  // ESP32-WROOM-32E -> ESP32-WROOM-32, ESP32
  [/^(ESP32|ESP8266)([-–][A-Z0-9]+)*/, (m) => [m[0], m[1]]],
  // 74HC00N / SN74HC00N -> SN74HC00, 74HC00, 7400
  [/^(SN|DM|MC|CD|HD|MM)?(74|54)([A-Z]{0,4})(\d{2,4})/, (m) => {
    const family = `${m[2]}${m[3] ?? ''}${m[4]}`
    const out = [family]
    if (m[1]) out.unshift(`${m[1]}${family}`)
    if (m[3]) out.push(`${m[2]}${m[4]}`) // varianta fara sub-familie: 74HC00 -> 7400
    return out
  }],
  // 2SC945 -> 2SC945, C945 (marcajul de pe capsula)
  [/^(2S([ABCDJK])(\d{3,4}))/, (m) => [m[1], `${m[2]}${m[3]}`]]
]

/** Normalizare: cirilic -> latin, uppercase, fara spatii si sufixe de comanda. */
export function normalizePart(raw: string): string {
  let s = raw.trim()
  if (hasCyrillic(s)) s = transliterateCyrillic(s)
  s = s.toUpperCase().replace(/\s+/g, '')
  // pastrez doar caractere plauzibile intr-un part number
  s = s.replace(/[^A-Z0-9\-_/#.+]/g, '')
  for (const suffix of ORDER_SUFFIXES) s = s.replace(suffix, '')
  return s.replace(/[-_/]+$/, '')
}

/**
 * Taie progresiv literele de la coada cat timp raman cu un nume plauzibil.
 * LM358ADGKR -> LM358ADGK -> ... -> LM358 (se opreste cand se termina in cifra).
 */
function stripTrailingSuffixLetters(part: string): string[] {
  const out: string[] = []
  let cur = part
  // opresc procesarea la primul '-' sau '/': LM317-TO220 -> LM317
  const cut = cur.search(/[-/]/)
  if (cut > 3) {
    cur = cur.slice(0, cut)
    out.push(cur)
  }
  let guard = 0
  while (/[A-Z]$/.test(cur) && cur.length > 4 && guard++ < 8) {
    cur = cur.slice(0, -1)
    // nu cobor sub o radacina care nu mai contine cifre
    if (!/\d/.test(cur)) break
    out.push(cur)
  }
  return out
}

function detectManufacturers(normalized: string): string[] {
  const found: string[] = []
  for (const [re, name] of MANUFACTURER_PREFIXES) {
    if (re.test(normalized) && !found.includes(name)) found.push(name)
  }
  return found
}

/**
 * Cod de integrat sau nume de aparat?
 *
 * Distinctia conteaza enorm: pentru un part number scot spatiile si caut fraza
 * exacta, ceea ce pentru "Logitech Z5500" ar produce tokenul LOGITECHZ5500 --
 * un sir care nu exista nicaieri pe web. Un aparat se cauta pe cuvinte, si se
 * cauta schema sau manualul de service, nu fisa tehnica.
 *
 * Regula: daca exista cel putin doua cuvinte si unul e pur alfabetic si
 * suficient de lung ("Logitech", "amplificator"), e nume de aparat. Codurile
 * de piese sunt un singur token, sau tokeni care amesteca litere si cifre
 * (`K155 LA3`), deci raman tratate ca part number.
 */
function detectQueryType(raw: string): QueryType {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return 'part'
  return tokens.some((t) => /^[a-zA-Z]{4,}$/.test(t)) ? 'device' : 'part'
}

/** Curata o interogare pe aparat pastrand cuvintele separate. */
function normalizeDevice(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/["']/g, '')
}

/**
 * Punctul de intrare: transforma inputul brut intr-un plan de cautare.
 * `variants` e ordonat descrescator dupa specificitate -- primele sunt cele mai
 * exacte, ultimele cele mai generale (deci mai probabil de gasit, dar mai vagi).
 */
export function analyzePart(raw: string): PartAnalysis {
  if (detectQueryType(raw) === 'device') {
    const phrase = normalizeDevice(raw)
    const terms = phrase.split(' ').filter((t) => t.length >= 2)
    return {
      queryType: 'device',
      terms,
      raw,
      normalized: phrase,
      root: phrase,
      variants: [phrase],
      likelyManufacturers: [],
      equivalents: []
    }
  }

  const normalized = normalizePart(raw)
  const variants: string[] = []
  const push = (v: string) => {
    const t = v.trim()
    if (t.length >= 3 && !variants.includes(t)) variants.push(t)
  }

  push(normalized)

  let root = normalized
  let matchedFamily = false
  for (const [re, expand] of FAMILY_ROOTS) {
    const m = normalized.match(re)
    if (!m) continue
    const roots = expand(m).filter(Boolean)
    for (const r of roots) push(r)
    if (roots.length) root = roots[roots.length - 1]
    matchedFamily = true
    break
  }

  if (!matchedFamily) {
    const stripped = stripTrailingSuffixLetters(normalized)
    for (const s of stripped) push(s)
    if (stripped.length) root = stripped[stripped.length - 1]
  }

  // Echivalentele se calculeaza si pentru forma completa, si pentru radacina:
  // K155LA3 se potriveste pe regula de familie, CDB400E doar dupa ce taie 'E'.
  const equivalents = new Set<string>()
  const seedsForEquivalents = [normalized, ...variants.slice(1, 4)]
  for (const seed of seedsForEquivalents) {
    for (const eq of findEquivalents(seed).parts) equivalents.add(eq)
  }

  return {
    queryType: 'part',
    terms: [normalized],
    raw,
    normalized,
    root,
    variants,
    likelyManufacturers: detectManufacturers(normalized),
    equivalents: [...equivalents]
  }
}

export interface MatchDetail {
  /** 0..1, cat de bine se potriveste rezultatul cu piesa cautata. */
  score: number
  via: 'exact' | 'variant' | 'equivalent' | 'none'
  /** Termenul care a produs potrivirea, pentru explicatia din interfata. */
  term?: string
}

/**
 * Cat de bine se potriveste un titlu/URL de rezultat cu piesa cautata.
 *
 * Potrivirea prin echivalenta e punctata generos intentionat: pentru piesele
 * greu de gasit, datasheet-ul echivalentului occidental *este* raspunsul.
 * Nimeni nu publica fisa tehnica a lui CDB400E, dar cea a lui SN7400 descrie
 * exact acelasi cip.
 */
export function matchDetail(analysis: PartAnalysis, text: string): MatchDetail {
  if (analysis.queryType === 'device') return matchDevice(analysis, text)

  const hay = normalizePart(text)
  if (!hay) return { score: 0, via: 'none' }

  if (hay.includes(analysis.normalized)) {
    return { score: 1, via: 'exact', term: analysis.normalized }
  }

  for (let i = 0; i < analysis.variants.length; i++) {
    if (hay.includes(analysis.variants[i])) {
      // variantele mai generale primesc scor mai mic
      return { score: Math.max(0.45, 0.95 - i * 0.12), via: 'variant', term: analysis.variants[i] }
    }
  }

  for (const eq of analysis.equivalents) {
    if (hay.includes(normalizePart(eq))) return { score: 0.6, via: 'equivalent', term: eq }
  }

  return { score: 0, via: 'none' }
}

/**
 * Potrivire pentru interogari pe aparat: cat de multe dintre cuvintele cerute
 * apar in titlu sau in URL.
 *
 * Modelul e altul decat la piese. "Logitech Z5500" nu apare niciodata ca sir
 * continuu intr-un URL -- apare ca `logitech-z-5500-service-manual.pdf` sau ca
 * "Logitech Z-5500 Service Manual" in titlu. Deci compar pe cuvinte, iar
 * modelul (tokenul cu cifre) cantareste mai mult decat marca: sunt sute de
 * scheme Logitech, dar una singura de Z5500.
 */
function matchDevice(analysis: PartAnalysis, text: string): MatchDetail {
  // scot separatoarele ca `z-5500` sa se potriveasca cu `z5500`
  const hay = text.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!hay) return { score: 0, via: 'none' }

  let weightTotal = 0
  let weightFound = 0
  const missing: string[] = []

  for (const term of analysis.terms) {
    const needle = term.toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (!needle) continue
    // tokenii cu cifre sunt numere de model: identifica aparatul mult mai precis
    const weight = /\d/.test(needle) ? 2.5 : 1
    weightTotal += weight
    if (hay.includes(needle)) weightFound += weight
    else missing.push(term)
  }

  if (!weightTotal) return { score: 0, via: 'none' }
  const ratio = weightFound / weightTotal

  // sub jumatate din greutate inseamna ca s-a nimerit doar marca
  if (ratio < 0.5) return { score: 0, via: 'none' }
  return {
    score: ratio === 1 ? 1 : 0.45 + ratio * 0.4,
    via: ratio === 1 ? 'exact' : 'variant',
    term: missing.length ? `lipseste: ${missing.join(', ')}` : analysis.normalized
  }
}
