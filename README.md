# SkillLedger

Your skills, one source of truth.

SkillLedger is a local-first desktop control plane for global Agent Skills. It inventories a canonical `~/.agents/skills` library, inspects which coding agents consume each skill, and makes drift or missing provenance visible before any filesystem mutation.

## Why this project

Agent skill installers are good at adding packages. SkillLedger focuses on the maintenance loop that follows:

- Which copy is canonical?
- Where did a skill come from?
- Which agents are linked, copied, missing, or broken?
- What would a reconciliation change before it touches disk?
- How can a failed update be rolled back safely?

The current foundation is deliberately read-only. Scanning is real; reconciliation is preview-only until the rollback journal is implemented.

## UI directions

The app contains three complete, switchable interface directions:

1. **Ledger** — calm three-pane library, recommended for daily use.
2. **Atlas** — compact metrics and table, optimized for large inventories.
3. **Harbor** — source-to-canonical-to-agent map, optimized for provenance.

## Current capabilities

- Scans `~/.agents/skills` as the canonical library.
- Reads optional provenance from `~/.agents/.skill-lock.json`.
- Inspects Codex, Claude Code, Cursor, Gemini CLI, Grok, OpenCode, and AiderDesk skill directories.
- Detects healthy links, independent copies, missing canonical content, and broken symlinks.
- Falls back to representative demo data in a normal browser for design review.
- Exposes one validated, read-only Electron IPC method.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module boundaries and safe mutation model, and [docs/PRODUCT.md](docs/PRODUCT.md) for the product plan.

## Development

Requirements: Node.js 22+ and Yarn 1.x.

```bash
yarn install
yarn dev
```

Validation:

```bash
yarn typecheck
yarn test
yarn build:app
```

Create an unsigned local macOS package:

```bash
yarn package
```

## Security stance

- Local-first; no account, telemetry, or network service.
- Electron context isolation and renderer sandbox are enabled.
- The renderer has no Node.js access.
- IPC exposes a narrow scan method and validates the sender.
- Future write operations must use preview, an append-only journal, atomic replacement, and rollback.

## License

MIT
