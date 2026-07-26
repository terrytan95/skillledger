/// <reference types="vite-plugin-electron/electron-env" />

import type { SkillLedgerBridge } from '../src/types'

declare global {
  interface Window {
    skillLedger?: SkillLedgerBridge
  }
}
