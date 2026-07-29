# Release Promotion Checklist — v0.9.0

## Preconditions

- `v0.9.0-rc.2` is tagged and green.
- Branch `release/v0.9.0` is frozen.
- No feature work has been merged since `v0.9.0-rc.2`.

## Gate 1 — 24-Hour Wall-Clock Soak

### Command

Windows:

```powershell
$env:SOAK_MS = 86400000
node scripts/op-validation.js
```

Unix:

```bash
SOAK_MS=86400000 node scripts/op-validation.js
```

### Required Evidence

Capture from `data/op-validation.json` after the run:

- [ ] Start timestamp
- [ ] End timestamp
- [ ] Commit hash
- [ ] Total iterations
- [ ] Unexpected failures (must be 0)
- [ ] Expected failures (crash-recovery only)
- [ ] Mean/min/max latency per scenario
- [ ] heapUsed, heapTotal, handles, requests, listeners delta
- [ ] Baseline operations mean/min/max
- [ ] Final `hydi architecture verify` output
- [ ] Final ArchitectureGuard score (must be 100%)

### Acceptance

- [ ] Zero unexpected failures
- [ ] No unexplained resource growth
- [ ] No stuck timers or listeners
- [ ] No degraded subsystem health
- [ ] Deterministic final state

## Gate 2 — Clean-Machine Deployment

### Environment

- [ ] New host or isolated VM
- [ ] No pre-existing HYDI state
- [ ] No copied `data/` directory
- [ ] No developer `.env` unless documented
- [ ] Only operator documentation used

### Procedure

```bash
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
# run a basic workload here
node scripts/hydi-cli.js export-manifest
node scripts/hydi-cli.js snapshot
# compare the two snapshots for drift
```

### Required Evidence

- [ ] Host details
- [ ] Installation log
- [ ] `npm ci` exit code
- [ ] `npm test` summary
- [ ] `hydi architecture verify` score
- [ ] First snapshot hash
- [ ] Second snapshot hash after basic workload
- [ ] Rollback/restore procedure result

## Gate 3 — Final Release Decision

Run:

```bash
node scripts/hydi-cli.js architecture verify
```

Required: 100% pass.

Then update `RC2_GO_NO_GO_REPORT.md`:

- [ ] 24-hour soak evidence attached
- [ ] Clean-machine deployment evidence attached
- [ ] All release gates green

## Promotion to v0.9.0

If and only if all three gates are satisfied:

1. [ ] Update `package.json`: `"version": "0.9.0"`
2. [ ] Update `CHANGELOG.md` with final `0.9.0` section
3. [ ] Generate final `RELEASE_REPORT_v0.9.0.md`
4. [ ] Create migration guide
5. [ ] Final operator sign-off
6. [ ] `git tag -a v0.9.0 -m "HYDI v0.9.0 stable release"`
7. [ ] Keep `release/v0.9.0` branch frozen

## What Not To Do

- Do not begin v1.0 implementation until `v0.9.0` is tagged.
- Do not merge new features into `release/v0.9.0`.
- Do not promote to `v0.9.0` with uncompleted soak or deployment gates.
