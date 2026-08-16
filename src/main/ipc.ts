import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import type {
  Component,
  FieldDef,
  InventoryQuery,
  InventorySchema
} from '../shared/inventory'
import type {
  AppConfig,
  DownloadProgress,
  LibraryDoc,
  SearchProgress,
  SearchRequest,
  UpdateInfo
} from '../shared/types'
import {
  addField,
  adjustQuantity,
  exportCsv,
  getSchema,
  inventoryStats,
  listComponents,
  removeComponent,
  removeField,
  resetInventoryCache,
  saveSchema,
  upsertComponent
} from './inventory'
import { listSuppliers, searchSuppliers, supplierSearchUrl } from './suppliers'
import { checkForUpdate, downloadAndRestart } from './updater'
import { defaultLibrarySuggestion, loadConfig, saveConfig, validateLibraryPath } from './config'
import { downloadHit } from './download'
import { setPolitenessDelay } from './http'
import { importFiles } from './import'
import {
  absolutePathOf,
  getAllDocs,
  libraryStats,
  removeDoc,
  resetLibraryCache,
  searchLocal,
  updateDoc
} from './library'
import { explainQuery, runSearch } from './search/orchestrator'
import { listSources } from './search/registry'

/**
 * Puntea intre UI si motor.
 *
 * Cautarile si descarcarile sunt de lunga durata, asa ca nu le tratez ca
 * simple request/response: rezultatele parciale se trimit prin evenimente,
 * iar UI-ul le afiseaza pe masura ce apar.
 */

/** Cautari si descarcari in curs, ca sa le pot anula. */
const activeSearches = new Map<string, { cancel: () => void }>()
const activeDownloads = new Map<string, AbortController>()

function send(window: BrowserWindow | null, channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // ---- configurare ----

  ipcMain.handle('config:get', async (): Promise<AppConfig> => loadConfig())

  ipcMain.handle('config:set', async (_e, patch: Partial<AppConfig>): Promise<AppConfig> => {
    const next = await saveConfig(patch)
    if (patch.libraryPath !== undefined) {
      resetLibraryCache()
      resetInventoryCache()
    }
    if (patch.politenessDelayMs !== undefined) setPolitenessDelay(next.politenessDelayMs)
    return next
  })

  ipcMain.handle('config:suggest-path', async (): Promise<string> => defaultLibrarySuggestion())

  ipcMain.handle('config:pick-folder', async (): Promise<string | null> => {
    const window = getWindow()
    const result = await dialog.showOpenDialog(window ?? undefined!, {
      title: 'Alege folderul pentru librarie',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultLibrarySuggestion()
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })

  ipcMain.handle('config:validate-path', async (_e, dir: string) => validateLibraryPath(dir))

  // ---- surse ----

  ipcMain.handle('sources:list', async () => listSources())

  // ---- cautare ----

  ipcMain.handle('search:explain', async (_e, query: string) => explainQuery(query))

  ipcMain.handle('search:run', async (_e, req: SearchRequest) => {
    const window = getWindow()
    const onProgress = (p: SearchProgress): void => send(window, 'search:progress', p)

    const run = await runSearch(req, onProgress)
    activeSearches.set(run.runId, run)
    // curat referinta dupa ce cautarea s-a incheiat; anularea ulterioara e no-op
    activeSearches.delete(run.runId)
    return { runId: run.runId, hits: run.hits }
  })

  ipcMain.handle('search:cancel', async (_e, runId: string) => {
    activeSearches.get(runId)?.cancel()
    activeSearches.delete(runId)
    return true
  })

  // ---- descarcare ----

  ipcMain.handle('download:start', async (_e, payload: { hit: Parameters<typeof downloadHit>[0]; query: string }) => {
    const window = getWindow()
    const controller = new AbortController()
    activeDownloads.set(payload.hit.id, controller)

    const onProgress = (p: DownloadProgress): void => send(window, 'download:progress', p)
    try {
      return await downloadHit(payload.hit, payload.query, onProgress, controller.signal)
    } finally {
      activeDownloads.delete(payload.hit.id)
    }
  })

  ipcMain.handle('download:cancel', async (_e, hitId: string) => {
    activeDownloads.get(hitId)?.abort()
    activeDownloads.delete(hitId)
    return true
  })

  // ---- librarie ----

  ipcMain.handle('library:list', async (): Promise<LibraryDoc[]> => getAllDocs())

  ipcMain.handle('library:import', async (_e, hint?: string) => {
    const window = getWindow()
    const result = await dialog.showOpenDialog(window ?? undefined!, {
      title: 'Alege PDF-urile de importat in librarie',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documente PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePaths.length) return []
    return importFiles(result.filePaths, hint)
  })

  ipcMain.handle('library:search', async (_e, query: string) => searchLocal(query))

  ipcMain.handle('library:stats', async () => libraryStats())

  ipcMain.handle('library:open', async (_e, doc: LibraryDoc) => {
    const abs = await absolutePathOf(doc)
    const error = await shell.openPath(abs)
    return error ? { ok: false, error } : { ok: true }
  })

  ipcMain.handle('library:reveal', async (_e, doc: LibraryDoc) => {
    shell.showItemInFolder(await absolutePathOf(doc))
    return true
  })

  ipcMain.handle('library:open-root', async () => {
    const cfg = await loadConfig()
    if (!cfg.libraryPath) return { ok: false, error: 'libraria nu e configurata' }
    const error = await shell.openPath(cfg.libraryPath)
    return error ? { ok: false, error } : { ok: true }
  })

  ipcMain.handle('library:remove', async (_e, id: string, deleteFile: boolean) =>
    removeDoc(id, deleteFile)
  )

  ipcMain.handle('library:update', async (_e, id: string, patch: Partial<LibraryDoc>) =>
    updateDoc(id, patch)
  )

  // ---- inventar de componente ----

  ipcMain.handle('inventory:schema', async () => getSchema())
  ipcMain.handle('inventory:save-schema', async (_e, schema: InventorySchema) => saveSchema(schema))
  ipcMain.handle('inventory:add-field', async (_e, field: Omit<FieldDef, 'id'>) => addField(field))
  ipcMain.handle('inventory:remove-field', async (_e, id: string) => removeField(id))

  ipcMain.handle('inventory:list', async (_e, query: InventoryQuery) => listComponents(query))
  ipcMain.handle('inventory:upsert', async (_e, c: Partial<Component>) => upsertComponent(c))
  ipcMain.handle('inventory:remove', async (_e, id: string) => removeComponent(id))
  ipcMain.handle('inventory:adjust', async (_e, id: string, delta: number) =>
    adjustQuantity(id, delta)
  )
  ipcMain.handle('inventory:stats', async () => inventoryStats())

  ipcMain.handle('inventory:export-csv', async () => {
    const csv = await exportCsv()
    const window = getWindow()
    const result = await dialog.showSaveDialog(window ?? undefined!, {
      title: 'Exporta inventarul',
      defaultPath: 'inventar.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    // BOM ca Excel sa recunoasca diacriticele
    await writeFile(result.filePath, `﻿${csv}`, 'utf8')
    return { ok: true, path: result.filePath }
  })

  // ---- furnizori ----

  ipcMain.handle('suppliers:list', async () => listSuppliers())
  ipcMain.handle('suppliers:search', async (_e, query: string) => searchSuppliers(query))
  ipcMain.handle('suppliers:url', async (_e, supplierId: string, query: string) =>
    supplierSearchUrl(supplierId, query)
  )

  // ---- actualizare ----

  ipcMain.handle('update:check', async () => checkForUpdate())

  ipcMain.handle('update:download', async (_e, info: UpdateInfo) => {
    const window = getWindow()
    return downloadAndRestart(info, (p) => send(window, 'update:progress', p))
  })

  ipcMain.handle('app:version', async () => app.getVersion())

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    // deschid doar http(s): altfel as putea fi pacalit sa lansez un fisier local
    if (!/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })
}
