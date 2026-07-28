/// <reference types="vite-plugin-electron/electron-env" />

import type { SkillLedgerBridge } from './ipc-contract'

declare global {
  interface Window {
    skillLedger?: SkillLedgerBridge
  }
}
