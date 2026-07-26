import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fingerprint } from './path-fingerprint'
import { stageGitHubSkill } from './skill-source'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

function blobSha(content: Buffer): string {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
}

function json(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('stageGitHubSkill', () => {
  it('stages an exact pinned public GitHub tree and verifies its SHA-256', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skillledger-source-'))
    temporaryDirectories.push(root)
    const expected = path.join(root, 'expected')
    await mkdir(path.join(expected, 'scripts'), { recursive: true })
    const skill = Buffer.from('---\nname: demo\n---\n')
    const script = Buffer.from('#!/bin/sh\nexit 0\n')
    await writeFile(path.join(expected, 'SKILL.md'), skill)
    await writeFile(path.join(expected, 'scripts', 'run.sh'), script)
    const expectedHash = await fingerprint(expected)
    const destination = path.join(root, 'staged')
    const skillSha = blobSha(skill)
    const scriptSha = blobSha(script)
    const requested: string[] = []
    let activeDownloads = 0
    let peakDownloads = 0
    const rawSources = new Map([
      [`https://raw.githubusercontent.com/example/skills/${'1'.repeat(40)}/skills/demo/SKILL.md`, skill],
      [`https://raw.githubusercontent.com/example/skills/${'1'.repeat(40)}/skills/demo/scripts/run.sh`, script],
    ])
    const fetchSource = async (input: string) => {
      requested.push(input)
      if (input.endsWith('/git/commits/1111111111111111111111111111111111111111')) {
        return json({ sha: '1'.repeat(40), tree: { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } })
      }
      if (input.endsWith('/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')) {
        return json({ tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }], truncated: false })
      }
      if (input.endsWith('/git/trees/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')) {
        return json({ tree: [{ path: 'demo', mode: '040000', type: 'tree', sha: 'cccccccccccccccccccccccccccccccccccccccc' }], truncated: false })
      }
      if (input.endsWith('/git/trees/cccccccccccccccccccccccccccccccccccccccc?recursive=1')) {
        return json({
          truncated: false,
          tree: [
            { path: 'SKILL.md', mode: '100644', type: 'blob', size: skill.length, sha: skillSha },
            { path: 'scripts', mode: '040000', type: 'tree', sha: 'dddddddddddddddddddddddddddddddddddddddd' },
            { path: 'scripts/run.sh', mode: '100755', type: 'blob', size: script.length, sha: scriptSha },
          ],
        })
      }
      const raw = rawSources.get(input)
      if (raw) {
        activeDownloads += 1
        peakDownloads = Math.max(peakDownloads, activeDownloads)
        await new Promise((resolve) => setTimeout(resolve, 5))
        activeDownloads -= 1
        return new Response(raw)
      }
      return json({}, 404)
    }

    await stageGitHubSkill({
      repository: 'example/skills',
      path: 'skills/demo',
      revision: '1'.repeat(40),
      sha256: expectedHash.sha256!,
    }, destination, fetchSource)

    expect(await fingerprint(destination)).toEqual(expectedHash)
    expect(await readFile(path.join(destination, 'SKILL.md'), 'utf8')).toContain('name: demo')
    expect(requested.filter((url) => url.startsWith('https://raw.githubusercontent.com/'))).toHaveLength(2)
    expect(requested.some((url) => url.includes('/git/blobs/'))).toBe(false)
    expect(peakDownloads).toBe(2)
  })

  it('rejects symlinks and removes the staging directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skillledger-source-'))
    temporaryDirectories.push(root)
    const destination = path.join(root, 'staged')
    const fetchSource = async (input: string) => {
      if (input.includes('/git/commits/')) return json({ sha: '1'.repeat(40), tree: { sha: 'a'.repeat(40) } })
      if (input.endsWith(`/git/trees/${'a'.repeat(40)}`)) {
        return json({ tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: 'b'.repeat(40) }] })
      }
      if (input.endsWith(`/git/trees/${'b'.repeat(40)}`)) {
        return json({ tree: [{ path: 'demo', mode: '040000', type: 'tree', sha: 'c'.repeat(40) }] })
      }
      return json({
        truncated: false,
        tree: [{ path: 'SKILL.md', mode: '120000', type: 'blob', size: 6, sha: 'd'.repeat(40) }],
      })
    }

    await expect(stageGitHubSkill({
      repository: 'example/skills',
      path: 'skills/demo',
      revision: '1'.repeat(40),
      sha256: '2'.repeat(64),
    }, destination, fetchSource)).rejects.toThrow('unsupported entry')
    expect(await fingerprint(destination)).toMatchObject({ kind: 'missing' })
  })
})
