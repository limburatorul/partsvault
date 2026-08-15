/**
 * Inlocuitor pentru modulul `electron` in harness-ul de test.
 * Motorul de cautare atinge Electron doar prin `app.getPath`, asa ca atat
 * trebuie sa simulez ca sa-l pot rula direct in Node.
 */
import os from 'node:os'
import path from 'node:path'

const base = path.join(os.tmpdir(), 'partsvault-probe')

export const app = {
  getPath: (name) => (name === 'documents' ? path.join(base, 'docs') : path.join(base, name))
}

export const ipcMain = { handle: () => {} }
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
export const shell = { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} }
export const BrowserWindow = class {}

export default { app, ipcMain, dialog, shell, BrowserWindow }
