import { randomUUID } from 'node:crypto'
import type { SearchHit, SearchProgress, SearchRequest, SourceTier } from '../../shared/types'
import { findByUrl } from '../library'
import { analyzePart, matchDetail } from '../partnumber'
import { activeSources } from './registry'
import { dedupeByUrl } from './scrape'
import type { RawHit, Source, SourceContext } from './types'

/**
 * Orchestratorul cascadei de cautare.
 *
 * Ideea centrala: sursele nu sunt egale si nu merita interogate toate de
 * fiecare data. Merg pe tiere, de la ieftin si sigur (ce am pe disc, link direct
 * de la producator) catre scump si incert (agregatoare, arhive scanate). Daca
 * un tier superior da rezultate bune si utilizatorul n-a cerut cautare
 * profunda, ma opresc acolo -- nu are rost sa scormonesc prin Bitsavers dupa
 * un LM358.
 */

const TIER_ORDER: SourceTier[] = ['local', 'manufacturer', 'websearch', 'aggregator', 'archive']

/** Bonus de incredere dupa cat de autoritara e sursa. */
const TIER_BONUS: Record<SourceTier, number> = {
  local: 0.3,
  manufacturer: 0.25,
  websearch: 0.05,
  aggregator: 0,
  archive: -0.05
}

/** Cate rezultate bune imi trebuie ca sa ma opresc din cautarea rapida. */
const GOOD_ENOUGH_COUNT = 3
const GOOD_ENOUGH_SCORE = 0.8

export interface SearchRun {
  runId: string
  hits: SearchHit[]
  cancel(): void
}

type ProgressFn = (p: SearchProgress) => void

/** Transforma un rezultat brut in unul cu scor si metadate complete. */
async function scoreHit(
  raw: RawHit,
  source: Source,
  analysis: ReturnType<typeof analyzePart>,
  runId: string,
  index: number
): Promise<SearchHit> {
  // scorez pe titlu + URL: piesa apare adesea doar in numele fisierului
  const byTitle = matchDetail(analysis, raw.title)
  const byUrl = matchDetail(analysis, decodeURIComponent(raw.url))
  const match = byUrl.score > byTitle.score ? byUrl : byTitle

  const boost = (raw.confidenceBoost ?? 0) + TIER_BONUS[source.tier]
  const isPdf = /\.pdf(\?|$)/i.test(raw.url)
  let score = Math.max(0, Math.min(1, match.score + boost + (isPdf ? 0.05 : -0.1)))

  // Un link care nu duce la un PDF e cel mult o pista, niciodata un rezultat de
  // top: magazinele online au part number-ul in URL si altfel ar iesi la egalitate
  // cu datasheet-ul oficial al producatorului. Rezultatele `gated` sunt exceptia:
  // acolo pagina *este* destinatia corecta, nu un compromis.
  if (!isPdf && !raw.gated && source.tier !== 'local') score = Math.min(score, 0.5)

  const existing = await findByUrl(raw.url).catch(() => undefined)

  let reason: string | undefined
  if (raw.gated) reason = 'descarcare de pe pagina sursei -- se deschide in browser'
  else if (match.via === 'none') reason = 'part number-ul nu apare in titlu sau in link'
  else if (match.via === 'equivalent') reason = `gasit prin echivalentul ${match.term}`
  else if (!isPdf) reason = 'link-ul nu pare sa duca direct la un PDF'

  return {
    id: `${runId}-${index}`,
    query: raw.query,
    title: raw.title || raw.query,
    url: raw.url,
    pageUrl: raw.pageUrl,
    sourceId: source.id,
    sourceLabel: source.label,
    tier: source.tier,
    kind: raw.kind ?? 'unknown',
    manufacturer: raw.manufacturer,
    sizeBytes: raw.sizeBytes,
    score,
    alreadyInLibrary: Boolean(existing),
    reason,
    gated: raw.gated
  }
}

/**
 * Ruleaza o cautare completa.
 * `onProgress` primeste rezultate pe masura ce apar, ca UI-ul sa nu astepte
 * sursele lente ca sa afiseze ce a gasit deja.
 */
export async function runSearch(
  req: SearchRequest,
  onProgress: ProgressFn
): Promise<SearchRun> {
  const runId = randomUUID()
  const controller = new AbortController()
  const analysis = analyzePart(req.query)
  const all = await activeSources()

  // in cautare rapida sar peste sursele lente
  const planned = all.filter((s) => req.deepSearch || !s.slow)

  const ctx: SourceContext = {
    analysis,
    kinds: req.kinds,
    deep: req.deepSearch,
    useEquivalents: req.expandEquivalents,
    signal: controller.signal
  }

  onProgress({
    runId,
    phase: 'start',
    message:
      `Caut ${analysis.normalized}` +
      (analysis.variants.length > 1 ? ` (si ${analysis.variants.length - 1} variante)` : '') +
      (req.expandEquivalents && analysis.equivalents.length
        ? `, plus echivalente: ${analysis.equivalents.slice(0, 3).join(', ')}`
        : ''),
    fraction: 0
  })

  const collected: SearchHit[] = []
  let done = 0
  let hitIndex = 0

  for (const tier of TIER_ORDER) {
    if (controller.signal.aborted) break
    const inTier = planned.filter((s) => s.tier === tier)
    if (!inTier.length) continue

    // sursele din acelasi tier merg in paralel: sunt hosturi diferite
    const results = await Promise.all(
      inTier.map(async (source) => {
        onProgress({
          runId,
          phase: 'source',
          sourceId: source.id,
          sourceLabel: source.label,
          tier: source.tier,
          message: `Interoghez ${source.label}...`,
          fraction: done / planned.length
        })
        try {
          const raw = await source.search(ctx)
          return { source, raw: dedupeByUrl(raw) }
        } catch (err) {
          onProgress({
            runId,
            phase: 'error',
            sourceId: source.id,
            sourceLabel: source.label,
            message: `${source.label}: ${err instanceof Error ? err.message : 'eroare'}`
          })
          return { source, raw: [] as RawHit[] }
        } finally {
          done++
        }
      })
    )

    for (const { source, raw } of results) {
      const scored = await Promise.all(
        raw.map((r) => scoreHit(r, source, analysis, runId, hitIndex++))
      )
      // sub 0.15 sunt aproape sigur rezultate gresite; nu aglomerez UI-ul cu ele
      const keep = scored.filter((h) => h.score >= 0.15)
      collected.push(...keep)
      if (keep.length) {
        onProgress({
          runId,
          phase: 'hit',
          sourceId: source.id,
          sourceLabel: source.label,
          tier: source.tier,
          hits: keep.sort((a, b) => b.score - a.score),
          fraction: done / planned.length
        })
      }
    }

    const strong = collected.filter((h) => h.score >= GOOD_ENOUGH_SCORE)
    if (!req.deepSearch && strong.length >= GOOD_ENOUGH_COUNT) {
      onProgress({
        runId,
        phase: 'done',
        message: `Gasit ${strong.length} rezultate bune. Bifeaza "cautare profunda" daca vrei si arhivele.`,
        fraction: 1
      })
      return { runId, hits: sortHits(collected), cancel: () => controller.abort() }
    }
  }

  const final = sortHits(collected)
  onProgress({
    runId,
    phase: 'done',
    message: final.length
      ? `${final.length} rezultate din ${planned.length} surse.`
      : `Nimic gasit pentru ${analysis.normalized}. Incearca cautarea profunda sau o varianta a codului.`,
    fraction: 1
  })

  return { runId, hits: final, cancel: () => controller.abort() }
}

function sortHits(hits: SearchHit[]): SearchHit[] {
  const unique = dedupeByUrl(hits)
  return unique.sort((a, b) => {
    if (a.alreadyInLibrary !== b.alreadyInLibrary) return a.alreadyInLibrary ? -1 : 1
    return b.score - a.score
  })
}

/** Expusa separat pentru UI: ce a inteles aplicatia din ce a tastat omul. */
export function explainQuery(query: string): ReturnType<typeof analyzePart> {
  return analyzePart(query)
}
