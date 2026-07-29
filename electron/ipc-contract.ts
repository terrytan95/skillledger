import type {
  ActivitySnapshot,
  AppUpdateStatus,
  ApplyResult,
  DiscardResult,
  ExternalSkillPreview,
  InventoryExportResult,
  InventorySnapshot,
  ReconcileRequest,
  ReconciliationPreview,
  RollbackResult,
  SkillContentSnapshot,
  SourceUpdateSnapshot,
  TeamImportResult,
  TeamStatus,
} from '../src/types'

export const ipcChannels = {
  scan: 'skillledger:scan',
  readSkillContent: 'skillledger:skill:read-content',
  revealSkill: 'skillledger:skill:reveal',
  previewExternalSkill: 'skillledger:external:preview',
  installExternalSkill: 'skillledger:external:install',
  deleteSkill: 'skillledger:skill:delete',
  openSkillSource: 'skillledger:skill:open-source',
  checkSourceUpdates: 'skillledger:source:check-updates',
  exportInventory: 'skillledger:inventory:export',
  reconcilePreview: 'skillledger:reconcile:preview',
  reconcileApply: 'skillledger:reconcile:apply',
  reconcileRollback: 'skillledger:reconcile:rollback',
  reconcileActivity: 'skillledger:reconcile:activity',
  reconcileDiscard: 'skillledger:reconcile:discard',
  teamStatus: 'skillledger:team:status',
  teamImportPolicy: 'skillledger:team:import-policy',
  teamImportManifest: 'skillledger:team:import-manifest',
  appVersion: 'skillledger:get-app-version',
  checkUpdates: 'skillledger:check-for-updates',
  installUpdate: 'skillledger:install-update',
  openUpdatesPage: 'skillledger:open-updates-page',
} as const satisfies Record<keyof SkillLedgerIpcContract, `skillledger:${string}`>

export const ipcEventChannels = {
  updateState: 'skillledger:update-state',
} as const

export interface SkillLedgerIpcContract {
  scan: { args: []; result: InventorySnapshot }
  readSkillContent: {
    args: [request: { skillId: string; relativePath?: string }]
    result: SkillContentSnapshot
  }
  revealSkill: { args: [skillId: string]; result: void }
  previewExternalSkill: { args: [url: string]; result: ExternalSkillPreview }
  installExternalSkill: { args: [planId: string]; result: ApplyResult }
  deleteSkill: { args: [skillId: string]; result: ApplyResult }
  openSkillSource: { args: [skillId: string]; result: void }
  checkSourceUpdates: { args: []; result: SourceUpdateSnapshot }
  exportInventory: { args: []; result: InventoryExportResult }
  reconcilePreview: { args: [request?: ReconcileRequest]; result: ReconciliationPreview }
  reconcileApply: { args: [planId: string]; result: ApplyResult }
  reconcileRollback: { args: [journalId: string]; result: RollbackResult }
  reconcileActivity: { args: []; result: ActivitySnapshot }
  reconcileDiscard: { args: [journalId: string]; result: DiscardResult }
  teamStatus: { args: []; result: TeamStatus }
  teamImportPolicy: { args: [json: string]; result: TeamImportResult }
  teamImportManifest: { args: [json: string]; result: TeamImportResult }
  appVersion: { args: []; result: string }
  checkUpdates: { args: []; result: AppUpdateStatus }
  installUpdate: { args: []; result: void }
  openUpdatesPage: { args: []; result: void }
}

export type IpcOperation = keyof SkillLedgerIpcContract
export type IpcArgs<Operation extends IpcOperation> = SkillLedgerIpcContract[Operation]['args']
export type IpcResult<Operation extends IpcOperation> = SkillLedgerIpcContract[Operation]['result']
export type IpcUnknownArgs<Operation extends IpcOperation> =
  IpcArgs<Operation>['length'] extends 0 ? [] : [value: unknown]
export type IpcMethod<Operation extends IpcOperation> = (
  ...args: IpcArgs<Operation>
) => Promise<IpcResult<Operation>>

/**
 * Validation and transport failures reject with Error. Expected domain
 * refusals remain explicit result-union members such as `status: "rejected"`.
 */
export interface SkillLedgerBridge {
  scan: IpcMethod<'scan'>
  readSkillContent: (skillId: string, relativePath?: string) => Promise<IpcResult<'readSkillContent'>>
  revealSkill: IpcMethod<'revealSkill'>
  previewExternalSkill: IpcMethod<'previewExternalSkill'>
  installExternalSkill: IpcMethod<'installExternalSkill'>
  deleteSkill: IpcMethod<'deleteSkill'>
  openSkillSource: IpcMethod<'openSkillSource'>
  checkSourceUpdates: IpcMethod<'checkSourceUpdates'>
  exportInventory: IpcMethod<'exportInventory'>
  getAppVersion: IpcMethod<'appVersion'>
  checkForUpdates: IpcMethod<'checkUpdates'>
  onUpdateState: (listener: (status: AppUpdateStatus) => void) => () => void
  installUpdate: IpcMethod<'installUpdate'>
  openUpdatesPage: IpcMethod<'openUpdatesPage'>
  reconcile: {
    preview: IpcMethod<'reconcilePreview'>
    apply: IpcMethod<'reconcileApply'>
    rollback: IpcMethod<'reconcileRollback'>
    activity: IpcMethod<'reconcileActivity'>
    discard: IpcMethod<'reconcileDiscard'>
  }
  team: {
    status: IpcMethod<'teamStatus'>
    importPolicy: IpcMethod<'teamImportPolicy'>
    importManifest: IpcMethod<'teamImportManifest'>
  }
}
