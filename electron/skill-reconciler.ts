import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
} from 'node:fs/promises'
import path from 'node:path'
import { scanGlobalSkills } from './skill-inventory'
import type { AgentLocation } from './skill-inventory'
import { fingerprint, fingerprintsMatch } from './path-fingerprint'
import { stageGitHubSkill } from './skill-source'
import type { FetchSource } from './skill-source'
import type { TeamManager } from './team-policy'
import type {
  ActivitySnapshot,
  ApplyResult,
  DiscardResult,
  JournalActivity,
  PathFingerprint,
  PlanBlocker,
  PlannedOperation,
  ReconcileRequest,
  ReconciliationPreview,
  RollbackResult,
  SourcePin,
} from '../src/types'

interface SkillReconcilerOptions {
  homeDir: string
  agentLocations: AgentLocation[]
  fetchSource?: FetchSource
  teamManager?: TeamManager
}

interface StoredOperation {
  public: PlannedOperation
  rootKind?: 'agent' | 'canonical'
  agentRoot: string
  canonicalRoot: string
  canonicalBefore: PathFingerprint
  sourcePin?: SourcePin
}

interface StoredPlan {
  preview: ReconciliationPreview
  operations: StoredOperation[]
}

interface JournalOperation extends StoredOperation {
  backupPath: string | null
}

interface JournalPlan {
  schemaVersion: 1 | 2
  journalId: string
  planId: string
  createdAt: string
  operations: JournalOperation[]
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function appendJournalEvent(journalDirectory: string, event: object): Promise<void> {
  const handle = await open(path.join(journalDirectory, 'events.jsonl'), 'a')
  try {
    await handle.writeFile(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeJournalPlan(journalDirectory: string, plan: JournalPlan): Promise<void> {
  await mkdir(journalDirectory, { recursive: true, mode: 0o700 })
  const handle = await open(path.join(journalDirectory, 'plan.json'), 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(plan, null, 2))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await appendJournalEvent(journalDirectory, { status: 'prepared' })
  await syncDirectory(journalDirectory)
}

function isSourceOperation(
  operation: StoredOperation,
): operation is StoredOperation & {
  public: PlannedOperation & { kind: 'restore-canonical' | 'update-canonical' }
} {
  return operation.public.kind === 'restore-canonical'
    || operation.public.kind === 'update-canonical'
}

export class SkillReconciler {
  private readonly plans = new Map<string, StoredPlan>()
  private readonly planReceipts = new Map<string, { status: 'applied' | 'rolled-back'; journalId: string }>()
  private mutating = false

  constructor(private readonly options: SkillReconcilerOptions) {}

  private async scan() {
    return scanGlobalSkills({
      ...this.options,
      sourcePins: await this.options.teamManager?.sourcePins(),
    })
  }

  async preview(request: ReconcileRequest = {}): Promise<ReconciliationPreview> {
    const canonicalRoot = path.join(this.options.homeDir, '.agents', 'skills')
    const inventory = await this.scan()
    const operations: PlannedOperation[] = []
    const storedOperations: StoredOperation[] = []
    const blockers: PlanBlocker[] = []
    const warnings = new Set<string>()
    let unchanged = 0

    for (const skill of inventory.skills) {
      if (request.skillIds && !request.skillIds.includes(skill.id)) continue
      const canonicalPath = skill.canonicalPath
      const canonicalBefore = await fingerprint(canonicalPath)
      let canonicalFingerprint = canonicalBefore
      const canonicalExists = skill.agents.some((agent) => agent.id === 'universal')
      const sourceKind = canonicalExists ? 'update-canonical' : 'restore-canonical'
      const needsSource = Boolean(
        skill.sourcePin
        && (!canonicalExists || canonicalBefore.sha256 !== skill.sourcePin.sha256),
      )

      if (!canonicalExists && !skill.sourcePin) {
        blockers.push({
          skillId: skill.id,
          code: 'missing-canonical',
          path: skill.canonicalPath,
          message: 'Tracked skill has no complete pinned GitHub source.',
        })
        continue
      }
      if (needsSource && request.sourcePolicy !== 'restore-pinned') {
        blockers.push({
          skillId: skill.id,
          code: canonicalExists
            ? 'source-update-requires-confirmation'
            : 'source-restore-requires-confirmation',
          path: skill.canonicalPath,
          message: canonicalExists
            ? 'Canonical drift is preserved until replacing it with the pinned source is explicitly approved.'
            : 'Pinned source restoration requires explicit approval.',
        })
        if (!canonicalExists) continue
      } else if (needsSource && skill.sourcePin) {
        const approval = await this.options.teamManager?.authorize(
          sourceKind,
          skill.id,
          skill.sourcePin,
        )
        if (approval && !approval.allowed) {
          blockers.push({
            skillId: skill.id,
            code: 'team-approval-required',
            path: skill.canonicalPath,
            message: approval.reason ?? 'Team policy approval is required.',
          })
          if (!canonicalExists) continue
        } else {
          canonicalFingerprint = {
            kind: 'directory',
            sha256: skill.sourcePin.sha256,
            linkTarget: null,
          }
          const sourceOperation: PlannedOperation = {
            id: `${skill.id}:universal:source`,
            skillId: skill.id,
            agentId: 'universal',
            kind: sourceKind,
            targetPath: canonicalPath,
            canonicalPath,
            before: canonicalBefore,
            after: canonicalFingerprint,
            sourcePin: skill.sourcePin,
          }
          operations.push(sourceOperation)
          storedOperations.push({
            public: sourceOperation,
            rootKind: 'canonical',
            agentRoot: canonicalRoot,
            canonicalRoot,
            canonicalBefore,
            sourcePin: skill.sourcePin,
          })
        }
      }

      for (const agent of this.options.agentLocations) {
        if (request.agentIds && !request.agentIds.includes(agent.id)) continue
        const agentRoot = path.resolve(this.options.homeDir, agent.relativePath)
        const targetPath = path.join(this.options.homeDir, agent.relativePath, skill.id)
        const agentRootFingerprint = await fingerprint(agentRoot)
        if (agentRootFingerprint.kind !== 'directory') {
          if (request.agentIds) {
            blockers.push({
              skillId: skill.id,
              agentId: agent.id,
              code: 'missing-agent-root',
              path: agentRoot,
              message: `${agent.label} skill directory does not exist.`,
            })
          } else {
            warnings.add(`${agent.label} is not installed; its missing skill directory was skipped.`)
          }
          continue
        }
        const before = await fingerprint(targetPath)
        if (before.kind === 'symlink' && before.linkTarget === canonicalPath) {
          unchanged += 1
          continue
        }
        if (before.kind === 'directory' || before.kind === 'file') {
          if (request.copyPolicy !== 'replace-with-symlink') {
            blockers.push({
              skillId: skill.id,
              agentId: agent.id,
              code: 'copy-requires-confirmation',
              path: targetPath,
              message: 'Independent copy preserved until replacement is explicitly approved.',
            })
            continue
          }
          const approval = await this.options.teamManager?.authorize(
            'replace-copy',
            skill.id,
            undefined,
            agent.id,
          )
          if (approval && !approval.allowed) {
            blockers.push({
              skillId: skill.id,
              agentId: agent.id,
              code: 'team-approval-required',
              path: targetPath,
              message: approval.reason ?? 'Team policy approval is required.',
            })
            continue
          }
        } else if (before.kind === 'other') {
          blockers.push({
            skillId: skill.id,
            agentId: agent.id,
            code: 'unsupported-source',
            path: targetPath,
            message: 'Unsupported filesystem entry cannot be reconciled safely.',
          })
          continue
        }
        const kind: PlannedOperation['kind'] = before.kind === 'missing'
          ? 'create-symlink'
          : before.kind === 'symlink'
            ? 'repair-symlink'
            : 'replace-copy'
        const operation: PlannedOperation = {
          id: `${skill.id}:${agent.id}`,
          skillId: skill.id,
          agentId: agent.id,
          kind,
          targetPath,
          canonicalPath,
          before,
          after: { kind: 'symlink', sha256: canonicalFingerprint.sha256, linkTarget: canonicalPath },
        }
        operations.push(operation)
        storedOperations.push({
          public: operation,
          rootKind: 'agent',
          agentRoot,
          canonicalRoot,
          canonicalBefore: canonicalFingerprint,
        })
      }
    }

    const preview: ReconciliationPreview = {
      planId: randomUUID(),
      status: blockers.length ? 'blocked' : operations.length ? 'ready' : 'noop',
      generatedAt: new Date().toISOString(),
      algorithm: 'sha256-tree-v1',
      operations,
      blockers,
      summary: {
        createLinks: operations.filter((operation) => operation.kind === 'create-symlink').length,
        repairLinks: operations.filter((operation) => operation.kind === 'repair-symlink').length,
        replaceCopies: operations.filter((operation) => operation.kind === 'replace-copy').length,
        restoreCanonical: operations.filter((operation) => operation.kind === 'restore-canonical').length,
        updateCanonical: operations.filter((operation) => operation.kind === 'update-canonical').length,
        unchanged,
        blocked: blockers.length,
      },
      warnings: [...warnings],
    }
    this.plans.set(preview.planId, { preview, operations: storedOperations })
    return preview
  }

  async apply(planId: string): Promise<ApplyResult> {
    const receipt = this.planReceipts.get(planId)
    if (receipt?.status === 'applied') {
      return {
        status: 'already-applied',
        planId,
        journalId: receipt.journalId,
        snapshot: await this.scan(),
      }
    }
    if (receipt?.status === 'rolled-back') {
      return {
        status: 'rejected',
        planId,
        error: { code: 'plan-consumed', phase: 'apply', message: 'Rolled-back plans must be previewed again.' },
      }
    }

    const plan = this.plans.get(planId)
    if (!plan) {
      return {
        status: 'rejected',
        planId,
        error: { code: 'plan-not-found', phase: 'apply', message: 'Preview the plan again before applying it.' },
      }
    }
    if (plan.preview.status !== 'ready') {
      return {
        status: 'rejected',
        planId,
        error: {
          code: 'plan-blocked',
          phase: 'apply',
          message: plan.preview.status === 'blocked'
            ? 'Resolve or explicitly scope every blocker before applying.'
            : 'The reconciliation plan contains no changes.',
        },
      }
    }
    if (this.mutating) {
      return {
        status: 'rejected',
        planId,
        error: {
          code: 'operation-in-progress',
          phase: 'apply',
          message: 'Another reconciliation is already changing Agent destinations.',
        },
      }
    }

    this.mutating = true
    try {
      return await this.applyPlan(planId, plan)
    } finally {
      this.mutating = false
    }
  }

  private async applyPlan(planId: string, plan: StoredPlan): Promise<ApplyResult> {
    const sourceTargets = new Set(
      plan.operations.filter(isSourceOperation).map((operation) => operation.public.canonicalPath),
    )
    for (const operation of plan.operations) {
      try {
        await this.assertSafe(
          operation,
          !isSourceOperation(operation) && sourceTargets.has(operation.public.canonicalPath),
        )
      } catch (error) {
        return {
          status: 'rejected',
          planId,
          error: {
            code: error instanceof StalePlanError ? 'stale-plan' : 'path-rejected',
            phase: 'apply',
            message: (error as Error).message,
          },
        }
      }
    }

    const journalId = randomUUID()
    const journalDirectory = path.join(
      this.options.homeDir,
      '.agents',
      '.skillledger',
      'journals',
      journalId,
    )
    const journalOperations: JournalOperation[] = plan.operations.map((operation) => ({
      ...operation,
      backupPath: operation.public.before.kind === 'missing'
        ? null
        : `${operation.public.targetPath}.skillledger-${journalId}.backup`,
    }))
    await writeJournalPlan(journalDirectory, {
      schemaVersion: 2,
      journalId,
      planId,
      createdAt: new Date().toISOString(),
      operations: journalOperations,
    })

    const applied: JournalOperation[] = []
    const temporaryPaths: string[] = []
    try {
      for (const operation of journalOperations) {
        await this.assertSafe(operation)
        const target = operation.public.targetPath
        const temporary = `${target}.skillledger-${journalId}.tmp`
        temporaryPaths.push(temporary)
        if (isSourceOperation(operation)) {
          if (!operation.sourcePin) throw new Error('Source operation has no pinned GitHub source.')
          await stageGitHubSkill(
            operation.sourcePin,
            temporary,
            this.options.fetchSource ?? fetch,
          )
        } else {
          await symlink(path.relative(path.dirname(target), operation.public.canonicalPath), temporary, 'dir')
        }
        if (operation.backupPath) {
          await rename(target, operation.backupPath)
          applied.push(operation)
          if (!fingerprintsMatch(await fingerprint(operation.backupPath), operation.public.before)) {
            throw new Error(`Backup verification failed for ${operation.public.skillId}.`)
          }
          await syncDirectory(path.dirname(target))
          await appendJournalEvent(journalDirectory, {
            status: 'backed-up',
            operationId: operation.public.id,
          })
        }
        if ((await fingerprint(target)).kind !== 'missing') {
          throw new Error(`Target changed while applying ${operation.public.skillId}.`)
        }
        await rename(temporary, target)
        await syncDirectory(path.dirname(target))
        if (!operation.backupPath) applied.push(operation)
        await appendJournalEvent(journalDirectory, { status: 'applied', operationId: operation.public.id })
      }

      for (const operation of applied) {
        const actual = await fingerprint(operation.public.targetPath)
        const verified = isSourceOperation(operation)
          ? fingerprintsMatch(actual, operation.public.after)
          : actual.kind === 'symlink'
            && actual.linkTarget === operation.public.canonicalPath
            && fingerprintsMatch(
              await fingerprint(operation.public.canonicalPath),
              operation.canonicalBefore,
            )
        if (!verified) {
          throw new VerificationError(`Verification failed for ${operation.public.skillId}.`)
        }
      }

      await appendJournalEvent(journalDirectory, { status: 'verified' })
      this.planReceipts.set(planId, { status: 'applied', journalId })
      return {
        status: 'applied',
        planId,
        journalId,
        snapshot: await this.scan(),
      }
    } catch (error) {
      await Promise.all(temporaryPaths.map((temporary) => rm(temporary, { recursive: true, force: true })))
      const rollbackFailure = await this.rollbackApplied(applied, journalDirectory)
      if (rollbackFailure) {
        return {
          status: 'rollback-incomplete',
          planId,
          journalId,
          error: { code: 'rollback-failed', phase: 'rollback', message: rollbackFailure.message },
        }
      }
      this.planReceipts.set(planId, { status: 'rolled-back', journalId })
      return {
        status: 'rolled-back',
        planId,
        journalId,
        error: {
          code: 'write-failed',
          phase: error instanceof VerificationError ? 'verify' : 'apply',
          message: (error as Error).message,
        },
        snapshot: await this.scan(),
      }
    }
  }

  async rollback(journalId: string): Promise<RollbackResult> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(journalId)) {
      return {
        status: 'rejected',
        journalId,
        error: { code: 'journal-not-found', phase: 'rollback', message: 'Unknown reconciliation journal.' },
      }
    }
    if (this.mutating) {
      return {
        status: 'rejected',
        journalId,
        error: {
          code: 'operation-in-progress',
          phase: 'rollback',
          message: 'Another reconciliation is already changing Agent destinations.',
        },
      }
    }

    this.mutating = true
    try {
      return await this.rollbackJournal(journalId)
    } finally {
      this.mutating = false
    }
  }

  async recoverIncomplete(): Promise<{ recovered: string[]; failed: string[] }> {
    if (this.mutating) return { recovered: [], failed: [] }
    this.mutating = true
    try {
      const journals = (await Promise.all((await this.journalIds()).map(async (journalId) => {
        try {
          const journal = await this.readJournal(journalId)
          const statuses = new Set(journal.events.map((event) => event.status))
          return statuses.has('verified')
            || statuses.has('rollback-complete')
            || statuses.has('rollback-failed')
            || statuses.has('rollback-discard-intent')
            || statuses.has('rollback-discarded')
            ? null
            : journal
        } catch {
          return null
        }
      })))
        .filter((journal): journal is NonNullable<typeof journal> => journal !== null)
        .sort((left, right) => right.plan.createdAt.localeCompare(left.plan.createdAt))
      const recovered: string[] = []
      const failed: string[] = []
      for (const journal of journals) {
        if (await this.recoverJournal(journal)) recovered.push(journal.plan.journalId)
        else failed.push(journal.plan.journalId)
      }
      return { recovered, failed }
    } finally {
      this.mutating = false
    }
  }

  private async recoverJournal(
    journal: Awaited<ReturnType<SkillReconciler['readJournal']>>,
  ): Promise<boolean> {
    const { directory, plan, events } = journal
    const restored = new Set(
      events
        .filter((event) => event.status === 'rolled-back' && event.operationId)
        .map((event) => event.operationId),
    )
    try {
      for (const operation of [...plan.operations].reverse()) {
        if (restored.has(operation.public.id)) continue
        await this.assertJournalOperationSafe(operation, plan.journalId)
        await rm(
          `${operation.public.targetPath}.skillledger-${plan.journalId}.tmp`,
          { recursive: true, force: true },
        )
        const current = await fingerprint(operation.public.targetPath)
        const backup = operation.backupPath
          ? await fingerprint(operation.backupPath)
          : { kind: 'missing', sha256: null, linkTarget: null } as PathFingerprint
        if (fingerprintsMatch(current, operation.public.before)) {
          if (operation.backupPath && fingerprintsMatch(backup, operation.public.before)) {
            await rm(operation.backupPath, { recursive: true, force: false })
          } else if (backup.kind !== 'missing') {
            throw new Error(`Recovery backup changed for ${operation.public.skillId}.`)
          }
        } else {
          if (
            current.kind !== 'missing'
            && !this.matchesApplied(operation, current)
          ) {
            throw new Error(`Recovery conflict for ${operation.public.skillId}.`)
          }
          if (
            operation.backupPath
            && !fingerprintsMatch(backup, operation.public.before)
          ) {
            throw new Error(`Recovery backup changed for ${operation.public.skillId}.`)
          }
          await this.restoreOperation(operation)
        }
        await syncDirectory(path.dirname(operation.public.targetPath))
        await appendJournalEvent(directory, {
          status: 'rolled-back',
          operationId: operation.public.id,
          reason: 'startup-recovery',
        })
      }
      await appendJournalEvent(directory, { status: 'rollback-complete', reason: 'startup-recovery' })
      this.planReceipts.set(plan.planId, {
        status: 'rolled-back',
        journalId: plan.journalId,
      })
      return true
    } catch (error) {
      await appendJournalEvent(directory, {
        status: 'rollback-failed',
        message: (error as Error).message,
        reason: 'startup-recovery',
      }).catch(() => undefined)
      return false
    }
  }

  private async rollbackJournal(journalId: string): Promise<RollbackResult> {
    const journalDirectory = path.join(
      this.options.homeDir,
      '.agents',
      '.skillledger',
      'journals',
      journalId,
    )
    let plan: JournalPlan
    let events: Array<{ status?: string }>
    try {
      const journal = await this.readJournal(journalId)
      plan = journal.plan
      events = journal.events
    } catch (error) {
      return {
        status: 'rejected',
        journalId,
        error: {
          code: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'journal-not-found' : 'journal-corrupt',
          phase: 'rollback',
          message: 'The reconciliation journal is unavailable or invalid.',
        },
      }
    }

    if (events.some((event) => event.status === 'rollback-complete')) {
      return {
        status: 'already-rolled-back',
        journalId,
        snapshot: await this.scan(),
      }
    }
    if (events.some((event) => event.status === 'rollback-discarded')) {
      return {
        status: 'rejected',
        journalId,
        error: {
          code: 'rollback-conflict',
          phase: 'rollback',
          message: 'Rollback data for this journal was explicitly discarded.',
        },
      }
    }
    if (events.some((event) => event.status === 'rollback-discard-intent')) {
      return {
        status: 'rejected',
        journalId,
        error: {
          code: 'rollback-conflict',
          phase: 'rollback',
          message: 'Rollback data deletion was interrupted; the journal is protected for inspection.',
        },
      }
    }
    if (!events.some((event) => event.status === 'verified')) {
      return {
        status: 'rejected',
        journalId,
        error: {
          code: 'journal-corrupt',
          phase: 'rollback',
          message: 'Only a fully verified reconciliation can be rolled back explicitly.',
        },
      }
    }

    try {
      for (const operation of [...plan.operations].reverse()) {
        await this.assertJournalOperationSafe(operation, journalId)
        const current = await fingerprint(operation.public.targetPath)
        if (!this.matchesApplied(operation, current)) {
          return {
            status: 'rejected',
            journalId,
            error: {
              code: 'rollback-conflict',
              phase: 'rollback',
              message: `Managed content changed after apply: ${operation.public.skillId}.`,
            },
          }
        }
        if (
          operation.backupPath
          && !fingerprintsMatch(await fingerprint(operation.backupPath), operation.public.before)
        ) {
          return {
            status: 'rejected',
            journalId,
            error: {
              code: 'rollback-conflict',
              phase: 'rollback',
              message: `The backup changed after apply: ${operation.public.skillId}.`,
            },
          }
        }
        await this.restoreOperation(operation)
        await syncDirectory(path.dirname(operation.public.targetPath))
        await appendJournalEvent(journalDirectory, {
          status: 'rolled-back',
          operationId: operation.public.id,
        })
      }
      await appendJournalEvent(journalDirectory, { status: 'rollback-complete' })
      this.planReceipts.set(plan.planId, { status: 'rolled-back', journalId })
      return {
        status: 'rolled-back',
        journalId,
        snapshot: await this.scan(),
      }
    } catch (error) {
      await appendJournalEvent(journalDirectory, {
        status: 'rollback-failed',
        message: (error as Error).message,
      }).catch(() => undefined)
      return {
        status: 'rollback-incomplete',
        journalId,
        error: { code: 'rollback-failed', phase: 'rollback', message: (error as Error).message },
      }
    }
  }

  async activity(): Promise<ActivitySnapshot> {
    if (!this.mutating) {
      this.mutating = true
      try {
        await this.cleanupExpiredBackups()
      } finally {
        this.mutating = false
      }
    }
    return this.readActivity()
  }

  async discard(journalId: string): Promise<DiscardResult> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(journalId)) {
      return {
        status: 'rejected',
        journalId,
        error: { code: 'journal-not-found', phase: 'rollback', message: 'Unknown reconciliation journal.' },
      }
    }
    if (this.mutating) {
      return {
        status: 'rejected',
        journalId,
        error: {
          code: 'operation-in-progress',
          phase: 'rollback',
          message: 'Another reconciliation operation is already running.',
        },
      }
    }
    this.mutating = true
    try {
      const status = await this.discardJournal(journalId, 'explicit')
      return { status, journalId, activity: await this.readActivity() }
    } catch (error) {
      return {
        status: 'rejected',
        journalId,
        error: { code: 'rollback-conflict', phase: 'rollback', message: (error as Error).message },
      }
    } finally {
      this.mutating = false
    }
  }

  private journalsRoot(): string {
    return path.join(this.options.homeDir, '.agents', '.skillledger', 'journals')
  }

  private async journalIds(): Promise<string[]> {
    try {
      return (await readdir(this.journalsRoot(), { withFileTypes: true }))
        .filter((entry) => (
          entry.isDirectory()
          && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.name)
        ))
        .map((entry) => entry.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async readJournal(journalId: string): Promise<{
    directory: string
    plan: JournalPlan
    events: Array<{ status?: string; operationId?: string }>
  }> {
    const directory = path.join(this.journalsRoot(), journalId)
    const plan = JSON.parse(await readFile(path.join(directory, 'plan.json'), 'utf8')) as JournalPlan
    const events = (await readFile(path.join(directory, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { status?: string; operationId?: string })
    const knownStatuses = new Set([
      'prepared',
      'backed-up',
      'applied',
      'verified',
      'rolled-back',
      'rollback-complete',
      'rollback-failed',
      'rollback-discard-intent',
      'rollback-discarded',
    ])
    if (
      (plan.schemaVersion !== 1 && plan.schemaVersion !== 2)
      || plan.journalId !== journalId
      || !Number.isFinite(Date.parse(plan.createdAt))
      || !Array.isArray(plan.operations)
      || events.some((event) => typeof event.status !== 'string' || !knownStatuses.has(event.status))
    ) {
      throw new Error('Journal plan is invalid.')
    }
    return { directory, plan, events }
  }

  private async readActivity(): Promise<ActivitySnapshot> {
    const entries = await Promise.all((await this.journalIds()).map(async (journalId): Promise<JournalActivity> => {
      try {
        const { plan, events } = await this.readJournal(journalId)
        const rolledBack = events.some((event) => event.status === 'rollback-complete')
        const discarded = events.some((event) => event.status === 'rollback-discarded')
        const rollbackFailed = events.some((event) => event.status === 'rollback-failed')
        const discardIntent = events.some((event) => event.status === 'rollback-discard-intent')
        const verified = events.some((event) => event.status === 'verified')
        const status: JournalActivity['status'] = rolledBack
          ? 'rolled-back'
          : discarded
            ? 'discarded'
            : rollbackFailed || discardIntent
              ? 'rollback-incomplete'
              : verified
                ? 'verified'
                : 'incomplete'
        const backupBytes = (await Promise.all(plan.operations.map((operation) => (
          operation.backupPath ? this.pathBytes(operation.backupPath) : Promise.resolve(0)
        )))).reduce((total, value) => total + value, 0)
        return {
          journalId,
          createdAt: plan.createdAt,
          status,
          skillIds: [...new Set(plan.operations.map((operation) => operation.public.skillId))],
          backupBytes,
          rollbackAvailable: status === 'verified',
          protected: status === 'incomplete' || status === 'rollback-incomplete',
        }
      } catch {
        return {
          journalId,
          createdAt: null,
          status: 'corrupt',
          skillIds: [],
          backupBytes: 0,
          rollbackAvailable: false,
          protected: true,
        }
      }
    }))
    entries.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
    return {
      retentionDays: 30,
      totalBackupBytes: entries.reduce((total, entry) => total + entry.backupBytes, 0),
      entries,
    }
  }

  private async pathBytes(entryPath: string): Promise<number> {
    try {
      const stats = await lstat(entryPath)
      if (!stats.isDirectory() || stats.isSymbolicLink()) return stats.size
      const children = await readdir(entryPath)
      return (await Promise.all(children.map((child) => this.pathBytes(path.join(entryPath, child)))))
        .reduce((total, value) => total + value, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }

  private async verifiedJournals(): Promise<Array<Awaited<ReturnType<SkillReconciler['readJournal']>>>> {
    const journals = await Promise.all((await this.journalIds()).map(async (journalId) => {
      try {
        const journal = await this.readJournal(journalId)
        const statuses = new Set(journal.events.map((event) => event.status))
        return statuses.has('verified')
          && !statuses.has('rollback-complete')
          && !statuses.has('rollback-discarded')
          && !statuses.has('rollback-failed')
          && !statuses.has('rollback-discard-intent')
          ? journal
          : null
      } catch {
        return null
      }
    }))
    return journals.filter((journal): journal is NonNullable<typeof journal> => journal !== null)
  }

  private async cleanupExpiredBackups(): Promise<void> {
    const journals = await this.verifiedJournals()
    const newestBySkill = new Map<string, string>()
    for (const journal of [...journals].sort((left, right) => right.plan.createdAt.localeCompare(left.plan.createdAt))) {
      for (const operation of journal.plan.operations) {
        if (!newestBySkill.has(operation.public.skillId)) {
          newestBySkill.set(operation.public.skillId, journal.plan.journalId)
        }
      }
    }
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000
    for (const journal of journals) {
      const skills = [...new Set(journal.plan.operations.map((operation) => operation.public.skillId))]
      if (
        Date.parse(journal.plan.createdAt) < cutoff
        && skills.every((skillId) => newestBySkill.get(skillId) !== journal.plan.journalId)
      ) {
        await this.discardJournal(journal.plan.journalId, 'retention').catch(() => undefined)
      }
    }
  }

  private async discardJournal(
    journalId: string,
    reason: 'explicit' | 'retention',
  ): Promise<'discarded' | 'already-discarded'> {
    const journal = await this.readJournal(journalId)
    const statuses = new Set(journal.events.map((event) => event.status))
    if (statuses.has('rollback-discarded')) return 'already-discarded'
    if (
      !statuses.has('verified')
      || statuses.has('rollback-complete')
      || statuses.has('rollback-failed')
    ) {
      throw new Error('Only a fully verified, unchanged journal can discard rollback data.')
    }

    const latestByTarget = new Map<string, JournalOperation>()
    for (const candidate of [...await this.verifiedJournals()]
      .sort((left, right) => left.plan.createdAt.localeCompare(right.plan.createdAt))) {
      for (const operation of candidate.plan.operations) {
        latestByTarget.set(operation.public.targetPath, operation)
      }
    }
    for (const operation of journal.plan.operations) {
      await this.assertJournalOperationSafe(operation, journalId)
      const expected = latestByTarget.get(operation.public.targetPath) ?? operation
      if (!this.matchesApplied(expected, await fingerprint(operation.public.targetPath))) {
        throw new Error(`Managed content changed after apply: ${operation.public.skillId}.`)
      }
      if (
        operation.backupPath
        && !fingerprintsMatch(await fingerprint(operation.backupPath), operation.public.before)
      ) {
        throw new Error(`Rollback backup changed: ${operation.public.skillId}.`)
      }
    }
    if (!statuses.has('rollback-discard-intent')) {
      await appendJournalEvent(journal.directory, { status: 'rollback-discard-intent', reason })
    }
    for (const operation of journal.plan.operations) {
      if (operation.backupPath) await rm(operation.backupPath, { recursive: true, force: false })
    }
    await appendJournalEvent(journal.directory, { status: 'rollback-discarded', reason })
    return 'discarded'
  }

  private async assertSafe(operation: StoredOperation, skipCanonical = false): Promise<void> {
    const { canonicalPath, targetPath } = operation.public
    const canonicalRoot = await realpath(operation.canonicalRoot)
    const home = await realpath(this.options.homeDir)
    if (!isInside(home, canonicalRoot)) {
      throw new Error(`Canonical root is outside the managed home: ${canonicalRoot}`)
    }

    if (isSourceOperation(operation)) {
      if (
        operation.rootKind !== 'canonical'
        || operation.agentRoot !== operation.canonicalRoot
        || path.dirname(targetPath) !== operation.canonicalRoot
        || targetPath !== canonicalPath
        || path.dirname(canonicalPath) !== operation.canonicalRoot
      ) {
        throw new Error(`Canonical source path is outside the managed root: ${targetPath}`)
      }
      const currentPin = (await this.scan()).skills.find(
        (skill) => skill.id === operation.public.skillId,
      )?.sourcePin
      if (!operation.sourcePin || JSON.stringify(currentPin) !== JSON.stringify(operation.sourcePin)) {
        throw new StalePlanError(`The pinned source changed after preview for ${operation.public.skillId}.`)
      }
      const approval = await this.options.teamManager?.authorize(
        operation.public.kind,
        operation.public.skillId,
        operation.sourcePin,
      )
      if (approval && !approval.allowed) throw new Error(approval.reason ?? 'Team approval is required.')
      if (!fingerprintsMatch(await fingerprint(targetPath), operation.public.before)) {
        throw new StalePlanError(`The filesystem changed after preview for ${operation.public.skillId}.`)
      }
      return
    }

    const canonical = skipCanonical
      ? path.join(await realpath(path.dirname(canonicalPath)), path.basename(canonicalPath))
      : await realpath(canonicalPath)
    const canonicalRelative = path.relative(canonicalRoot, canonical)
    if (
      !canonicalRelative
      || canonicalRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(canonicalRelative)
      || canonicalRelative.includes(path.sep)
    ) {
      throw new Error(`Canonical path is outside the managed root: ${canonicalPath}`)
    }

    const agentRoot = await realpath(operation.agentRoot)
    const targetParent = await realpath(path.dirname(targetPath))
    if (
      !isInside(home, agentRoot)
      || agentRoot !== targetParent
      || path.dirname(targetPath) !== operation.agentRoot
    ) {
      throw new Error(`Target path is outside the managed Agent root: ${targetPath}`)
    }

    if (
      (!skipCanonical && !fingerprintsMatch(await fingerprint(canonicalPath), operation.canonicalBefore))
      || !fingerprintsMatch(await fingerprint(targetPath), operation.public.before)
    ) {
      throw new StalePlanError(`The filesystem changed after preview for ${operation.public.skillId}.`)
    }
    if (operation.public.kind === 'replace-copy') {
      const approval = await this.options.teamManager?.authorize(
        'replace-copy',
        operation.public.skillId,
        undefined,
        operation.public.agentId,
      )
      if (approval && !approval.allowed) throw new Error(approval.reason ?? 'Team approval is required.')
    }
  }

  private async rollbackApplied(
    applied: JournalOperation[],
    journalDirectory: string,
  ): Promise<Error | null> {
    try {
      for (const operation of [...applied].reverse()) {
        const current = await fingerprint(operation.public.targetPath)
        if (current.kind !== 'missing' && !this.matchesApplied(operation, current)) {
          throw new Error(`Rollback conflict for ${operation.public.targetPath}.`)
        }
        if (
          operation.backupPath
          && !fingerprintsMatch(await fingerprint(operation.backupPath), operation.public.before)
        ) {
          throw new Error(`Backup verification failed for ${operation.public.targetPath}.`)
        }
        await this.restoreOperation(operation)
        await syncDirectory(path.dirname(operation.public.targetPath))
        await appendJournalEvent(journalDirectory, {
          status: 'rolled-back',
          operationId: operation.public.id,
        })
      }
      await appendJournalEvent(journalDirectory, { status: 'rollback-complete' })
      return null
    } catch (error) {
      await appendJournalEvent(journalDirectory, {
        status: 'rollback-failed',
        message: (error as Error).message,
      }).catch(() => undefined)
      return error as Error
    }
  }

  private async assertJournalOperationSafe(operation: JournalOperation, journalId: string): Promise<void> {
    const skillId = operation.public?.skillId
    const agentId = operation.public?.agentId
    if (
      typeof skillId !== 'string'
      || skillId === '.'
      || skillId === '..'
      || skillId.includes('/')
      || skillId.includes('\\')
      || skillId.includes('\0')
    ) {
      throw new Error('Journal contains an invalid skill identifier.')
    }

    const canonicalRoot = path.join(this.options.homeDir, '.agents', 'skills')
    const sourceOperation = isSourceOperation(operation)
    const agent = sourceOperation
      ? null
      : this.options.agentLocations.find((candidate) => candidate.id === agentId)
    if (!sourceOperation && !agent) throw new Error('Journal references an unknown Agent destination.')
    const agentRoot = sourceOperation
      ? canonicalRoot
      : path.resolve(this.options.homeDir, agent!.relativePath)
    if (
      operation.canonicalRoot !== canonicalRoot
      || operation.agentRoot !== agentRoot
      || operation.public.canonicalPath !== path.join(canonicalRoot, skillId)
      || operation.public.targetPath !== path.join(agentRoot, skillId)
      || (sourceOperation && operation.rootKind !== 'canonical')
    ) {
      throw new Error('Journal path is outside the configured roots.')
    }
    const expectedBackup = operation.public.before.kind === 'missing'
      ? null
      : `${operation.public.targetPath}.skillledger-${journalId}.backup`
    if (operation.backupPath !== expectedBackup) {
      throw new Error('Journal backup escaped the configured root.')
    }

    const resolvedAgentRoot = await realpath(agentRoot)
    const resolvedHome = await realpath(this.options.homeDir)
    const resolvedTargetParent = await realpath(path.dirname(operation.public.targetPath))
    if (!isInside(resolvedHome, resolvedAgentRoot) || resolvedAgentRoot !== resolvedTargetParent) {
      throw new Error('Journal target parent escaped the configured root.')
    }
  }

  private matchesApplied(operation: StoredOperation, current: PathFingerprint): boolean {
    return isSourceOperation(operation)
      ? fingerprintsMatch(current, operation.public.after)
      : current.kind === 'symlink' && current.linkTarget === operation.public.canonicalPath
  }

  private async restoreOperation(operation: JournalOperation): Promise<void> {
    const target = operation.public.targetPath
    const current = await fingerprint(target)
    if (isSourceOperation(operation)) {
      const displaced = `${target}.skillledger-rollback-${randomUUID()}.tmp`
      if (current.kind !== 'missing') await rename(target, displaced)
      try {
        if (operation.backupPath) await rename(operation.backupPath, target)
        if (!fingerprintsMatch(await fingerprint(target), operation.public.before)) {
          throw new Error(`Rollback verification failed for ${operation.public.skillId}.`)
        }
        await syncDirectory(path.dirname(target))
        if (current.kind !== 'missing') await rm(displaced, { recursive: true, force: true })
      } catch (error) {
        if (
          (await fingerprint(target)).kind === 'missing'
          && (await fingerprint(displaced)).kind !== 'missing'
        ) {
          await rename(displaced, target).catch(() => undefined)
        }
        throw error
      }
      return
    }

    if (current.kind === 'symlink') await unlink(target)
    if (operation.backupPath) await rename(operation.backupPath, target)
    if (!fingerprintsMatch(await fingerprint(target), operation.public.before)) {
      throw new Error(`Rollback verification failed for ${operation.public.skillId}.`)
    }
    await syncDirectory(path.dirname(target))
  }
}

class StalePlanError extends Error {}
class VerificationError extends Error {}
