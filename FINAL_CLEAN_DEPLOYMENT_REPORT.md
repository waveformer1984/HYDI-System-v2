# Final Clean Deployment Report

## Status

**A true clean-machine deployment was not executed in this session.**

A clean-data-path validation was completed. A full clean-machine deployment must be performed on a new host or isolated VM before this report can be closed.

## Clean Data-Path Evidence

The CLI was executed against an empty `data/clean-deploy` directory.

| Step | Command | Result |
|------|---------|--------|
| Initialize empty state | `mkdir data\clean-deploy` | PASS |
| Export manifest | `node scripts/hydi-cli.js export-manifest --data-path data\clean-deploy` | PASS — 10 components |
| Verify | `node scripts/hydi-cli.js verify --data-path data\clean-deploy` | PASS — no missing, no extra |
| Snapshot | `node scripts/hydi-cli.js snapshot --data-path data\clean-deploy` | PASS — `00aa498e...` |

## Clean-Machine Procedure

The following must be executed on a fresh host using only the operator documentation:

```bash
git clone <repo>
cd HYDI_System
git checkout release/v0.9.0
git checkout v0.9.0-rc.2
npm ci
npm run typecheck
npm test
npm test -- --runInBand
node scripts/hydi-cli.js architecture verify
node scripts/hydi-cli.js export-manifest
node scripts/hydi-cli.js verify
node scripts/hydi-cli.js snapshot
# basic workload
node scripts/hydi-cli.js snapshot
# shutdown
# restart
# restore from snapshot
# verify final state
```

## Required Clean-Machine Evidence

- [ ] Host operating system and version
- [ ] Node and npm versions
- [ ] `npm ci` exit code
- [ ] `npm run typecheck` result
- [ ] `npm test` summary
- [ ] `npm test -- --runInBand` summary
- [ ] `hydi architecture verify` output
- [ ] Initial manifest hash
- [ ] Initial snapshot hash
- [ ] Post-workload snapshot hash
- [ ] Rollback/restore verification
- [ ] Final health status

## Acceptance Criteria

- [ ] Installation succeeds from `npm ci`
- [ ] All tests pass
- [ ] ArchitectureGuard = 100%
- [ ] Manifest exports and verifies
- [ ] Snapshot creation succeeds
- [ ] Normal execution succeeds
- [ ] Shutdown is clean
- [ ] Restart restores state
- [ ] Recovery succeeds

## Clean-Machine Result

Pending. A fresh host must be used to complete this gate.
