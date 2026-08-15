/**
 * Inventar de componente.
 *
 * Cerinta a fost "o baza de date blank in care sa pot defini eu", dar cu niste
 * campuri numite explicit: categorie, tip, caracteristici, cantitate, locatie.
 * De aici impartirea: un nucleu fix, pe care se sprijina cautarea, sortarea si
 * alertele de stoc, plus campuri definite de utilizator pentru caracteristici,
 * fiindca un condensator si un microcontroler n-au ce sa aiba in comun.
 */

export type FieldType = 'text' | 'number' | 'select' | 'boolean'

/** Un camp de caracteristici, definit de utilizator. */
export interface FieldDef {
  id: string
  label: string
  type: FieldType
  /** Doar pentru `select`. */
  options?: string[]
  /** Unitatea afisata langa valoare (V, µF, mA, %). */
  unit?: string
  /** Daca apare ca o coloana in tabel sau doar in fisa componentei. */
  showInTable?: boolean
  /** Restrange campul la anumite categorii; gol = se aplica peste tot. */
  categories?: string[]
}

export interface InventorySchema {
  version: number
  fields: FieldDef[]
  /** Categoriile definite de utilizator, in ordinea in care vrea sa le vada. */
  categories: string[]
}

/** Unde se afla fizic componenta. */
export interface Location {
  /** Cutia, sertarul sau raftul. */
  storage?: string
  row?: string
  column?: string
  note?: string
}

export interface Component {
  id: string
  /** Codul piesei; leaga componenta de librari de datasheet-uri. */
  partNumber: string
  category: string
  type: string
  quantity: number
  /** Sub acest prag componenta e semnalata ca fiind pe terminate. */
  minQuantity?: number
  location: Location
  /** Valorile campurilor definite de utilizator, dupa `FieldDef.id`. */
  values: Record<string, string | number | boolean>
  manufacturer?: string
  /** Pretul unitar platit ultima data, pentru estimari. */
  unitPrice?: number
  currency?: string
  notes?: string
  tags: string[]
  addedAt: string
  updatedAt: string
}

export interface InventoryData {
  version: number
  schema: InventorySchema
  components: Component[]
}

/** Rezultat de la un furnizor: fie link de cautare, fie date reale din API. */
export interface SupplierResult {
  supplierId: string
  supplierLabel: string
  /** Pagina de cautare sau de produs, deschisa in browser. */
  url: string
  /** Completate doar cand furnizorul a fost interogat prin API. */
  partNumber?: string
  description?: string
  manufacturer?: string
  stock?: number
  minQuantity?: number
  priceBreaks?: Array<{ quantity: number; price: number; currency: string }>
  datasheetUrl?: string
  /** `true` cand randul e doar un link de cautare, fara date. */
  linkOnly: boolean
  /**
   * De ce n-a intors date furnizorul: cheie gresita, cota depasita, API picat.
   * Fara asta esecurile arata identic cu "n-am cheie", iar omul nu stie ce sa repare.
   */
  error?: string
}

export interface SupplierInfo {
  id: string
  label: string
  /** Tara/regiunea de livrare, ca sa se stie de unde vine marfa. */
  region: string
  /** Furnizorul are integrare prin API in aplicatie. */
  supportsApi: boolean
  /** Cheia API e configurata in Setari. */
  apiConfigured: boolean
  /** Furnizorul cere si o parte secreta pe langa cheie. */
  needsSecret?: boolean
  /** Unde isi ia utilizatorul cheia. */
  apiSignupUrl?: string
  /** Cat costa accesul la API: cheie gratuita sau abonament. */
  pricing?: 'free' | 'paid'
  /** Ce anume trebuie pus in cele doua campuri. */
  keyLabel?: string
  secretLabel?: string
}

/** Filtru pentru lista de componente. */
export interface InventoryQuery {
  text?: string
  category?: string
  /** Doar componentele sub `minQuantity`. */
  lowStockOnly?: boolean
}
