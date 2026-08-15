import { fetchJson } from '../../http'
import { dedupeByUrl } from '../scrape'
import type { RawHit, Source, SourceContext } from '../types'

/**
 * Internet Archive, prin API-ul public de cautare.
 *
 * Aici ajung manualele si cataloagele scanate care nu exista nicaieri altundeva:
 * databook-uri Motorola din '78, cataloage IPRS, manuale de service. Nu are
 * cheie de API si nu are cota, doar e lent -- de aceea e marcat `slow`.
 */

interface AdvancedSearchResponse {
  response?: {
    docs?: Array<{ identifier?: string; title?: string | string[]; year?: string }>
  }
}

interface MetadataResponse {
  files?: Array<{ name?: string; format?: string; size?: string }>
  metadata?: { title?: string | string[]; creator?: string | string[] }
}

const SEARCH_ENDPOINT = 'https://archive.org/advancedsearch.php'
const MAX_ITEMS = 5

function asText(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}

async function searchItems(
  query: string,
  signal: AbortSignal
): Promise<Array<{ identifier: string; title: string }>> {
  const params = new URLSearchParams({ q: query, rows: String(MAX_ITEMS), page: '1', output: 'json' })
  // fl[] trebuie repetat, nu poate fi setat printr-o singura intrare
  params.append('fl[]', 'identifier')
  params.append('fl[]', 'title')

  const data = await fetchJson<AdvancedSearchResponse>(`${SEARCH_ENDPOINT}?${params}`, {
    signal,
    timeoutMs: 30_000
  })

  return (data?.response?.docs ?? [])
    .filter((d) => d.identifier)
    .map((d) => ({ identifier: d.identifier as string, title: asText(d.title, d.identifier as string) }))
}

/** Listeaza PDF-urile dintr-un item si le transforma in link-uri de descarcare. */
async function pdfsOfItem(
  identifier: string,
  itemTitle: string,
  part: string,
  signal: AbortSignal
): Promise<RawHit[]> {
  const meta = await fetchJson<MetadataResponse>(`https://archive.org/metadata/${identifier}`, {
    signal,
    timeoutMs: 25_000
  })
  if (!meta?.files) return []

  return meta.files
    .filter((f) => f.name && /\.pdf$/i.test(f.name))
    // sar peste PDF-urile derivate de arhiva pentru previzualizare
    .filter((f) => !/_text\.pdf$/i.test(f.name as string))
    .slice(0, 3)
    .map((f) => ({
      title: `${itemTitle} - ${f.name}`,
      url: `https://archive.org/download/${identifier}/${encodeURIComponent(f.name as string)}`,
      pageUrl: `https://archive.org/details/${identifier}`,
      query: part,
      kind: 'manual' as const,
      sizeBytes: f.size ? Number(f.size) : undefined,
      confidenceBoost: -0.05
    }))
}

export const archiveOrgSource: Source = {
  id: 'archiveorg',
  label: 'Internet Archive',
  tier: 'archive',
  note: 'Databook-uri si manuale scanate. Ultima sansa pentru integrate din anii 70-80.',
  slow: true,

  async search(ctx: SourceContext): Promise<RawHit[]> {
    const { analysis, signal, deep } = ctx
    const parts = analysis.variants.slice(0, deep ? 2 : 1)
    if (ctx.useEquivalents && deep) parts.push(...analysis.equivalents.slice(0, 1))

    const hits: RawHit[] = []
    for (const part of parts) {
      if (signal.aborted) break
      // restrang la texte: altfel intorc si inregistrari audio sau filme
      const items = await searchItems(`"${part}" AND mediatype:texts`, signal)
      for (const item of items.slice(0, deep ? MAX_ITEMS : 2)) {
        if (signal.aborted) break
        hits.push(...(await pdfsOfItem(item.identifier, item.title, part, signal)))
      }
    }
    return dedupeByUrl(hits)
  }
}
