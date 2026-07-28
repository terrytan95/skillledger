import { expect, it } from 'vitest'
import { automaticUpdateIntervalMs } from './preferences'

it('uses a daily automatic update interval', () => {
  expect(automaticUpdateIntervalMs).toBe(86_400_000)
})
