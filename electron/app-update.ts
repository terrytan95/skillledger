import type { AppUpdateInfo } from '../src/types'

interface GitHubRelease {
  tag_name?: unknown
}

type FetchRelease = (input: string, init?: RequestInit) => Promise<Response>

function versionParts(version: string): number[] {
  return version.replace(/^v/i, '').split('-', 1)[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = versionParts(candidate)
  const currentParts = versionParts(current)
  const length = Math.max(candidateParts.length, currentParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (candidateParts[index] ?? 0) - (currentParts[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

export async function checkForUpdates(
  currentVersion: string,
  fetchRelease: FetchRelease,
): Promise<AppUpdateInfo> {
  const response = await fetchRelease('https://api.github.com/repos/terrytan95/skillledger/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SkillLedger' },
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) {
    return { currentVersion, latestVersion: currentVersion, available: false }
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`)

  const release = await response.json() as GitHubRelease
  if (typeof release.tag_name !== 'string') throw new Error('Latest release has no version tag')

  return {
    currentVersion,
    latestVersion: release.tag_name.replace(/^v/i, ''),
    available: isNewerVersion(release.tag_name, currentVersion),
  }
}
