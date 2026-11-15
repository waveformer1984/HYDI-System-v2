# Frank operational truth status

**Status:** **BLOCKED** (cloud agent — Frank not reachable)

## What exists

| Component | Purpose |
|-----------|---------|
| `scripts/frank-production-truth-collect.ps1` | Read-only Frank collector (schema v2: adds `local_ci_hint` for ESLint flat-config flags) |
| `lib/observation/frank-truth-loader.js` | Loads newest `.runtime/production-truth/*.json`; labels LIVE / CACHED / UNAVAILABLE |
| `lib/heidi/operations-evidence-snapshot.js` | Auto-includes collector file in `frank_production_truth` evidence block |
| `GET /operations/snapshot` (heidi-core) | Bundles evidence for authorized clients |

## Operator procedure (Frank)

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank-production-truth-collect.ps1
# Upload printed path to cloud agent or copy into repo .runtime/production-truth/ (do not commit secrets)
```

## Local-CI closure (Phase 1)

| Item | Status |
|------|--------|
| Root cause documented | `docs/reports/frank-windows-local-ci-root-cause.md` |
| Fix PR #600 (`92909393`) | Open — merge pending human approval |
| Frank orchestrator re-run | **NOT VERIFIED** — incident **not closed** |
| Post-merge verification | See PowerShell block in root-cause doc |

## Evidence required to unblock

1. Collector JSON from Frank (LIVE).  
2. `node scripts/local-ci.js` exit 0 on `clean-main` head after #600 merge + PM2 restart.  
3. Optional: attach `%TEMP%\hydi-local-ci\*\*.log` tails if still red.