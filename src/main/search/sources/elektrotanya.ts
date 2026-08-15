import * as cheerio from 'cheerio'
import { fetchHtml } from '../../http'
import { cleanTitle, dedupeByUrl, squash } from '../scrape'
import type { RawHit, Source, SourceContext } from '../types'

/**
 * Elektrotanya -- cea mai buna arhiva de scheme si manuale de service pentru
 * aparate electronice de larg consum.
 *
 * Interogata prin motorul ei intern (`/showresult?what=`), descoperit citind
 * formularul de cautare de pe pagina principala. Aceeasi lectie ca la piese:
 * cautarea nativa pe site bate un motor de cautare care ne limiteaza. Bing ne
 * servea aceleasi zece pagini de pe logitech.com pentru orice interogare,
 * inclusiv pentru `site:elektrotanya.com`.
 *
 * Descarcarea trece printr-o pagina de asteptare, care e mecanismul lor de
 * monetizare. Nu il ocolesc: intorc rezultatele marcate `gated`, iar aplicatia
 * deschide pagina in browser ca omul sa descarce de acolo.
 */

/** Sufixele din numele fisierului spun ce fel de document e. */
function kindFromFileName(fileName: string): RawHit['kind'] {
  if (/_sch(?:_|\.|$)/i.test(fileName)) return 'schematic'
  if (/_sm(?:_|\.|$)|service/i.test(fileName)) return 'manual'
  if (/_um(?:_|\.|$)|user/i.test(fileName)) return 'manual'
  return 'schematic'
}

export const elektrotanyaSource: Source = {
  id: 'elektrotanya',
  label: 'Elektrotanya (scheme si manuale service)',
  tier: 'archive',
  note:
    'Arhiva de scheme si manuale de service pentru aparate. Descarcarea se face din browser, pe pagina lor.',
  slow: true,

  async search(ctx: SourceContext): Promise<RawHit[]> {
    const { analysis, signal } = ctx
    // arhiva e despre aparate; pentru un cod de integrat nu are ce sa ofere
    if (analysis.queryType !== 'device') return []

    const phrase = analysis.normalized
    const url = `https://elektrotanya.com/showresult?what=${encodeURIComponent(phrase).replace(/%20/g, '+')}`
    const html = await fetchHtml(url, { signal, timeoutMs: 25_000, referer: 'https://elektrotanya.com/' })
    if (!html) return []

    // tokenul cu cifre e numarul de model: fara el, rezultatul e doar "acelasi brand"
    const model = squash(analysis.terms.find((t) => /\d/.test(t)) ?? phrase)

    const $ = cheerio.load(html)
    const hits: RawHit[] = []

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')
      if (!href) return
      // rezultatele arata ca /logitech_z-5500_sch.pdf/download.html
      const m = href.match(/\/([^/]+\.pdf)\/download\.html/i)
      if (!m) return

      const fileName = m[1]
      const text = $(el).text().replace(/\s+/g, ' ').trim()
      if (model && !squash(`${fileName} ${text}`).includes(model)) return

      hits.push({
        title: cleanTitle(text, fileName.replace(/\.pdf$/i, '')),
        url: href.startsWith('http') ? href : `https://elektrotanya.com${href}`,
        pageUrl: url,
        query: phrase,
        kind: kindFromFileName(fileName),
        gated: true,
        // e exact tipul de document cautat, chiar daca nu il pot descarca singur
        confidenceBoost: 0.3
      })
    })

    return dedupeByUrl(hits).slice(0, 12)
  }
}
