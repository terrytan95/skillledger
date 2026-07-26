import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApplyResult,
  InventorySnapshot,
  ReconcileRequest,
  ReconciliationPreview,
  RollbackResult,
  SkillLedgerBridge,
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
  },
}

contextBridge.exposeInMainWorld('skillLedger', bridge)
