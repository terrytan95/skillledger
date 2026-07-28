import { describe, expect, it } from 'vitest'
import {
  applyPreferences,
  defaultPreferences,
  persistPreferences,
  readPreferences,
  resolveLanguage,
  updatePreference,
  type FontSize,
} from './preferences'

function memoryStorage(initial: string | null = null) {
  let stored = initial
  let key = ''
  return {
    getItem: () => stored,
    setItem: (nextKey: string, value: string) => {
      key = nextKey
      stored = value
    },
    snapshot: () => ({ key, stored }),
  }
}

describe('preferences', () => {
  it('uses defaults without browser or stored state', () => {
    expect(readPreferences()).toEqual(defaultPreferences)
    expect(readPreferences(memoryStorage())).toEqual(defaultPreferences)
  })

  it('normalizes partial, stale, malformed, and legacy stored values', () => {
    const partial = memoryStorage(JSON.stringify({
      theme: 'dark',
      accent: 'retired-accent',
      fontFamily: 'mono',
      fontSize: 'large',
      automaticUpdates: 'yes',
    }))

    expect(readPreferences(partial)).toEqual({
      ...defaultPreferences,
      theme: 'dark',
      fontFamily: 'mono',
      fontSize: 11,
    })
    expect(readPreferences(memoryStorage('{broken'))).toEqual(defaultPreferences)
  })

  it('accepts valid updates and rejects invalid runtime values', () => {
    const updated = updatePreference({ ...defaultPreferences }, 'theme', 'dark')
    const rejected = updatePreference(updated, 'fontSize', 99 as FontSize)

    expect(updated.theme).toBe('dark')
    expect(rejected).toBe(updated)
  })

  it('persists under the compatible key and restores after reload', () => {
    const storage = memoryStorage()
    const updated = updatePreference(
      updatePreference({ ...defaultPreferences }, 'language', 'zh-CN'),
      'automaticUpdates',
      false,
    )

    expect(persistPreferences(updated, storage)).toBe(true)
    expect(storage.snapshot().key).toBe('skillledger:preferences')
    expect(readPreferences(storage)).toEqual(updated)
  })

  it('keeps runtime preferences active when persistence fails', () => {
    const failingStorage = {
      getItem: () => { throw new Error('unavailable') },
      setItem: () => { throw new Error('quota exceeded') },
    }
    const root = { dataset: {}, style: { fontSize: '' }, lang: '' }
    const preferences = {
      ...defaultPreferences,
      theme: 'system' as const,
      accent: 'ocean' as const,
      fontFamily: 'serif' as const,
      fontSize: 18 as const,
    }

    expect(readPreferences(failingStorage)).toEqual(defaultPreferences)
    expect(persistPreferences(preferences, failingStorage)).toBe(false)

    applyPreferences(preferences, 'zh-CN', true, root)
    expect(root).toEqual({
      dataset: { theme: 'dark', accent: 'ocean', fontFamily: 'serif' },
      style: { fontSize: '18px' },
      lang: 'zh-CN',
    })
    expect(resolveLanguage('system', 'zh-Hans')).toBe('zh-CN')
    expect(resolveLanguage('system', 'en-US')).toBe('en')
  })
})
