import { app, BrowserWindow, dialog, ipcMain, net, shell, type IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { checkForUpdates as checkLatestRelease } from './app-update'
import { defaultAgentLocations, readSkillContent, validSkillId } from './skill-inventory'
import { serializeInventoryExport } from './inventory-export'
import { SkillReconciler } from './skill-reconciler'
import { discoverGitHubSourceUpdates } from './skill-source'
import { TeamManager } from './team-policy'
import type { AppUpdateStatus, ReconcileRequest } from '../src/types'

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const devServerUrl = process.env['VITE_DEV_SERVER_URL']
const rendererDist = path.join(appRoot, 'dist')
const preloadPath = path.join(appRoot, 'dist-electron', 'preload.mjs')
const channels = {
  scan: 'skillledger:scan',
  readSkillContent: 'skillledger:skill:read-content',
  revealSkill: 'skillledger:skill:reveal',
  previewExternalSkill: 'skillledger:external:preview',
  installExternalSkill: 'skillledger:external:install',
  deleteSkill: 'skillledger:skill:delete',
  checkSourceUpdates: 'skillledger:source:check-updates',
  exportInventory: 'skillledger:inventory:export',
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
  updateState: 'skillledger:update-state',
  installUpdate: 'skillledger:install-update',
  openUpdatesPage: 'skillledger:open-updates-page',
} as const
const updatesPage = 'https://github.com/terrytan95/skillledger/releases/latest'
let updateStatus: AppUpdateStatus = {
  currentVersion: app.getVersion(),
  latestVersion: app.getVersion(),
  available: false,
  phase: 'idle',
  downloadPercent: null,
}
const homeDir = os.homedir()
const teamManager = new TeamManager(homeDir)
const reconciler = new SkillReconciler({
  homeDir,
  agentLocations: defaultAgentLocations,
  fetchSource: net.fetch,
  teamManager,
})

function publishUpdateStatus(status: AppUpdateStatus): void {
  updateStatus = status
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channels.updateState, status)
  }
}

function configureUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = console
  autoUpdater.on('checking-for-update', () => {
    publishUpdateStatus({ ...updateStatus, phase: 'checking', downloadPercent: null })
  })
  autoUpdater.on('update-available', (info) => {
    publishUpdateStatus({
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      available: true,
      phase: 'downloading',
      downloadPercent: 0,
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    publishUpdateStatus({ ...updateStatus, phase: 'downloading', downloadPercent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    publishUpdateStatus({
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      available: true,
      phase: 'downloaded',
      downloadPercent: 100,
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    publishUpdateStatus({
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      available: false,
      phase: 'up-to-date',
      downloadPercent: null,
    })
  })
  autoUpdater.on('error', (error) => {
    console.error('SkillLedger update failed.', error)
    publishUpdateStatus({ ...updateStatus, phase: 'error', downloadPercent: null })
  })
}

async function checkAppUpdates(): Promise<AppUpdateStatus> {
  publishUpdateStatus({ ...updateStatus, phase: 'checking', downloadPercent: null })
  const info = await checkLatestRelease(app.getVersion(), net.fetch)
  if (!info.available || !app.isPackaged) {
    publishUpdateStatus({
      ...info,
      phase: info.available ? 'available' : 'up-to-date',
      downloadPercent: null,
    })
    return updateStatus
  }

  await autoUpdater.checkForUpdates()
  return updateStatus
}

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
    return reconciler.scan()
  })
  ipcMain.handle(channels.readSkillContent, async (event, value: unknown) => {
    assertTrustedSender(event)
    const request = parseSkillContentRequest(value)
    return readSkillContent(homeDir, request.skillId, request.relativePath)
  })
  ipcMain.handle(channels.revealSkill, async (event, value: unknown) => {
    assertTrustedSender(event)
    const skillId = parseSkillId(value)
    shell.showItemInFolder(path.join(homeDir, '.agents', 'skills', skillId, 'SKILL.md'))
  })
  ipcMain.handle(channels.previewExternalSkill, async (event, value: unknown) => {
    assertTrustedSender(event)
    return reconciler.previewExternalSkill(parseExternalSkillUrl(value))
  })
  ipcMain.handle(channels.installExternalSkill, async (event, value: unknown) => {
    assertTrustedSender(event)
    return reconciler.apply(parseOpaqueId(value))
  })
  ipcMain.handle(channels.deleteSkill, async (event, value: unknown) => {
    assertTrustedSender(event)
    return reconciler.deleteSkill(parseSkillId(value))
  })
  ipcMain.handle(channels.checkSourceUpdates, async (event) => {
    assertTrustedSender(event)
    const snapshot = await reconciler.scan()
    const pins = Object.fromEntries(
      snapshot.skills.flatMap((skill) => skill.sourcePin ? [[skill.id, skill.sourcePin]] : []),
    )
    return discoverGitHubSourceUpdates(pins, net.fetch)
  })
  ipcMain.handle(channels.exportInventory, async (event) => {
    assertTrustedSender(event)
    const choice = await dialog.showSaveDialog({
      title: 'Export reproducible inventory',
      defaultPath: 'skillledger-inventory.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (choice.canceled || !choice.filePath) return { status: 'cancelled' }
    const snapshot = await reconciler.scan()
    await writeFile(choice.filePath, serializeInventoryExport(snapshot), { encoding: 'utf8', mode: 0o600 })
    return { status: 'exported', fileName: path.basename(choice.filePath), skillCount: snapshot.skills.length }
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
    return checkAppUpdates()
  })
  ipcMain.handle(channels.installUpdate, (event) => {
    assertTrustedSender(event)
    if (updateStatus.phase !== 'downloaded') throw new Error('No downloaded update is ready to install')
    setImmediate(() => autoUpdater.quitAndInstall())
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

function parseSkillId(value: unknown): string {
  if (typeof value !== 'string' || !validSkillId(value)) throw new Error('Invalid skill identifier')
  return value
}

function parseExternalSkillUrl(value: unknown): string {
  if (
    typeof value !== 'string'
    || !value
    || Buffer.byteLength(value) > 2_048
    || value.includes('\0')
  ) {
    throw new Error('Invalid GitHub skill URL')
  }
  return value
}

function parseSkillContentRequest(value: unknown): { skillId: string; relativePath: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid skill content request')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !['skillId', 'relativePath'].includes(key))) {
    throw new Error('Invalid skill content request')
  }
  const relativePath = record.relativePath ?? 'SKILL.md'
  if (typeof relativePath !== 'string') throw new Error('Invalid skill content request')
  return { skillId: parseSkillId(record.skillId), relativePath }
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
    configureUpdater()
    registerIpc()
    createWindow()
  })
}
