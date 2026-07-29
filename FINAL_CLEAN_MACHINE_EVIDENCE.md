# Final Clean-Machine Deployment Evidence

## Pre-Validation

| Check | Command | Result |
|-------|---------|--------|
| HEAD | `git rev-parse HEAD` | `3417fed2ec3688b3534742cd91606c6247043b9a` |
| Tag describe | `git describe --tags` | `v0.9.0-rc.3-1-g3417fed` |
| Working tree | `git status --short` | clean |

## Validated Release Candidate

- **Release Candidate:** `v0.9.0-rc.3`
- **Validated Commit:** `de9cbc1`
- **Branch:** `release/v0.9.0`

The `v0.9.0-rc.3` tag points to `de9cbc1`. The branch tip is one documentation commit ahead. Any clean-machine validation must be executed after `git checkout v0.9.0-rc.3`.

## Clean-Machine Deployment Status

**Not executed.** This evidence must be collected on a fresh VM or unused machine.

## Execution Procedure

```bash
git clone <repository>
cd HYDI_System
git checkout v0.9.0-rc.3
npm ci
npm test
npm test -- --runInBand
node scripts/hydi-cli.js architecture verify
node scripts/hydi-cli.js bootstrap
node scripts/hydi-cli.js export-manifest
node scripts/hydi-cli.js verify
node scripts/hydi-cli.js snapshot
# startup / basic operation
# shutdown
# restart
# recovery
```

## Required Environment Details

- [ ] Host OS and version
- [ ] Node version
- [ ] npm version
- [ ] Clean repository (no prior HYDI state)
- [ ] No copied `data/` directory
- [ ] No copied `.env` or other configuration
- [ ] Only documented commands used

## Required Validation Steps

- [ ] `npm ci` succeeds
- [ ] `npm test` passes
- [ ] `npm test -- --runInBand` passes
- [ ] `node scripts/hydi-cli.js architecture verify` reports 100%
- [ ] `node scripts/hydi-cli.js bootstrap` succeeds
- [ ] `node scripts/hydi-cli.js export-manifest` succeeds
- [ ] `node scripts/hydi-cli.js verify` reports no missing/extra components
- [ ] `node scripts/hydi-cli.js snapshot` succeeds
- [ ] Startup succeeds
- [ ] Normal operation succeeds
- [ ] Shutdown succeeds
- [ ] Restart succeeds
- [ ] Recovery succeeds

## Acceptance

PASS only if the installation and all lifecycle operations succeed using the documented operator instructions without human intervention or developer shortcuts.

## Result

Pending. Replace this section with actual evidence once the clean-machine run completes.
