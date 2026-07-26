import type { InventorySnapshot } from '../src/types'

export function serializeInventoryExport(snapshot: InventorySnapshot): string {
  const skills = snapshot.skills
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      sourceType: skill.sourceType,
      sourcePin: skill.sourcePin && {
        repository: skill.sourcePin.repository,
        path: skill.sourcePin.path,
        revision: skill.sourcePin.revision,
        sha256: skill.sourcePin.sha256,
      },
      sourceState: skill.sourceState,
      health: skill.health,
      healthReason: skill.healthReason,
      agents: skill.agents
        .map(({ id, label, kind, healthy }) => ({ id, label, kind, healthy }))
        .sort((left, right) => left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
    }))
    .sort((left, right) => left.id === right.id ? 0 : left.id < right.id ? -1 : 1)
  return `${JSON.stringify({
    schemaVersion: 1,
    summary: {
      total: skills.length,
      healthy: skills.filter((skill) => skill.health === 'healthy').length,
      review: skills.filter((skill) => skill.health === 'review').length,
      missing: skills.filter((skill) => skill.health === 'missing').length,
      broken: skills.filter((skill) => skill.health === 'broken').length,
      agentLinks: skills.reduce((count, skill) => count + skill.agents.length, 0),
    },
    skills,
  }, null, 2)}\n`
}
