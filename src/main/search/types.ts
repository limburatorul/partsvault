import type { DocKind, PartAnalysis, SourceTier } from '../../shared/types'

/** Ce primeste o sursa cand e interogata. */
export interface SourceContext {
  analysis: PartAnalysis
  /** Tipurile de documente cerute de utilizator; sursa poate ignora restul. */
  kinds: DocKind[]
  /** Cautare profunda: sursa are voie sa faca mai multe cereri si sa mearga mai adanc. */
  deep: boolean
  /** Include si echivalentele in interogari. */
  useEquivalents: boolean
  signal: AbortSignal
}

/** Un rezultat brut, inainte de scoring si deduplicare. */
export interface RawHit {
  title: string
  url: string
  /** Pagina de provenienta, trimisa ca Referer la descarcare. */
  pageUrl?: string
  /** Varianta de part number care a produs rezultatul. */
  query: string
  kind?: DocKind
  manufacturer?: string
  sizeBytes?: number
  /** Bonus/malus aplicat peste scorul calculat din potrivirea de nume. */
  confidenceBoost?: number
  /** Descarcarea trece printr-o pagina proprie a sursei; se deschide in browser. */
  gated?: boolean
}

export interface Source {
  id: string
  label: string
  tier: SourceTier
  note?: string
  /** Daca sursa e lenta, orchestratorul o ruleaza doar in cautare profunda. */
  slow?: boolean
  search(ctx: SourceContext): Promise<RawHit[]>
}
