import type { SourceInfo } from '../../shared/types'
import { loadConfig } from '../config'
import { searchLocal } from '../library'
import { aggregatorSources } from './sources/aggregators'
import { archiveOrgSource } from './sources/archiveOrg'
import { directUrlSource } from './sources/directUrl'
import { elektrotanyaSource } from './sources/elektrotanya'
import { vintageArchivesSource } from './sources/vintageArchives'
import { webSearchSource } from './sources/webSearch'
import type { RawHit, Source, SourceContext } from './types'

/**
 * Sursa care cauta in ce am descarcat deja.
 * Ruleaza prima si e singura care nu atinge reteaua.
 */
const localSource: Source = {
  id: 'local',
  label: 'Libraria locala',
  tier: 'local',
  note: 'Ce ai deja pe disc. Se verifica intotdeauna prima, ca sa nu descarci de doua ori.',

  async search(ctx: SourceContext): Promise<RawHit[]> {
    const found = await searchLocal(ctx.analysis.variants[0], ctx.kinds)
    return found.slice(0, 20).map((doc) => ({
      title: doc.title,
      url: doc.sourceUrl,
      query: ctx.analysis.variants[0],
      kind: doc.kind,
      manufacturer: doc.manufacturer,
      sizeBytes: doc.sizeBytes,
      confidenceBoost: 0.5
    }))
  }
}

/** Toate sursele, in ordinea in care are sens sa fie interogate. */
export const ALL_SOURCES: Source[] = [
  localSource,
  directUrlSource,
  webSearchSource,
  ...aggregatorSources,
  elektrotanyaSource,
  archiveOrgSource,
  vintageArchivesSource
]

export function sourceById(id: string): Source | undefined {
  return ALL_SOURCES.find((s) => s.id === id)
}

/** Lista pentru ecranul de Setari, cu starea activat/dezactivat din config. */
export async function listSources(): Promise<SourceInfo[]> {
  const cfg = await loadConfig()
  return ALL_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    tier: s.tier,
    note: s.note,
    enabled: !cfg.disabledSources.includes(s.id)
  }))
}

/** Sursele active, grupate pe tier si in ordinea de executie. */
export async function activeSources(): Promise<Source[]> {
  const cfg = await loadConfig()
  return ALL_SOURCES.filter((s) => !cfg.disabledSources.includes(s.id))
}
