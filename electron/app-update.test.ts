import { describe, expect, it } from 'vitest'
import { checkForUpdates, isNewerVersion } from './app-update'

describe('isNewerVersion', () => {
  it('compares stable release tags numerically', () => {
    expect(isNewerVersion('v0.2.0', '0.1.9')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true)
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false)
  })

  it('treats a repository without releases as current', async () => {
    const result = await checkForUpdates('0.1.0', async () => new Response(null, { status: 404 }))
    expect(result).toEqual({ currentVersion: '0.1.0', latestVersion: '0.1.0', available: false })
  })
})
