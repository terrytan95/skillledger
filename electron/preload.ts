import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActivitySnapshot,
  AppUpdateInfo,
  ApplyResult,
  DiscardResult,
  InventoryExportResult,
  InventorySnapshot,
  ReconcileRequest,
  ReconciliationPreview,
  RollbackResult,
  SkillLedgerBridge,
  SourceUpdateSnapshot,
  TeamImportResult,
  TeamStatus,
} from '../src/types'

const bridge: SkillLedgerBridge = {
  scan: () => ipcRenderer.invoke('skillledger:scan') as Promise<InventorySnapshot>,
  checkSourceUpdates: () => ipcRenderer.invoke(
    'skillledger:source:check-updates',
  ) as Promise<SourceUpdateSnapshot>,
  exportInventory: () => ipcRenderer.invoke(
    'skillledger:inventory:export',
  ) as Promise<InventoryExportResult>,
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
    activity: () => ipcRenderer.invoke(
      'skillledger:reconcile:activity',
    ) as Promise<ActivitySnapshot>,
    discard: (journalId: string) => ipcRenderer.invoke(
      'skillledger:reconcile:discard',
      journalId,
    ) as Promise<DiscardResult>,
  },
  team: {
    status: () => ipcRenderer.invoke('skillledger:team:status') as Promise<TeamStatus>,
    importPolicy: (json: string) => ipcRenderer.invoke(
      'skillledger:team:import-policy',
      json,
    ) as Promise<TeamImportResult>,
    importManifest: (json: string) => ipcRenderer.invoke(
      'skillledger:team:import-manifest',
      json,
    ) as Promise<TeamImportResult>,
  },
}

contextBridge.exposeInMainWorld('skillLedger', bridge)
