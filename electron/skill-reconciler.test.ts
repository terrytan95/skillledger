import { createHash, randomUUID } from 'node:crypto'
import { access, chmod, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillReconciler } from './skill-reconciler'
import { fingerprint } from './path-fingerprint'

const temporaryHomes: string[] = []

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('SkillReconciler', () => {
  it('previews a missing Agent link without changing the filesystem', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    const target = path.join(codexRoot, 'review-code')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), '---\nname: review-code\n---\n')

    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
    })

    const preview = await reconciler.preview()

    expect(preview).toMatchObject({
      status: 'ready',
      summary: { createLinks: 1, repairLinks: 0, replaceCopies: 0, blocked: 0 },
      blockers: [],
      operations: [{
        skillId: 'review-code',
        agentId: 'codex',
        kind: 'create-symlink',
        targetPath: target,
        canonicalPath: canonical,
      }],
    })
    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('journals, atomically applies, and verifies a previewed link', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), '---\nname: review-code\n---\n')
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
    })
    const preview = await reconciler.preview()

    const result = await reconciler.apply(preview.planId)
    if (result.status !== 'applied') throw new Error(`Expected apply, received ${result.status}`)

    expect(result).toMatchObject({
      status: 'applied',
      planId: preview.planId,
      snapshot: {
        summary: { total: 1, healthy: 1, review: 0, broken: 0 },
        skills: [{
          id: 'review-code',
          health: 'healthy',
          agents: [
            { id: 'universal', kind: 'canonical', healthy: true },
            { id: 'codex', kind: 'symlink', healthy: true },
          ],
        }],
      },
    })
    expect(result.journalId).toEqual(expect.any(String))
  })

  it('rolls back a verified journal after the module is recreated', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), '---\nname: review-code\n---\n')
    const options = {
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
    }
    const reconciler = new SkillReconciler(options)
    const preview = await reconciler.preview()
    const applied = await reconciler.apply(preview.planId)
    if (applied.status !== 'applied') throw new Error(`Expected apply, received ${applied.status}`)

    const result = await new SkillReconciler(options).rollback(applied.journalId)

    expect(result).toMatchObject({
      status: 'rolled-back',
      journalId: applied.journalId,
      snapshot: {
        skills: [{
          id: 'review-code',
          agents: [{ id: 'universal', kind: 'canonical', healthy: true }],
        }],
      },
    })
  })

  it('rejects a stale plan before changing an Agent destination', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    const skillFile = path.join(canonical, 'SKILL.md')
    await writeFile(skillFile, '---\nname: review-code\n---\n')
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
    })
    const preview = await reconciler.preview()
    await writeFile(skillFile, '---\nname: review-code\ndescription: changed\n---\n')

    const result = await reconciler.apply(preview.planId)

    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'stale-plan', phase: 'apply' },
    })
    expect(await reconciler.preview()).toMatchObject({
      status: 'ready',
      summary: { createLinks: 1 },
    })
  })

  it('plans broken-link repair but blocks an independent copy by default', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    const cursorRoot = path.join(home, '.cursor', 'skills')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await mkdir(path.join(cursorRoot, 'review-code'), { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), '---\nname: review-code\n---\n')
    await writeFile(path.join(cursorRoot, 'review-code', 'SKILL.md'), 'local copy\n')
    await symlink('../wrong-target', path.join(codexRoot, 'review-code'))
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [
        { id: 'codex', label: 'Codex', relativePath: '.codex/skills' },
        { id: 'cursor', label: 'Cursor', relativePath: '.cursor/skills' },
      ],
    })

    const preview = await reconciler.preview()

    expect(preview).toMatchObject({
      status: 'blocked',
      summary: { createLinks: 0, repairLinks: 1, replaceCopies: 0, blocked: 1 },
      operations: [{ agentId: 'codex', kind: 'repair-symlink' }],
      blockers: [{ agentId: 'cursor', code: 'copy-requires-confirmation' }],
    })
  })

  it('restores an independent copy from its journal backup', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const cursorCopy = path.join(home, '.cursor', 'skills', 'review-code')
    await mkdir(canonical, { recursive: true })
    await mkdir(cursorCopy, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), 'canonical content\n')
    await writeFile(path.join(cursorCopy, 'SKILL.md'), 'local customized content\n')
    const options = {
      homeDir: home,
      agentLocations: [{ id: 'cursor', label: 'Cursor', relativePath: '.cursor/skills' }],
    }
    const reconciler = new SkillReconciler(options)
    const preview = await reconciler.preview({ copyPolicy: 'replace-with-symlink' })
    const originalFingerprint = preview.operations[0]?.before
    const applied = await reconciler.apply(preview.planId)
    if (applied.status !== 'applied') throw new Error(`Expected apply, received ${applied.status}`)

    const recreated = new SkillReconciler(options)
    const rollback = await recreated.rollback(applied.journalId)
    const replay = await recreated.preview({ copyPolicy: 'replace-with-symlink' })

    expect(rollback.status).toBe('rolled-back')
    expect(replay.operations[0]?.before).toEqual(originalFingerprint)
  })

  it('returns the original receipt when the same plan is applied twice', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), 'canonical content\n')
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
    })
    const preview = await reconciler.preview()
    const first = await reconciler.apply(preview.planId)
    if (first.status !== 'applied') throw new Error(`Expected apply, received ${first.status}`)

    const second = await reconciler.apply(preview.planId)

    expect(second).toMatchObject({
      status: 'already-applied',
      planId: preview.planId,
      journalId: first.journalId,
    })
  })

  it('rejects an Agent root that escapes the configured home', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'skillledger-outside-'))
    temporaryHomes.push(home, outside)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    await mkdir(canonical, { recursive: true })
    await mkdir(path.join(outside, 'skills'), { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), 'canonical content\n')
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{
        id: 'outside',
        label: 'Outside',
        relativePath: path.relative(home, path.join(outside, 'skills')),
      }],
    })
    const preview = await reconciler.preview()

    const result = await reconciler.apply(preview.planId)

    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'path-rejected', phase: 'apply' },
    })
  })

  it('allows only one mutation pipeline at a time', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), 'canonical content\n')
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
    })
    const preview = await reconciler.preview()

    const results = await Promise.all([
      reconciler.apply(preview.planId),
      reconciler.apply(preview.planId),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(['applied', 'rejected'])
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      error: { code: 'operation-in-progress' },
    })
  })

  it('does not partially apply a preview that contains blockers', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    const cursorCopy = path.join(home, '.cursor', 'skills', 'review-code')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await mkdir(cursorCopy, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), 'canonical content\n')
    await writeFile(path.join(cursorCopy, 'SKILL.md'), 'local copy\n')
    await symlink('../wrong-target', path.join(codexRoot, 'review-code'))
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [
        { id: 'codex', label: 'Codex', relativePath: '.codex/skills' },
        { id: 'cursor', label: 'Cursor', relativePath: '.cursor/skills' },
      ],
    })
    const preview = await reconciler.preview()

    const result = await reconciler.apply(preview.planId)

    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'plan-blocked', phase: 'apply' },
    })
  })

  it('reports a tracked skill with missing canonical content as blocked', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    await mkdir(path.join(home, '.agents', 'skills'), { recursive: true })
    await mkdir(path.join(home, '.codex', 'skills'), { recursive: true })
    await writeFile(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({
      skills: { 'missing-skill': { source: 'example/missing', sourceType: 'github' } },
    }))
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
    })

    const preview = await reconciler.preview()

    expect(preview).toMatchObject({
      status: 'blocked',
      summary: { blocked: 1 },
      blockers: [{ skillId: 'missing-skill', code: 'missing-canonical' }],
    })
  })

  it('automatically restores earlier destinations when a later write fails', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    const cursorRoot = path.join(home, '.cursor', 'skills')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await mkdir(cursorRoot, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), 'canonical content\n')
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [
        { id: 'codex', label: 'Codex', relativePath: '.codex/skills' },
        { id: 'cursor', label: 'Cursor', relativePath: '.cursor/skills' },
      ],
    })
    const preview = await reconciler.preview()
    await chmod(cursorRoot, 0o500)

    const result = await reconciler.apply(preview.planId)
    await chmod(cursorRoot, 0o700)

    expect(result).toMatchObject({
      status: 'rolled-back',
      snapshot: {
        skills: [{
          id: 'review-code',
          agents: [{ id: 'universal', kind: 'canonical' }],
        }],
      },
    })
  })

  it('recovers an interrupted journal after the process is recreated', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonicalRoot = path.join(home, '.agents', 'skills')
    const canonical = path.join(canonicalRoot, 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    const cursorRoot = path.join(home, '.cursor', 'skills')
    const codexTarget = path.join(codexRoot, 'review-code')
    const cursorTarget = path.join(cursorRoot, 'review-code')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await mkdir(cursorTarget, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), 'canonical content\n')
    await writeFile(path.join(cursorTarget, 'SKILL.md'), 'local customized content\n')
    const options = {
      homeDir: home,
      agentLocations: [
        { id: 'codex', label: 'Codex', relativePath: '.codex/skills' },
        { id: 'cursor', label: 'Cursor', relativePath: '.cursor/skills' },
      ],
    }
    const reconciler = new SkillReconciler(options)
    const preview = await reconciler.preview({ copyPolicy: 'replace-with-symlink' })
    const journalId = randomUUID()
    const journalDirectory = path.join(home, '.agents', '.skillledger', 'journals', journalId)
    const cursorBackup = `${cursorTarget}.skillledger-${journalId}.backup`
    const canonicalBefore = await fingerprint(canonical)
    const operations = preview.operations.map((operation) => ({
      public: operation,
      rootKind: 'agent',
      agentRoot: operation.agentId === 'codex' ? codexRoot : cursorRoot,
      canonicalRoot,
      canonicalBefore,
      backupPath: operation.before.kind === 'missing'
        ? null
        : `${operation.targetPath}.skillledger-${journalId}.backup`,
    }))
    await mkdir(journalDirectory, { recursive: true })
    await writeFile(path.join(journalDirectory, 'plan.json'), JSON.stringify({
      schemaVersion: 2,
      journalId,
      planId: preview.planId,
      createdAt: new Date().toISOString(),
      operations,
    }))
    await writeFile(
      path.join(journalDirectory, 'events.jsonl'),
      `${JSON.stringify({ at: new Date().toISOString(), status: 'prepared' })}\n`,
    )
    await symlink(path.relative(path.dirname(codexTarget), canonical), codexTarget, 'dir')
    await rename(cursorTarget, cursorBackup)
    await symlink(path.relative(path.dirname(cursorTarget), canonical), cursorTarget, 'dir')

    const recreated = new SkillReconciler(options)
    const recovery = await recreated.recoverIncomplete()
    const activity = await recreated.activity()

    expect(recovery).toEqual({ recovered: [journalId], failed: [] })
    await expect(access(codexTarget)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path.join(cursorTarget, 'SKILL.md'), 'utf8')).toBe('local customized content\n')
    await expect(access(cursorBackup)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(activity.entries[0]).toMatchObject({
      journalId,
      status: 'rolled-back',
      rollbackAvailable: false,
      protected: false,
    })
  })

  it('discards verified rollback data while retaining the journal audit', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const cursorCopy = path.join(home, '.cursor', 'skills', 'review-code')
    await mkdir(canonical, { recursive: true })
    await mkdir(cursorCopy, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), 'canonical content\n')
    await writeFile(path.join(cursorCopy, 'SKILL.md'), 'local customized content\n')
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{ id: 'cursor', label: 'Cursor', relativePath: '.cursor/skills' }],
    })
    const preview = await reconciler.preview({ copyPolicy: 'replace-with-symlink' })
    const applied = await reconciler.apply(preview.planId)
    if (applied.status !== 'applied') throw new Error(`Expected apply, received ${applied.status}`)

    const discarded = await reconciler.discard(applied.journalId)
    const rollback = await reconciler.rollback(applied.journalId)

    expect(discarded).toMatchObject({
      status: 'discarded',
      activity: {
        totalBackupBytes: 0,
        entries: [{
          journalId: applied.journalId,
          status: 'discarded',
          rollbackAvailable: false,
        }],
      },
    })
    expect(rollback).toMatchObject({
      status: 'rejected',
      error: { code: 'rollback-conflict' },
    })
  })

  it('restores a missing canonical skill from an exact GitHub pin before linking it', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-reconcile-'))
    temporaryHomes.push(home)
    const canonicalRoot = path.join(home, '.agents', 'skills')
    const canonical = path.join(canonicalRoot, 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    await mkdir(canonicalRoot, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    const expected = path.join(home, 'expected')
    await mkdir(expected)
    const content = Buffer.from('---\nname: review-code\n---\n')
    await writeFile(path.join(expected, 'SKILL.md'), content)
    const expectedHash = (await fingerprint(expected)).sha256!
    await rm(expected, { recursive: true })
    await writeFile(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({
      skills: {
        'review-code': {
          source: 'example/skills',
          sourceType: 'github',
          repository: 'example/skills',
          path: 'skills/review-code',
          revision: '1'.repeat(40),
          sha256: expectedHash,
        },
      },
    }))
    const blobSha = createHash('sha1')
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest('hex')
    const json = (value: object) => new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchSource = async (input: string) => {
      if (input.includes('/git/commits/')) return json({ sha: '1'.repeat(40), tree: { sha: 'a'.repeat(40) } })
      if (input.endsWith(`/git/trees/${'a'.repeat(40)}`)) {
        return json({ tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: 'b'.repeat(40) }] })
      }
      if (input.endsWith(`/git/trees/${'b'.repeat(40)}`)) {
        return json({ tree: [{ path: 'review-code', mode: '040000', type: 'tree', sha: 'c'.repeat(40) }] })
      }
      if (input.includes(`git/trees/${'c'.repeat(40)}?recursive=1`)) {
        return json({
          truncated: false,
          tree: [{ path: 'SKILL.md', mode: '100644', type: 'blob', size: content.length, sha: blobSha }],
        })
      }
      if (input.startsWith('https://raw.githubusercontent.com/')) return new Response(content)
      return new Response(null, { status: 404 })
    }
    const reconciler = new SkillReconciler({
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
      fetchSource,
    })

    const preview = await reconciler.preview({ sourcePolicy: 'restore-pinned' })
    const applied = await reconciler.apply(preview.planId)
    if (applied.status !== 'applied') throw new Error(`Expected apply, received ${JSON.stringify(applied)}`)

    expect(preview.operations.map((operation) => operation.kind))
      .toEqual(['restore-canonical', 'create-symlink'])
    expect(applied.snapshot.skills[0]).toMatchObject({
      id: 'review-code',
      health: 'healthy',
      sourceState: 'pinned',
    })
    expect((await reconciler.rollback(applied.journalId)).status).toBe('rolled-back')
    expect(await fingerprint(canonical)).toMatchObject({ kind: 'missing' })
  })
})
