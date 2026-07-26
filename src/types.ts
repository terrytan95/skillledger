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

export interface ReconcileRequest {
  skillIds?: string[]
  agentIds?: string[]
  copyPolicy?: 'preserve' | 'replace-with-symlink'
}

export interface PathFingerprint {
  kind: 'missing' | 'directory' | 'symlink' | 'file' | 'other'
  sha256: string | null
  linkTarget: string | null
}

export interface PlannedOperation {
  id: string
  skillId: string
  agentId: string
  kind: 'create-symlink' | 'repair-symlink' | 'replace-copy'
  targetPath: string
  canonicalPath: string
  before: PathFingerprint
  after: PathFingerprint
}

export interface PlanBlocker {
  skillId: string
  agentId?: string
  code: 'missing-canonical' | 'copy-requires-confirmation' | 'unsupported-source' | 'missing-agent-root'
  path: string
  message: string
}

export interface ReconciliationPreview {
  planId: string
  status: 'ready' | 'blocked' | 'noop'
  generatedAt: string
  algorithm: 'sha256-tree-v1'
  operations: PlannedOperation[]
  blockers: PlanBlocker[]
  summary: {
    createLinks: number
    repairLinks: number
    replaceCopies: number
    unchanged: number
    blocked: number
  }
  warnings: string[]
}

export interface ReconcileError {
  code:
    | 'plan-not-found'
    | 'plan-consumed'
    | 'plan-blocked'
    | 'stale-plan'
    | 'path-rejected'
    | 'write-failed'
    | 'journal-not-found'
    | 'journal-corrupt'
    | 'operation-in-progress'
    | 'rollback-conflict'
    | 'rollback-failed'
  phase: 'apply' | 'verify' | 'rollback'
  message: string
}

export type ApplyResult =
  | { status: 'applied'; planId: string; journalId: string; snapshot: InventorySnapshot }
  | { status: 'already-applied'; planId: string; journalId: string; snapshot: InventorySnapshot }
  | { status: 'rejected'; planId: string; error: ReconcileError }
  | { status: 'rolled-back'; planId: string; journalId: string; error: ReconcileError; snapshot: InventorySnapshot }
  | { status: 'rollback-incomplete'; planId: string; journalId: string; error: ReconcileError }

export type RollbackResult =
  | { status: 'rolled-back'; journalId: string; snapshot: InventorySnapshot }
  | { status: 'already-rolled-back'; journalId: string; snapshot: InventorySnapshot }
  | { status: 'rejected' | 'rollback-incomplete'; journalId: string; error: ReconcileError }

export interface AppUpdateInfo {
  currentVersion: string
  latestVersion: string
  available: boolean
}

export interface SkillLedgerBridge {
  scan: () => Promise<InventorySnapshot>
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<AppUpdateInfo>
  openUpdatesPage: () => Promise<void>
  reconcile: {
    preview: (request?: ReconcileRequest) => Promise<ReconciliationPreview>
    apply: (planId: string) => Promise<ApplyResult>
    rollback: (journalId: string) => Promise<RollbackResult>
  }
}
