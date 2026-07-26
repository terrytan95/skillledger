import { contextBridge, ipcRenderer } from 'electron'
import type { InventorySnapshot, SkillLedgerBridge } from '../src/types'

const bridge: SkillLedgerBridge = {
  scan: () => ipcRenderer.invoke('skillledger:scan') as Promise<InventorySnapshot>,
}

contextBridge.exposeInMainWorld('skillLedger', bridge)
