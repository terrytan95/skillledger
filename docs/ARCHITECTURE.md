# Architecture

## Design goals

SkillLedger should remain easy to extend without making filesystem safety depend on UI code. The central rule is:

> Scan facts first, derive a plan second, mutate only an approved plan.

## Runtime boundaries

```text
React renderer
  └─ window.skillLedger.scan()
       └─ contextBridge preload
            └─ validated Electron IPC
                 └─ inventory module
                      ├─ ~/.agents/skills
                      ├─ ~/.agents/.skill-lock.json
                      └─ agent-specific skill directories
```

- **Renderer:** presentation, filtering, selection, and plan preview. It never receives arbitrary filesystem access.
- **Preload:** the smallest public API the UI needs.
- **Main process:** window policy and sender validation.
- **Inventory module:** pure discovery and health derivation, independently testable without Electron.

## Domain model

- `SkillRecord`: canonical path, provenance, health, and per-agent presence.
- `AgentPresence`: destination path, install kind, and link health.
- `InventorySnapshot`: timestamped collection plus aggregate counts and warnings.

The model records observed facts. It does not hide uncertainty: an untracked local skill is `review`, not silently considered healthy.

## Safe mutation pipeline

Write support should be added as one vertical slice, not as separate buttons:

1. **Scan:** capture the current snapshot and content hashes.
2. **Plan:** produce explicit operations (`link`, `replace`, `remove`, `update`) with preconditions.
3. **Preview:** show every affected path and whether content will be preserved.
4. **Journal:** save the plan, hashes, backups, and timestamp before mutation.
5. **Apply:** use temporary paths and atomic renames where possible.
6. **Verify:** rescan and compare the expected postconditions.
7. **Rollback:** restore from the same journal if verification fails.

A plan becomes stale when any precondition changes; stale plans must be regenerated.

## Extension seams

Add capabilities at these narrow seams:

- New agent: append one `AgentLocation`.
- New provenance source: normalize it into the existing lock entry fields.
- New health rule: extend `deriveHealth` and its focused tests.
- Write operation: add a plan type and one executor path; keep the renderer declarative.
- Remote installer: adapt an external CLI behind the main process instead of reimplementing package resolution.

Avoid a plugin system until a third-party extension actually needs one. A small typed registry is enough for built-in agents.

## Release discipline

- Every pull request runs type checking, the focused inventory test, and a production build.
- Filesystem mutation cannot ship without rollback coverage.
- Schema changes should be versioned only when persisted journals exist.
- Packaging and signing stay separate from the domain layer.
