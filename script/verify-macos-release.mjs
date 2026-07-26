import { spawnSync } from 'node:child_process'

if (process.platform === 'darwin') {
  const identities = spawnSync(
    '/usr/bin/security',
    ['find-identity', '-v', '-p', 'codesigning'],
    { encoding: 'utf8' },
  )
  if (identities.status !== 0 || !identities.stdout.includes('"AgentBar Local Code Signing"')) {
    throw new Error('macOS releases require the AgentBar local signing identity.')
  }
}
