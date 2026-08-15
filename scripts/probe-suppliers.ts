import { app } from 'electron'
import { renderHtml } from '../src/main/browser'

/**
 * Cum arata paginile de rezultate ale magazinelor dupa randare?
 *
 * Ma intereseaza daca pot scoate din DOM denumirea, stocul si pretul fara
 * selectoare fragile, deci caut tipare generale: preturi, indicii de stoc si
 * link-uri catre produse.
 */

const QUERY = process.env.PROBE_ARG || 'LM358N'

const SITES: Array<[string, string]> = [
  ['TME', `https://www.tme.eu/ro/katalog/?search=${encodeURIComponent(QUERY)}`],
  ['Mouser', `https://www.mouser.com/c/?q=${encodeURIComponent(QUERY)}`],
  ['Farnell', `https://ro.farnell.com/search?st=${encodeURIComponent(QUERY)}`],
  ['DigiKey', `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(QUERY)}`],
  ['RS', `https://ro.rs-online.com/web/c/?searchTerm=${encodeURIComponent(QUERY)}`],
  [
    'OptimusDigital',
    `https://www.optimusdigital.ro/ro/cautare?controller=search&s=${encodeURIComponent(QUERY)}`
  ],
  ['Cleste', `https://www.cleste.ro/cautare?controller=search&s=${encodeURIComponent(QUERY)}`]
]

/** Tipare de pret din zona noastra: 12,34 lei / 1.23 EUR / €1,23 / $1.23 */
const PRICE_RE =
  /(?:(?:RON|LEI|EUR|USD|€|\$)\s*\d[\d.,]*|\d[\d.,]*\s*(?:RON|LEI|EUR|USD|€|\$))/gi

const STOCK_RE =
  /(in stock|out of stock|în stoc|in stoc|indisponibil|stoc epuizat|disponibil|pe stoc|\d+\s*(?:buc|pcs|pieces))/gi

async function main(): Promise<void> {
  await app.whenReady()

  for (const [name, url] of SITES) {
    const started = Date.now()
    const html = await renderHtml(url, { timeoutMs: 30_000, settleMs: 2500 })
    const secs = ((Date.now() - started) / 1000).toFixed(1)

    if (!html) {
      console.log(`\n${name.padEnd(16)} — nimic randat (${secs}s)`)
      continue
    }

    // scot scripturile si stilurile, altfel gasesc preturi in JSON-ul din pagina
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')

    const prices = [...new Set(text.match(PRICE_RE) ?? [])].slice(0, 6)
    const stock = [...new Set(text.match(STOCK_RE) ?? [])].slice(0, 6)
    const mentionsQuery = new RegExp(QUERY.replace(/[^a-z0-9]/gi, ''), 'i').test(
      text.replace(/[^a-z0-9]/gi, '')
    )

    console.log(`\n${name.padEnd(16)} ${secs}s  len=${html.length}  contineCodul=${mentionsQuery}`)
    console.log(`   preturi: ${prices.join(' | ') || '—'}`)
    console.log(`   stoc:    ${stock.join(' | ') || '—'}`)
    if (/captcha|cloudflare|are you a robot|access denied/i.test(text)) {
      console.log(`   (!) pagina pare sa ceara verificare anti-bot`)
    }
  }

  app.quit()
}

main().catch((err) => {
  console.error('probe esuat:', err)
  app.quit()
})
