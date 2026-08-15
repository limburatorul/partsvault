import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppConfig } from '../shared/types'

/**
 * Configurarea aplicatiei.
 *
 * In varianta portabila totul sta intr-un singur folder langa executabil, ca
 * aplicatia sa nu lase urme prin sistem si sa poata fi mutata pe stick cu tot
 * cu librarie. `PORTABLE_EXECUTABLE_DIR` e setata de electron-builder si arata
 * unde se afla .exe-ul (nu folderul temporar in care se dezarhiveaza).
 */

const PORTABLE_FOLDER = 'PartsVault-Date'

const DEFAULTS: AppConfig = {
  libraryPath: null,
  disabledSources: [],
  autoDownloadBest: false,
  politenessDelayMs: 900,
  maxConcurrentDownloads: 3,
  maxFileSizeMb: 80,
  supplierApiKeys: {}
}

let cached: AppConfig | null = null

/** Folderul care contine .exe-ul portabil, sau null cand rulam normal. */
function portableExeDir(): string | null {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR
  return dir && dir.trim() ? dir : null
}

export function isPortable(): boolean {
  return portableExeDir() !== null
}

/** Radacina in care tinem config-ul, indexul si documentele. */
export function dataRoot(): string {
  const exeDir = portableExeDir()
  return exeDir ? path.join(exeDir, PORTABLE_FOLDER) : app.getPath('userData')
}

function configFile(): string {
  return path.join(dataRoot(), 'config.json')
}

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached
  try {
    const raw = await fs.readFile(configFile(), 'utf8')
    // merge cu DEFAULTS ca sa nu crape dupa ce adaug campuri noi intr-o versiune viitoare
    cached = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppConfig>) }
  } catch {
    cached = { ...DEFAULTS }
  }

  // In varianta portabila nu are rost sa intreb unde sa salvez: raspunsul e
  // intotdeauna "langa executabil". Configurez tacut si sar peste primul ecran.
  if (!cached.libraryPath && isPortable()) {
    cached.libraryPath = dataRoot()
    await saveConfig({ libraryPath: cached.libraryPath })
  }

  return cached
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig()
  const next: AppConfig = { ...current, ...patch }
  await fs.mkdir(path.dirname(configFile()), { recursive: true })
  await fs.writeFile(configFile(), JSON.stringify(next, null, 2), 'utf8')
  cached = next
  return next
}

/** Calea sugerata la prima pornire, daca omul nu vrea sa aleaga el. */
export function defaultLibrarySuggestion(): string {
  return isPortable() ? dataRoot() : path.join(app.getPath('documents'), 'PartsVault')
}

/** Verifica daca o cale e utilizabila ca radacina de librarie (o si creeaza). */
export async function validateLibraryPath(dir: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.mkdir(dir, { recursive: true })
    const probe = path.join(dir, '.partsvault-write-test')
    await fs.writeFile(probe, 'ok', 'utf8')
    await fs.unlink(probe)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
