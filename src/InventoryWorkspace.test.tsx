import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoSnapshot } from './demo'
import { messages } from './i18n'
import {
  clampSplitRatio,
  InventoryHeaderActions,
  InventoryWorkspace,
  InventoryWorkspaceView,
  resolveInventorySelection,
} from './InventoryWorkspace'

describe('InventoryWorkspace', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the divider within usable panel bounds', () => {
    expect(clampSplitRatio(0.1)).toBe(0.18)
    expect(clampSplitRatio(0.42)).toBe(0.42)
    expect(clampSplitRatio(0.8)).toBe(0.65)
    expect(clampSplitRatio(0.5, 0.3, 0.45)).toBe(0.45)
  })

  it('preserves, prefers, and repairs selection after snapshot changes', () => {
    const [first, second, ...remaining] = demoSnapshot.skills
    const next = { ...demoSnapshot, skills: [second, ...remaining] }

    expect(resolveInventorySelection(demoSnapshot, second.id)).toBe(second.id)
    expect(resolveInventorySelection(demoSnapshot, second.id, first.id)).toBe(first.id)
    expect(resolveInventorySelection(next, first.id)).toBe(second.id)
    expect(resolveInventorySelection({ ...demoSnapshot, skills: [] }, first.id)).toBe('')
  })

  it('renders the complete demo workspace through its narrow interface', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })

    const markup = renderToStaticMarkup(
      <InventoryWorkspace
        active
        snapshot={demoSnapshot}
        onSnapshot={() => undefined}
        copy={messages.en}
        language="en"
      >
        <InventoryHeaderActions />
        <InventoryWorkspaceView />
      </InventoryWorkspace>,
    )

    expect(markup).toContain('class="header-actions"')
    expect(markup).toContain('codex-model-routing-team')
    expect(markup).toContain(messages.en.searchPlaceholder)
  })
})
