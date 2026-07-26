import { access, chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillReconciler } from './skill-reconciler'

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
        summary: { total: 1, healthy: 0, review: 1, broken: 0 },
        skills: [{
          id: 'review-code',
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
})
