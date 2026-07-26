import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalizeTeamPayload, TeamManager } from './team-policy'

const temporaryHomes: string[] = []

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('TeamManager', () => {
  it('verifies an Ed25519 manifest and enforces scoped approvals', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-team-'))
    temporaryHomes.push(home)
    const manager = new TeamManager(home)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const policy = {
      schemaVersion: 1,
      teamId: 'acme',
      name: 'Acme Engineering',
      managedRepositories: [{ repository: 'acme/skills', paths: ['skills'] }],
      trustedSigners: [{
        id: 'release-key',
        publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        roles: ['maintainer'],
      }],
      approvalRules: {
        restoreCanonical: 'maintainer',
        updateCanonical: 'owner',
        replaceCopy: 'maintainer',
      },
    }
    expect((await manager.importPolicy(JSON.stringify(policy))).status).toBe('imported')

    const pin = {
      repository: 'acme/skills',
      path: 'skills/review-code',
      revision: '1'.repeat(40),
      sha256: '2'.repeat(64),
    }
    const payload = {
      schemaVersion: 1,
      teamId: 'acme',
      sequence: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      skills: { 'review-code': pin },
      approvals: [
        { action: 'restore-canonical', skillId: 'review-code' },
        { action: 'replace-copy', skillId: 'review-code', agentId: 'codex' },
      ],
    }
    const signature = sign(null, Buffer.from(canonicalizeTeamPayload(payload)), privateKey).toString('base64')
    expect((await manager.importManifest(JSON.stringify({
      payload,
      signature: { keyId: 'release-key', algorithm: 'ed25519', value: signature },
    }))).status).toBe('imported')

    await expect(manager.authorize('restore-canonical', 'review-code', pin))
      .resolves.toEqual({ allowed: true, reason: null })
    await expect(manager.authorize('replace-copy', 'review-code', undefined, 'cursor'))
      .resolves.toMatchObject({ allowed: false })
    await expect(manager.authorize('update-canonical', 'review-code', pin))
      .resolves.toMatchObject({ allowed: false })
  })

  it('rejects a manifest changed after signing', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-team-'))
    temporaryHomes.push(home)
    const manager = new TeamManager(home)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    await manager.importPolicy(JSON.stringify({
      schemaVersion: 1,
      teamId: 'acme',
      name: 'Acme',
      managedRepositories: [{ repository: 'acme/skills', paths: ['skills'] }],
      trustedSigners: [{
        id: 'owner-key',
        publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        roles: ['owner'],
      }],
      approvalRules: {
        restoreCanonical: 'owner',
        updateCanonical: 'owner',
        replaceCopy: 'owner',
      },
    }))
    const payload = {
      schemaVersion: 1,
      teamId: 'acme',
      sequence: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      skills: {
        demo: {
          repository: 'acme/skills',
          path: 'skills/demo',
          revision: '1'.repeat(40),
          sha256: '2'.repeat(64),
        },
      },
      approvals: [{ action: 'restore-canonical', skillId: 'demo' }],
    }
    const signature = sign(null, Buffer.from(canonicalizeTeamPayload(payload)), privateKey).toString('base64')
    payload.skills.demo.sha256 = '3'.repeat(64)

    const result = await manager.importManifest(JSON.stringify({
      payload,
      signature: { keyId: 'owner-key', algorithm: 'ed25519', value: signature },
    }))

    expect(result).toMatchObject({ status: 'rejected', message: 'Manifest signature verification failed.' })
  })

  it('persists the manifest sequence high-water mark across restarts', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillledger-team-'))
    temporaryHomes.push(home)
    const manager = new TeamManager(home)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    await manager.importPolicy(JSON.stringify({
      schemaVersion: 1,
      teamId: 'acme',
      name: 'Acme',
      managedRepositories: [{ repository: 'acme/skills', paths: ['skills'] }],
      trustedSigners: [{
        id: 'owner-key',
        publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        roles: ['owner'],
      }],
      approvalRules: {
        restoreCanonical: 'owner',
        updateCanonical: 'owner',
        replaceCopy: 'owner',
      },
    }))
    const manifest = (sequence: number, sha256: string) => {
      const payload = {
        schemaVersion: 1,
        teamId: 'acme',
        sequence,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        skills: {
          demo: {
            repository: 'acme/skills',
            path: 'skills/demo',
            revision: '1'.repeat(40),
            sha256,
          },
        },
        approvals: [{ action: 'restore-canonical', skillId: 'demo' }],
      }
      return JSON.stringify({
        payload,
        signature: {
          keyId: 'owner-key',
          algorithm: 'ed25519',
          value: sign(null, Buffer.from(canonicalizeTeamPayload(payload)), privateKey).toString('base64'),
        },
      })
    }
    const current = manifest(5, '2'.repeat(64))
    expect((await manager.importManifest(current)).status).toBe('imported')
    expect(JSON.parse(await readFile(manager.sequencePath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      sequence: 5,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })

    const restarted = new TeamManager(home)
    expect((await restarted.importManifest(current)).status).toBe('imported')
    await expect(restarted.importManifest(manifest(4, '2'.repeat(64))))
      .resolves.toMatchObject({ status: 'rejected', message: 'Manifest sequence cannot move backwards.' })
    await expect(restarted.importManifest(manifest(5, '3'.repeat(64))))
      .resolves.toMatchObject({
        status: 'rejected',
        message: 'Manifest sequence is already used by different content.',
      })
  })
})
