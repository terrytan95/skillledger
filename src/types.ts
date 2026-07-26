export type SkillHealth = 'healthy' | 'review' | 'missing' | 'broken'
export type AgentInstallKind = 'canonical' | 'symlink' | 'copy'

export interface AgentPresence {
  id: string
  label: string
  path: string
  kind: AgentInstallKind
  healthy: boolean
}

export interface SkillRecord {
  id: string
  name: string
  description: string
  canonicalPath: string
  source: string | null
  sourceUrl: string | null
  sourceType: string | null
  updatedAt: string | null
  health: SkillHealth
  healthReason: string
  agents: AgentPresence[]
}

export interface InventorySummary {
  total: number
  healthy: number
  review: number
  missing: number
  broken: number
  agentLinks: number
}

export interface InventorySnapshot {
  scannedAt: string
  canonicalRoot: string
  lockFilePath: string
  skills: SkillRecord[]
  summary: InventorySummary
  warnings: string[]
}

export interface SkillLedgerBridge {
  scan: () => Promise<InventorySnapshot>
}
