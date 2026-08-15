import { app, BrowserWindow } from 'electron'

/** Ce structura au paginile de rezultate ale magazinelor romanesti? */

const QUERY = process.env.PROBE_ARG || 'LM358'

const SHOPS: Array<[string, string]> = [
  [
    'OptimusDigital',
    `https://www.optimusdigital.ro/ro/cautare?controller=search&s=${encodeURIComponent(QUERY)}`
  ],
  ['Cleste', `https://www.cleste.ro/cautare?controller=search&s=${encodeURIComponent(QUERY)}`]
]

/** Dumpeaza indiciile de structura: unde stau preturile si ce link-uri exista. */
const INSPECT = `
(() => {
  const PRICE = /(\\d[\\d.,]*)\\s*(lei|ron)/i;
  const out = { priceNodes: [], productLinks: [], itemSelectors: [] };

  // cele mai mici elemente care contin un pret
  for (const el of document.querySelectorAll('span, div, p, strong, b')) {
    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (t.length > 24 || !PRICE.test(t)) continue;
    if (el.querySelector('span, div, p')) continue;
    out.priceNodes.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ').slice(0,3).join('.') + '  =>  ' + t);
    if (out.priceNodes.length >= 6) break;
  }

  // link-uri cu text lung: candidate de titlu de produs
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const name = (a.textContent || '').replace(/\\s+/g, ' ').trim();
    if (name.length < 12 || name.length > 90) continue;
    const href = a.getAttribute('href') || '';
    if (seen.has(href)) continue;
    seen.add(href);
    out.productLinks.push(name.slice(0, 48) + '  ->  ' + href.slice(0, 78));
    if (out.productLinks.length >= 8) break;
  }

  // containere care se repeta si contin si pret si link
  for (const sel of ['article', 'li', 'div']) {
    let count = 0;
    for (const el of document.querySelectorAll(sel)) {
      const t = el.textContent || '';
      if (PRICE.test(t) && el.querySelector('a[href]') && t.length < 700) count++;
    }
    if (count) out.itemSelectors.push(sel + ': ' + count);
  }

  out.classHints = [...document.querySelectorAll('[class*=product], [class*=produs], [class*=item]')]
    .slice(0, 8)
    .map(e => e.tagName.toLowerCase() + '.' + (e.className||'').toString().split(' ').slice(0,2).join('.'));

  return out;
})()
`

async function inspect(url: string): Promise<Record<string, unknown>> {
  const win = new BrowserWindow({
    show: false,
    width: 1366,
    height: 900,
    webPreferences: { partition: 'persist:randare', sandbox: true, contextIsolation: true }
  })
  try {
    await win.loadURL(url)
    await new Promise((r) => setTimeout(r, 3000))
    return (await win.webContents.executeJavaScript(INSPECT)) as Record<string, unknown>
  } catch (err) {
    return { eroare: err instanceof Error ? err.message : String(err) }
  } finally {
    win.destroy()
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  for (const [name, url] of SHOPS) {
    console.log(`\n===== ${name}`)
    const data = await inspect(url)
    for (const [key, value] of Object.entries(data)) {
      console.log(`  ${key}:`)
      for (const line of (Array.isArray(value) ? value : [value]).slice(0, 8)) {
        console.log(`     ${String(line)}`)
      }
    }
  }
  app.quit()
}

main().catch((err) => {
  console.error('probe esuat:', err)
  app.quit()
})
