# Contributing

Use Node.js 22+ and Yarn 1.x.

```bash
yarn install
yarn typecheck
yarn test
yarn build:app
```

Keep changes narrow:

- Put filesystem facts and health rules in `electron/skill-inventory.ts`.
- Keep the preload API minimal and typed in `src/types.ts`.
- Do not give the renderer direct Node.js or filesystem access.
- Add one focused test for each non-trivial inventory rule.
- Do not enable an Apply action without a journal, verification, and rollback path.
