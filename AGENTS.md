# AGENTS.md

## Cursor Cloud specific instructions

SkillLedger is an Electron + Vite + React (TypeScript) local-first desktop app that
targets macOS. Standard commands live in `package.json` scripts and `README.md`
(`yarn typecheck`, `yarn test`, `yarn build:app`, `yarn dev`). Dependencies are
managed with Yarn 1.x on Node 22.

Non-obvious notes for this Linux cloud environment:

- Running the renderer for development: `yarn dev` starts Vite at
  `http://localhost:5173/`. Open that URL in a normal browser — the renderer has no
  Node/filesystem access and automatically falls back to representative demo data
  (see `src/demo.ts`), so the full Ledger UI is usable without Electron.
- `yarn dev` also spawns Electron via `vite-plugin-electron`. On headless Linux this
  prints harmless noise (`Failed to connect to the bus`/dbus errors, and
  `ENOENT ... /home/ubuntu/.agents/skills/...` because the canonical library does not
  exist here). These do not affect the Vite server or browser renderer; ignore them
  and use `http://localhost:5173/` for UI work.
- Electron packaging is macOS-only: `yarn package` and `yarn dist` (and the
  `predist` `script/verify-macos-release.mjs` check) will not produce a working
  bundle on Linux. Use `yarn build:app` to validate the production build instead.
- CI (`.github/workflows/ci.yml`) runs on `macos-latest` with
  `yarn install --frozen-lockfile`, `yarn typecheck`, `yarn test`, `yarn build:app`.
