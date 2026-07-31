# Clean Deployment Report

## Scope

A full clean-machine deployment could not be performed in the current environment. A clean-data-path deployment was executed to validate that HYDI can initialize, generate a manifest, verify it, and create a snapshot from an empty state directory.

## Clean Data-Path Procedure

```powershell
mkdir data\clean-deploy
node scripts/hydi-cli.js export-manifest --data-path data\clean-deploy
node scripts/hydi-cli.js verify --data-path data\clean-deploy
node scripts/hydi-cli.js snapshot --data-path data\clean-deploy
```

## Results

| Step | Command | Result |
|------|---------|--------|
| Initialize | `mkdir data\clean-deploy` | PASS (empty state) |
| Export manifest | `export-manifest --data-path data\clean-deploy` | PASS — 10 components written to `data\clean-deploy\hydi-manifest.json` |
| Verify | `verify --data-path data\clean-deploy` | PASS — no missing, no extra |
| Snapshot | `snapshot --data-path data\clean-deploy` | PASS — `00aa498e...` |

## Clean-Machine Status

The following was not possible in this session:

- New operating-system user
- Fresh Node / npm install from lockfile
- No copied `.env` or existing `data/` directory

A CI pipeline or VM must perform the full clean-machine procedure before `v0.9.0` is released.

## Installation Notes

- `npm install` is the documented install step.
- `npm run typecheck` and `npm test` must pass.
- The `data/` directory must not be pre-populated.
- `hydi-cli.js` supports `--data-path` for isolated state.

## Findings

No issues in clean-data-path deployment. Full OS-level clean installation remains unverified.

## Recommendation

The clean-data-path path is proven. The full clean-machine deployment is a **release blocker** until completed in a separate environment.
