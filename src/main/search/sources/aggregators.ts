import { fetchHtml } from '../../http'
import { cleanTitle, dedupeByUrl, extractLinks, looksLikePdfUrl } from '../scrape'
import type { RawHit, Source, SourceContext } from '../types'

/**
 * Agregatoare de datasheet-uri -- sursa pentru piesele care nu mai au pagina la
 * producator: cipuri scoase din productie, clone asiatice, integrate din anii '80.
 *
 * Verificat pe viu care mai traiesc: AllDatasheet si AllTransistors dau 403
 * (Cloudflare), DatasheetsPDF si DatasheetCatalog nu mai rezolva DNS-ul. Au
 * ramas cele doua de mai jos, asa ca nu mai pastrez adaptoare pentru surse care
 * esueaza garantat.
 */

/**
 * Datasheet4U are o structura de URL determinista:
 *   pagina de detaliu  /datasheets/{PRODUCATOR}/{PIESA}/{ID}
 *   PDF-ul             /pdf/{ID}/{PIESA}.pdf
 * Deci pot construi link-ul de descarcare direct din rezultatele cautarii,
 * fara sa mai fac doua cereri intermediare.
 */
const datasheet4u: Source = {
  id: 'datasheet4u',
  label: 'Datasheet4U',
  tier: 'aggregator',
  note: 'Arhiva cu structura predictibila. Buna pentru piese comune de la producatori multipli.',
  slow: true,

  async search(ctx: SourceContext): Promise<RawHit[]> {
    // agregatoarele indexeaza piese, nu aparate: pentru "Logitech Z5500" n-au nimic
    if (ctx.analysis.queryType === 'device') return []
    const parts = ctx.analysis.variants.slice(0, ctx.deep ? 2 : 1)
    if (ctx.useEquivalents && ctx.deep) parts.push(...ctx.analysis.equivalents.slice(0, 1))

    const hits: RawHit[] = []
    for (const part of parts) {
      if (ctx.signal.aborted) break
      const searchUrl = `https://www.datasheet4u.com/search.php?sWord=${encodeURIComponent(part)}`
      const html = await fetchHtml(searchUrl, { signal: ctx.signal, timeoutMs: 25_000 })
      if (!html) continue

      for (const link of extractLinks(html, searchUrl)) {
        const m = link.href.match(/datasheet4u\.com\/datasheets\/([^/]+)\/([^/]+)\/(\d+)/i)
        if (!m) continue
        const [, manufacturer, partName, id] = m
        hits.push({
          title: cleanTitle(link.text, `${partName} - ${manufacturer}`),
          url: `https://www.datasheet4u.com/pdf/${id}/${partName}.pdf`,
          pageUrl: link.href,
          query: part,
          kind: 'datasheet',
          manufacturer: manufacturer.replace(/-/g, ' '),
          confidenceBoost: 0
        })
      }
    }
    return dedupeByUrl(hits).slice(0, 12)
  }
}

/**
 * The Datasheet Archive: specializat pe componente obsolete. Nu are structura
 * predictibila, asa ca merg pe culegere generica de link-uri -- iau tot ce arata
 * a PDF si mentioneaza piesa, si las verificarea sa filtreze restul.
 */
const datasheetArchive: Source = {
  id: 'datasheetarchive',
  label: 'The Datasheet Archive',
  tier: 'aggregator',
  note: 'Specializat pe componente obsolete. Prima oprire pentru integrate din anii 70-90.',
  slow: true,

  async search(ctx: SourceContext): Promise<RawHit[]> {
    if (ctx.analysis.queryType === 'device') return []
    const parts = ctx.analysis.variants.slice(0, ctx.deep ? 2 : 1)
    const hits: RawHit[] = []

    for (const part of parts) {
      if (ctx.signal.aborted) break
      const partUpper = part.toUpperCase()
      const searchUrl = `https://www.datasheetarchive.com/${encodeURIComponent(part)}-datasheet.html`
      const html = await fetchHtml(searchUrl, { signal: ctx.signal, timeoutMs: 25_000 })
      if (!html) continue

      const links = extractLinks(html, searchUrl)
      const detailPages: string[] = []

      for (const link of links) {
        if (/\.pdf(\?|$)/i.test(link.href)) {
          hits.push({
            title: cleanTitle(link.text, `${part} datasheet`),
            url: link.href,
            pageUrl: searchUrl,
            query: part,
            kind: 'datasheet',
            confidenceBoost: 0
          })
        } else if (
          /datasheetarchive\.com\/(?:pdf|datasheet|download)/i.test(link.href) &&
          link.href.toUpperCase().includes(partUpper)
        ) {
          detailPages.push(link.href)
        }
      }

      // urmaresc paginile de detaliu doar daca n-am gasit deja PDF-uri directe
      if (!hits.length) {
        for (const page of [...new Set(detailPages)].slice(0, ctx.deep ? 3 : 1)) {
          if (ctx.signal.aborted) break
          const detailHtml = await fetchHtml(page, { signal: ctx.signal, referer: searchUrl })
          if (!detailHtml) continue
          for (const link of extractLinks(detailHtml, page)) {
            if (!looksLikePdfUrl(link.href)) continue
            hits.push({
              title: cleanTitle(link.text, `${part} datasheet`),
              url: link.href,
              pageUrl: page,
              query: part,
              kind: 'datasheet',
              confidenceBoost: 0
            })
          }
        }
      }
    }

    return dedupeByUrl(hits).slice(0, 12)
  }
}

export const aggregatorSources: Source[] = [datasheet4u, datasheetArchive]
