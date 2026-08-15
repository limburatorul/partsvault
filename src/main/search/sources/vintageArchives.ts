import { cleanTitle, dedupeByUrl } from '../scrape'
import type { RawHit, Source, SourceContext } from '../types'
import { webQuery } from './webSearch'

/**
 * Arhive specializate, interogate prin cautare restransa la domeniu.
 *
 * Site-urile astea nu au API si au motoare de cautare interne slabe, dar sunt
 * bine indexate de motoarele mari. Asa ca le caut din exterior cu `site:`.
 * Fiecare acopera o nisa pe care sursele comerciale nu o ating deloc.
 *
 * Interogarile sunt scumpe (fiecare consuma din bugetul inainte de rate limit),
 * asa ca ating putine domenii si doar in cautare profunda.
 */

interface ArchiveDomain {
  domain: string
  label: string
  kind: RawHit['kind']
}

/** Arhive de piese: databook-uri si fise tehnice. */
const PART_DOMAINS: ArchiveDomain[] = [
  { domain: 'bitsavers.org', label: 'Bitsavers', kind: 'manual' },
  { domain: 'frank.pocnet.net', label: 'Frank’s Electron Tube Data', kind: 'datasheet' },
  { domain: 'worldradiohistory.com', label: 'World Radio History', kind: 'manual' },
  { domain: 'elektrotanya.com', label: 'Elektrotanya', kind: 'schematic' }
]

/**
 * Arhive de aparate: manuale de service si scheme. Pentru un boxe Logitech sau
 * un amplificator Pioneer astea sunt sursele care conteaza -- Bitsavers, care
 * are calculatoare DEC, nu ajuta cu nimic.
 */
const DEVICE_DOMAINS: ArchiveDomain[] = [
  { domain: 'elektrotanya.com', label: 'Elektrotanya', kind: 'schematic' },
  { domain: 'manualslib.com', label: 'ManualsLib', kind: 'manual' },
  { domain: 'manualsnet.com', label: 'ManualsNet', kind: 'manual' },
  { domain: 'worldradiohistory.com', label: 'World Radio History', kind: 'manual' }
]

export const vintageArchivesSource: Source = {
  id: 'vintage',
  label: 'Arhive vintage si obscure',
  tier: 'archive',
  note:
    'Bitsavers, World Radio History, Frank’s Tube Data, Elektrotanya. Pentru piese si aparate scoase din productie.',
  slow: true,

  async search(ctx: SourceContext): Promise<RawHit[]> {
    const { analysis, signal, deep } = ctx
    if (!deep) return []

    const isDevice = analysis.queryType === 'device'
    const part = analysis.variants[0]
    const terms = isDevice ? analysis.terms : [analysis.normalized]
    const domains = isDevice ? DEVICE_DOMAINS : PART_DOMAINS
    // motoarele arse raman arse pentru toate domeniile din rularea asta
    const exhausted = new Set<string>()
    const hits: RawHit[] = []

    for (const { domain, label, kind } of domains) {
      if (signal.aborted || exhausted.size >= 2) break
      // numele de aparat nu se pune in ghilimele: modelul e scris diferit peste tot
      const q = isDevice ? `site:${domain} ${part}` : `site:${domain} "${part}"`
      const results = await webQuery(q, terms, signal, exhausted)

      for (const r of results.filter((x) => x.url.includes(domain)).slice(0, 4)) {
        const isPdf = /\.pdf(\?|$)/i.test(r.url)
        hits.push({
          title: cleanTitle(r.title, `${part} - ${label}`),
          url: r.url,
          query: part,
          kind,
          // paginile HTML nu se pot descarca direct; le penalizez, dar nu le arunc
          confidenceBoost: isPdf ? 0 : -0.25
        })
      }
    }

    return dedupeByUrl(hits)
  }
}
