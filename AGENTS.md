# HYDI System — Agent Notes

## Build / Test / Validation Commands

```bash
npm install
npm run build          # Next.js production build (ignores TS/ESLint errors)
npm run server         # Express server on PORT (default 3005)
npm start              # Next.js production server (no continuous HYDI loop)

npm test               # Jest unit tests (currently needs --forceExit)
npm run test:integration  # Integration tests (requires live Supabase env)
npm run test:soak         # node scripts/soak-test.js
npm run benchmark:performance
npm run security-audit
npm run lint
npm run typecheck
```

## Project Layout

- `src/hydi-v3/` — committed V3 reliability/autonomy layer (25 modules, 364 public methods, unit tests in `tests/unit/hydi-v3/`).
- `src/HYDISystem.js` — top-level system entry that wires V2 layers + V3 `AutonomyManager`.
- `src/server.js` — Express server with legacy modules; does **not** start `HYDISystem`.
- `pages/api/` — Next.js API routes. `pages/api/chat.js` is a stub/placeholder dispatcher.
- `api/life-flow/route.js` — references `HYDISystem` but is not part of the Next.js build (`pages/api/`).
- `bin/hydi.js` — untracked V4 CLI; do not use for V3.
- `src/hydi-v4/` and related NEXUS files are untracked and frozen per `V1_RECONCILIATION_REPORT.md` and `NEXUS_RECONCILIATION_REPORT.md`.

## Key Observations

- 419 unit tests pass (35 suites) but Jest reports a worker force-exit due to open handles.
- `npm run build`, `npm run lint`, and `npm run typecheck` pass.
- `scripts/chaos-runner.js` passes all 11 V3 chaos scenarios.
- `HYDISystem`/`HYDIAutonomyManager` have no production runtime entry point; `boot-agent.js` and `supervisor.js` are referenced but missing.
- V3 `ArchitectureAudit` scores 73 with 0 critical/high issues; most findings are duplicate method names and heuristic async-correctness warnings.
