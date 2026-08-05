# DUAL HEIDI and Port Registry Remediation Plan

## Status

Not implemented in this pass. A plan is documented here because the changes
cross multiple launchers, tests, environment files, and documentation and
require an explicit architecture decision before code changes are made.

## Dual HEIDI ambiguity

### Current runtimes

| File | Port | Role | How it is launched |
| --- | --- | --- | --- |
| `src/server.js` | `PORT` default `3005` | ProtoForge Core event pipeline + agent bus | `restart.ps1`, `npm start`? |
| `heidi-core/server.js` | `HEIDI_PORT` default `3459` | HEIDI Core orchestrator (Ollama, memory, reflection) | `start-heidi-everything.ps1`, `launch-heidi-mobile.js` |

Both pieces of code are used. The ambiguity is not that one should be deleted,
but that they are **both named as if they are the authoritative HEIDI runtime**.

### References found

- `restart.ps1` kills and restarts `3005` as "HYDI Express".
- `start-heidi-everything.ps1` starts `heidi-core/server.js` on `3459`.
- `launch-heidi-mobile.js` uses `HEIDI_CORE_URL=http://localhost:3459`.
- `protoforge-main.js` advertises `http://localhost:3005/protohub-dashboard.html`.
- `tests/unit/health-observer.test.js` expects `http://127.0.0.1:3005/health`.
- `modules/deployment-manager.js` uses `URSULA_URL` or `localhost:3005`.
- `modules/cascade-integration-bridge.js` defaults to `http://localhost:3005`.

### Proposed consolidation

1. Treat `src/server.js` as the **ProtoForge Core / Ursula API** and rename
everything that calls it "HEIDI" to "ProtoForge Core" or "Ursula API".
2. Treat `heidi-core/server.js` as the **HEIDI Core Orchestrator**.
3. Make the names in code, scripts, and docs match this split.
4. Update `start-heidi-everything.ps1`, `restart.ps1`, `health-observer.test.js`,
`protoforge-main.js`, and `task-5-heidi-documentation.md` to use the new names.
5. Add a startup guard that refuses to start `heidi-core/server.js` if
`HEIDI_PORT` is set to `3005` or another reserved port, and vice-versa.

## Port registry drift

### Current sources of truth

| Source | Scope | Problems |
| --- | --- | --- |
| `.ports.json` | Ideal/desired registry | Lists `protoforge-core:3005` and `heidi-core:3459`, but these services are not present in `services-manifest.json`. |
| `services-manifest.json` | Supervisor startup manifest | Uses `C:\Users\Owner\HYDI_System` as `cwd` (wrong worktree), lists `hydi-core:9997` and `heidi-mobile:3006` but not the 3005/3459 runtimes, and has the `next-app` using `npm run dev` on `3000`. |
| `restart.ps1` | Manual restart script | Hard-codes `3000` and `3005`. |
| `start-heidi-everything.ps1` | Heidi launcher | Hard-codes `3459` and `3006`. |
| `unified-system-sitrep.js` | Health sitrep | Points `ursula-agent` and `protoforge-hq` to `http://localhost:3005`. |

### Proposed reconciliation

1. Choose one source of truth: `.ports.json` is the canonical registry.
2. Generate `services-manifest.json` from `.ports.json` and a small script,
or keep `services-manifest.json` in sync by hand and add a CI check.
3. Update `services-manifest.json` to:
   - Use `C:\Users\Owner\HYDI-Remediation` (or `%HYDI_HOME%`) as `cwd`.
   - Include `protoforge-core` (3005) and `heidi-core` (3459).
   - Remove or move to optional any services that do not have a runnable entry point.
4. Create `scripts/check-ports.js` and run it in CI to fail when `.ports.json`
does not match actual process startup ports.
5. Update all hard-coded `3005`, `3459`, `3006`, `3000` references to read from
`.ports.json` or environment variables.
6. Add an `ARCHITECTURE.md` section on the two-runtimes model and a
`PORT_ALLOCATION.md` guide that explains how to reserve a new port.

## Recommended implementation order

1. Rename in-code references (`src/server.js` comments, `restart.ps1` messages,
test descriptions, `protoforge-main.js` output).
2. Update `.ports.json` with the definitive service list and an `autodiscover`
flag for `HYDI_HOME`.
3. Rewrite `services-manifest.json` against `.ports.json`.
4. Add `scripts/check-ports.js` and a CI step.
5. Update startup scripts to read `.ports.json`.
6. Re-run the health-observer and restart tests.

## Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Renaming `src/server.js` messaging breaks external curl scripts | Medium | Update docs first, keep old paths until v0.10.0, add deprecated-warnings. |
| Changing `services-manifest.json` cwd breaks supervisor on other machines | Medium | Use environment variable `HYDI_HOME` or a setup script. |
| Adding port checks without CI means drift continues | Low | Add CI step before merge. |
| Removal of `hydi-core:9997` if it is real | High | Verify `hydi-core.js` exists and is launched before removing from manifest. |
