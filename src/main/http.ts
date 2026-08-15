import { setTimeout as delay } from 'node:timers/promises'

/**
 * Strat HTTP comun tuturor surselor.
 *
 * Trei lucruri conteaza aici:
 *  - User-Agent realist: agregatoarele (AllDatasheet, Datasheet4U) intorc 403
 *    pentru clientii care nu par browser;
 *  - throttling per host, ca sa nu ne blocheze nimeni IP-ul;
 *  - cache in memorie pe durata sesiunii, fiindca aceeasi pagina de rezultate
 *    e ceruta de mai multe variante ale aceluiasi part number.
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
  // Accept-Encoding e lasat pe seama lui undici: daca il setez manual, nu mai
  // garanteaza decomprimarea si primesc octeti bruti in loc de HTML
  'Upgrade-Insecure-Requests': '1'
}

/** Ultimul moment la care am atins fiecare host, pentru throttling. */
const lastHitAt = new Map<string, number>()
/** Lanturi de promisiuni per host: serializeaza cererile catre acelasi domeniu. */
const hostQueue = new Map<string, Promise<unknown>>()

let politenessDelayMs = 900

export function setPolitenessDelay(ms: number): void {
  politenessDelayMs = Math.max(0, ms)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Ruleaza `fn` serializat per host, cu pauza minima intre cereri.
 * Cererile catre hosturi diferite raman paralele.
 */
function withHostThrottle<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = hostOf(url)
  const prev = hostQueue.get(host) ?? Promise.resolve()
  const next = prev.then(async () => {
    const since = Date.now() - (lastHitAt.get(host) ?? 0)
    if (since < politenessDelayMs) await delay(politenessDelayMs - since)
    try {
      return await fn()
    } finally {
      lastHitAt.set(host, Date.now())
    }
  })
  // pastrez lantul viu si dupa esec, altfel un reject rupe coada hostului
  hostQueue.set(
    host,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

export interface FetchOptions {
  timeoutMs?: number
  referer?: string
  retries?: number
  /** Nu urmari redirectari -- util cand vreau sa vad Location-ul. */
  manualRedirect?: boolean
  signal?: AbortSignal
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Fetch cu throttle, timeout si retry pe erori tranzitorii. */
export async function httpFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, referer, retries = 2, manualRedirect = false, signal } = opts

  return withHostThrottle(url, async () => {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw new Error('anulat')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const onAbort = () => controller.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const headers = { ...DEFAULT_HEADERS }
        if (referer) headers.Referer = referer
        const res = await fetch(url, {
          headers,
          redirect: manualRedirect ? 'manual' : 'follow',
          signal: controller.signal
        })
        // 429 si 5xx merita reincercate; 4xx restul, nu
        if (res.status === 429 || res.status >= 500) {
          lastError = new HttpError(`HTTP ${res.status}`, res.status, url)
          if (attempt < retries) {
            await delay(1200 * (attempt + 1))
            continue
          }
        }
        return res
      } catch (err) {
        lastError = err
        if (attempt < retries) await delay(800 * (attempt + 1))
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  })
}

const htmlCache = new Map<string, { at: number; body: string }>()
const HTML_CACHE_TTL_MS = 10 * 60 * 1000

/** Descarca o pagina HTML, cu cache de 10 minute. Intoarce '' la esec. */
export async function fetchHtml(url: string, opts: FetchOptions = {}): Promise<string> {
  const cached = htmlCache.get(url)
  if (cached && Date.now() - cached.at < HTML_CACHE_TTL_MS) return cached.body

  try {
    const res = await httpFetch(url, opts)
    if (!res.ok) return ''
    const type = res.headers.get('content-type') ?? ''
    // daca sursa raspunde direct cu PDF la un URL de cautare, nu e HTML de parsat
    if (type.includes('application/pdf')) return ''
    const body = await res.text()
    htmlCache.set(url, { at: Date.now(), body })
    return body
  } catch {
    return ''
  }
}

/** Fetch JSON tolerant la erori. */
export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  try {
    const res = await httpFetch(url, { ...opts, timeoutMs: opts.timeoutMs ?? 25_000 })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Interogheaza un URL fara sa descarce corpul, ca sa aflu tip si marime.
 * Multe servere de fisiere refuza HEAD, asa ca fac fallback pe GET cu Range.
 */
export async function probeUrl(
  url: string,
  opts: FetchOptions = {}
): Promise<{ ok: boolean; contentType: string; sizeBytes?: number; finalUrl: string }> {
  try {
    const res = await httpFetch(url, { ...opts, timeoutMs: opts.timeoutMs ?? 15_000, retries: 1 })
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    const len = res.headers.get('content-length')
    // consum corpul ca sa eliberez conexiunea
    await res.body?.cancel().catch(() => undefined)
    return {
      ok: res.ok,
      contentType,
      sizeBytes: len ? Number(len) : undefined,
      finalUrl: res.url || url
    }
  } catch {
    return { ok: false, contentType: '', finalUrl: url }
  }
}

export { USER_AGENT }
