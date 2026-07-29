# Final Clean Deployment Results

## Candidate

- Commit: `de9cbc1`
- Tag: `v0.9.0-rc.3`
- Branch: `release/v0.9.0`

## True Clean-Machine Run

**Not executed in this session.** A separate, fresh host or VM is required.

The qualified procedure is:

```bash
git checkout v0.9.0-rc.3
npm ci
npm test
node scripts/hydi-cli.js architecture verify
node scripts/hydi-cli.js export-manifest
node scripts/hydi-cli.js verify
node scripts/hydi-cli.js snapshot
```

## Clean Data-Path Validation

An isolated data directory was used to verify the CLI from empty state.

| Step | Command | Result |
|------|---------|--------|
| Initialize | `mkdir data\clean-deploy` | PASS |
| Export manifest | `node scripts/hydi-cli.js export-manifest --data-path data\clean-deploy` | PASS — 10 components |
| Verify | `node scripts/hydi-cli.js verify --data-path data\clean-deploy` | PASS |
| Snapshot | `node scripts/hydi-cli.js snapshot --data-path data\clean-deploy` | PASS |

## Required Clean-Machine Evidence

- [ ] Host OS and version
- [ ] Node / npm versions
- [ ] `npm ci` exit code
- [ ] `npm test` results
- [ ] `node scripts/hydi-cli.js architecture verify` output
- [ ] Initial snapshot hash
- [ ] Post-workload snapshot hash
- [ ] Shutdown and restart behavior
- [ ] Recovery behavior

## Acceptance

Pending. True clean-machine deployment is a release blocker.
