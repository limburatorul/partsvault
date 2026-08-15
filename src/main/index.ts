import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { disposeBrowser } from './browser'
import { loadConfig } from './config'
import { setPolitenessDelay } from './http'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    title: 'PartsVault',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // izolarea contextului e obligatorie: renderer-ul primeste doar API-ul din preload
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // link-urile externe se deschid in browserul implicit, nu intr-o fereastra Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  const cfg = await loadConfig()
  setPolitenessDelay(cfg.politenessDelayMs)

  registerIpc(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // fereastra ascunsa de randare nu se inchide singura si ar tine procesul viu
  disposeBrowser()
})
