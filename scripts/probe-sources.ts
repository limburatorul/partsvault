import { httpFetch, probeUrl } from '../src/main/http'
import { extractLinks } from '../src/main/search/scrape'

/**
 * Verificare de sanatate a surselor.
 *
 * Sursele de datasheet-uri se strica in timp: domenii care expira, Cloudflare
 * care se strange, tipare de URL care se schimba. Cand cautarea incepe sa dea
 * gres, asta e primul lucru de rulat -- arata exact ce a cazut, ca sa nu cauti
 * bug-ul in cod cand de fapt a murit un site.
 *
 *   node scripts/run.mjs probe-sources
 */

type Status = 'OK' | 'BLOCAT' | 'MORT' | 'GOL'

function report(name: string, status: Status, detail = ''): void {
  const mark = status === 'OK' ? '  ok  ' : status === 'GOL' ? ' gol  ' : ' PICA '
  console.log(`[${mark}] ${name.padEnd(28)} ${status.padEnd(7)} ${detail}`)
}

/** Tipare directe de la producatori -- cea mai valoroasa categorie: fara rate limit. */
const DIRECT_CASES: Array<[string, string]> = [
  ['TI (lit/gpn)', 'https://www.ti.com/lit/gpn/lm324'],
  ['ST (resource)', 'https://www.st.com/resource/en/datasheet/tda2030.pdf'],
  ['onsemi', 'https://www.onsemi.com/pdf/datasheet/mc34063a-d.pdf'],
  ['Analog Devices', 'https://www.analog.com/media/en/technical-documentation/data-sheets/AD620.pdf'],
  ['Nexperia', 'https://assets.nexperia.com/documents/data-sheet/74HC_HCT00.pdf'],
  ['Diodes Inc.', 'https://www.diodes.com/assets/Datasheets/AP2112.pdf'],
  ['Espressif', 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf']
]

async function checkDirect(): Promise<void> {
  console.log('\n--- tipare directe de la producatori ---')
  for (const [name, url] of DIRECT_CASES) {
    const r = await probeUrl(url, { referer: 'https://www.google.com/' })
    if (r.ok && r.contentType.includes('pdf')) {
      report(name, 'OK', r.sizeBytes ? `${Math.round(r.sizeBytes / 1024)} KB` : '')
    } else {
      report(name, r.ok ? 'GOL' : 'MORT', r.contentType || 'inaccesibil')
    }
  }
}

async function checkEngines(): Promise<void> {
  console.log('\n--- motoare de cautare ---')
  const query = '"LM358" datasheet filetype:pdf'

  const bing = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=20`
  try {
    const res = await httpFetch(bing, { timeoutMs: 20_000, retries: 0 })
    const xml = await res.text()
    const items = (xml.match(/<item>/g) ?? []).length
    const relevant = /LM358/i.test(xml)
    report('Bing (RSS)', items && relevant ? 'OK' : 'GOL', `${items} rezultate, relevante=${relevant}`)
  } catch (err) {
    report('Bing (RSS)', 'MORT', err instanceof Error ? err.message : '')
  }

  const ddg = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  try {
    const res = await httpFetch(ddg, { timeoutMs: 20_000, retries: 0 })
    const html = await res.text()
    const blocked = res.status === 202 || /anomaly|unusual traffic/i.test(html)
    const hits = (html.match(/result__a/g) ?? []).length
    report('DuckDuckGo (HTML)', blocked ? 'BLOCAT' : hits ? 'OK' : 'GOL', blocked ? 'rate limit' : `${hits} rezultate`)
  } catch (err) {
    report('DuckDuckGo (HTML)', 'MORT', err instanceof Error ? err.message : '')
  }
}

async function checkAggregators(): Promise<void> {
  console.log('\n--- agregatoare ---')
  const cases: Array<[string, string, RegExp]> = [
    ['Datasheet4U', 'https://www.datasheet4u.com/search.php?sWord=LM358', /datasheet4u\.com\/datasheets\//i],
    ['The Datasheet Archive', 'https://www.datasheetarchive.com/LM358-datasheet.html', /LM358/i]
  ]

  for (const [name, url, marker] of cases) {
    try {
      const res = await httpFetch(url, { timeoutMs: 25_000, retries: 0 })
      if (!res.ok) {
        report(name, res.status === 403 ? 'BLOCAT' : 'MORT', `HTTP ${res.status}`)
        continue
      }
      const body = await res.text()
      const links = extractLinks(body, url).filter((l) => marker.test(l.href))
      report(name, links.length ? 'OK' : 'GOL', `${links.length} link-uri utile`)
    } catch (err) {
      report(name, 'MORT', err instanceof Error ? err.message : '')
    }
  }
}

async function checkArchives(): Promise<void> {
  console.log('\n--- arhive ---')
  try {
    const url =
      'https://archive.org/advancedsearch.php?q=' +
      encodeURIComponent('"LM358" AND mediatype:texts') +
      '&fl%5B%5D=identifier&rows=3&output=json'
    const res = await httpFetch(url, { timeoutMs: 30_000, retries: 1 })
    const body = await res.text()
    const found = (body.match(/"identifier"/g) ?? []).length
    report('Internet Archive (API)', found ? 'OK' : 'GOL', `${found} itemi`)
  } catch (err) {
    report('Internet Archive (API)', 'MORT', err instanceof Error ? err.message : '')
  }
}

async function main(): Promise<void> {
  console.log('Verific ce surse mai raspund...')
  await checkDirect()
  await checkEngines()
  await checkAggregators()
  await checkArchives()
  console.log('\nSursele marcate PICA trebuie scoase sau reparate in src/main/search/sources/.')
}

main().catch(console.error)
