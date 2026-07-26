import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppUpdateInfo,
  ApplyResult,
  InventorySnapshot,
  ReconcileRequest,
  ReconciliationPreview,
  RollbackResult,
  SkillLedgerBridge,
} from '../src/types'

const bridge: SkillLedgerBridge = {
  scan: () => ipcRenderer.invoke('skillledger:scan') as Promise<InventorySnapshot>,
  getAppVersion: () => ipcRenderer.invoke('skillledger:get-app-version') as Promise<string>,
  checkForUpdates: () => ipcRenderer.invoke('skillledger:check-for-updates') as Promise<AppUpdateInfo>,
  openUpdatesPage: () => ipcRenderer.invoke('skillledger:open-updates-page') as Promise<void>,
  reconcile: {
    preview: (request?: ReconcileRequest) => ipcRenderer.invoke(
      'skillledger:reconcile:preview',
      request,
    ) as Promise<ReconciliationPreview>,
    apply: (planId: string) => ipcRenderer.invoke(
      'skillledger:reconcile:apply',
      planId,
    ) as Promise<ApplyResult>,
    rollback: (journalId: string) => ipcRenderer.invoke(
      'skillledger:reconcile:rollback',
      journalId,
    ) as Promise<RollbackResult>,
  },
}

contextBridge.exposeInMainWorld('skillLedger', bridge)
