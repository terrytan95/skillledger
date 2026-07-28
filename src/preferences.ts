import type { Language } from './i18n'

export const preferenceOptions = {
  theme: ['system', 'light', 'dark'],
  accent: [
    'forest',
    'ocean',
    'violet',
    'amber',
    'rose',
    'mist-pine',
    'haze-blue',
    'red-bean',
    'clay-blush',
    'moss',
    'smoky-violet',
    'stone-taupe',
    'lake-teal',
  ],
  language: ['system', 'en', 'zh-CN'],
  fontFamily: ['system', 'sans', 'serif', 'mono'],
  fontSize: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
} as const

export type ThemeMode = typeof preferenceOptions.theme[number]
export type Accent = typeof preferenceOptions.accent[number]
export type LanguagePreference = typeof preferenceOptions.language[number]
export type FontFamily = typeof preferenceOptions.fontFamily[number]
export type FontSize = typeof preferenceOptions.fontSize[number]

export interface Preferences {
  theme: ThemeMode
  accent: Accent
  language: LanguagePreference
  fontFamily: FontFamily
  fontSize: FontSize
  automaticUpdates: boolean
}

export const defaultPreferences: Readonly<Preferences> = {
  theme: 'system',
  accent: 'forest',
  language: 'system',
  fontFamily: 'system',
  fontSize: 10,
  automaticUpdates: true,
}

export const automaticUpdateIntervalMs = 24 * 60 * 60 * 1000

const preferenceKey = 'skillledger:preferences'
const legacyFontSizes: Record<string, FontSize | undefined> = {
  small: 9,
  medium: 10,
  large: 11,
}

type PreferenceStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type PreferenceRoot = {
  dataset: {
    theme?: string
    accent?: string
    fontFamily?: string
  }
  style: { fontSize: string }
  lang: string
}

function browserStorage(): PreferenceStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function allowed<Value>(values: readonly Value[], value: unknown, fallback: Value): Value {
  return values.includes(value as Value) ? value as Value : fallback
}

function normalizePreferences(value: unknown): Preferences {
  const stored = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const fontSize = typeof stored.fontSize === 'number'
    ? stored.fontSize
    : legacyFontSizes[String(stored.fontSize)]

  return {
    theme: allowed(preferenceOptions.theme, stored.theme, defaultPreferences.theme),
    accent: allowed(preferenceOptions.accent, stored.accent, defaultPreferences.accent),
    language: allowed(preferenceOptions.language, stored.language, defaultPreferences.language),
    fontFamily: allowed(preferenceOptions.fontFamily, stored.fontFamily, defaultPreferences.fontFamily),
    fontSize: allowed(preferenceOptions.fontSize, fontSize, defaultPreferences.fontSize),
    automaticUpdates: typeof stored.automaticUpdates === 'boolean'
      ? stored.automaticUpdates
      : defaultPreferences.automaticUpdates,
  }
}

export function readPreferences(storage = browserStorage()): Preferences {
  try {
    return normalizePreferences(JSON.parse(storage?.getItem(preferenceKey) ?? '{}'))
  } catch {
    return normalizePreferences(undefined)
  }
}

export function persistPreferences(preferences: Preferences, storage = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(preferenceKey, JSON.stringify(normalizePreferences(preferences)))
    return true
  } catch {
    return false
  }
}

export function updatePreference<Key extends keyof Preferences>(
  current: Preferences,
  key: Key,
  value: Preferences[Key],
): Preferences {
  const next = normalizePreferences({ ...current, [key]: value })
  return Object.is(next[key], value) ? next : current
}

export function resolveLanguage(
  preference: LanguagePreference,
  systemLanguage = navigator.language,
): Language {
  if (preference !== 'system') return preference
  return systemLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function applyPreferences(
  preferences: Preferences,
  language: Language,
  prefersDark: boolean,
  root: PreferenceRoot = document.documentElement,
): void {
  root.dataset.theme = preferences.theme === 'system'
    ? prefersDark ? 'dark' : 'light'
    : preferences.theme
  root.dataset.accent = preferences.accent
  root.dataset.fontFamily = preferences.fontFamily
  root.style.fontSize = `${preferences.fontSize}px`
  root.lang = language
}
