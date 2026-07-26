import { describe, expect, it } from 'vitest'
import { demoSnapshot } from '../src/demo'
import { serializeInventoryExport } from './inventory-export'

describe('serializeInventoryExport', () => {
  it('is stable across scan times, absolute paths, and input ordering', () => {
    const reordered = structuredClone(demoSnapshot)
    reordered.scannedAt = '2099-01-01T00:00:00.000Z'
    reordered.canonicalRoot = '/different/canonical/root'
    reordered.lockFilePath = '/different/.skill-lock.json'
    reordered.skills.reverse()
    for (const skill of reordered.skills) {
      skill.canonicalPath = `/different/${skill.id}`
      skill.agents.reverse()
      for (const agent of skill.agents) agent.path = `/different/${agent.id}/${skill.id}`
    }

    const exported = serializeInventoryExport(demoSnapshot)
    expect(serializeInventoryExport(reordered)).toBe(exported)
    expect(JSON.parse(exported)).toMatchObject({ schemaVersion: 1, summary: { total: demoSnapshot.skills.length } })
    expect(exported).not.toContain(demoSnapshot.canonicalRoot)
    expect(exported).not.toContain('scannedAt')
    expect(exported).not.toContain('updatedAt')
  })
})
