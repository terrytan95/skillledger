import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActivitySnapshot,
  ApplyResult,
  DiscardResult,
  InventorySnapshot,
  ReconcileRequest,
  ReconciliationPreview,
  RollbackResult,
  SkillLedgerBridge,
  TeamImportResult,
  TeamStatus,
} from '../src/types'

const bridge: SkillLedgerBridge = {
  scan: () => ipcRenderer.invoke('skillledger:scan') as Promise<InventorySnapshot>,
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
