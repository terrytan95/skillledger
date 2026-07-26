# Architecture

## Design goals

SkillLedger should remain easy to extend without making filesystem safety depend on UI code. The central rule is:

> Scan facts first, derive a plan second, mutate only an approved plan.

## Runtime boundaries

```text
React renderer
  └─ window.skillLedger.{scan,reconcile}
       └─ contextBridge preload
            └─ validated Electron IPC
                 ├─ inventory module
                 └─ SkillReconciler
                      ├─ in-memory, hash-bound plans
                      ├─ ~/.agents/.skillledger/journals
                      └─ agent-specific skill directories
```

- **Renderer:** presentation, filtering, selection, and plan preview. It never receives arbitrary filesystem access.
- **Preload:** the three-method reconciliation interface plus inventory scan.
- **Main process:** window policy and sender validation.
- **Inventory module:** pure discovery and health derivation, independently testable without Electron.
- **Reconciliation module:** the deep module that hides hashing, preconditions, journal durability, atomic swaps, verification, and restoration behind `preview`, `apply`, and `rollback`.

## Domain model

- `SkillRecord`: canonical path, provenance, health, and per-agent presence.
- `AgentPresence`: destination path, install kind, and link health.
- `InventorySnapshot`: timestamped collection plus aggregate counts and warnings.

The model records observed facts. It does not hide uncertainty: an untracked local skill is `review`, not silently considered healthy.

## Safe mutation pipeline

Write support is one vertical slice, not a collection of filesystem buttons:

1. **Hash:** capture deterministic SHA-256 tree fingerprints without following symlinks.
2. **Plan:** produce explicit create-link, repair-link, or approved copy-replacement operations with preconditions.
3. **Preview:** show the selected skill's affected destinations and preserve independent copies by default.
4. **Journal:** persist the immutable plan and fsynced append-only events before destination writes.
5. **Apply:** create sibling temporary links, hash-verify same-directory backups, and use same-volume renames.
6. **Verify:** rescan and compare the expected postconditions.
7. **Rollback:** restore from the same journal if verification fails.

A plan becomes stale when any canonical or destination fingerprint changes; stale plans must be regenerated. The renderer can submit only skill/Agent selectors and opaque IDs, never paths or operations.

The filesystem cannot atomically commit a multi-destination transaction. SkillLedger therefore guarantees an atomic switch per destination plus deterministic reverse-order recovery for the whole plan.

## Extension seams

Add capabilities at these narrow seams:

- New agent: append one `AgentLocation`.
- New provenance source: normalize it into the existing lock entry fields.
- New health rule: extend `deriveHealth` and its focused tests.
- Write operation: extend the internal plan and executor together; keep the three-method interface and renderer declarative.
- Remote installer: adapt an external CLI behind the main process instead of reimplementing package resolution.

Avoid a plugin system until a third-party extension actually needs one. A small typed registry is enough for built-in agents.

## Release discipline

- Every pull request runs type checking, filesystem seam tests, and a production build.
- Filesystem mutation cannot ship without rollback coverage.
- Persisted journals carry a schema version and reject malformed or out-of-root paths.
- Packaging and signing stay separate from the domain layer.
