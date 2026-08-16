/**
 * Tipuri partajate intre procesul main (motorul de cautare) si renderer (UI).
 * Nu importa nimic din Node aici -- fisierul e inclus si in bundle-ul de browser.
 */

/** Ce fel de document am gasit. Determina si folderul in care ajunge pe disc. */
export type DocKind =
  | 'datasheet'
  | 'schematic'
  | 'appnote'
  | 'manual'
  | 'errata'
  | 'reference-design'
  | 'unknown'

/**
 * Cat de sigur sunt ca documentul chiar corespunde piesei cautate.
 * `verified` = am deschis PDF-ul si am gasit part number-ul in text.
 */
export type Confidence = 'verified' | 'likely' | 'possible' | 'rejected'

/** Nivelul din cascada de cautare de la care a venit rezultatul. */
export type SourceTier = 'local' | 'manufacturer' | 'aggregator' | 'websearch' | 'archive'

export interface SourceInfo {
  /** Id stabil, folosit in config si in metadatele salvate. Ex: 'ti', 'alldatasheet'. */
  id: string
  label: string
  tier: SourceTier
  /** Sursele dezactivate din setari sunt sarite complet de orchestrator. */
  enabled: boolean
  /** Descriere scurta afisata in ecranul de Setari. */
  note?: string
}

/** Un candidat gasit de o sursa, inainte de descarcare si verificare. */
export interface SearchHit {
  /** Id unic al hit-ului in cadrul unei rulari de cautare. */
  id: string
  /** Part number-ul (varianta) care a produs acest rezultat. */
  query: string
  title: string
  url: string
  /** Pagina de pe care a fost extras link-ul, pentru Referer si pentru audit. */
  pageUrl?: string
  sourceId: string
  sourceLabel: string
  tier: SourceTier
  kind: DocKind
  manufacturer?: string
  /** Marime raportata de sursa sau de HEAD, in bytes. */
  sizeBytes?: number
  /** Scor euristic 0..1 calculat inainte de download (potrivire nume, sursa, tip). */
  score: number
  /** Setat cand hit-ul corespunde unui document deja aflat in librarie. */
  alreadyInLibrary?: boolean
  /** Motivul pentru care scorul e mic, afisat in UI ca explicatie. */
  reason?: string
  /**
   * Sursa cere trecerea printr-o pagina proprie (asteptare, cont, reclame)
   * inainte de descarcare. Nu incerc sa ocolesc: deschid pagina in browser si
   * omul descarca de acolo, apoi poate importa fisierul in librarie.
   */
  gated?: boolean
}

/** Intrare persistata in librarie, dupa descarcare + verificare. */
export interface LibraryDoc {
  id: string
  /** Part number-ul canonic sub care e indexat documentul. */
  partNumber: string
  /** Toate part number-urile gasite in text -- permite cautare dupa variante. */
  aliases: string[]
  title: string
  kind: DocKind
  manufacturer?: string
  /** Cale relativa la radacina librariei, cu separatori '/'. */
  relPath: string
  sizeBytes: number
  sha256: string
  pageCount?: number
  confidence: Confidence
  /** De unde a fost luat, pastrat pentru re-descarcare si verificare ulterioara. */
  sourceId: string
  sourceUrl: string
  /** ISO timestamp. */
  addedAt: string
  /** Primele ~2000 caractere din PDF, pentru cautare full-text locala. */
  textSnippet?: string
  notes?: string
  tags: string[]
  favorite?: boolean
}

export interface LibraryIndex {
  version: number
  docs: LibraryDoc[]
}

/** Progres emis catre UI in timpul unei cautari. */
export interface SearchProgress {
  runId: string
  phase: 'start' | 'source' | 'hit' | 'done' | 'error'
  /** Sursa care tocmai a fost interogata. */
  sourceId?: string
  sourceLabel?: string
  tier?: SourceTier
  message?: string
  hits?: SearchHit[]
  /** 0..1, aproximativ -- cate surse din plan au fost terminate. */
  fraction?: number
}

export interface SearchRequest {
  /** Ce a tastat utilizatorul, brut. */
  query: string
  /** Daca e false, orchestratorul se opreste dupa primul tier cu rezultate bune. */
  deepSearch: boolean
  /** Include variante si echivalente (ex: K155LA3 -> SN7400). */
  expandEquivalents: boolean
  kinds: DocKind[]
}

export interface DownloadProgress {
  hitId: string
  phase: 'queued' | 'downloading' | 'verifying' | 'done' | 'error' | 'duplicate'
  receivedBytes?: number
  totalBytes?: number
  message?: string
  doc?: LibraryDoc
}

export interface AppConfig {
  /** Radacina librariei pe disc. null inainte de primul run. */
  libraryPath: string | null
  /** Id-uri de surse dezactivate manual. */
  disabledSources: string[]
  /** Descarca automat primul rezultat verificat al fiecarei cautari. */
  autoDownloadBest: boolean
  /** Milisecunde intre cereri catre acelasi host. */
  politenessDelayMs: number
  maxConcurrentDownloads: number
  /** Nu descarca fisiere mai mari de atat (MB). */
  maxFileSizeMb: number
  /**
   * Chei API pentru furnizori, dupa id-ul furnizorului. Optionale: fara ele,
   * cautarea la furnizori se face prin link in browser.
   */
  supplierApiKeys: Record<string, string>
  /**
   * Partea secreta, pentru furnizorii care cer o pereche: TME are token +
   * secret pentru semnatura, DigiKey are client id + client secret.
   */
  supplierApiSecrets: Record<string, string>
}

/**
 * Ce fel de cautare a cerut utilizatorul.
 * `part` = un cod de integrat (LM358); `device` = un aparat, pentru care se
 * cauta schema sau manualul de service (Logitech Z5500).
 */
export type QueryType = 'part' | 'device'

/** Ce s-a aflat despre o versiune mai noua publicata pe GitHub. */
export interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion?: string
  notes?: string
  downloadUrl?: string
  sizeBytes?: number
  /** Motivul pentru care verificarea n-a putut fi facuta. */
  error?: string
}

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'restarting' | 'error'
  receivedBytes?: number
  totalBytes?: number
  message?: string
}

/** Rezultatul analizei a ceea ce a introdus utilizatorul. */
export interface PartAnalysis {
  queryType: QueryType
  /** Cuvintele interogarii, pentru cautarile pe aparat. */
  terms: string[]
  raw: string
  /** Forma normalizata, uppercase, fara separatori. */
  normalized: string
  /** Radacina fara sufixe de package/temperatura. Ex: LM358ADGKR -> LM358. */
  root: string
  /** Variante de cautat, in ordinea descrescatoare a relevantei. */
  variants: string[]
  /** Producatori probabili, dedusi din prefix. */
  likelyManufacturers: string[]
  /** Piese echivalente din alte familii (ex: sovietice, house numbers). */
  equivalents: string[]
}
