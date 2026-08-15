import { createHash } from 'node:crypto'
import type { Confidence, DocKind, PartAnalysis } from '../shared/types'
import { hasCyrillic, transliterateCyrillic } from './equivalents'
import { normalizePart } from './partnumber'

/**
 * Verificarea documentelor descarcate.
 *
 * Agregatoarele returneaza frecvent pagini de eroare, redirectari sau HTML de
 * captcha cu Content-Type mincinos. Fara pasul asta, libraria s-ar umple de
 * fisiere de 4 KB numite "LM358.pdf" care nu contin nimic. Regula e simpla:
 * un document intra in librarie doar daca il pot deschide si citi.
 */

/** Semnatura %PDF- trebuie sa apara in primii octeti ai fisierului. */
export function looksLikePdf(buf: Uint8Array): boolean {
  if (buf.length < 5) return false
  const head = Buffer.from(buf.subarray(0, 1024)).toString('latin1')
  return head.includes('%PDF-')
}

export function sha256Of(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

export interface VerifyResult {
  confidence: Confidence
  /** Motivul deciziei, afisat in UI cand un rezultat e respins. */
  reason: string
  pageCount?: number
  /** Part number-urile gasite efectiv in text. */
  aliases: string[]
  manufacturer?: string
  kind: DocKind
  textSnippet?: string
  title?: string
}

/** Producatori recunoscuti dupa cum isi semneaza documentele. */
const MANUFACTURER_SIGNATURES: Array<[RegExp, string]> = [
  [/texas\s+instruments|\bti\.com\b/i, 'Texas Instruments'],
  [/stmicroelectronics|\bst\.com\b/i, 'STMicroelectronics'],
  [/\bnxp\b|philips\s+semiconductors/i, 'NXP / Philips'],
  [/microchip\s+technology|\batmel\b/i, 'Microchip / Atmel'],
  [/analog\s+devices|linear\s+technology|maxim\s+integrated/i, 'Analog Devices'],
  [/infineon|international\s+rectifier|\bcypress\b/i, 'Infineon / Cypress'],
  [/\bon\s*semiconductor\b|\bonsemi\b|fairchild|motorola/i, 'onsemi'],
  [/renesas|intersil|\bnec\s+electronics\b/i, 'Renesas / Intersil'],
  [/toshiba/i, 'Toshiba'],
  [/vishay|siliconix/i, 'Vishay'],
  [/nexperia/i, 'Nexperia'],
  [/rohm\s+semiconductor|\brohm\b/i, 'Rohm'],
  [/diodes\s+incorporated|zetex/i, 'Diodes Inc.'],
  [/espressif/i, 'Espressif'],
  [/nordic\s+semiconductor/i, 'Nordic Semiconductor'],
  [/silicon\s+lab/i, 'Silicon Labs'],
  [/\bjrc\b|new\s+japan\s+radio|nisshinbo/i, 'JRC / Nisshinbo'],
  [/holtek/i, 'Holtek'],
  [/microelectronica\s+bucure|i\.?p\.?r\.?s\.?\s+b[aă]neasa/i, 'Microelectronica Bucuresti'],
  [/\btesla\b.*(?:rozn|elektronick)/i, 'Tesla (CS)']
]

/**
 * Semnale de clasificare, cu pondere.
 *
 * Prima versiune lua prima potrivire si gresea sistematic: datasheet-ul LM358
 * de la TI mentioneaza "reference design" in lista de documente inrudite, deci
 * era clasificat ca reference design. Acum fiecare tip aduna puncte si castiga
 * cel cu scorul cel mai mare, ceea ce face mentiunile incidentale inofensive.
 */
const KIND_SIGNALS: Array<{ re: RegExp; kind: DocKind; weight: number }> = [
  // datasheet: sectiunile obligatorii ale unei fise tehnice
  { re: /absolute\s+maximum\s+ratings/gi, kind: 'datasheet', weight: 4 },
  { re: /electrical\s+characteristics/gi, kind: 'datasheet', weight: 3 },
  { re: /recommended\s+operating\s+conditions/gi, kind: 'datasheet', weight: 3 },
  { re: /\bdata\s?sheet\b/gi, kind: 'datasheet', weight: 2 },
  { re: /ordering\s+information|pin\s+configuration|package\s+outline/gi, kind: 'datasheet', weight: 2 },
  { re: /product\s+specification|technical\s+data/gi, kind: 'datasheet', weight: 2 },

  { re: /silicon\s+errata|device\s+errata/gi, kind: 'errata', weight: 6 },
  { re: /\berrata\b/gi, kind: 'errata', weight: 3 },

  { re: /service\s+manual/gi, kind: 'schematic', weight: 5 },
  { re: /schematic\s+diagram|circuit\s+diagram/gi, kind: 'schematic', weight: 4 },
  { re: /wiring\s+diagram|schema\s+electric/gi, kind: 'schematic', weight: 3 },

  { re: /application\s+note/gi, kind: 'appnote', weight: 5 },
  { re: /\bapp\s+note\b|design\s+guide/gi, kind: 'appnote', weight: 2 },

  { re: /reference\s+design/gi, kind: 'reference-design', weight: 3 },
  { re: /evaluation\s+(?:board|module)|\beval\s*board\b/gi, kind: 'reference-design', weight: 2 },

  { re: /reference\s+manual|hardware\s+manual/gi, kind: 'manual', weight: 5 },
  { re: /user'?s?\s+(?:manual|guide)|owner'?s\s+manual|instruction\s+manual/gi, kind: 'manual', weight: 3 }
]

function detectManufacturer(text: string): string | undefined {
  for (const [re, name] of MANUFACTURER_SIGNATURES) {
    if (re.test(text)) return name
  }
  return undefined
}

/**
 * Deduce tipul insumand punctele fiecarui semnal gasit.
 * Aparitiile repetate conteaza, dar plafonat: un cuvant repetat de 50 de ori
 * nu trebuie sa doboare toate celelalte indicii.
 */
export function classifyKind(text: string, hints = ''): DocKind {
  // indiciile din titlu/URL se aplica de doua ori: sunt mai intentionate decat corpul
  const hay = `${hints}\n${hints}\n${text}`
  const scores = new Map<DocKind, number>()

  for (const { re, kind, weight } of KIND_SIGNALS) {
    const matches = hay.match(re)
    if (!matches) continue
    scores.set(kind, (scores.get(kind) ?? 0) + weight * Math.min(matches.length, 3))
  }

  let best: DocKind = 'unknown'
  let bestScore = 0
  for (const [kind, score] of scores) {
    if (score > bestScore) {
      best = kind
      bestScore = score
    }
  }
  return bestScore >= 3 ? best : 'unknown'
}

/**
 * Extrage part number-uri plauzibile din text: siruri alfanumerice care
 * amesteca litere si cifre, de lungime rezonabila.
 */
function extractCandidateParts(text: string): Set<string> {
  const out = new Set<string>()
  const scan = (source: string): void => {
    const re = /\b[A-Z]{1,6}[0-9]{2,6}[A-Z0-9-]{0,8}\b/g
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) {
      out.add(normalizePart(m[0]))
      if (out.size > 4000) return
    }
  }

  scan(text.toUpperCase())
  // Fisele pieselor sovietice sunt scrise cu chirilice: in PDF scrie К155ЛА3,
  // nu K155LA3. Fara transliterare n-as confirma niciodata piesa cautata.
  if (hasCyrillic(text)) scan(transliterateCyrillic(text))
  return out
}

/** Prima linie non-goala si suficient de lunga din PDF, ca titlu de rezerva. */
function guessTitle(text: string): string | undefined {
  for (const line of text.split(/\r?\n/).slice(0, 40)) {
    const t = line.trim()
    if (t.length >= 8 && t.length <= 120 && /[a-zA-Z]/.test(t)) return t
  }
  return undefined
}

/**
 * Verifica un buffer descarcat.
 * `hints` primeste titlul si URL-ul, ca ajutor la clasificare cand PDF-ul e scanat.
 */
export async function verifyDocument(
  buf: Uint8Array,
  analysis: PartAnalysis,
  hints = ''
): Promise<VerifyResult> {
  if (!looksLikePdf(buf)) {
    // HTML servit ca PDF -- cazul clasic de captcha sau pagina de eroare
    const head = Buffer.from(buf.subarray(0, 512)).toString('latin1').toLowerCase()
    const isHtml = head.includes('<html') || head.includes('<!doctype')
    return {
      confidence: 'rejected',
      reason: isHtml ? 'serverul a trimis o pagina HTML, nu un PDF' : 'fisierul nu e PDF valid',
      aliases: [],
      kind: 'unknown'
    }
  }

  if (buf.length < 8 * 1024) {
    return {
      confidence: 'rejected',
      reason: `PDF prea mic (${Math.round(buf.length / 1024)} KB) -- probabil pagina de eroare`,
      aliases: [],
      kind: 'unknown'
    }
  }

  let text = ''
  let pageCount: number | undefined

  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    // copiez bufferul: pdf.js consuma (detaseaza) array-ul primit
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    pageCount = pdf.numPages
    const extracted = await extractText(pdf, { mergePages: true })
    text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
  } catch (err) {
    // PDF-urile scanate vechi n-au strat de text; nu e motiv de respingere
    return {
      confidence: 'possible',
      reason: `nu am putut extrage text (${err instanceof Error ? err.message : 'eroare'}) -- posibil PDF scanat`,
      pageCount,
      aliases: [],
      kind: classifyKind('', hints),
      title: undefined
    }
  }

  const kind = classifyKind(text, hints)
  const manufacturer = detectManufacturer(text) ?? detectManufacturer(hints)
  const textSnippet = text.replace(/\s+/g, ' ').trim().slice(0, 2000)

  if (text.trim().length < 200) {
    // Un scan legitim de databook are zeci de pagini si megaocteti. O pagina de
    // 44 KB fara text nu e un datasheet, e un fluturas care s-a nimerit sa aiba
    // part number-ul in numele fisierului.
    if ((pageCount ?? 1) <= 2 && buf.length < 150 * 1024) {
      return {
        confidence: 'rejected',
        reason: `o singura pagina, fara text, ${Math.round(buf.length / 1024)} KB -- nu e un document tehnic`,
        pageCount,
        aliases: [],
        kind: 'unknown'
      }
    }
    return {
      confidence: 'possible',
      reason: 'PDF fara strat de text (scanat) -- nu pot confirma automat continutul',
      pageCount,
      aliases: [],
      manufacturer,
      kind,
      textSnippet
    }
  }

  const found = extractCandidateParts(text)
  const aliases: string[] = []

  // potrivire exacta pe ce a cerut utilizatorul
  if (found.has(analysis.normalized)) aliases.push(analysis.normalized)

  // potrivire pe variante (radacina, familie)
  let bestVariantIndex = -1
  for (let i = 0; i < analysis.variants.length; i++) {
    const v = analysis.variants[i]
    if (found.has(v)) {
      aliases.push(v)
      if (bestVariantIndex < 0) bestVariantIndex = i
    }
  }

  // potrivire pe echivalente
  const matchedEquivalents = analysis.equivalents.filter((e) => found.has(normalizePart(e)))
  aliases.push(...matchedEquivalents)

  const uniqueAliases = [...new Set(aliases)]
  const title = guessTitle(text)

  if (found.has(analysis.normalized) || bestVariantIndex === 0) {
    return {
      confidence: 'verified',
      reason: `part number-ul ${analysis.normalized} apare in document`,
      pageCount,
      aliases: uniqueAliases,
      manufacturer,
      kind,
      textSnippet,
      title
    }
  }

  if (bestVariantIndex > 0) {
    return {
      confidence: 'likely',
      reason: `documentul acopera ${analysis.variants[bestVariantIndex]}, familia piesei cautate`,
      pageCount,
      aliases: uniqueAliases,
      manufacturer,
      kind,
      textSnippet,
      title
    }
  }

  if (matchedEquivalents.length) {
    return {
      confidence: 'likely',
      reason: `documentul e pentru ${matchedEquivalents[0]}, echivalentul piesei cautate`,
      pageCount,
      aliases: uniqueAliases,
      manufacturer,
      kind,
      textSnippet,
      title
    }
  }

  return {
    confidence: 'possible',
    reason: 'nu am gasit part number-ul in text -- verifica manual',
    pageCount,
    aliases: uniqueAliases,
    manufacturer,
    kind,
    textSnippet,
    title
  }
}
