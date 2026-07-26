import { app, BrowserWindow, ipcMain, net, shell, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { checkForUpdates } from './app-update'
import { defaultAgentLocations, scanGlobalSkills } from './skill-inventory'
import { SkillReconciler } from './skill-reconciler'
import { TeamManager } from './team-policy'
import type { ReconcileRequest } from '../src/types'

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const devServerUrl = process.env['VITE_DEV_SERVER_URL']
const rendererDist = path.join(appRoot, 'dist')
const preloadPath = path.join(appRoot, 'dist-electron', 'preload.mjs')
const channels = {
  scan: 'skillledger:scan',
  preview: 'skillledger:reconcile:preview',
  apply: 'skillledger:reconcile:apply',
  rollback: 'skillledger:reconcile:rollback',
  activity: 'skillledger:reconcile:activity',
  discard: 'skillledger:reconcile:discard',
  teamStatus: 'skillledger:team:status',
  importPolicy: 'skillledger:team:import-policy',
  importManifest: 'skillledger:team:import-manifest',
  appVersion: 'skillledger:get-app-version',
  checkUpdates: 'skillledger:check-for-updates',
  openUpdatesPage: 'skillledger:open-updates-page',
} as const
const updatesPage = 'https://github.com/terrytan95/skillledger/releases/latest'
const homeDir = os.homedir()
const teamManager = new TeamManager(homeDir)
const reconciler = new SkillReconciler({
  homeDir,
  agentLocations: defaultAgentLocations,
  fetchSource: net.fetch,
  teamManager,
})

function isTrustedSender(rawUrl: string): boolean {
  try {
    const sender = new URL(rawUrl)
    if (devServerUrl) return sender.origin === new URL(devServerUrl).origin
    if (sender.protocol !== 'file:') return false
    const relative = path.relative(rendererDist, fileURLToPath(sender))
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  } catch {
    return false
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || !isTrustedSender(event.senderFrame.url)) {
    throw new Error('Untrusted IPC sender')
  }
}

function registerIpc(): void {
  ipcMain.handle(channels.scan, async (event) => {
    assertTrustedSender(event)
    return scanGlobalSkills({ sourcePins: await teamManager.sourcePins() })
  })
  ipcMain.handle(channels.preview, async (event, value: unknown) => {
    assertTrustedSender(event)
    return reconciler.preview(parseReconcileRequest(value))
  })
  ipcMain.handle(channels.apply, async (event, value: unknown) => {
    assertTrustedSender(event)
    return reconciler.apply(parseOpaqueId(value))
  })
  ipcMain.handle(channels.rollback, async (event, value: unknown) => {
    assertTrustedSender(event)
    return reconciler.rollback(parseOpaqueId(value))
  })
  ipcMain.handle(channels.activity, async (event) => {
    assertTrustedSender(event)
    return reconciler.activity()
  })
  ipcMain.handle(channels.discard, async (event, value: unknown) => {
    assertTrustedSender(event)
    return reconciler.discard(parseOpaqueId(value))
  })
  ipcMain.handle(channels.teamStatus, async (event) => {
    assertTrustedSender(event)
    return teamManager.status()
  })
  ipcMain.handle(channels.importPolicy, async (event, value: unknown) => {
    assertTrustedSender(event)
    return teamManager.importPolicy(parseTeamDocument(value))
  })
  ipcMain.handle(channels.importManifest, async (event, value: unknown) => {
    assertTrustedSender(event)
    return teamManager.importManifest(parseTeamDocument(value))
  })
  ipcMain.handle(channels.appVersion, (event) => {
    assertTrustedSender(event)
    return app.getVersion()
  })
  ipcMain.handle(channels.checkUpdates, async (event) => {
    assertTrustedSender(event)
    return checkForUpdates(app.getVersion(), net.fetch)
  })
  ipcMain.handle(channels.openUpdatesPage, async (event) => {
    assertTrustedSender(event)
    await shell.openExternal(updatesPage)
  })
}

function parseOpaqueId(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error('Invalid reconciliation identifier')
  }
  return value
}

function parseReconcileRequest(value: unknown): ReconcileRequest {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid reconciliation request')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !['skillIds', 'agentIds', 'copyPolicy', 'sourcePolicy'].includes(key))) {
    throw new Error('Invalid reconciliation request')
  }
  const parseIds = (ids: unknown): string[] | undefined => {
    if (ids === undefined) return undefined
    if (
      !Array.isArray(ids)
      || ids.length > 1_000
      || ids.some((id) => typeof id !== 'string' || !id || id.length > 256 || id.includes('\0'))
    ) {
      throw new Error('Invalid reconciliation request')
    }
    return ids as string[]
  }
  if (
    record.copyPolicy !== undefined
    && record.copyPolicy !== 'preserve'
    && record.copyPolicy !== 'replace-with-symlink'
  ) {
    throw new Error('Invalid reconciliation request')
  }
  if (
    record.sourcePolicy !== undefined
    && record.sourcePolicy !== 'preserve'
    && record.sourcePolicy !== 'restore-pinned'
  ) {
    throw new Error('Invalid reconciliation request')
  }
  return {
    skillIds: parseIds(record.skillIds),
    agentIds: parseIds(record.agentIds),
    copyPolicy: record.copyPolicy as ReconcileRequest['copyPolicy'],
    sourcePolicy: record.sourcePolicy as ReconcileRequest['sourcePolicy'],
  }
}

function parseTeamDocument(value: unknown): string {
  if (
    typeof value !== 'string'
    || !value
    || Buffer.byteLength(value) > 256 * 1024
    || value.includes('\0')
  ) {
    throw new Error('Invalid team document')
  }
  return value
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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.whenReady().then(async () => {
    try {
      const recovery = await reconciler.recoverIncomplete()
      if (recovery.failed.length) {
        console.error(`SkillLedger could not recover journals: ${recovery.failed.join(', ')}`)
      }
    } catch (error) {
      console.error('SkillLedger could not inspect recovery journals.', error)
    }
    registerIpc()
    createWindow()
  })
}
