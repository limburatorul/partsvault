import { createHmac } from 'node:crypto'
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
  api?: (
    query: string,
    key: string,
    secret: string,
    signal?: AbortSignal
  ) => Promise<SupplierResult[]>
  /** Furnizorul cere si o parte secreta pe langa cheie. */
  needsSecret?: boolean
  apiSignupUrl?: string
  keyLabel?: string
  secretLabel?: string
  /** Acopera mai multi distribuitori deodata; randurile lui le inlocuiesc pe ale lor. */
  aggregator?: boolean
  /** Cat costa accesul la API. */
  pricing?: 'free' | 'paid'
}

// ---------------------------------------------------------------- API Mouser

interface MouserResponse {
  Errors?: Array<{ Message?: string; Code?: string }>
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
  _secret: string,
  signal?: AbortSignal
): Promise<SupplierResult[]> {
  const res = await httpFetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${key}`, {
    method: 'POST',
    body: { SearchByKeywordRequest: { keyword: query, records: 8, startingRecord: 0 } },
    headers: { Accept: 'application/json' },
    timeoutMs: 25_000,
    retries: 1,
    signal
  })
  if (!res.ok) throw new Error(`Mouser a raspuns ${res.status}`)

  const data = (await res.json()) as MouserResponse
  // Mouser raporteaza erorile de cheie in corp, cu HTTP 200
  if (data.Errors?.length) {
    throw new Error(data.Errors[0].Message ?? 'Mouser a refuzat cererea')
  }
  const parts = (data.SearchResults?.Parts ?? []).slice(0, 8).map((p) => ({
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

  // Rezultatele contin si variante nefabricate, fara stoc si fara pret. Sunt
  // informatie corecta, dar nu ajuta pe cineva care vrea sa comande azi, deci
  // coboara sub cele disponibile.
  return parts.sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0))
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
  _secret: string,
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

// -------------------------------------------------------------------- API TME

interface TmeResponse {
  Data?: {
    ProductList?: Array<{
      Symbol?: string
      OriginalSymbol?: string
      Producer?: string
      Description?: string
      ProductInformationPage?: string
    }>
  }
}

interface TmePriceResponse {
  Data?: {
    ProductList?: Array<{
      Symbol?: string
      Amount?: number
      PriceList?: Array<{ Amount?: number; PriceValue?: number }>
      Unit?: string
    }>
  }
}

/**
 * TME semneaza fiecare cerere: HMAC-SHA1 peste metoda, URL si parametrii
 * sortati, cu secretul contului. Fara semnatura corecta raspunde 401.
 */
function tmeSignature(url: string, params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
  const base = `POST&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`
  return createHmac('sha1', secret).update(base).digest('base64')
}

async function tmePost<T>(
  endpoint: string,
  params: Record<string, string>,
  secret: string,
  signal?: AbortSignal
): Promise<T | null> {
  const signed = { ...params, ApiSignature: tmeSignature(endpoint, params, secret) }
  const body = Object.entries(signed)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const res = await httpFetch(endpoint, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeoutMs: 25_000,
    retries: 1,
    signal
  })
  if (!res.ok) throw new Error(`TME a raspuns ${res.status}`)
  return (await res.json()) as T
}

async function tmeApi(
  query: string,
  token: string,
  secret: string,
  signal?: AbortSignal
): Promise<SupplierResult[]> {
  const base = { Token: token, Country: 'RO', Language: 'RO' }

  const found = await tmePost<TmeResponse>(
    'https://api.tme.eu/Products/Search.json',
    { ...base, SearchPlain: query },
    secret,
    signal
  )
  const products = (found?.Data?.ProductList ?? []).slice(0, 6)
  if (!products.length) return []

  // preturile si stocul vin dintr-un al doilea apel, pe simbolurile gasite
  const symbols: Record<string, string> = { ...base }
  products.forEach((p, i) => {
    symbols[`SymbolList[${i}]`] = p.Symbol ?? ''
  })

  const priced = await tmePost<TmePriceResponse>(
    'https://api.tme.eu/Products/GetPricesAndStocks.json',
    symbols,
    secret,
    signal
  ).catch(() => null)

  const bySymbol = new Map(
    (priced?.Data?.ProductList ?? []).map((p) => [p.Symbol ?? '', p])
  )

  return products.map((p) => {
    const stockInfo = bySymbol.get(p.Symbol ?? '')
    return {
      supplierId: 'tme',
      supplierLabel: 'TME',
      url: p.ProductInformationPage ?? `https://www.tme.eu/ro/katalog/?search=${encodeURIComponent(query)}`,
      partNumber: p.OriginalSymbol || p.Symbol,
      description: p.Description,
      manufacturer: p.Producer,
      stock: stockInfo?.Amount,
      priceBreaks: (stockInfo?.PriceList ?? [])
        .filter((b) => typeof b.PriceValue === 'number')
        .map((b) => ({ quantity: b.Amount ?? 1, price: b.PriceValue as number, currency: 'RON' })),
      linkOnly: false
    }
  })
}

// ---------------------------------------------------------------- API DigiKey

interface DigiKeyTokenResponse {
  access_token?: string
  expires_in?: number
}

interface DigiKeySearchResponse {
  Products?: Array<{
    ManufacturerProductNumber?: string
    Description?: { ProductDescription?: string }
    Manufacturer?: { Name?: string }
    QuantityAvailable?: number
    ProductUrl?: string
    DatasheetUrl?: string
    ProductVariations?: Array<{
      StandardPricing?: Array<{ BreakQuantity?: number; UnitPrice?: number }>
    }>
  }>
}

/** Token-ul DigiKey e valabil ~10 minute; il pastrez cat timp e bun. */
let digikeyToken: { value: string; expiresAt: number } | null = null

async function digikeyAccessToken(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<string> {
  if (digikeyToken && Date.now() < digikeyToken.expiresAt) return digikeyToken.value

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials'
  }).toString()

  const res = await httpFetch('https://api.digikey.com/v1/oauth2/token', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeoutMs: 20_000,
    retries: 1,
    signal
  })
  if (!res.ok) throw new Error(`DigiKey token: ${res.status}`)

  const data = (await res.json()) as DigiKeyTokenResponse
  if (!data.access_token) throw new Error('DigiKey nu a intors token')

  digikeyToken = {
    value: data.access_token,
    // 60s marja, ca sa nu expire fix intre doua cereri
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 600) - 60) * 1000
  }
  return digikeyToken.value
}

async function digikeyApi(
  query: string,
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<SupplierResult[]> {
  const token = await digikeyAccessToken(clientId, clientSecret, signal)

  const res = await httpFetch('https://api.digikey.com/products/v4/search/keyword', {
    method: 'POST',
    body: { Keywords: query, Limit: 6, Offset: 0 },
    headers: {
      Authorization: `Bearer ${token}`,
      'X-DIGIKEY-Client-Id': clientId,
      'X-DIGIKEY-Locale-Site': 'RO',
      'X-DIGIKEY-Locale-Language': 'en',
      'X-DIGIKEY-Locale-Currency': 'RON'
    },
    timeoutMs: 25_000,
    retries: 1,
    signal
  })
  if (!res.ok) throw new Error(`DigiKey a raspuns ${res.status}`)

  const data = (await res.json()) as DigiKeySearchResponse
  return (data.Products ?? []).slice(0, 6).map((p) => ({
    supplierId: 'digikey',
    supplierLabel: 'DigiKey',
    url: p.ProductUrl ?? `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(query)}`,
    partNumber: p.ManufacturerProductNumber,
    description: p.Description?.ProductDescription,
    manufacturer: p.Manufacturer?.Name,
    stock: p.QuantityAvailable,
    datasheetUrl: p.DatasheetUrl,
    priceBreaks: (p.ProductVariations?.[0]?.StandardPricing ?? [])
      .filter((b) => typeof b.UnitPrice === 'number')
      .map((b) => ({ quantity: b.BreakQuantity ?? 1, price: b.UnitPrice as number, currency: 'RON' })),
    linkOnly: false
  }))
}

// ------------------------------------------------------- API Nexar (Octopart)

interface NexarTokenResponse {
  access_token?: string
  expires_in?: number
}

interface NexarSearchResponse {
  data?: {
    supSearchMpn?: {
      results?: Array<{
        part?: {
          mpn?: string
          shortDescription?: string
          manufacturer?: { name?: string }
          bestDatasheet?: { url?: string }
          sellers?: Array<{
            company?: { name?: string }
            offers?: Array<{
              inventoryLevel?: number
              clickUrl?: string
              moq?: number
              prices?: Array<{ quantity?: number; price?: number; currency?: string }>
            }>
          }>
        }
      }>
    }
  }
}

let nexarToken: { value: string; expiresAt: number } | null = null

async function nexarAccessToken(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<string> {
  if (nexarToken && Date.now() < nexarToken.expiresAt) return nexarToken.value

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'supply.domain'
  }).toString()

  const res = await httpFetch('https://identity.nexar.com/connect/token', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeoutMs: 20_000,
    retries: 1,
    signal
  })
  if (!res.ok) throw new Error(`Nexar token: ${res.status}`)

  const data = (await res.json()) as NexarTokenResponse
  if (!data.access_token) throw new Error('Nexar nu a intors token')

  nexarToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 120) * 1000
  }
  return nexarToken.value
}

const NEXAR_QUERY = `
query Search($q: String!) {
  supSearchMpn(q: $q, limit: 5) {
    results {
      part {
        mpn
        shortDescription
        manufacturer { name }
        bestDatasheet { url }
        sellers(authorizedOnly: true) {
          company { name }
          offers {
            inventoryLevel
            moq
            clickUrl
            prices { quantity price currency }
          }
        }
      }
    }
  }
}`

/**
 * Nexar (Octopart) agrega stocul si pretul de la toti distribuitorii mari
 * deodata. E singura integrare care populeaza tabelul intreg cu o singura
 * cheie, in loc de cate un cont la fiecare magazin.
 *
 * Intoarce cate un rand per distribuitor, ca sa se poata compara pe verticala.
 */
async function nexarApi(
  query: string,
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<SupplierResult[]> {
  const token = await nexarAccessToken(clientId, clientSecret, signal)

  const res = await httpFetch('https://api.nexar.com/graphql', {
    method: 'POST',
    body: { query: NEXAR_QUERY, variables: { q: query } },
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30_000,
    retries: 1,
    signal
  })
  if (!res.ok) throw new Error(`Nexar a raspuns ${res.status}`)

  const data = (await res.json()) as NexarSearchResponse & { errors?: Array<{ message?: string }> }
  // GraphQL raspunde 200 chiar si cand refuza cererea; eroarea e in corp
  if (data.errors?.length) {
    throw new Error(data.errors[0].message ?? 'Nexar a refuzat interogarea')
  }

  const out: SupplierResult[] = []

  for (const result of data.data?.supSearchMpn?.results ?? []) {
    const part = result.part
    if (!part) continue

    for (const seller of part.sellers ?? []) {
      // ofertele aceluiasi distribuitor difera pe ambalare; o iau pe prima
      const offer = seller.offers?.[0]
      if (!offer) continue

      out.push({
        supplierId: `nexar:${(seller.company?.name ?? 'distribuitor').toLowerCase()}`,
        supplierLabel: seller.company?.name ?? 'Distribuitor',
        url: offer.clickUrl ?? `https://octopart.com/search?q=${encodeURIComponent(query)}`,
        partNumber: part.mpn,
        description: part.shortDescription,
        manufacturer: part.manufacturer?.name,
        stock: offer.inventoryLevel,
        minQuantity: offer.moq,
        datasheetUrl: part.bestDatasheet?.url,
        priceBreaks: (offer.prices ?? [])
          .filter((p) => typeof p.price === 'number')
          .map((p) => ({
            quantity: p.quantity ?? 1,
            price: p.price as number,
            currency: p.currency ?? 'USD'
          })),
        linkOnly: false
      })
    }
  }

  // cele cu stoc primele: alea se pot comanda azi
  return out.sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0)).slice(0, 20)
}

// ------------------------------------------------------------------ registru

/**
 * Ordinea conteaza: e si ordinea din Setari, deci sugereaza pe unde sa inceapa
 * omul. Cheile gratuite primele; Nexar la coada, fiindca agregarea lui se
 * plateste -- irational pentru cateva piese pe luna, cand fiecare distribuitor
 * da acces gratuit la ale lui.
 */
const SUPPLIERS: SupplierDef[] = [
  {
    id: 'mouser',
    label: 'Mouser',
    region: 'International',
    searchUrl: (q) => `https://www.mouser.com/c/?q=${encodeURIComponent(q)}`,
    api: mouserApi,
    apiSignupUrl: 'https://www.mouser.com/api-hub/',
    keyLabel: 'API key',
    pricing: 'free'
  },
  {
    id: 'farnell',
    label: 'Farnell',
    region: 'Romania',
    searchUrl: (q) => `https://ro.farnell.com/search?st=${encodeURIComponent(q)}`,
    api: farnellApi,
    apiSignupUrl: 'https://partner.element14.com/',
    keyLabel: 'API key',
    pricing: 'free'
  },
  {
    id: 'tme',
    label: 'TME',
    region: 'Romania',
    searchUrl: (q) => `https://www.tme.eu/ro/katalog/?search=${encodeURIComponent(q)}`,
    api: tmeApi,
    needsSecret: true,
    apiSignupUrl: 'https://developers.tme.eu/',
    keyLabel: 'Token',
    secretLabel: 'App secret',
    pricing: 'free'
  },
  {
    id: 'digikey',
    label: 'DigiKey',
    region: 'International',
    searchUrl: (q) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(q)}`,
    api: digikeyApi,
    needsSecret: true,
    apiSignupUrl: 'https://developer.digikey.com/',
    keyLabel: 'Client ID',
    secretLabel: 'Client secret',
    pricing: 'free'
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
  },
  {
    // Ultimul deliberat: acopera toti distribuitorii dintr-un apel, dar planul
    // gratuit raspunde "part limit of 0", deci datele de stoc cer abonament.
    // Verificat pe cont real. Ramane pentru cine il are oricum.
    id: 'nexar',
    label: 'Nexar / Octopart',
    region: 'Agregator',
    searchUrl: (q) => `https://octopart.com/search?q=${encodeURIComponent(q)}`,
    api: nexarApi,
    needsSecret: true,
    apiSignupUrl: 'https://nexar.com/api',
    keyLabel: 'Client ID',
    secretLabel: 'Client secret',
    aggregator: true,
    pricing: 'paid'
  }
]

export async function listSuppliers(): Promise<SupplierInfo[]> {
  const cfg = await loadConfig()
  return SUPPLIERS.map((s) => ({
    id: s.id,
    label: s.label,
    region: s.region,
    supportsApi: Boolean(s.api),
    apiConfigured: Boolean(
      s.api &&
        cfg.supplierApiKeys?.[s.id] &&
        (!s.needsSecret || cfg.supplierApiSecrets?.[s.id])
    ),
    needsSecret: s.needsSecret,
    apiSignupUrl: s.apiSignupUrl,
    keyLabel: s.keyLabel,
    secretLabel: s.secretLabel,
    pricing: s.pricing
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
  const secrets = cfg.supplierApiSecrets ?? {}

  const results = await Promise.all(
    SUPPLIERS.map(async (supplier): Promise<SupplierResult[]> => {
      const key = keys[supplier.id]
      const secret = secrets[supplier.id] ?? ''
      const fallback: SupplierResult = {
        supplierId: supplier.id,
        supplierLabel: supplier.label,
        url: supplier.searchUrl(trimmed),
        linkOnly: true
      }

      if (!supplier.api || !key || (supplier.needsSecret && !secret)) return [fallback]
      try {
        const viaApi = await supplier.api(trimmed, key, secret, signal)
        // API fara rezultate: las link-ul, poate cautarea manuala gaseste ceva
        return viaApi.length ? viaApi : [fallback]
      } catch (err) {
        // cheie gresita, cota depasita, furnizor picat -- link-ul ramane util,
        // dar motivul trebuie sa ajunga in interfata, nu sa dispara in tacere
        return [
          {
            ...fallback,
            error: err instanceof Error ? err.message : 'API indisponibil'
          }
        ]
      }
    })
  )

  const rows = results.flat()

  // Cand agregatorul a intors date pentru un distribuitor, randul lui "doar
  // link" devine zgomot: acelasi magazin ar aparea de doua ori, o data cu stoc
  // si pret si o data gol.
  const coveredByAggregator = new Set(
    rows
      .filter((r) => !r.linkOnly && r.supplierId.startsWith('nexar:'))
      .map((r) => r.supplierLabel.toLowerCase())
  )

  return rows.filter((r) => {
    if (!r.linkOnly) return true
    const label = r.supplierLabel.toLowerCase()
    return ![...coveredByAggregator].some((c) => c.includes(label) || label.includes(c))
  })
}

/** URL-ul de cautare al unui furnizor, pentru butoanele din interfata. */
export function supplierSearchUrl(supplierId: string, query: string): string | null {
  const supplier = SUPPLIERS.find((s) => s.id === supplierId)
  return supplier ? supplier.searchUrl(query.trim()) : null
}
