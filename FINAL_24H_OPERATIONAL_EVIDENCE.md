# Final 24-Hour Operational Evidence

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

The `v0.9.0-rc.3` tag points to `de9cbc1`. The branch tip is one documentation commit ahead. Any operational validation must be executed after `git checkout v0.9.0-rc.3`.

## 24-Hour Soak Status

**Not executed.** This evidence must be collected on a dedicated host.

## Execution Command

```bash
git checkout v0.9.0-rc.3
```

Windows PowerShell:

```powershell
$env:SOAK_MS = 86400000
$env:SOAK_ITERS = 99999999
node scripts/op-validation.js
```

Windows cmd:

```cmd
set SOAK_MS=86400000
set SOAK_ITERS=99999999
node scripts/op-validation.js
```

Unix:

```bash
SOAK_MS=86400000 SOAK_ITERS=99999999 node scripts/op-validation.js
```

## Required Environment Details

- [ ] Hostname / environment name
- [ ] Operating system and version
- [ ] CPU model and count
- [ ] Memory capacity
- [ ] Node version
- [ ] `npm` version
- [ ] Dependency lock status
- [ ] `git rev-parse HEAD` at start
- [ ] `git describe --tags` at start

## Required Measurements

- [ ] Start timestamp
- [ ] End timestamp
- [ ] Process uptime
- [ ] Memory usage samples
- [ ] CPU usage samples
- [ ] Event listener count
- [ ] Active handle count
- [ ] Timer count
- [ ] Federation health
- [ ] Task execution count
- [ ] Recovery event count
- [ ] Snapshot verification result

## Acceptance

PASS only if all of the following are true:

- [ ] Zero unexpected failures
- [ ] No resource leak trend
- [ ] No degraded services
- [ ] No manual intervention
- [ ] Final `node scripts/hydi-cli.js architecture verify` succeeds at 100%

## Result

Pending. Replace this section with actual evidence once the soak completes.
