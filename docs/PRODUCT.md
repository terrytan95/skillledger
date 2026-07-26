# Product plan

## Product promise

SkillLedger makes a global skill library understandable and safe to maintain across many coding agents.

## Primary workflow

1. Open the app and scan the local machine.
2. See inventory health and provenance at a glance.
3. Select a skill to inspect every destination.
4. Preview a reconciliation plan.
5. Apply only after the app can journal and roll back the change.

## Scope

### Foundation — shipped

- Real local inventory scan.
- Canonical library and lock-file discovery.
- Seven built-in agent locations.
- Health classification.
- Selected Ledger desktop interface.
- Secure read-only Electron bridge.

### Safe reconciliation — next

- Content hashing and drift detail.
- Desired-state plan generation.
- Dry-run diff grouped by skill and destination.
- Append-only operation journal.
- Atomic apply, verification, and rollback.

### Source maintenance — later

- GitHub source discovery and update checks.
- `skills` CLI adapter for installation and updates.
- Pinned versions and reproducible export/import.
- Release notes and per-skill update policy.

### Team features — only with demand

- Shared policy files.
- Signed manifests.
- Managed repositories and approval rules.

## Non-goals

- Another skill marketplace.
- Editing skill content inside the app.
- Cloud accounts or sync before local reconciliation is trustworthy.
- A generic extension framework before real external integrations require it.

## Success measures

- A user can explain the source and destination of any skill in under ten seconds.
- Preview accurately names every path a write will affect.
- A failed operation restores the previous state without data loss.
- Adding a built-in agent requires one location entry plus a focused test.
