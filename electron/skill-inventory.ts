import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentInstallKind,
  AgentPresence,
  InventorySnapshot,
  SkillHealth,
  SkillRecord,
} from '../src/types'

interface AgentLocation {
  id: string
  label: string
  relativePath: string
}

interface LockEntry {
  source?: string
  sourceUrl?: string
  sourceType?: string
  updatedAt?: string
}

interface LockFile {
  skills?: Record<string, LockEntry>
}

interface ScanOptions {
  homeDir?: string
  agentLocations?: AgentLocation[]
}

export const defaultAgentLocations: AgentLocation[] = [
  { id: 'codex', label: 'Codex', relativePath: '.codex/skills' },
  { id: 'claude', label: 'Claude Code', relativePath: '.claude/skills' },
  { id: 'cursor', label: 'Cursor', relativePath: '.cursor/skills' },
  { id: 'gemini', label: 'Gemini CLI', relativePath: '.gemini/skills' },
  { id: 'grok', label: 'Grok', relativePath: '.grok/skills' },
  { id: 'opencode', label: 'OpenCode', relativePath: '.config/opencode/skills' },
  { id: 'aider', label: 'AiderDesk', relativePath: '.aider-desk/skills' },
]

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

async function loadLock(lockFilePath: string, warnings: string[]): Promise<Record<string, LockEntry>> {
  try {
    const parsed = JSON.parse(await readFile(lockFilePath, 'utf8')) as LockFile
    return parsed.skills ?? {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnings.push(`Could not read the global lock file: ${(error as Error).message}`)
    }
    return {}
  }
}

async function listSkillNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function frontmatterValue(markdown: string, key: string): string | null {
  const match = markdown.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null
}

async function readSkillMetadata(skillPath: string, fallbackName: string): Promise<{ name: string; description: string }> {
  try {
    const markdown = await readFile(path.join(skillPath, 'SKILL.md'), 'utf8')
    return {
      name: frontmatterValue(markdown, 'name') ?? fallbackName,
      description: frontmatterValue(markdown, 'description') ?? 'No description provided.',
    }
  } catch {
    return { name: fallbackName, description: 'SKILL.md is missing or unreadable.' }
  }
}

async function inspectAgent(
  homeDir: string,
  location: AgentLocation,
  skillName: string,
  canonicalPath: string,
): Promise<AgentPresence | null> {
  const installPath = path.join(homeDir, location.relativePath, skillName)
  try {
    const stats = await lstat(installPath)
    let kind: AgentInstallKind = 'copy'
    let healthy = await fileExists(path.join(installPath, 'SKILL.md'))

    if (stats.isSymbolicLink()) {
      kind = 'symlink'
      try {
        healthy = (await realpath(installPath)) === (await realpath(canonicalPath)) && healthy
      } catch {
        healthy = false
      }
    }

    return { id: location.id, label: location.label, path: installPath, kind, healthy }
  } catch {
    return null
  }
}

function deriveHealth(
  canonicalExists: boolean,
  lockEntry: LockEntry | undefined,
  agents: AgentPresence[],
): { health: SkillHealth; healthReason: string } {
  if (!canonicalExists && lockEntry) return { health: 'missing', healthReason: 'Tracked in the lock file but absent from the canonical library.' }
  if (!canonicalExists) return { health: 'broken', healthReason: 'Canonical skill content is missing.' }
  if (agents.some((agent) => !agent.healthy)) return { health: 'broken', healthReason: 'At least one Agent link is broken or points elsewhere.' }
  if (!lockEntry) return { health: 'review', healthReason: 'Installed locally but not tracked in the global source lock.' }
  if (agents.some((agent) => agent.kind === 'copy')) return { health: 'review', healthReason: 'Independent copies can drift from the canonical skill.' }
  return { health: 'healthy', healthReason: 'Canonical content and Agent links are consistent.' }
}

export async function scanGlobalSkills(options: ScanOptions = {}): Promise<InventorySnapshot> {
  const homeDir = options.homeDir ?? os.homedir()
  const agentLocations = options.agentLocations ?? defaultAgentLocations
  const canonicalRoot = path.join(homeDir, '.agents', 'skills')
  const lockFilePath = path.join(homeDir, '.agents', '.skill-lock.json')
  const warnings: string[] = []
  const lockEntries = await loadLock(lockFilePath, warnings)
  const names = new Set([...await listSkillNames(canonicalRoot), ...Object.keys(lockEntries)])

  const skills: SkillRecord[] = await Promise.all([...names].sort().map(async (skillName) => {
    const canonicalPath = path.join(canonicalRoot, skillName)
    const canonicalExists = await fileExists(path.join(canonicalPath, 'SKILL.md'))
    const metadata = await readSkillMetadata(canonicalPath, skillName)
    const discovered = await Promise.all(
      agentLocations.map((location) => inspectAgent(homeDir, location, skillName, canonicalPath)),
    )
    const agents: AgentPresence[] = canonicalExists
      ? [{ id: 'universal', label: 'Universal', path: canonicalPath, kind: 'canonical', healthy: true }, ...discovered.filter((item): item is AgentPresence => item !== null)]
      : discovered.filter((item): item is AgentPresence => item !== null)
    const lockEntry = lockEntries[skillName]
    const { health, healthReason } = deriveHealth(canonicalExists, lockEntry, agents)

    return {
      id: skillName,
      name: metadata.name,
      description: metadata.description,
      canonicalPath,
      source: lockEntry?.source ?? null,
      sourceUrl: lockEntry?.sourceUrl ?? null,
      sourceType: lockEntry?.sourceType ?? null,
      updatedAt: lockEntry?.updatedAt ?? null,
      health,
      healthReason,
      agents,
    }
  }))

  return {
    scannedAt: new Date().toISOString(),
    canonicalRoot,
    lockFilePath,
    skills,
    summary: {
      total: skills.length,
      healthy: skills.filter((skill) => skill.health === 'healthy').length,
      review: skills.filter((skill) => skill.health === 'review').length,
      missing: skills.filter((skill) => skill.health === 'missing').length,
      broken: skills.filter((skill) => skill.health === 'broken').length,
      agentLinks: skills.reduce((count, skill) => count + skill.agents.length, 0),
    },
    warnings,
  }
}
