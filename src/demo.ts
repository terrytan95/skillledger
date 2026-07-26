import type { InventorySnapshot, SkillHealth } from './types'

const canonicalRoot = '/Users/you/.agents/skills'
const agents = ['Universal', 'Codex', 'Claude Code', 'Cursor', 'Gemini CLI', 'Grok', 'OpenCode']

function skill(
  id: string,
  description: string,
  source: string | null,
  health: SkillHealth,
  reach: number,
  reason: string,
) {
  return {
    id,
    name: id,
    description,
    canonicalPath: `${canonicalRoot}/${id}`,
    source,
    sourceUrl: source ? `https://github.com/${source}` : null,
    sourceType: source ? 'github' : null,
    updatedAt: source ? '2026-07-25T18:20:00Z' : null,
    health,
    healthReason: reason,
    agents: agents.slice(0, reach).map((label, index) => ({
      id: label.toLowerCase().replaceAll(' ', '-'),
      label,
      path: index === 0 ? `${canonicalRoot}/${id}` : `/Users/you/.${label.toLowerCase().replaceAll(' ', '-')}/skills/${id}`,
      kind: index === 0 ? 'canonical' as const : 'symlink' as const,
      healthy: health !== 'broken',
    })),
  }
}

export const demoSnapshot: InventorySnapshot = {
  scannedAt: new Date().toISOString(),
  canonicalRoot,
  lockFilePath: '/Users/you/.agents/.skill-lock.json',
  warnings: [],
  skills: [
    skill('codex-model-routing-team', 'Route complex parallel work through bounded, auditable Workers.', 'zjp1997720/zhijian-skills', 'healthy', 7, 'Canonical content and Agent links are consistent.'),
    skill('animation-vocabulary', 'Translate motion intent into implementation-ready animation language.', 'emilkowalski/skills', 'healthy', 6, 'Canonical content and Agent links are consistent.'),
    skill('code-review', 'Review changes with a fixed evidence boundary and actionable priorities.', 'mattpocock/skills', 'healthy', 7, 'Canonical content and Agent links are consistent.'),
    skill('research', 'Investigate a question against primary sources and preserve citations.', 'mattpocock/skills', 'review', 5, 'One independent copy can drift from canonical content.'),
    skill('find-skills', 'Discover relevant skills and install them from trusted repositories.', 'vercel-labs/skills', 'healthy', 7, 'Canonical content and Agent links are consistent.'),
    skill('local-release-notes', 'Generate concise release notes from local Git history.', null, 'review', 2, 'Installed locally but not tracked in the global source lock.'),
    skill('obsolete-qa', 'Legacy QA workflow retained in the source lock.', 'example/legacy-skills', 'missing', 0, 'Tracked in the lock file but absent from the canonical library.'),
    skill('broken-link-demo', 'A sample skill with a destination that no longer resolves.', 'example/demo-skills', 'broken', 4, 'At least one Agent link is broken or points elsewhere.'),
  ],
  summary: { total: 8, healthy: 4, review: 2, missing: 1, broken: 1, agentLinks: 38 },
}
