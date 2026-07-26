import { spawnSync } from 'node:child_process'

if (process.platform === 'darwin') {
  const identities = spawnSync(
    '/usr/bin/security',
    ['find-identity', '-v', '-p', 'codesigning'],
    { encoding: 'utf8' },
  )
  if (identities.status !== 0 || !identities.stdout.includes('"Developer ID Application:')) {
    throw new Error('macOS releases require a valid Developer ID Application identity.')
  }

  const env = process.env
  const hasNotaryCredentials = Boolean(
    (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)
    || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
    || env.APPLE_KEYCHAIN_PROFILE,
  )
  if (!hasNotaryCredentials) {
    throw new Error('macOS releases require Apple notarization credentials.')
  }
}
