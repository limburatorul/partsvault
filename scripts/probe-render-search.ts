import { app } from 'electron'
import { renderHtml } from '../src/main/browser'

/**
 * Randarea intr-un Chromium adevarat repara rezultatele degradate?
 *
 * Aceleasi interogari care prin `fetch()` intorceau pagini goale sau rezultate
 * despre linii aeriene, cerute acum printr-un browser complet.
 */

const QUERY = process.env.PROBE_ARG || 'Logitech Z5500 service manual'

const ENGINES: Array<[string, string, string]> = [
  ['SearXNG (opnxng)', `https://opnxng.com/search?q=${encodeURIComponent(QUERY)}`, 'article.result'],
  ['SearXNG (inetol)', `https://search.inetol.net/search?q=${encodeURIComponent(QUERY)}`, 'article.result'],
  ['DuckDuckGo', `https://duckduckgo.com/?q=${encodeURIComponent(QUERY)}`, '[data-testid="result"]'],
  ['Bing', `https://www.bing.com/search?q=${encodeURIComponent(QUERY)}`, 'li.b_algo']
]

const MODEL = QUERY.split(/\s+/).find((t) => /\d/.test(t))?.toLowerCase() ?? ''

async function main(): Promise<void> {
  await app.whenReady()
  console.log(`interogare: "${QUERY}"  (token distinctiv: ${MODEL})\n`)

  for (const [name, url, selector] of ENGINES) {
    const started = Date.now()
    const html = await renderHtml(url, { timeoutMs: 30_000, waitForSelector: selector, settleMs: 1500 })
    const secs = ((Date.now() - started) / 1000).toFixed(1)

    if (!html) {
      console.log(`${name.padEnd(20)} nimic randat (${secs}s)`)
      continue
    }

    const links = [...new Set(html.match(/https?:\/\/[^"'<>\s]+/g) ?? [])].filter(
      (u) => !/duckduckgo|bing\.com|opnxng|inetol|microsoft|w3\.org|schema\.org/.test(u)
    )
    const relevant = links.filter((u) => u.toLowerCase().replace(/[^a-z0-9]/g, '').includes(MODEL))
    const pdfs = links.filter((u) => /\.pdf(\?|$)/i.test(u))

    console.log(
      `${name.padEnd(20)} ${secs}s len=${String(html.length).padEnd(7)} linkuri=${String(links.length).padEnd(5)} cuModel=${String(relevant.length).padEnd(4)} pdf=${pdfs.length}`
    )
    for (const u of relevant.slice(0, 4)) console.log(`${' '.repeat(22)}${u.slice(0, 96)}`)
  }

  app.quit()
}

main().catch((err) => {
  console.error('probe esuat:', err)
  app.quit()
})
