import { createHash } from 'node:crypto'
import { chmod, mkdir, open, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { SourcePin, SourceUpdateEntry, SourceUpdateSnapshot } from '../src/types'
import { fingerprint } from './path-fingerprint'

export type FetchSource = (input: string, init?: RequestInit) => Promise<Response>

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
    || path.posix.isAbsolute(sourcePath)
    || sourcePath.includes('\\')
    || sourcePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
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
  const response = await fetchSource(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SkillLedger',
    },
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)
  const value = await response.json() as unknown
  if (!isRecord(value)) throw new Error('GitHub returned an invalid response.')
  return value
}

async function githubBytes(
  fetchSource: FetchSource,
  url: string,
  expectedBytes: number,
): Promise<Buffer> {
  const response = await fetchSource(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'SkillLedger',
    },
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
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

function rawSourceUrl(pin: SourcePin, relative: string): string {
  const sourcePath = [...pin.path.split('/'), ...relative.split('/')]
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `https://raw.githubusercontent.com/${pin.repository}/${pin.revision}/${sourcePath}`
}

async function resolveSourceTreeSha(
  pin: SourcePin,
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
  for (const segment of pin.path.split('/')) {
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
  pin: SourcePin,
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

export async function stageGitHubSkill(
  pinValue: SourcePin,
  destination: string,
  fetchSource: FetchSource,
): Promise<void> {
  const pin = normalizeSourcePin(pinValue)
  if (!pin) throw new Error('Pinned GitHub source is invalid.')
  if ((await fingerprint(destination)).kind !== 'missing') {
    throw new Error('Source staging path already exists.')
  }

  const entries = await resolveSourceTree(pin, fetchSource)
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
        const content = await githubBytes(fetchSource, rawSourceUrl(pin, relative), entry.size as number)
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
    if (staged.kind !== 'directory' || staged.sha256 !== pin.sha256) {
      throw new Error('Pinned source content hash does not match the lock.')
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}
