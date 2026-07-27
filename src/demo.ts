import type { InventorySnapshot, SkillContentSnapshot, SkillHealth, SkillRecord } from './types'

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
    sourcePin: source ? {
      repository: source,
      path: `skills/${id}`,
      revision: '0'.repeat(40),
      sha256: '0'.repeat(64),
    } : null,
    sourceState: source ? (health === 'missing' ? 'missing' as const : 'pinned' as const) : 'local' as const,
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

const demoSources: Record<string, string> = {
  'SKILL.md': `---
name: codex-model-routing-team
description: Route complex parallel work through bounded, auditable Workers.
---

# Codex Model Routing Team

Route complex parallel work through bounded, auditable Workers.

## When to use

Use this skill when a request requires multiple independent or semi-independent tracks of work that benefit from parallel execution, domain-specialized execution, or explicit quality gates.

Examples include multi-domain analysis, large codebase exploration, evidence synthesis, or coordinated generation and validation tasks.

## Routing strategy

Use structured routing to select the right Worker for the job, provide clear boundaries and success criteria, and aggregate results with traceability.

### Key principles

- Route by capability and context, not convenience.
- Keep Workers focused and bounded.
- Make handoffs explicit and auditable.
- Fail fast with clear reasons; retry with adjusted scope.

### High-level flow

\`\`\`text
plan → route → execute[parallel] → aggregate → validate → respond
\`\`\`

## Guardrails

- Respect scope limits and do not escalate without explicit instruction.
- Do not fabricate data, results, or sources.
- Prefer deterministic, reproducible steps over ad-hoc reasoning.
- Surface assumptions, risks, and open questions clearly.
- Preserve user intent and privacy at all times.
`,
  'references/routing.md': `# Routing reference

Choose the smallest set of independent Workers that covers the requested outcome.

## Selection order

1. Match the domain.
2. Bound the file or evidence ownership.
3. State the expected result.
4. Validate before integration.
`,
  'scripts/validate.ts': `export function validateHandoff(result: unknown): boolean {
  return Boolean(result && typeof result === 'object')
}
`,
}

export function demoSkillContent(
  skill: SkillRecord,
  selectedPath = 'SKILL.md',
): SkillContentSnapshot {
  const content = demoSources[selectedPath] ?? demoSources['SKILL.md']
  return {
    skillId: skill.id,
    rootPath: skill.canonicalPath,
    selectedPath: demoSources[selectedPath] ? selectedPath : 'SKILL.md',
    content: selectedPath === 'SKILL.md'
      ? content.replace('codex-model-routing-team', skill.id).replace('Codex Model Routing Team', skill.name)
      : content,
    files: [
      { path: 'SKILL.md', kind: 'file', depth: 0 },
      { path: 'references', kind: 'directory', depth: 0 },
      { path: 'references/routing.md', kind: 'file', depth: 1 },
      { path: 'scripts', kind: 'directory', depth: 0 },
      { path: 'scripts/validate.ts', kind: 'file', depth: 1 },
    ],
  }
}
