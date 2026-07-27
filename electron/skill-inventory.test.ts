import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSkillContent, scanGlobalSkills } from './skill-inventory'

const temporaryHomes: string[] = []

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('scanGlobalSkills', () => {
  it('reconciles canonical skills, source tracking, links, and missing entries', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const codexRoot = path.join(home, '.codex', 'skills')
    await mkdir(canonical, { recursive: true })
    await mkdir(codexRoot, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), '---\nname: review-code\ndescription: Review code safely.\n---\n')
    await symlink(path.relative(codexRoot, canonical), path.join(codexRoot, 'review-code'))
    await writeFile(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({
      skills: {
        'review-code': { source: 'example/skills', sourceType: 'github', updatedAt: '2026-07-26T00:00:00Z' },
        'missing-skill': { source: 'example/missing', sourceType: 'github' },
      },
    }))

    const snapshot = await scanGlobalSkills({
      homeDir: home,
      agentLocations: [{ id: 'codex', label: 'Codex', relativePath: '.codex/skills' }],
    })

    expect(snapshot.summary).toMatchObject({ total: 2, healthy: 1, missing: 1 })
    expect(snapshot.skills.find((skill) => skill.id === 'review-code')).toMatchObject({
      name: 'review-code',
      description: 'Review code safely.',
      health: 'healthy',
      source: 'example/skills',
    })
    expect(snapshot.skills.find((skill) => skill.id === 'review-code')?.agents.map((agent) => agent.kind))
      .toEqual(['canonical', 'symlink'])
  })

  it('reads bounded text content without following paths outside the skill', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-'))
    temporaryHomes.push(home)
    const canonical = path.join(home, '.agents', 'skills', 'review-code')
    const references = path.join(canonical, 'references')
    const outside = path.join(home, 'outside.md')
    await mkdir(references, { recursive: true })
    await writeFile(path.join(canonical, 'SKILL.md'), '# Review code\n\nRead this safely.\n')
    await writeFile(path.join(references, 'checks.md'), '# Checks\n')
    await writeFile(outside, 'private')
    await symlink(outside, path.join(canonical, 'linked.md'))

    const content = await readSkillContent(home, 'review-code')

    expect(content).toMatchObject({
      skillId: 'review-code',
      selectedPath: 'SKILL.md',
      content: '# Review code\n\nRead this safely.\n',
    })
    expect(content.files.map((entry) => entry.path)).toEqual([
      'SKILL.md',
      'references',
      'references/checks.md',
    ])
    await expect(readSkillContent(home, 'review-code', '../outside.md'))
      .rejects.toThrow('Invalid skill content request')
    await expect(readSkillContent(home, 'review-code', 'linked.md'))
      .rejects.toThrow('Skill content path escapes its root')
  })
})
