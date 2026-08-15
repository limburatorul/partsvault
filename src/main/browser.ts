import { BrowserWindow, session } from 'electron'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Randare de pagini intr-un Chromium ascuns.
 *
 * `fetch()` primeste HTML brut, fara sa execute JavaScript si fara istoric de
 * cookie-uri. Motoarele de cautare recunosc tiparul si raspund degradat -- Bing
 * ne intorcea 200 cu zece rezultate complet nerelevante, iar instantele SearXNG
 * pagini goale. Electron are insa un browser adevarat inauntru: aceleasi pagini
 * randate aici arata exact ca la un utilizator real.
 *
 * Sesiunea e persistenta, deci cookie-urile de consimtamant se aduna in timp si
 * paginile devin mai cooperante la fiecare rulare.
 */

const PARTITION = 'persist:randare'

/** UA-ul implicit al Electron contine "Electron/33.x" si ne da de gol. */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let configured = false

/** Taie descarcarile inutile: paginile de rezultate se randeaza si fara ele. */
function configureSession(): void {
  if (configured) return
  const scrapeSession = session.fromPartition(PARTITION)
  scrapeSession.setUserAgent(CHROME_UA)

  scrapeSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const blocked =
      details.resourceType === 'image' ||
      details.resourceType === 'media' ||
      details.resourceType === 'font'
    callback({ cancel: blocked })
  })

  // fara antetul asta unele site-uri trimit varianta pentru boti
  scrapeSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    headers['Accept-Language'] = 'en-US,en;q=0.9,ro;q=0.8'
    callback({ requestHeaders: headers })
  })

  configured = true
}

/** O singura fereastra ascunsa reutilizata; cererile se serializeaza pe ea. */
let hidden: BrowserWindow | null = null
let queue: Promise<unknown> = Promise.resolve()

function getWindow(): BrowserWindow {
  if (hidden && !hidden.isDestroyed()) return hidden
  configureSession()
  hidden = new BrowserWindow({
    show: false,
    width: 1366,
    height: 900,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // paginile ascunse sunt incetinite altfel de Chromium
      backgroundThrottling: false
    }
  })
  hidden.on('closed', () => {
    hidden = null
  })
  return hidden
}

export interface RenderOptions {
  /** Cat astept incarcarea paginii. */
  timeoutMs?: number
  /** Pauza dupa incarcare, pentru rezultatele aduse prin JavaScript. */
  settleMs?: number
  /** Astept sa apara acest selector inainte de a citi HTML-ul. */
  waitForSelector?: string
  signal?: AbortSignal
}

/**
 * Incarca `url` si intoarce HTML-ul dupa randare. Sir gol la esec -- apelantii
 * trateaza deja "n-am primit nimic" ca pe un rezultat valid.
 */
export async function renderHtml(url: string, opts: RenderOptions = {}): Promise<string> {
  const { timeoutMs = 25_000, settleMs = 700, waitForSelector, signal } = opts

  const task = queue.then(async () => {
    if (signal?.aborted) return ''
    const win = getWindow()

    try {
      const load = win.loadURL(url, { userAgent: CHROME_UA })
      // loadURL nu se rezolva niciodata pe unele pagini; cursa cu un timeout
      await Promise.race([
        load.catch(() => undefined),
        delay(timeoutMs).then(() => {
          throw new Error('timeout la randare')
        })
      ])

      if (waitForSelector) {
        const deadline = Date.now() + Math.min(6000, timeoutMs)
        for (;;) {
          const found = await win.webContents
            .executeJavaScript(`!!document.querySelector(${JSON.stringify(waitForSelector)})`)
            .catch(() => false)
          if (found || Date.now() > deadline) break
          await delay(250)
        }
      } else {
        await delay(settleMs)
      }

      return (await win.webContents.executeJavaScript(
        'document.documentElement.outerHTML'
      )) as string
    } catch {
      return ''
    } finally {
      // las o pagina goala, ca sa nu ramana scripturi ruland intre cereri
      win.loadURL('about:blank').catch(() => undefined)
    }
  })

  queue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

/** Elibereaza fereastra ascunsa; apelata la inchiderea aplicatiei. */
export function disposeBrowser(): void {
  if (hidden && !hidden.isDestroyed()) hidden.destroy()
  hidden = null
}

export { CHROME_UA, PARTITION }
