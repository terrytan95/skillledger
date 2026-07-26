import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { scanGlobalSkills } from './skill-inventory'

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const devServerUrl = process.env['VITE_DEV_SERVER_URL']
const rendererDist = path.join(appRoot, 'dist')
const preloadPath = path.join(appRoot, 'dist-electron', 'preload.mjs')
const scanChannel = 'skillledger:scan'

function isTrustedSender(rawUrl: string): boolean {
  try {
    const sender = new URL(rawUrl)
    if (devServerUrl) return sender.origin === new URL(devServerUrl).origin
    return sender.protocol === 'file:' && fileURLToPath(sender).startsWith(rendererDist)
  } catch {
    return false
  }
}

function registerIpc(): void {
  ipcMain.handle(scanChannel, async (event) => {
    if (!event.senderFrame || !isTrustedSender(event.senderFrame.url)) {
      throw new Error('Untrusted IPC sender')
    }
    return scanGlobalSkills()
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: 'SkillLedger',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f3f1eb',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url)) event.preventDefault()
  })

  if (devServerUrl) void window.loadURL(devServerUrl)
  else void window.loadFile(path.join(rendererDist, 'index.html'))

  return window
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(() => {
  registerIpc()
  createWindow()
})
