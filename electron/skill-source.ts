import { createHash } from 'node:crypto'
import { chmod, mkdir, open, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { SourcePin, SourceUpdateEntry, SourceUpdateSnapshot } from '../src/types'
import { fingerprint } from './path-fingerprint'

export type FetchSource = (input: string, init?: RequestInit) => Promise<Response>
export type GitHubSkillSource = Omit<SourcePin, 'sha256'>

interface GitTreeEntry {
  path?: unknown
  mode?: unknown
  type?: unknown
  size?: unknown
  sha?: unknown
}

interface GitTree {
  tree?: unknown
  truncated?: unknown
}

const MAX_FILES = 500
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_SKILL_BYTES = 10 * 1024 * 1024
const DOWNLOAD_CONCURRENCY = 8
const SOURCE_CHECK_CONCURRENCY = 4
const GITHUB_REQUEST_TIMEOUT_MS = 15_000
const GITHUB_PARSE_TIMEOUT_MS = 30_000

class GitHubResponseError extends Error {
  constructor(readonly status: number) {
    super(`GitHub returned ${status}.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function abortableFetch(
  fetchSource: FetchSource,
  input: string,
  init: RequestInit,
): Promise<Response> {
  const signal = init.signal
  if (!signal) return fetchSource(input, init)
  if (signal.aborted) throw signal.reason ?? new Error('GitHub request was aborted.')
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('GitHub request was aborted.'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([fetchSource(input, init), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function githubResponse(
  fetchSource: FetchSource,
  url: string,
  accept: string,
): Promise<Response> {
  const signal = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)
  try {
    return await abortableFetch(fetchSource, url, {
      headers: {
        Accept: accept,
        'User-Agent': 'SkillLedger',
      },
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw new Error('GitHub request timed out after 15 seconds. Check your network connection or GitHub availability, then try again.')
    }
    const reason = error instanceof Error && error.message ? error.message : 'Unknown network error.'
    throw new Error(`GitHub request failed: ${reason}`)
  }
}

export function normalizeSourcePin(value: unknown): SourcePin | null {
  if (!isRecord(value)) return null
  const repository = value.repository
  const sourcePath = value.path
  const revision = value.revision
  const sha256 = value.sha256
  if (
    typeof repository !== 'string'
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
    || repository.endsWith('.git')
    || typeof sourcePath !== 'string'
    || sourcePath.length > 1_024
    || (
      sourcePath !== ''
      && (
        path.posix.isAbsolute(sourcePath)
        || sourcePath.includes('\\')
        || sourcePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      )
    )
    || typeof revision !== 'string'
    || !/^[0-9a-f]{40}$/i.test(revision)
    || typeof sha256 !== 'string'
    || !/^[0-9a-f]{64}$/i.test(sha256)
  ) {
    return null
  }
  return {
    repository,
    path: sourcePath,
    revision: revision.toLowerCase(),
    sha256: sha256.toLowerCase(),
  }
}

async function githubJson(fetchSource: FetchSource, url: string): Promise<Record<string, unknown>> {
  const response = await githubResponse(fetchSource, url, 'application/vnd.github+json')
  if (!response.ok) throw new GitHubResponseError(response.status)
  const value = await response.json() as unknown
  if (!isRecord(value)) throw new Error('GitHub returned an invalid response.')
  return value
}

async function githubBytes(
  fetchSource: FetchSource,
  url: string,
  expectedBytes: number,
): Promise<Buffer> {
  const response = await githubResponse(fetchSource, url, 'application/octet-stream')
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('GitHub returned an empty source file.')
  const chunks: Buffer[] = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > expectedBytes) {
      await reader.cancel()
      throw new Error('GitHub source file exceeded its declared size.')
    }
    chunks.push(Buffer.from(value))
  }
  if (bytes !== expectedBytes) throw new Error('GitHub source file did not match its declared size.')
  return Buffer.concat(chunks, bytes)
}

function parseTree(value: Record<string, unknown>): GitTreeEntry[] {
  const tree = value as GitTree
  if (tree.truncated === true) throw new Error('GitHub truncated the source tree.')
  if (!Array.isArray(tree.tree)) throw new Error('GitHub returned an invalid source tree.')
  return tree.tree as GitTreeEntry[]
}

function safeRelativePath(value: unknown): string {
  if (
    typeof value !== 'string'
    || !value
    || value.length > 1_024
    || path.posix.isAbsolute(value)
    || value.includes('\\')
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('GitHub returned an unsafe source path.')
  }
  return value
}

function destinationPath(root: string, relative: string): string {
  const candidate = path.resolve(root, ...relative.split('/'))
  const within = path.relative(root, candidate)
  if (!within || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
    throw new Error('GitHub source path escaped the staging directory.')
  }
  return candidate
}

function rawSourceUrl(pin: GitHubSkillSource, relative: string): string {
  const sourcePath = [...(pin.path ? pin.path.split('/') : []), ...relative.split('/')]
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `https://raw.githubusercontent.com/${pin.repository}/${pin.revision}/${sourcePath}`
}

async function resolveSourceTreeSha(
  pin: GitHubSkillSource,
  fetchSource: FetchSource,
): Promise<string> {
  const base = `https://api.github.com/repos/${pin.repository}`
  const commit = await githubJson(fetchSource, `${base}/git/commits/${pin.revision}`)
  if (commit.sha !== pin.revision) throw new Error('GitHub commit did not match the pinned revision.')
  const commitTree = isRecord(commit.tree) ? commit.tree.sha : null
  if (typeof commitTree !== 'string' || !/^[0-9a-f]{40}$/i.test(commitTree)) {
    throw new Error('Pinned revision has no valid Git tree.')
  }

  let treeSha = commitTree
  for (const segment of pin.path ? pin.path.split('/') : []) {
    const entries = parseTree(await githubJson(fetchSource, `${base}/git/trees/${treeSha}`))
    const next = entries.find((entry) => entry.path === segment)
    if (next?.type !== 'tree' || next.mode !== '040000' || typeof next.sha !== 'string') {
      throw new Error(`Pinned source directory was not found: ${pin.path}.`)
    }
    treeSha = next.sha
  }
  return treeSha
}

async function resolveSourceTree(
  pin: GitHubSkillSource,
  fetchSource: FetchSource,
): Promise<GitTreeEntry[]> {
  const treeSha = await resolveSourceTreeSha(pin, fetchSource)
  return parseTree(await githubJson(
    fetchSource,
    `https://api.github.com/repos/${pin.repository}/git/trees/${treeSha}?recursive=1`,
  ))
}

async function repositoryHead(
  repository: string,
  fetchSource: FetchSource,
): Promise<{ defaultBranch: string; revision: string }> {
  const base = `https://api.github.com/repos/${repository}`
  const metadata = await githubJson(fetchSource, base)
  const defaultBranch = metadata.default_branch
  if (typeof defaultBranch !== 'string' || !defaultBranch || defaultBranch.length > 255) {
    throw new Error('GitHub repository has no valid default branch.')
  }
  const commit = await githubJson(fetchSource, `${base}/commits/${encodeURIComponent(defaultBranch)}`)
  if (typeof commit.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(commit.sha)) {
    throw new Error('GitHub default branch has no valid commit.')
  }
  return { defaultBranch, revision: commit.sha.toLowerCase() }
}

export async function resolveGitHubSkillUrl(
  value: string,
  fetchSource: FetchSource,
): Promise<GitHubSkillSource> {
  if (!value || Buffer.byteLength(value) > 2_048 || value.includes('\0')) {
    throw new Error('GitHub skill URL is invalid.')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('GitHub skill URL is invalid.')
  }
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'github.com'
    || url.port
    || url.username
    || url.password
  ) {
    throw new Error('Only public https://github.com skill URLs are supported.')
  }

  let segments: string[]
  try {
    segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment))
  } catch {
    throw new Error('GitHub skill URL contains invalid encoding.')
  }
  if (segments.some((segment) => !segment || segment.includes('/') || segment.includes('\\') || segment.includes('\0'))) {
    throw new Error('GitHub skill URL contains an unsafe path.')
  }
  const repositoryName = segments[1]?.replace(/\.git$/i, '')
  const repository = `${segments[0] ?? ''}/${repositoryName ?? ''}`
  if (
    !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
    || segments.length < 2
  ) {
    throw new Error('GitHub skill URL must identify a public repository.')
  }

  if (segments.length === 2) {
    const { revision } = await repositoryHead(repository, fetchSource)
    return { repository, path: '', revision }
  }
  const linkKind = segments[2]
  if (linkKind !== 'tree' && linkKind !== 'blob') {
    throw new Error('GitHub skill URL must point to a repository, directory, or SKILL.md file.')
  }
  const tail = segments.slice(3)
  if (linkKind === 'blob') {
    if (tail.at(-1)?.toLowerCase() !== 'skill.md') {
      throw new Error('GitHub file URL must point to SKILL.md.')
    }
    tail.pop()
  }
  if (tail.length === 0) throw new Error('GitHub skill URL has no revision.')

  for (let split = tail.length; split >= 1; split -= 1) {
    const reference = tail.slice(0, split).join('/')
    try {
      const commit = await githubJson(
        fetchSource,
        `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(reference)}`,
      )
      if (typeof commit.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(commit.sha)) {
        throw new Error('GitHub revision has no valid commit.')
      }
      const sourcePath = tail.slice(split).join('/')
      if (sourcePath) safeRelativePath(sourcePath)
      return { repository, path: sourcePath, revision: commit.sha.toLowerCase() }
    } catch (error) {
      if (error instanceof GitHubResponseError && (error.status === 404 || error.status === 422)) continue
      throw error
    }
  }
  throw new Error('GitHub skill revision could not be resolved.')
}

export async function discoverGitHubSourceUpdates(
  pins: Record<string, SourcePin>,
  fetchSource: FetchSource,
): Promise<SourceUpdateSnapshot> {
  const sources = Object.entries(pins).sort(([left], [right]) => left.localeCompare(right))
  const entries: SourceUpdateEntry[] = new Array(sources.length)
  const heads = new Map<string, Promise<{ defaultBranch: string; revision: string }>>()
  let nextSource = 0
  const workers = Array.from({ length: Math.min(SOURCE_CHECK_CONCURRENCY, sources.length) }, async () => {
    while (nextSource < sources.length) {
      const index = nextSource++
      const [skillId, pinValue] = sources[index]
      const pin = normalizeSourcePin(pinValue)
      if (!pin) throw new Error(`Pinned GitHub source is invalid: ${skillId}.`)
      let defaultBranch: string | null = null
      let latestRevision: string | null = null
      try {
        let head = heads.get(pin.repository)
        if (!head) {
          head = repositoryHead(pin.repository, fetchSource)
          heads.set(pin.repository, head)
        }
        ({ defaultBranch, revision: latestRevision } = await head)
        const [latestTree, pinnedTree] = latestRevision === pin.revision
          ? [null, null]
          : await Promise.all([
            resolveSourceTreeSha({ ...pin, revision: latestRevision }, fetchSource),
            resolveSourceTreeSha(pin, fetchSource),
          ])
        entries[index] = {
          skillId,
          repository: pin.repository,
          path: pin.path,
          pinnedRevision: pin.revision,
          latestRevision,
          defaultBranch,
          available: latestTree !== pinnedTree,
          error: null,
        }
      } catch (error) {
        entries[index] = {
          skillId,
          repository: pin.repository,
          path: pin.path,
          pinnedRevision: pin.revision,
          latestRevision,
          defaultBranch,
          available: false,
          error: (error as Error).message,
        }
      }
    }
  })
  await Promise.all(workers)
  return {
    checkedAt: new Date().toISOString(),
    entries,
    summary: {
      checked: entries.length,
      available: entries.filter((entry) => entry.available).length,
      failed: entries.filter((entry) => entry.error).length,
    },
  }
}

async function downloadGitHubSkill(
  source: GitHubSkillSource,
  destination: string,
  fetchSource: FetchSource,
): Promise<string> {
  if ((await fingerprint(destination)).kind !== 'missing') {
    throw new Error('Source staging path already exists.')
  }

  const entries = await resolveSourceTree(source, fetchSource)
  const files = entries.filter((entry) => entry.type === 'blob')
  if (files.length === 0 || files.length > MAX_FILES) {
    throw new Error('Pinned skill contains an unsupported number of files.')
  }
  let declaredBytes = 0
  const seenPaths = new Set<string>()
  for (const entry of entries) {
    const relative = safeRelativePath(entry.path)
    if (relative.split('/').length > 32) throw new Error(`Pinned skill path is too deep: ${relative}.`)
    const collisionKey = relative.normalize('NFC').toLowerCase()
    if (seenPaths.has(collisionKey)) throw new Error(`Pinned skill contains a path collision: ${relative}.`)
    seenPaths.add(collisionKey)
    if (entry.type === 'tree' && entry.mode === '040000') continue
    if (
      entry.type !== 'blob'
      || (entry.mode !== '100644' && entry.mode !== '100755')
      || typeof entry.sha !== 'string'
      || !/^[0-9a-f]{40}$/i.test(entry.sha)
      || typeof entry.size !== 'number'
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || entry.size > MAX_FILE_BYTES
    ) {
      throw new Error(`Pinned skill contains an unsupported entry: ${relative}.`)
    }
    declaredBytes += entry.size
    if (declaredBytes > MAX_SKILL_BYTES) throw new Error('Pinned skill exceeds the size limit.')
  }

  await mkdir(destination, { recursive: false, mode: 0o700 })
  try {
    for (const entry of entries.filter((candidate) => candidate.type === 'tree')) {
      await mkdir(destinationPath(destination, safeRelativePath(entry.path)), { recursive: true, mode: 0o700 })
    }
    let nextFile = 0
    const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, files.length) }, async () => {
      while (nextFile < files.length) {
        const entry = files[nextFile++]
        const relative = safeRelativePath(entry.path)
        const sha = entry.sha as string
        const content = await githubBytes(
          fetchSource,
          rawSourceUrl(source, relative),
          entry.size as number,
        )
        if (createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex') !== sha) {
          throw new Error(`GitHub blob verification failed: ${relative}.`)
        }
        const filePath = destinationPath(destination, relative)
        await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
        const handle = await open(filePath, 'wx', entry.mode === '100755' ? 0o700 : 0o600)
        try {
          await handle.writeFile(content)
          await handle.sync()
        } finally {
          await handle.close()
        }
        if (entry.mode === '100755') await chmod(filePath, 0o700)
      }
    })
    const results = await Promise.allSettled(workers)
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason

    const skillFile = await stat(path.join(destination, 'SKILL.md'))
    if (!skillFile.isFile()) throw new Error('Pinned source does not contain SKILL.md.')
    const staged = await fingerprint(destination)
    if (staged.kind !== 'directory' || !staged.sha256) throw new Error('Pinned source could not be hashed.')
    return staged.sha256
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

export async function stageGitHubSkillFromUrl(
  url: string,
  destination: string,
  fetchSource: FetchSource,
): Promise<SourcePin> {
  const signal = AbortSignal.timeout(GITHUB_PARSE_TIMEOUT_MS)
  const timedFetch: FetchSource = (input, init = {}) => {
    const combinedSignal = init.signal
      ? AbortSignal.any([init.signal, signal])
      : signal
    return abortableFetch(fetchSource, input, { ...init, signal: combinedSignal })
  }
  try {
    const source = await resolveGitHubSkillUrl(url, timedFetch)
    return {
      ...source,
      sha256: await downloadGitHubSkill(source, destination, timedFetch),
    }
  } catch (error) {
    if (signal.aborted) {
      throw new Error('GitHub skill parsing timed out after 30 seconds. Check your network connection or GitHub availability, then try again.')
    }
    throw error
  }
}

export async function stageGitHubSkill(
  pinValue: SourcePin,
  destination: string,
  fetchSource: FetchSource,
): Promise<void> {
  const pin = normalizeSourcePin(pinValue)
  if (!pin) throw new Error('Pinned GitHub source is invalid.')
  try {
    const sha256 = await downloadGitHubSkill(pin, destination, fetchSource)
    if (sha256 !== pin.sha256) throw new Error('Pinned source content hash does not match the lock.')
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}
