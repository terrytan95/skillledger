import { contextBridge, ipcRenderer } from 'electron'
import {
  ipcChannels,
  ipcEventChannels,
  type IpcArgs,
  type IpcOperation,
  type IpcResult,
  type SkillLedgerBridge,
} from './ipc-contract'
import type { AppUpdateStatus } from '../src/types'

function invoke<Operation extends IpcOperation>(
  operation: Operation,
  ...args: IpcArgs<Operation>
): Promise<IpcResult<Operation>> {
  return ipcRenderer.invoke(ipcChannels[operation], ...args) as Promise<IpcResult<Operation>>
}

const bridge: SkillLedgerBridge = {
  scan: () => invoke('scan'),
  readSkillContent: (skillId, relativePath) => invoke('readSkillContent', { skillId, relativePath }),
  revealSkill: (skillId) => invoke('revealSkill', skillId),
  previewExternalSkill: (url) => invoke('previewExternalSkill', url),
  installExternalSkill: (planId) => invoke('installExternalSkill', planId),
  deleteSkill: (skillId) => invoke('deleteSkill', skillId),
  openSkillSource: (skillId) => invoke('openSkillSource', skillId),
  checkSourceUpdates: () => invoke('checkSourceUpdates'),
  exportInventory: () => invoke('exportInventory'),
  getAppVersion: () => invoke('appVersion'),
  checkForUpdates: () => invoke('checkUpdates'),
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => listener(status)
    ipcRenderer.on(ipcEventChannels.updateState, handler)
    return () => ipcRenderer.removeListener(ipcEventChannels.updateState, handler)
  },
  installUpdate: () => invoke('installUpdate'),
  openUpdatesPage: () => invoke('openUpdatesPage'),
  reconcile: {
    preview: (request) => invoke('reconcilePreview', request),
    apply: (planId) => invoke('reconcileApply', planId),
    rollback: (journalId) => invoke('reconcileRollback', journalId),
    activity: () => invoke('reconcileActivity'),
    discard: (journalId) => invoke('reconcileDiscard', journalId),
  },
  team: {
    status: () => invoke('teamStatus'),
    importPolicy: (json) => invoke('teamImportPolicy', json),
    importManifest: (json) => invoke('teamImportManifest', json),
  },
}

contextBridge.exposeInMainWorld('skillLedger', bridge)
