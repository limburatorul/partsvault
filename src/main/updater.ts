import { app } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { UpdateInfo, UpdateProgress } from '../shared/types'
import { httpFetch } from './http'

/**
 * Auto-actualizare pentru varianta portabila.
 *
 * Nu exista instalator: aplicatia e un singur .exe, deci "actualizarea"
 * inseamna sa pun fisierul nou langa cel vechi, sa-l pornesc si sa-l sterg pe
 * cel vechi. Tiparul e preluat din Game Browser, unde ruleaza de zeci de
 * versiuni, inclusiv cele doua capcane platite deja acolo:
 *
 *  - `process.execPath` NU e bun: exe-ul portabil se auto-extrage in
 *    `%TEMP%\<random>\`, deci arata spre copia temporara. Folderul real, unde
 *    sta fisierul pe care il dublu-clickeaza omul, vine din
 *    `PORTABLE_EXECUTABLE_DIR`, setata de wrapper-ul electron-builder.
 *  - stergerea vechiului exe esueaza daca procesul inlocuit inca tine lock pe
 *    fisier. `app.quit()` doar programeaza inchiderea, deci o singura
 *    incercare la pornire nu ajunge -- de aici reincercarile intarziate.
 */

const UPDATE_REPO = 'limburatorul/partsvault'
const ASSET_PATTERN = /^PartsVault-(\d+\.\d+\.\d+)-portabil\.exe$/i

interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
}

/** Folderul in care sta .exe-ul portabil, sau null cand rulam altfel. */
function portableDir(): string | null {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR
  return dir && dir.trim() ? dir : null
}

/** Compara `1.10.0` cu `1.9.0` numeric, nu alfabetic. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion()

  try {
    const res = await httpFetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      timeoutMs: 15_000,
      retries: 1
    })
    if (!res.ok) {
      return { available: false, currentVersion, error: `GitHub a raspuns ${res.status}` }
    }

    const release = (await res.json()) as GitHubRelease
    if (release.draft || release.prerelease) return { available: false, currentVersion }

    const latestVersion = (release.tag_name ?? '').replace(/^v/i, '')
    if (!latestVersion) return { available: false, currentVersion, error: 'release fara versiune' }
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      return { available: false, currentVersion, latestVersion }
    }

    const asset = (release.assets ?? []).find((a) => a.name && ASSET_PATTERN.test(a.name))
    if (!asset?.browser_download_url) {
      return { available: false, currentVersion, latestVersion, error: 'release fara executabil' }
    }

    return {
      available: true,
      currentVersion,
      latestVersion,
      notes: release.body?.slice(0, 4000),
      downloadUrl: asset.browser_download_url,
      sizeBytes: asset.size
    }
  } catch (err) {
    return {
      available: false,
      currentVersion,
      error: err instanceof Error ? err.message : 'verificarea a esuat'
    }
  }
}

/**
 * Descarca versiunea noua langa cea curenta, o porneste si inchide aplicatia.
 * Nu sterge nimic aici: curatarea o face urmatoarea pornire, cand fisierul
 * vechi nu mai e blocat.
 */
export async function downloadAndRestart(
  info: UpdateInfo,
  onProgress: (p: UpdateProgress) => void
): Promise<{ ok: boolean; error?: string }> {
  const dir = portableDir()
  if (!dir) return { ok: false, error: 'actualizarea automata merge doar pe varianta portabila' }
  if (!info.downloadUrl || !info.latestVersion) return { ok: false, error: 'lipseste link-ul' }

  const fileName = `PartsVault-${info.latestVersion}-portabil.exe`
  const target = path.join(dir, fileName)
  const temp = `${target}.partial`

  try {
    onProgress({ phase: 'downloading', receivedBytes: 0, totalBytes: info.sizeBytes })

    const res = await httpFetch(info.downloadUrl, { timeoutMs: 300_000, retries: 1 })
    if (!res.ok || !res.body) throw new Error(`descarcarea a raspuns ${res.status}`)

    const total = Number(res.headers.get('content-length')) || info.sizeBytes
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      received += value.byteLength
      onProgress({ phase: 'downloading', receivedBytes: received, totalBytes: total })
    }

    onProgress({ phase: 'verifying', message: 'Verific fisierul...' })

    // marimea anuntata de GitHub e singura verificare pe care o pot face fara
    // semnatura; prinde descarcarile trunchiate, care altfel ar da un exe mort
    if (info.sizeBytes && received !== info.sizeBytes) {
      throw new Error(`fisier incomplet: ${received} din ${info.sizeBytes} octeti`)
    }

    const buffer = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }

    // scriu intai cu alt nume: un .exe pe jumatate scris, cu numele final, ar
    // fi pornit de om inainte sa fie gata
    await fs.writeFile(temp, buffer)
    await fs.rename(temp, target)

    onProgress({ phase: 'restarting', message: 'Pornesc versiunea noua...' })

    // detasat, altfel noul proces moare odata cu cel curent
    const child = spawn(target, [], { detached: true, stdio: 'ignore', cwd: dir })
    child.unref()

    setTimeout(() => app.quit(), 800)
    return { ok: true }
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined)
    const message = err instanceof Error ? err.message : String(err)
    onProgress({ phase: 'error', message })
    return { ok: false, error: message }
  }
}

/**
 * Sterge executabilele mai vechi ramase langa cel curent.
 *
 * Ruleaza de trei ori: imediat, apoi la 5 si 20 de secunde. Procesul inlocuit
 * poate tine inca lock pe fisierul lui in momentul pornirii noastre, iar o
 * singura incercare esueaza tacut si lasa gunoiul acolo pana la urmatoarea
 * repornire -- exact bug-ul prins in Game Browser.
 */
export function cleanupOldExecutables(): void {
  const dir = portableDir()
  if (!dir) return
  const current = app.getVersion()

  const sweep = async (): Promise<void> => {
    try {
      for (const name of await fs.readdir(dir)) {
        const match = name.match(ASSET_PATTERN)
        if (!match) continue
        if (compareVersions(match[1], current) >= 0) continue
        await fs.unlink(path.join(dir, name)).catch(() => undefined)
      }
    } catch {
      // folderul poate fi indisponibil momentan; reincercarile acopera cazul
    }
  }

  void sweep()
  void delay(5_000).then(sweep)
  void delay(20_000).then(sweep)
}

export { UPDATE_REPO, portableDir }
