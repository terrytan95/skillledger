import { describe, expect, it } from 'vitest'
import { ipcChannels, ipcEventChannels } from './ipc-contract'

describe('IPC contract', () => {
  it('uses unique SkillLedger channels', () => {
    const channels = [...Object.values(ipcChannels), ...Object.values(ipcEventChannels)]
    expect(new Set(channels).size).toBe(channels.length)
    expect(channels.every((channel) => channel.startsWith('skillledger:'))).toBe(true)
  })
})
