import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import type { SourcePin, TeamImportResult, TeamStatus } from '../src/types'
import { normalizeSourcePin } from './skill-source'

type TeamRole = 'maintainer' | 'owner'
type ApprovalAction = 'restore-canonical' | 'update-canonical' | 'replace-copy'

interface TeamPolicy {
  schemaVersion: 1
  teamId: string
  name: string
  managedRepositories: Array<{ repository: string; paths: string[] }>
  trustedSigners: Array<{ id: string; publicKey: string; roles: TeamRole[] }>
  approvalRules: {
    restoreCanonical: TeamRole
    updateCanonical: TeamRole
    replaceCopy: TeamRole
  }
}

interface ManifestPayload {
  schemaVersion: 1
  teamId: string
  sequence: number
  issuedAt: string
  expiresAt: string
  skills: Record<string, SourcePin>
  approvals: Array<{ action: ApprovalAction; skillId: string; agentId?: string }>
}

interface SignedManifest {
  payload: ManifestPayload
  signature: { keyId: string; algorithm: 'ed25519'; value: string }
}

interface LoadedTeam {
  policy: TeamPolicy
  manifest: SignedManifest
  signer: TeamPolicy['trustedSigners'][number]
}

interface ManifestHighWater {
  schemaVersion: 1
  sequence: number
  sha256: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
    && value !== '.'
    && value !== '..'
}

function validRepository(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)
    && !value.endsWith('.git')
}

function validSourcePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 1_024
    && !path.posix.isAbsolute(value)
    && !value.includes('\\')
    && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
}

function parseJson(json: string): unknown {
  if (Buffer.byteLength(json) > 256 * 1024) throw new Error('Team document exceeds 256 KiB.')
  return JSON.parse(json) as unknown
}

function parsePolicy(value: unknown): TeamPolicy {
  if (!isRecord(value) || value.schemaVersion !== 1 || !validId(value.teamId)) {
    throw new Error('Team policy identity is invalid.')
  }
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128) {
    throw new Error('Team policy name is invalid.')
  }
  if (
    !Array.isArray(value.managedRepositories)
    || value.managedRepositories.length === 0
    || value.managedRepositories.length > 100
  ) {
    throw new Error('Team policy managed repositories are invalid.')
  }
  const managedRepositories = value.managedRepositories.map((item) => {
    if (
      !isRecord(item)
      || !validRepository(item.repository)
      || !Array.isArray(item.paths)
      || item.paths.length === 0
      || item.paths.length > 100
      || item.paths.some((candidate) => !validSourcePath(candidate))
    ) {
      throw new Error('Team policy contains an invalid managed repository.')
    }
    return { repository: item.repository, paths: [...new Set(item.paths as string[])] }
  })
  if (
    !Array.isArray(value.trustedSigners)
    || value.trustedSigners.length === 0
    || value.trustedSigners.length > 100
  ) {
    throw new Error('Team policy trusted signers are invalid.')
  }
  const trustedSigners = value.trustedSigners.map((item) => {
    if (
      !isRecord(item)
      || !validId(item.id)
      || typeof item.publicKey !== 'string'
      || item.publicKey.length > 4_096
      || !Array.isArray(item.roles)
      || item.roles.length === 0
      || item.roles.some((role) => role !== 'maintainer' && role !== 'owner')
    ) {
      throw new Error('Team policy contains an invalid trusted signer.')
    }
    const key = createPublicKey({
      key: Buffer.from(item.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    })
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Team signer key must be Ed25519.')
    return { id: item.id, publicKey: item.publicKey, roles: [...new Set(item.roles as TeamRole[])] }
  })
  if (new Set(trustedSigners.map((signer) => signer.id)).size !== trustedSigners.length) {
    throw new Error('Team signer identifiers must be unique.')
  }
  if (!isRecord(value.approvalRules)) throw new Error('Team approval rules are invalid.')
  const approvalRules = value.approvalRules
  const rule = (name: string): TeamRole => {
    const candidate = approvalRules[name]
    if (candidate !== 'maintainer' && candidate !== 'owner') {
      throw new Error('Team approval rules are invalid.')
    }
    return candidate
  }
  return {
    schemaVersion: 1,
    teamId: value.teamId,
    name: value.name,
    managedRepositories,
    trustedSigners,
    approvalRules: {
      restoreCanonical: rule('restoreCanonical'),
      updateCanonical: rule('updateCanonical'),
      replaceCopy: rule('replaceCopy'),
    },
  }
}

function repositoryAllows(policy: TeamPolicy, pin: SourcePin): boolean {
  return policy.managedRepositories.some((managed) => (
    managed.repository.toLowerCase() === pin.repository.toLowerCase()
    && managed.paths.some((prefix) => pin.path === prefix || pin.path.startsWith(`${prefix}/`))
  ))
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error('Manifest contains a non-JSON value.')
}

function parseManifest(value: unknown, policy: TeamPolicy, allowExpired = false): LoadedTeam {
  if (!isRecord(value) || !isRecord(value.payload) || !isRecord(value.signature)) {
    throw new Error('Signed manifest envelope is invalid.')
  }
  const payload = value.payload
  const signature = value.signature
  if (
    payload.schemaVersion !== 1
    || payload.teamId !== policy.teamId
    || !Number.isSafeInteger(payload.sequence)
    || (payload.sequence as number) < 1
    || typeof payload.issuedAt !== 'string'
    || !Number.isFinite(Date.parse(payload.issuedAt))
    || typeof payload.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(payload.expiresAt))
    || (!allowExpired && Date.parse(payload.expiresAt) <= Date.now())
    || !isRecord(payload.skills)
    || Object.keys(payload.skills).length > 2_000
    || !Array.isArray(payload.approvals)
    || payload.approvals.length > 5_000
  ) {
    throw new Error('Signed manifest payload is invalid or expired.')
  }
  const skills: Record<string, SourcePin> = {}
  for (const [skillId, rawPin] of Object.entries(payload.skills)) {
    const pin = normalizeSourcePin(rawPin)
    if (!validId(skillId) || !pin || !repositoryAllows(policy, pin)) {
      throw new Error(`Manifest source is not managed: ${skillId}.`)
    }
    skills[skillId] = pin
  }
  const approvals = payload.approvals.map((approval) => {
    if (
      !isRecord(approval)
      || !['restore-canonical', 'update-canonical', 'replace-copy'].includes(approval.action as string)
      || !validId(approval.skillId)
      || (
        approval.agentId !== undefined
        && approval.agentId !== '*'
        && !validId(approval.agentId)
      )
    ) {
      throw new Error('Manifest contains an invalid approval.')
    }
    return {
      action: approval.action as ApprovalAction,
      skillId: approval.skillId,
      ...(approval.agentId === undefined ? {} : { agentId: approval.agentId }),
    }
  })
  if (
    signature.algorithm !== 'ed25519'
    || !validId(signature.keyId)
    || typeof signature.value !== 'string'
    || signature.value.length > 1_024
  ) {
    throw new Error('Manifest signature is invalid.')
  }
  const signer = policy.trustedSigners.find((candidate) => candidate.id === signature.keyId)
  if (!signer) throw new Error('Manifest signer is not trusted by this policy.')
  const key = createPublicKey({
    key: Buffer.from(signer.publicKey, 'base64'),
    format: 'der',
    type: 'spki',
  })
  const signatureBytes = Buffer.from(signature.value, 'base64')
  if (!verify(null, Buffer.from(canonicalJson(payload)), key, signatureBytes)) {
    throw new Error('Manifest signature verification failed.')
  }
  return {
    policy,
    signer,
    manifest: {
      payload: {
        schemaVersion: 1,
        teamId: payload.teamId,
        sequence: payload.sequence as number,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        skills,
        approvals,
      },
      signature: {
        keyId: signature.keyId,
        algorithm: 'ed25519',
        value: signature.value,
      },
    },
  }
}

function manifestHighWater(manifest: SignedManifest): ManifestHighWater {
  return {
    schemaVersion: 1,
    sequence: manifest.payload.sequence,
    sha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex'),
  }
}

function parseManifestHighWater(value: unknown): ManifestHighWater {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.sequence)
    || (value.sequence as number) < 1
    || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sha256)
  ) {
    throw new Error('Manifest sequence high-water mark is invalid.')
  }
  return { schemaVersion: 1, sequence: value.sequence as number, sha256: value.sha256 }
}

function roleAllows(roles: TeamRole[], required: TeamRole): boolean {
  return roles.includes('owner') || (required === 'maintainer' && roles.includes('maintainer'))
}

async function writeAtomic(filePath: string, json: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.tmp-${randomUUID()}`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(json)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, filePath)
  const directory = await open(path.dirname(filePath), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export class TeamManager {
  readonly policyPath: string
  readonly manifestPath: string
  readonly sequencePath: string
  private importingManifest = false

  constructor(homeDir: string) {
    const root = path.join(homeDir, '.agents', '.skillledger', 'team')
    this.policyPath = path.join(root, 'policy.json')
    this.manifestPath = path.join(root, 'manifest.json')
    this.sequencePath = path.join(root, 'manifest-sequence.json')
  }

  async status(): Promise<TeamStatus> {
    try {
      const policy = await this.loadPolicy()
      if (!policy) return this.emptyStatus()
      try {
        const team = await this.loadTeam(policy)
        return this.statusFrom(policy, team)
      } catch (error) {
        return this.statusFrom(policy, null, (error as Error).message)
      }
    } catch (error) {
      return { ...this.emptyStatus(), enabled: true, error: (error as Error).message }
    }
  }

  async importPolicy(json: string): Promise<TeamImportResult> {
    try {
      const policy = parsePolicy(parseJson(json))
      const existing = await this.loadPolicy()
      if (existing && canonicalJson(existing) !== canonicalJson(policy)) {
        throw new Error('The installed team trust policy is immutable in v1.')
      }
      await writeAtomic(this.policyPath, `${JSON.stringify(policy, null, 2)}\n`)
      return { status: 'imported', team: await this.status() }
    } catch (error) {
      return { status: 'rejected', message: (error as Error).message, team: await this.status() }
    }
  }

  async importManifest(json: string): Promise<TeamImportResult> {
    if (this.importingManifest) {
      return {
        status: 'rejected',
        message: 'Another team manifest import is already in progress.',
        team: await this.status(),
      }
    }
    this.importingManifest = true
    try {
      const policy = await this.loadPolicy()
      if (!policy) throw new Error('Import a team policy before its signed manifest.')
      const team = parseManifest(parseJson(json), policy)
      const nextHighWater = manifestHighWater(team.manifest)
      const highWater = await this.loadManifestHighWater(policy)
      if (highWater && nextHighWater.sequence < highWater.sequence) {
        throw new Error('Manifest sequence cannot move backwards.')
      }
      if (
        highWater
        && nextHighWater.sequence === highWater.sequence
        && nextHighWater.sha256 !== highWater.sha256
      ) {
        throw new Error('Manifest sequence is already used by different content.')
      }
      await writeAtomic(this.sequencePath, `${JSON.stringify(nextHighWater, null, 2)}\n`)
      await writeAtomic(this.manifestPath, `${JSON.stringify(team.manifest, null, 2)}\n`)
      return { status: 'imported', team: await this.status() }
    } catch (error) {
      return { status: 'rejected', message: (error as Error).message, team: await this.status() }
    } finally {
      this.importingManifest = false
    }
  }

  async sourcePins(): Promise<Record<string, SourcePin>> {
    const policy = await this.loadPolicy()
    if (!policy) return {}
    try {
      return (await this.loadTeam(policy)).manifest.payload.skills
    } catch {
      return {}
    }
  }

  async authorize(
    action: ApprovalAction,
    skillId: string,
    pin?: SourcePin,
    agentId?: string,
  ): Promise<{ allowed: boolean; reason: string | null }> {
    const policy = await this.loadPolicy()
    if (!policy) return { allowed: true, reason: null }
    let team: LoadedTeam
    try {
      team = await this.loadTeam(policy)
    } catch (error) {
      return { allowed: false, reason: (error as Error).message }
    }
    const required = action === 'restore-canonical'
      ? policy.approvalRules.restoreCanonical
      : action === 'update-canonical'
        ? policy.approvalRules.updateCanonical
        : policy.approvalRules.replaceCopy
    if (!roleAllows(team.signer.roles, required)) {
      return { allowed: false, reason: `${required} approval is required by the team policy.` }
    }
    if (pin) {
      const managedPin = team.manifest.payload.skills[skillId]
      if (!managedPin || JSON.stringify(managedPin) !== JSON.stringify(pin)) {
        return { allowed: false, reason: 'The pinned source is not in the signed team manifest.' }
      }
    }
    const approved = team.manifest.payload.approvals.some((approval) => (
      approval.action === action
      && approval.skillId === skillId
      && (
        action !== 'replace-copy'
        || approval.agentId === '*'
        || approval.agentId === agentId
      )
    ))
    return approved
      ? { allowed: true, reason: null }
      : { allowed: false, reason: 'The signed team manifest does not approve this action.' }
  }

  private async loadPolicy(): Promise<TeamPolicy | null> {
    try {
      return parsePolicy(parseJson(await readFile(this.policyPath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async loadTeam(policy: TeamPolicy): Promise<LoadedTeam> {
    try {
      return parseManifest(parseJson(await readFile(this.manifestPath, 'utf8')), policy)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('No signed team manifest is installed.')
      }
      throw error
    }
  }

  private async loadManifestHighWater(policy: TeamPolicy): Promise<ManifestHighWater | null> {
    try {
      return parseManifestHighWater(parseJson(await readFile(this.sequencePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      const team = parseManifest(parseJson(await readFile(this.manifestPath, 'utf8')), policy, true)
      return manifestHighWater(team.manifest)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private emptyStatus(): TeamStatus {
    return {
      enabled: false,
      teamId: null,
      name: null,
      policyPath: this.policyPath,
      manifestPath: this.manifestPath,
      signerId: null,
      signerRoles: [],
      managedRepositories: [],
      approvalRules: null,
      manifestSkillCount: 0,
      error: null,
    }
  }

  private statusFrom(policy: TeamPolicy, team: LoadedTeam | null, error: string | null = null): TeamStatus {
    return {
      enabled: true,
      teamId: policy.teamId,
      name: policy.name,
      policyPath: this.policyPath,
      manifestPath: this.manifestPath,
      signerId: team?.signer.id ?? null,
      signerRoles: team?.signer.roles ?? [],
      managedRepositories: policy.managedRepositories,
      approvalRules: policy.approvalRules,
      manifestSkillCount: team ? Object.keys(team.manifest.payload.skills).length : 0,
      error,
    }
  }
}

export const canonicalizeTeamPayload = canonicalJson
