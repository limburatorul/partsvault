import type { SupplierInfo, SupplierResult } from '../shared/inventory'
import { loadConfig } from './config'
import { httpFetch } from './http'

/**
 * Cautarea componentelor la furnizori.
 *
 * Doua niveluri, deliberat:
 *  - **link-out**, care merge intotdeauna si nu cere nimic: construiesc URL-ul
 *    de cautare al fiecarui magazin si il deschid in browser;
 *  - **API**, optional, pentru cine isi pune o cheie in Setari: aduce pret,
 *    stoc si link direct la datasheet, in aplicatie.
 *
 * Magazinele sunt alese cu livrare in Romania: TME si Farnell au storefront
 * romanesc, iar Optimus Digital si Cleste sunt locale, deci ajung a doua zi.
 */

interface SupplierDef {
  id: string
  label: string
  region: string
  /** Pagina de cautare pentru un cod de piesa. */
  searchUrl: (query: string) => string
  /** Interogare prin API; lipseste cand furnizorul nu are integrare. */
  api?: (query: string, key: string, signal?: AbortSignal) => Promise<SupplierResult[]>
}

// ---------------------------------------------------------------- API Mouser

interface MouserResponse {
  SearchResults?: {
    Parts?: Array<{
      MouserPartNumber?: string
      ManufacturerPartNumber?: string
      Manufacturer?: string
      Description?: string
      Availability?: string
      DataSheetUrl?: string
      ProductDetailUrl?: string
      Min?: string
      PriceBreaks?: Array<{ Quantity?: number; Price?: string; Currency?: string }>
    }>
  }
}

/** "123 In Stock" -> 123. Mouser trimite disponibilitatea ca text liber. */
function parseStock(availability?: string): number | undefined {
  if (!availability) return undefined
  const m = availability.replace(/[.,\s]/g, '').match(/(\d+)/)
  return m ? Number(m[1]) : undefined
}

/** "12,34 €" / "$1.23" -> 1.23 */
function parsePrice(price?: string): number | undefined {
  if (!price) return undefined
  const cleaned = price.replace(/[^\d.,]/g, '').replace(',', '.')
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) ? n : undefined
}

async function mouserApi(
  query: string,
  key: string,
  signal?: AbortSignal
): Promise<SupplierResult[]> {
  const res = await httpFetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${key}`, {
    method: 'POST',
    body: { SearchByKeywordRequest: { keyword: query, records: 8, startingRecord: 0 } },
    timeoutMs: 25_000,
    retries: 1,
    signal
  })
  if (!res.ok) throw new Error(`Mouser a raspuns ${res.status}`)

  const data = (await res.json()) as MouserResponse
  return (data.SearchResults?.Parts ?? []).slice(0, 8).map((p) => ({
    supplierId: 'mouser',
    supplierLabel: 'Mouser',
    url: p.ProductDetailUrl ?? SUPPLIERS[0].searchUrl(query),
    partNumber: p.ManufacturerPartNumber ?? p.MouserPartNumber,
    description: p.Description,
    manufacturer: p.Manufacturer,
    stock: parseStock(p.Availability),
    minQuantity: p.Min ? Number(p.Min) : undefined,
    datasheetUrl: p.DataSheetUrl,
    priceBreaks: (p.PriceBreaks ?? [])
      .map((b) => ({
        quantity: b.Quantity ?? 1,
        price: parsePrice(b.Price) ?? 0,
        currency: b.Currency ?? 'EUR'
      }))
      .filter((b) => b.price > 0),
    linkOnly: false
  }))
}

// --------------------------------------------------------- API Farnell (e14)

interface FarnellResponse {
  premierFarnellPartNumberReturn?: {
    products?: Array<{
      translatedManufacturerPartNumber?: string
      brandName?: string
      displayName?: string
      stock?: { level?: number }
      datasheets?: Array<{ url?: string }>
      prices?: Array<{ from?: number; cost?: number }>
      sku?: string
    }>
  }
}

async function farnellApi(
  query: string,
  key: string,
  signal?: AbortSignal
): Promise<SupplierResult[]> {
  const params = new URLSearchParams({
    'callInfo.responseDataFormat': 'json',
    'callInfo.apiKey': key,
    term: `any:${query}`,
    // storefront-ul romanesc: preturi in RON si livrare locala
    'storeInfo.id': 'ro.farnell.com',
    'resultsSettings.offset': '0',
    'resultsSettings.numberOfResults': '8',
    'resultsSettings.responseGroup': 'medium'
  })

  const res = await httpFetch(`https://api.element14.com/catalog/products?${params}`, {
    timeoutMs: 25_000,
    retries: 1,
    signal
  })
  if (!res.ok) throw new Error(`Farnell a raspuns ${res.status}`)

  const data = (await res.json()) as FarnellResponse
  return (data.premierFarnellPartNumberReturn?.products ?? []).slice(0, 8).map((p) => ({
    supplierId: 'farnell',
    supplierLabel: 'Farnell',
    url: p.sku
      ? `https://ro.farnell.com/search?st=${encodeURIComponent(p.sku)}`
      : `https://ro.farnell.com/search?st=${encodeURIComponent(query)}`,
    partNumber: p.translatedManufacturerPartNumber,
    description: p.displayName,
    manufacturer: p.brandName,
    stock: p.stock?.level,
    datasheetUrl: p.datasheets?.[0]?.url,
    priceBreaks: (p.prices ?? [])
      .filter((b) => typeof b.cost === 'number')
      .map((b) => ({ quantity: b.from ?? 1, price: b.cost as number, currency: 'RON' })),
    linkOnly: false
  }))
}

// ------------------------------------------------------------------ registru

const SUPPLIERS: SupplierDef[] = [
  {
    id: 'mouser',
    label: 'Mouser',
    region: 'International',
    searchUrl: (q) => `https://www.mouser.com/c/?q=${encodeURIComponent(q)}`,
    api: mouserApi
  },
  {
    id: 'farnell',
    label: 'Farnell',
    region: 'Romania',
    searchUrl: (q) => `https://ro.farnell.com/search?st=${encodeURIComponent(q)}`,
    api: farnellApi
  },
  {
    id: 'tme',
    label: 'TME',
    region: 'Romania',
    searchUrl: (q) => `https://www.tme.eu/ro/katalog/?search=${encodeURIComponent(q)}`
  },
  {
    id: 'digikey',
    label: 'DigiKey',
    region: 'International',
    searchUrl: (q) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(q)}`
  },
  {
    id: 'rs',
    label: 'RS Components',
    region: 'Romania',
    searchUrl: (q) => `https://ro.rs-online.com/web/c/?searchTerm=${encodeURIComponent(q)}`
  },
  {
    id: 'optimusdigital',
    label: 'Optimus Digital',
    region: 'Romania',
    searchUrl: (q) =>
      `https://www.optimusdigital.ro/ro/cautare?controller=search&s=${encodeURIComponent(q)}`
  },
  {
    id: 'cleste',
    label: 'Cleste',
    region: 'Romania',
    searchUrl: (q) => `https://www.cleste.ro/cautare?controller=search&s=${encodeURIComponent(q)}`
  }
]

export async function listSuppliers(): Promise<SupplierInfo[]> {
  const cfg = await loadConfig()
  return SUPPLIERS.map((s) => ({
    id: s.id,
    label: s.label,
    region: s.region,
    supportsApi: Boolean(s.api),
    apiConfigured: Boolean(s.api && cfg.supplierApiKeys?.[s.id])
  }))
}

/**
 * Cauta o componenta la toti furnizorii.
 *
 * Cei cu cheie configurata sunt interogati prin API si intorc pret si stoc;
 * restul intorc un rand `linkOnly`, care in interfata e un buton ce deschide
 * cautarea in browser. Asa lista e mereu completa, indiferent de configurare.
 */
export async function searchSuppliers(
  query: string,
  signal?: AbortSignal
): Promise<SupplierResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const cfg = await loadConfig()
  const keys = cfg.supplierApiKeys ?? {}

  const results = await Promise.all(
    SUPPLIERS.map(async (supplier): Promise<SupplierResult[]> => {
      const key = keys[supplier.id]
      const fallback: SupplierResult = {
        supplierId: supplier.id,
        supplierLabel: supplier.label,
        url: supplier.searchUrl(trimmed),
        linkOnly: true
      }

      if (!supplier.api || !key) return [fallback]
      try {
        const viaApi = await supplier.api(trimmed, key, signal)
        // API fara rezultate: las link-ul, poate cautarea manuala gaseste ceva
        return viaApi.length ? viaApi : [fallback]
      } catch {
        // cheie gresita, cota depasita, furnizor picat -- link-ul ramane util
        return [{ ...fallback, description: 'API indisponibil; deschide cautarea in browser' }]
      }
    })
  )

  return results.flat()
}

/** URL-ul de cautare al unui furnizor, pentru butoanele din interfata. */
export function supplierSearchUrl(supplierId: string, query: string): string | null {
  const supplier = SUPPLIERS.find((s) => s.id === supplierId)
  return supplier ? supplier.searchUrl(query.trim()) : null
}
