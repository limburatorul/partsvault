import * as cheerio from 'cheerio'

/** Utilitare de parsare HTML folosite de mai multe surse. */

export interface Link {
  href: string
  text: string
}

/** Toate ancorele dintr-o pagina, cu URL absolutizat fata de `baseUrl`. */
export function extractLinks(html: string, baseUrl: string): Link[] {
  if (!html) return []
  const $ = cheerio.load(html)
  const out: Link[] = []
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href')
    if (!raw) return
    const href = absolutize(raw, baseUrl)
    if (!href) return
    out.push({ href, text: $(el).text().replace(/\s+/g, ' ').trim() })
  })
  return out
}

export function absolutize(href: string, baseUrl: string): string | null {
  try {
    if (href.startsWith('//')) return `https:${href}`
    return new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}

/**
 * DuckDuckGo impacheteaza rezultatele intr-un redirect propriu:
 *   //duckduckgo.com/l/?uddg=https%3A%2F%2F...&rut=...
 * Scot URL-ul real ca sa nu mai fac un request in plus.
 */
export function unwrapDuckDuckGo(href: string): string {
  try {
    const url = new URL(href.startsWith('//') ? `https:${href}` : href)
    if (!url.hostname.endsWith('duckduckgo.com')) return href
    const target = url.searchParams.get('uddg')
    return target ? decodeURIComponent(target) : href
  } catch {
    return href
  }
}

/**
 * Reduce un sir la litere si cifre minuscule.
 * Necesar la compararea rezultatelor: acelasi aparat apare ca `Z5500`, `Z-5500`
 * sau `z 5500`, iar aceeasi piesa ca `LM358` sau `lm-358`.
 */
export function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Heuristica pentru "acest URL duce la un PDF". */
export function looksLikePdfUrl(url: string): boolean {
  const clean = url.split('#')[0].toLowerCase()
  if (/\.pdf(\?|$)/.test(clean)) return true
  // multe site-uri servesc PDF prin endpointuri fara extensie
  return /\/(?:lit|datasheet|datasheets|docs|pdf|download|getfile|media)\//.test(clean)
}

/** Elimina duplicate pastrand prima aparitie, dupa URL normalizat. */
export function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = item.url.split('#')[0].replace(/\?.*$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Titlu curatat: fara zgomot de tip "Datasheet PDF - Free Download". */
export function cleanTitle(text: string, fallback: string): string {
  const t = text
    .replace(/\s+/g, ' ')
    .replace(/\.pdf\b/i, '')
    .replace(/\b(free\s+)?download\b/gi, '')
    .replace(/[|·–-]\s*$/, '')
    .trim()
  return t.length >= 4 ? t.slice(0, 160) : fallback
}
