import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  symlink,
  unlink,
} from 'node:fs/promises'
import path from 'node:path'
import { scanGlobalSkills } from './skill-inventory'
import type { AgentLocation } from './skill-inventory'
import type {
  ApplyResult,
  PathFingerprint,
  PlanBlocker,
  PlannedOperation,
  ReconcileRequest,
  ReconciliationPreview,
  RollbackResult,
} from '../src/types'

interface SkillReconcilerOptions {
  homeDir: string
  agentLocations: AgentLocation[]
}

interface StoredOperation {
  public: PlannedOperation
  agentRoot: string
  canonicalRoot: string
  canonicalBefore: PathFingerprint
}

interface StoredPlan {
  preview: ReconciliationPreview
  operations: StoredOperation[]
}

interface JournalOperation extends StoredOperation {
  backupPath: string | null
}

interface JournalPlan {
  schemaVersion: 1
  journalId: string
  planId: string
  createdAt: string
  operations: JournalOperation[]
}

async function fingerprint(entryPath: string): Promise<PathFingerprint> {
  try {
    const stats = await lstat(entryPath)
    if (stats.isSymbolicLink()) {
      const target = await readlink(entryPath)
      return {
        kind: 'symlink',
        sha256: null,
        linkTarget: path.resolve(path.dirname(entryPath), target),
      }
    }
    if (stats.isFile()) {
      return {
        kind: 'file',
        sha256: createHash('sha256').update(await readFile(entryPath)).digest('hex'),
        linkTarget: null,
      }
    }
    if (!stats.isDirectory()) return { kind: 'other', sha256: null, linkTarget: null }

    const hash = createHash('sha256')
    const visit = async (directory: string, relative = ''): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const childRelative = path.posix.join(relative, entry.name)
        const childPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          hash.update(`directory\0${childRelative}\0`)
          await visit(childPath, childRelative)
        } else if (entry.isFile()) {
          hash.update(`file\0${childRelative}\0`)
          hash.update(await readFile(childPath))
          hash.update('\0')
        } else if (entry.isSymbolicLink()) {
          hash.update(`symlink\0${childRelative}\0${await readlink(childPath)}\0`)
        } else {
          hash.update(`other\0${childRelative}\0`)
        }
      }
    }
    await visit(entryPath)
    return { kind: 'directory', sha256: hash.digest('hex'), linkTarget: null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing', sha256: null, linkTarget: null }
    }
    throw error
  }
}

function fingerprintsMatch(left: PathFingerprint, right: PathFingerprint): boolean {
  return left.kind === right.kind
    && left.sha256 === right.sha256
    && left.linkTarget === right.linkTarget
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

export class SkillReconciler {
  private readonly plans = new Map<string, StoredPlan>()
  private readonly planReceipts = new Map<string, { status: 'applied' | 'rolled-back'; journalId: string }>()
  private mutating = false

  constructor(private readonly options: SkillReconcilerOptions) {}

  async preview(request: ReconcileRequest = {}): Promise<ReconciliationPreview> {
    const canonicalRoot = path.join(this.options.homeDir, '.agents', 'skills')
    const inventory = await scanGlobalSkills(this.options)
    const operations: PlannedOperation[] = []
    const storedOperations: StoredOperation[] = []
    const blockers: PlanBlocker[] = []
    const warnings = new Set<string>()
    let unchanged = 0

    for (const skill of inventory.skills) {
      if (request.skillIds && !request.skillIds.includes(skill.id)) continue
      if (!skill.agents.some((agent) => agent.id === 'universal')) {
        blockers.push({
          skillId: skill.id,
          code: 'missing-canonical',
          path: skill.canonicalPath,
          message: 'Tracked skill is missing from the canonical library.',
        })
        continue
      }
      const canonicalPath = skill.canonicalPath
      const canonicalFingerprint = await fingerprint(canonicalPath)

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
        snapshot: await scanGlobalSkills(this.options),
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
    for (const operation of plan.operations) {
      try {
        await this.assertSafe(operation)
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
      schemaVersion: 1,
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
        await symlink(path.relative(path.dirname(target), operation.public.canonicalPath), temporary, 'dir')
        temporaryPaths.push(temporary)
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
        const canonical = await fingerprint(operation.public.canonicalPath)
        if (
          actual.kind !== 'symlink'
          || actual.linkTarget !== operation.public.canonicalPath
          || !fingerprintsMatch(canonical, operation.canonicalBefore)
        ) {
          throw new VerificationError(`Verification failed for ${operation.public.skillId}.`)
        }
      }

      await appendJournalEvent(journalDirectory, { status: 'verified' })
      this.planReceipts.set(planId, { status: 'applied', journalId })
      return {
        status: 'applied',
        planId,
        journalId,
        snapshot: await scanGlobalSkills(this.options),
      }
    } catch (error) {
      await Promise.all(temporaryPaths.map((temporary) => unlink(temporary).catch(() => undefined)))
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
        snapshot: await scanGlobalSkills(this.options),
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
      plan = JSON.parse(await readFile(path.join(journalDirectory, 'plan.json'), 'utf8')) as JournalPlan
      events = (await readFile(path.join(journalDirectory, 'events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { status?: string })
      if (
        plan.schemaVersion !== 1
        || plan.journalId !== journalId
        || !Array.isArray(plan.operations)
      ) {
        throw new Error('Journal plan is invalid.')
      }
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
        snapshot: await scanGlobalSkills(this.options),
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
        if (current.kind !== 'symlink' || current.linkTarget !== operation.public.canonicalPath) {
          return {
            status: 'rejected',
            journalId,
            error: {
              code: 'rollback-conflict',
              phase: 'rollback',
              message: `The Agent copy changed after apply: ${operation.public.skillId}.`,
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
        await unlink(operation.public.targetPath)
        if (operation.backupPath) {
          await rename(operation.backupPath, operation.public.targetPath)
        }
        if (!fingerprintsMatch(await fingerprint(operation.public.targetPath), operation.public.before)) {
          throw new Error(`Rollback verification failed for ${operation.public.skillId}.`)
        }
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
        snapshot: await scanGlobalSkills(this.options),
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

  private async assertSafe(operation: StoredOperation): Promise<void> {
    const { canonicalPath, targetPath } = operation.public
    const canonicalRoot = await realpath(operation.canonicalRoot)
    const canonical = await realpath(canonicalPath)
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
    const home = await realpath(this.options.homeDir)
    const targetParent = await realpath(path.dirname(targetPath))
    if (
      !isInside(home, agentRoot)
      || agentRoot !== targetParent
      || path.dirname(targetPath) !== operation.agentRoot
    ) {
      throw new Error(`Target path is outside the managed Agent root: ${targetPath}`)
    }

    if (
      !fingerprintsMatch(await fingerprint(canonicalPath), operation.canonicalBefore)
      || !fingerprintsMatch(await fingerprint(targetPath), operation.public.before)
    ) {
      throw new StalePlanError(`The filesystem changed after preview for ${operation.public.skillId}.`)
    }
  }

  private async rollbackApplied(
    applied: JournalOperation[],
    journalDirectory: string,
  ): Promise<Error | null> {
    try {
      for (const operation of [...applied].reverse()) {
        const current = await fingerprint(operation.public.targetPath)
        if (
          current.kind !== 'missing'
          && (current.kind !== 'symlink' || current.linkTarget !== operation.public.canonicalPath)
        ) {
          throw new Error(`Rollback conflict for ${operation.public.targetPath}.`)
        }
        if (
          operation.backupPath
          && !fingerprintsMatch(await fingerprint(operation.backupPath), operation.public.before)
        ) {
          throw new Error(`Backup verification failed for ${operation.public.targetPath}.`)
        }
        if (current.kind === 'symlink') await unlink(operation.public.targetPath)
        if (operation.backupPath) await rename(operation.backupPath, operation.public.targetPath)
        if (!fingerprintsMatch(await fingerprint(operation.public.targetPath), operation.public.before)) {
          throw new Error(`Rollback verification failed for ${operation.public.targetPath}.`)
        }
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

    const agent = this.options.agentLocations.find((candidate) => candidate.id === agentId)
    if (!agent) throw new Error('Journal references an unknown Agent destination.')
    const canonicalRoot = path.join(this.options.homeDir, '.agents', 'skills')
    const agentRoot = path.resolve(this.options.homeDir, agent.relativePath)
    if (
      operation.canonicalRoot !== canonicalRoot
      || operation.agentRoot !== agentRoot
      || operation.public.canonicalPath !== path.join(canonicalRoot, skillId)
      || operation.public.targetPath !== path.join(agentRoot, skillId)
    ) {
      throw new Error('Journal path is outside the configured roots.')
    }
    const expectedBackup = operation.public.before.kind === 'missing'
      ? null
      : `${operation.public.targetPath}.skillledger-${journalId}.backup`
    if (operation.backupPath !== expectedBackup) {
      throw new Error('Journal backup escaped the configured Agent root.')
    }

    const resolvedAgentRoot = await realpath(agentRoot)
    const resolvedHome = await realpath(this.options.homeDir)
    const resolvedTargetParent = await realpath(path.dirname(operation.public.targetPath))
    if (!isInside(resolvedHome, resolvedAgentRoot) || resolvedAgentRoot !== resolvedTargetParent) {
      throw new Error('Journal target parent escaped the configured Agent root.')
    }
  }
}

class StalePlanError extends Error {}
class VerificationError extends Error {}
