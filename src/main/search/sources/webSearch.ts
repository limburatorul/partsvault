import * as cheerio from 'cheerio'
import { renderHtml } from '../../browser'
import { httpFetch } from '../../http'
import { cleanTitle, dedupeByUrl, squash, unwrapDuckDuckGo } from '../scrape'
import type { RawHit, Source, SourceContext } from '../types'

/**
 * Cautare web cu operatorul filetype:pdf.
 *
 * Motoarele fara cheie de API nu suporta rafale. Masurat pe viu:
 *  - DuckDuckGo intoarce o pagina de "anomaly" dupa cateva interogari;
 *  - Bing (format=rss) e si mai perfid -- continua sa raspunda 200 cu zece
 *    rezultate, dar complet nerelevante (linii aeriene, forumuri de mail).
 *
 * De aici doua decizii: rotesc intre motoare ca fiecare sa primeasca putine
 * interogari, si validez ca rezultatele chiar au legatura cu piesa. Un motor
 * care intoarce gunoi e marcat epuizat si nu mai e folosit in rularea curenta.
 */

/** Producator detectat din prefix -> domeniul pe care sa restrang cautarea. */
const VENDOR_DOMAINS: Record<string, string[]> = {
  'Texas Instruments': ['ti.com'],
  STMicroelectronics: ['st.com'],
  'NXP / Philips': ['nxp.com'],
  'Microchip / Atmel': ['microchip.com', 'ww1.microchip.com'],
  'Analog Devices': ['analog.com'],
  'Infineon / Cypress': ['infineon.com'],
  onsemi: ['onsemi.com'],
  'Renesas / Intersil': ['renesas.com'],
  Toshiba: ['toshiba.semicon-storage.com'],
  Vishay: ['vishay.com'],
  'Diodes Inc.': ['diodes.com'],
  Nexperia: ['nexperia.com', 'assets.nexperia.com'],
  Rohm: ['rohm.com', 'fscdn.rohm.com'],
  'JRC / Nisshinbo': ['njr.com'],
  'Silicon Labs': ['silabs.com'],
  Espressif: ['espressif.com'],
  'Nordic Semiconductor': ['nordicsemi.com'],
  'Bosch Sensortec': ['bosch-sensortec.com'],
  Sensirion: ['sensirion.com'],
  Melexis: ['melexis.com'],
  Allegro: ['allegromicro.com'],
  Holtek: ['holtek.com'],
  'Cirrus Logic / Wolfson': ['cirrus.com'],
  Winbond: ['winbond.com']
}

interface EngineResult {
  url: string
  title: string
}

interface Engine {
  id: string
  /**
   * `accept` spune daca un set de rezultate pare relevant. Motoarele cu mai
   * multe endpointuri il folosesc ca sa sara peste instantele degradate.
   */
  run(
    query: string,
    signal: AbortSignal,
    accept?: (results: EngineResult[]) => boolean
  ): Promise<EngineResult[]>
}

/**
 * DuckDuckGo randat intr-un Chromium adevarat.
 *
 * Acelasi motor care prin `fetch()` ne servea pagini de "anomaly", cerut printr-un
 * browser complet, intoarce rezultatele intregi. Diferenta nu e cosmetica:
 * pentru "Logitech Z5500 service manual", fetch dadea zero, iar randarea a adus
 * Elektrotanya, ManualsLib si Scribd -- adica exact ce gaseste omul manual.
 *
 * De aceea e primul din rotatie, inaintea variantelor pe fetch.
 */
const duckduckgoRendered: Engine = {
  id: 'ddg-render',
  async run(query, signal) {
    const html = await renderHtml(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
      timeoutMs: 30_000,
      waitForSelector: '[data-testid="result"]',
      settleMs: 1200,
      signal
    })
    if (!html) return []

    const $ = cheerio.load(html)
    const out: EngineResult[] = []

    $('[data-testid="result"]').each((_, el) => {
      const anchor = $(el).find('a[data-testid="result-title-a"]').first()
      const href = anchor.attr('href')
      if (href && /^https?:\/\//.test(href)) {
        out.push({ url: href, title: anchor.text().replace(/\s+/g, ' ').trim() })
      }
    })

    // rezerva daca DDG isi schimba atributele de test
    if (!out.length) {
      $('a[href^="http"]').each((_, el) => {
        const href = $(el).attr('href') as string
        if (/duckduckgo\.com|microsoft|w3\.org/.test(href)) return
        const text = $(el).text().replace(/\s+/g, ' ').trim()
        if (text.length > 10) out.push({ url: href, title: text })
      })
    }

    return out.slice(0, 20)
  }
}

/**
 * SearXNG: meta-motor care agrega Google, Bing si altele.
 *
 * E cel mai bun dintre cele fara cheie de API, fiindca vede rezultatele Google
 * -- exact ce obtine omul cautand manual. Instantele publice blocheaza aproape
 * toate `format=json`, dar HTML-ul merge. Multe instante sunt insa ele insele
 * degradate, asa ca le incerc pe rand pana una raspunde relevant.
 */
const SEARXNG_INSTANCES = [
  'https://opnxng.com',
  'https://search.inetol.net',
  'https://searxng.site',
  'https://priv.au',
  'https://search.rhscz.eu'
]

const searxng: Engine = {
  id: 'searxng',
  async run(query, signal, accept) {
    let fallback: EngineResult[] = []

    for (const base of SEARXNG_INSTANCES) {
      if (signal.aborted) break
      try {
        const res = await httpFetch(`${base}/search?q=${encodeURIComponent(query)}`, {
          signal,
          timeoutMs: 20_000,
          retries: 0
        })
        if (!res.ok) continue

        const $ = cheerio.load(await res.text())
        const out: EngineResult[] = []
        $('article.result').each((_, el) => {
          const anchor = $(el).find('h3 a').first()
          const href = anchor.attr('href') ?? $(el).find('a.url_header').first().attr('href')
          if (href && /^https?:\/\//.test(href)) {
            out.push({ url: href, title: anchor.text().replace(/\s+/g, ' ').trim() })
          }
        })

        if (!out.length) continue
        // instanta buna: gata. Altfel pastrez ce am si mai incerc una.
        if (!accept || accept(out)) return out
        if (!fallback.length) fallback = out
      } catch {
        continue
      }
    }
    return fallback
  }
}

/** Bing prin fluxul RSS: raspuns mic si usor de parsat, fara HTML de randat. */
const bingRss: Engine = {
  id: 'bing',
  async run(query, signal) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=20`
    const res = await httpFetch(url, { signal, timeoutMs: 20_000, retries: 1 })
    if (!res.ok) return []
    const xml = await res.text()

    const out: EngineResult[] = []
    for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? ''
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1] ?? ''
      const clean = (s: string): string =>
        s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim()
      if (link) out.push({ url: clean(link), title: clean(title) })
    }
    return out
  }
}

/** DuckDuckGo prin endpointul HTML. Merge cateva interogari, apoi ne blocheaza. */
const duckduckgo: Engine = {
  id: 'ddg',
  async run(query, signal) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await httpFetch(url, { signal, timeoutMs: 20_000, retries: 0 })
    // 202 e semnalul lor de rate limit, nu un raspuns valid
    if (!res.ok || res.status === 202) return []
    const html = await res.text()
    if (/anomaly|unusual traffic/i.test(html)) return []

    const $ = cheerio.load(html)
    const out: EngineResult[] = []
    $('a.result__a, a.result-link').each((_, el) => {
      const href = $(el).attr('href')
      if (!href) return
      const real = unwrapDuckDuckGo(href)
      if (/^https?:\/\//.test(real) && !real.includes('duckduckgo.com')) {
        out.push({ url: real, title: $(el).text().trim() })
      }
    })
    return out
  }
}

// Randarea prima: e singura care s-a dovedit ca nu e servita degradat.
// Celelalte raman ca rezerva, fiindca sunt mult mai ieftine cand functioneaza.
const ENGINES: Engine[] = [duckduckgoRendered, searxng, bingRss, duckduckgo]

/**
 * Ruleaza o interogare pe primul motor care intoarce ceva relevant.
 * Expusa si pentru sursa de arhive, ca sa nu-si scrie propriul client de
 * cautare si sa consume din acelasi buget de interogari.
 */
export async function webQuery(
  query: string,
  relevanceTerms: string[],
  signal: AbortSignal,
  skip: Set<string> = new Set()
): Promise<EngineResult[]> {
  const accept = (results: EngineResult[]): boolean =>
    resultsAreRelevant(results, relevanceTerms)

  for (const engine of ENGINES) {
    if (skip.has(engine.id) || signal.aborted) continue
    let results: EngineResult[] = []
    try {
      results = await engine.run(query, signal, accept)
    } catch {
      continue
    }

    if (accept(results)) return results

    // Un raspuns gol nu dovedeste nimic: interogarea putea fi pur si simplu
    // prea ingusta (`filetype:pdf` pe un aparat obscur). Doar un raspuns plin
    // de rezultate nerelevante arata ca motorul ne serveste gunoi -- abia
    // atunci il scot din rotatie. Altfel o singura interogare stearpa ar arde
    // toate motoarele pentru tot restul cautarii.
    if (results.length) skip.add(engine.id)
  }
  return []
}

/**
 * Un motor a raspuns cu gunoi? Verific daca macar un rezultat mentioneaza
 * piesa, in titlu sau in URL. Cand un motor incepe sa serveasca rezultate
 * generice, niciunul nu trece testul.
 */
function resultsAreRelevant(results: EngineResult[], terms: string[]): boolean {
  if (!results.length) return false
  let needles = terms.map(squash).filter((t) => t.length >= 3)
  if (!needles.length) return true

  // Cand exista un token cu cifre (numar de model, cod de piesa), doar el
  // conteaza. Altfel motorul degradat trece testul servind pagina de start a
  // marcii: pentru "Logitech Z5500", zece link-uri catre logitech.com contin
  // "logitech" si ar parea rezultate valide.
  const distinctive = needles.filter((t) => /\d/.test(t))
  if (distinctive.length) needles = distinctive
  return results.some((r) => {
    let url = r.url
    try {
      url = decodeURIComponent(r.url)
    } catch {
      /* URL cu procente invalide: il compar asa cum e */
    }
    const hay = squash(`${r.title} ${url}`)
    return needles.some((t) => hay.includes(t))
  })
}

/**
 * Interogari pentru un aparat, nu pentru o piesa.
 *
 * Aici nu are rost fraza exacta si nici cuvantul "datasheet": pentru un
 * Logitech Z5500 se cauta schema si manualul de service. Termenii sunt lasati
 * neghilimetati fiindca sursele scriu modelul in zeci de feluri (Z5500,
 * Z-5500, Z 5500) si ghilimelele ar elimina exact rezultatele bune.
 */
function buildDeviceQueries(
  ctx: SourceContext
): Array<{ q: string; forQuery: string; boost: number }> {
  const phrase = ctx.analysis.normalized
  const out = [
    { q: `${phrase} service manual filetype:pdf`, forQuery: phrase, boost: 0.15 },
    { q: `${phrase} schematic diagram filetype:pdf`, forQuery: phrase, boost: 0.15 },
    { q: `${phrase} schematic OR schema service manual`, forQuery: phrase, boost: 0 }
  ]
  if (ctx.deep) {
    out.push(
      { q: `${phrase} amplifier board schematic filetype:pdf`, forQuery: phrase, boost: 0.05 },
      { q: `${phrase} repair manual filetype:pdf`, forQuery: phrase, boost: 0.05 }
    )
  }
  return out
}

/** Construieste setul de interogari, in ordinea descrescatoare a valorii. */
function buildQueries(ctx: SourceContext): Array<{ q: string; forQuery: string; boost: number }> {
  const { analysis, kinds, deep, useEquivalents } = ctx
  if (analysis.queryType === 'device') return buildDeviceQueries(ctx)

  const out: Array<{ q: string; forQuery: string; boost: number }> = []
  const primary = analysis.variants.slice(0, deep ? 2 : 1)

  const wantsSchematic = kinds.includes('schematic') || kinds.includes('manual')
  const wantsDatasheet = kinds.includes('datasheet') || kinds.length === 0

  for (const v of primary) {
    if (wantsDatasheet) out.push({ q: `"${v}" datasheet filetype:pdf`, forQuery: v, boost: 0.1 })
    if (wantsSchematic) {
      out.push({
        q: `"${v}" (schematic OR "service manual") filetype:pdf`,
        forQuery: v,
        boost: 0.05
      })
    }
    if (kinds.includes('appnote')) {
      out.push({ q: `"${v}" "application note" filetype:pdf`, forQuery: v, boost: 0.05 })
    }
  }

  // cautare restransa pe site-ul producatorului: putine rezultate, dar oficiale
  if (deep) {
    const domains = analysis.likelyManufacturers.flatMap((m) => VENDOR_DOMAINS[m] ?? [])
    for (const domain of [...new Set(domains)].slice(0, 2)) {
      out.push({
        q: `site:${domain} "${analysis.variants[0]}" filetype:pdf`,
        forQuery: analysis.variants[0],
        boost: 0.2
      })
    }
  }

  // echivalentele sunt plasa de siguranta, nu prima optiune
  if (useEquivalents) {
    for (const eq of analysis.equivalents.slice(0, deep ? 2 : 1)) {
      out.push({ q: `"${eq}" datasheet filetype:pdf`, forQuery: eq, boost: -0.1 })
    }
  }

  // bugetul total de interogari: peste atat, motoarele incep sa ne blocheze
  return out.slice(0, deep ? 7 : 3)
}

function guessManufacturerFromDomain(url: string): string | undefined {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
  for (const [name, domains] of Object.entries(VENDOR_DOMAINS)) {
    if (domains.some((d) => host === d || host.endsWith(`.${d}`))) return name
  }
  return undefined
}

export const webSearchSource: Source = {
  id: 'websearch',
  label: 'Cautare web (browser randat + rezerve)',
  tier: 'websearch',
  note: 'Cauta pe tot webul dintr-un Chromium real, ca sa nu primim rezultate degradate ca la scraping.',

  async search(ctx: SourceContext): Promise<RawHit[]> {
    // termenii fata de care validez relevanta raspunsului
    const terms =
      ctx.analysis.queryType === 'device'
        ? ctx.analysis.terms
        : [...ctx.analysis.variants, ...ctx.analysis.equivalents]
    const exhausted = new Set<string>()
    const hits: RawHit[] = []

    for (const { q, forQuery, boost } of buildQueries(ctx)) {
      if (ctx.signal.aborted) break
      // cand toate motoarele sunt arse nu mai are rost sa continui interogarile
      if (exhausted.size >= ENGINES.length) break

      for (const r of (await webQuery(q, terms, ctx.signal, exhausted)).slice(0, 10)) {
        hits.push({
          title: cleanTitle(r.title, forQuery),
          url: r.url,
          query: forQuery,
          confidenceBoost: boost,
          manufacturer: guessManufacturerFromDomain(r.url)
        })
      }
    }

    return dedupeByUrl(hits)
  }
}

export { VENDOR_DOMAINS }
