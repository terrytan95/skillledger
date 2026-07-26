export type SkillHealth = 'healthy' | 'review' | 'missing' | 'broken'
export type AgentInstallKind = 'canonical' | 'symlink' | 'copy'

export interface SourcePin {
  repository: string
  path: string
  revision: string
  sha256: string
}

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
  sourcePin: SourcePin | null
  sourceState: 'local' | 'pinned' | 'drifted' | 'missing'
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
  sourcePolicy?: 'preserve' | 'restore-pinned'
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
  kind: 'create-symlink' | 'repair-symlink' | 'replace-copy' | 'restore-canonical' | 'update-canonical'
  targetPath: string
  canonicalPath: string
  before: PathFingerprint
  after: PathFingerprint
  sourcePin?: SourcePin
}

export interface PlanBlocker {
  skillId: string
  agentId?: string
  code:
    | 'missing-canonical'
    | 'copy-requires-confirmation'
    | 'source-restore-requires-confirmation'
    | 'source-update-requires-confirmation'
    | 'team-approval-required'
    | 'unsupported-source'
    | 'missing-agent-root'
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
    restoreCanonical: number
    updateCanonical: number
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

export interface JournalActivity {
  journalId: string
  createdAt: string | null
  status: 'verified' | 'rolled-back' | 'discarded' | 'incomplete' | 'rollback-incomplete' | 'corrupt'
  skillIds: string[]
  backupBytes: number
  rollbackAvailable: boolean
  protected: boolean
}

export interface ActivitySnapshot {
  retentionDays: 30
  totalBackupBytes: number
  entries: JournalActivity[]
}

export type DiscardResult =
  | { status: 'discarded' | 'already-discarded'; journalId: string; activity: ActivitySnapshot }
  | { status: 'rejected'; journalId: string; error: ReconcileError }

export interface TeamStatus {
  enabled: boolean
  teamId: string | null
  name: string | null
  policyPath: string
  manifestPath: string
  signerId: string | null
  signerRoles: Array<'maintainer' | 'owner'>
  managedRepositories: Array<{ repository: string; paths: string[] }>
  approvalRules: {
    restoreCanonical: 'maintainer' | 'owner'
    updateCanonical: 'maintainer' | 'owner'
    replaceCopy: 'maintainer' | 'owner'
  } | null
  manifestSkillCount: number
  error: string | null
}

export type TeamImportResult =
  | { status: 'imported'; team: TeamStatus }
  | { status: 'rejected'; message: string; team: TeamStatus }

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
    activity: () => Promise<ActivitySnapshot>
    discard: (journalId: string) => Promise<DiscardResult>
  }
  team: {
    status: () => Promise<TeamStatus>
    importPolicy: (json: string) => Promise<TeamImportResult>
    importManifest: (json: string) => Promise<TeamImportResult>
  }
}
