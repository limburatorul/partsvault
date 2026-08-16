import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { disposeBrowser } from './browser'
import { isPortable, loadConfig } from './config'
import { setPolitenessDelay } from './http'
import { registerIpc } from './ipc'
import { checkForUpdate, cleanupOldExecutables } from './updater'

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

  // curat executabilele vechi ramase langa cel curent, cu reincercari:
  // procesul inlocuit poate tine inca lock pe fisierul lui
  cleanupOldExecutables()

  // Verificarea porneste dupa ce fereastra e vizibila, ca sa nu incetineasca
  // pornirea; e tacuta daca nu exista versiune noua. Doar pe varianta portabila:
  // altfel in dev ar aparea un banner care ofera o actualizare ce n-are cum sa
  // se instaleze, fiindca nu exista un exe langa care sa punem altul.
  if (isPortable()) {
    setTimeout(async () => {
      const info = await checkForUpdate()
      if (info.available && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:available', info)
      }
    }, 3000)
  }

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
