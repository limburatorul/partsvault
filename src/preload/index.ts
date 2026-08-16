import { contextBridge, ipcRenderer } from 'electron'
import type {
  Component,
  FieldDef,
  InventoryQuery,
  InventorySchema,
  SupplierInfo,
  SupplierResult
} from '../shared/inventory'
import type {
  AppConfig,
  DownloadProgress,
  LibraryDoc,
  PartAnalysis,
  SearchHit,
  SearchProgress,
  SearchRequest,
  SourceInfo,
  UpdateInfo,
  UpdateProgress
} from '../shared/types'

/**
 * API-ul expus renderer-ului. Suprafata e deliberat mica si tipizata:
 * UI-ul nu are acces la Node, doar la operatiile de mai jos.
 */
const api = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    set: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:set', patch),
    suggestPath: (): Promise<string> => ipcRenderer.invoke('config:suggest-path'),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('config:pick-folder'),
    validatePath: (dir: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('config:validate-path', dir)
  },

  sources: {
    list: (): Promise<SourceInfo[]> => ipcRenderer.invoke('sources:list')
  },

  search: {
    explain: (query: string): Promise<PartAnalysis> => ipcRenderer.invoke('search:explain', query),
    run: (req: SearchRequest): Promise<{ runId: string; hits: SearchHit[] }> =>
      ipcRenderer.invoke('search:run', req),
    cancel: (runId: string): Promise<boolean> => ipcRenderer.invoke('search:cancel', runId),
    /** Intoarce functia de dezabonare, ca React sa poata curata la unmount. */
    onProgress: (cb: (p: SearchProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: SearchProgress): void => cb(p)
      ipcRenderer.on('search:progress', listener)
      return () => ipcRenderer.removeListener('search:progress', listener)
    }
  },

  download: {
    start: (hit: SearchHit, query: string) => ipcRenderer.invoke('download:start', { hit, query }),
    cancel: (hitId: string): Promise<boolean> => ipcRenderer.invoke('download:cancel', hitId),
    onProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: DownloadProgress): void => cb(p)
      ipcRenderer.on('download:progress', listener)
      return () => ipcRenderer.removeListener('download:progress', listener)
    }
  },

  library: {
    list: (): Promise<LibraryDoc[]> => ipcRenderer.invoke('library:list'),
    /** Deschide un dialog de fisiere si importa PDF-urile alese. */
    import: (
      hint?: string
    ): Promise<Array<{ file: string; ok: boolean; error?: string; doc?: LibraryDoc }>> =>
      ipcRenderer.invoke('library:import', hint),
    search: (query: string): Promise<LibraryDoc[]> => ipcRenderer.invoke('library:search', query),
    stats: (): Promise<{ total: number; byKind: Record<string, number>; totalBytes: number }> =>
      ipcRenderer.invoke('library:stats'),
    open: (doc: LibraryDoc) => ipcRenderer.invoke('library:open', doc),
    reveal: (doc: LibraryDoc) => ipcRenderer.invoke('library:reveal', doc),
    openRoot: () => ipcRenderer.invoke('library:open-root'),
    remove: (id: string, deleteFile: boolean): Promise<boolean> =>
      ipcRenderer.invoke('library:remove', id, deleteFile),
    update: (id: string, patch: Partial<LibraryDoc>): Promise<LibraryDoc | null> =>
      ipcRenderer.invoke('library:update', id, patch)
  },

  inventory: {
    schema: (): Promise<InventorySchema> => ipcRenderer.invoke('inventory:schema'),
    saveSchema: (schema: InventorySchema): Promise<InventorySchema> =>
      ipcRenderer.invoke('inventory:save-schema', schema),
    addField: (field: Omit<FieldDef, 'id'>): Promise<FieldDef> =>
      ipcRenderer.invoke('inventory:add-field', field),
    removeField: (id: string): Promise<boolean> => ipcRenderer.invoke('inventory:remove-field', id),

    list: (query: InventoryQuery = {}): Promise<Component[]> =>
      ipcRenderer.invoke('inventory:list', query),
    upsert: (component: Partial<Component>): Promise<Component> =>
      ipcRenderer.invoke('inventory:upsert', component),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('inventory:remove', id),
    adjust: (id: string, delta: number): Promise<Component | null> =>
      ipcRenderer.invoke('inventory:adjust', id, delta),
    stats: (): Promise<{
      total: number
      totalPieces: number
      lowStock: number
      byCategory: Record<string, number>
    }> => ipcRenderer.invoke('inventory:stats'),
    exportCsv: (): Promise<{ ok: boolean; path?: string }> =>
      ipcRenderer.invoke('inventory:export-csv')
  },

  suppliers: {
    list: (): Promise<SupplierInfo[]> => ipcRenderer.invoke('suppliers:list'),
    search: (query: string): Promise<SupplierResult[]> =>
      ipcRenderer.invoke('suppliers:search', query),
    url: (supplierId: string, query: string): Promise<string | null> =>
      ipcRenderer.invoke('suppliers:url', supplierId, query)
  },

  update: {
    check: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:check'),
    download: (info: UpdateInfo): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('update:download', info),
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    /** Notificarea de la pornire, cand exista o versiune mai noua. */
    onAvailable: (cb: (info: UpdateInfo) => void): (() => void) => {
      const listener = (_e: unknown, info: UpdateInfo): void => cb(info)
      ipcRenderer.on('update:available', listener)
      return () => ipcRenderer.removeListener('update:available', listener)
    },
    onProgress: (cb: (p: UpdateProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: UpdateProgress): void => cb(p)
      ipcRenderer.on('update:progress', listener)
      return () => ipcRenderer.removeListener('update:progress', listener)
    }
  },

  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open-external', url)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
