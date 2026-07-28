import { describe, expect, it } from 'vitest'
import { clampSplitRatio } from './App'
import { automaticUpdateIntervalMs } from './preferences'

describe('clampSplitRatio', () => {
  it('keeps the divider within usable panel bounds', () => {
    expect(clampSplitRatio(0.1)).toBe(0.18)
    expect(clampSplitRatio(0.42)).toBe(0.42)
    expect(clampSplitRatio(0.8)).toBe(0.65)
    expect(clampSplitRatio(0.5, 0.3, 0.45)).toBe(0.45)
  })
})

it('uses a daily automatic update interval', () => {
  expect(automaticUpdateIntervalMs).toBe(86_400_000)
})
