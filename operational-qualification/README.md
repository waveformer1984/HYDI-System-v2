# Operational Qualification Harness

**Purpose:** Repeatable operational validation infrastructure for HYDI System production certification.

**Philosophy:** Production systems tend to fail in motion, not while sitting in a repository. This harness validates operational behavior through actual runtime execution, not static analysis.

> ### Chaos is disabled by default
>
> Failure injection is **destructive** — it terminates real processes and
> restarts real containers. It runs only when `--chaos` is passed explicitly.
> The `failures.*.enabled` keys in `config/qualification-config.json` select
> *which* scenarios run when chaos is requested; they do not arm it.
>
> Without `--chaos`, all resilience criteria are reported `NOT TESTED` and the
> overall status is at best `pass_with_gaps`. A run that injected nothing can
> never be graded a clean pass.

> ### 2026-08-02 correction
>
> As originally committed this harness **could not run at all**: `startService`
> declared `const process = spawn(...)`, putting the global `process` into the
> temporal dead zone, so every invocation threw
> `ReferenceError: Cannot access 'process' before initialization` on the first
> service. Three further defects sat behind it — camelCase config lookups
> against a kebab-case config, workloads that re-appended their own path onto
> an already-complete endpoint, and failure "scenarios" that were `setTimeout`
> calls returning hardcoded `recovered: true` / `dataIntegrity: true`.
>
> Because `reports/report-generator.js` graded "All failure scenarios recover"
> and "Data integrity maintained" from those hardcoded values, the harness
> would have certified resilience it never exercised. All four defects are
> fixed and locked by `tests/unit/validation-tooling-integrity.test.js`.

## Components

- `orchestrator/` - Stack launch/shutdown orchestration
- `workloads/` - Representative workload drivers
- `metrics/` - System metrics collection
- `failures/` - Controlled failure injection
- `reports/` - Qualification report generation
- `config/` - Harness configuration

## Usage

```bash
# Full qualification, NO failure injection (dedicated host, 24+ hours)
node operational-qualification.js full
npm run production-certification          # equivalent

# Quick qualification, NO failure injection (~30 minutes)
node operational-qualification.js quick
npm run operational-qualification         # equivalent

# Full qualification WITH real, destructive failure injection
node operational-qualification.js full --chaos

# See what chaos would do without injecting anything
node operational-qualification.js full --chaos --dry-run

# Let the supervisor perform recovery instead of the harness
node operational-qualification.js full --chaos --supervised

# Run a specific phase
node operational-qualification.js phase <phase-name>

# Available phases:
# - stack-lifecycle     start the stack and wait for health
# - workload-execution  drive workloads only
# - metrics-collection  sample metrics only
# - loaded-window       workloads and metrics concurrently (what full/quick use)
# - failure-injection   chaos scenarios (no-op without --chaos)
# - stack-shutdown      stop the stack and record graceful shutdown
# - report-generation   emit a report from whatever has been collected
```

### Options

| Flag | Effect |
|---|---|
| `--chaos` | Enable REAL destructive failure injection. Off by default. |
| `--dry-run` | With `--chaos`, report what would be injected without injecting. |
| `--supervised` | Let the supervisor recover services rather than the harness. |

## Output

Reports are timestamped and stored in `reports/qualification/` at the repo root:

```
reports/qualification/
  ├── 2026-08-01T09-00-00-qual-full.json
  └── 2026-08-01T09-00-00-qual-quick.json
```

Every report carries a `classificationLegend` and a `scopeStatement`. Each
acceptance criterion is tagged with one of:

| Classification | Meaning |
|---|---|
| `VERIFIED` | Measured directly during this run |
| `OBSERVED` | Recorded during the run, but not a controlled measurement |
| `INFERRED` | Derived from measured data; not itself measured |
| `PENDING` | Intended for this run but not completed (e.g. window too short) |
| `NOT TESTED` | Not exercised at all during this run |

## Requirements

- Node.js >= 20
- Docker (for Docker stack components)
- Python 3.x (for bridge)
- PowerShell (for forge-loop)
- Dedicated host for full qualification (24+ hours)
- Isolated test environment for failure injection

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Operational Qualification Harness             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │ Orchestrator │───▶│  Workloads   │───▶│   Metrics    │ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
│         │                   │                   │          │
│         ▼                   ▼                   ▼          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │   Stack      │    │  HYDI Stack  │    │   System     │ │
│  │  Lifecycle   │    │  Execution  │    │  Monitoring │ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
│         │                                           │         │
│         ▼                                           ▼         │
│  ┌──────────────┐                          ┌──────────────┐ │
│  │   Failures   │                          │   Reports    │ │
│  │  Injection   │                          │  Generation  │ │
│  └──────────────┘                          └──────────────┘ │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Qualification Levels

Workload execution and metrics collection run **concurrently** over the same
window, so the metrics describe the system under load. (An earlier revision ran
them sequentially, which sampled an idle system and made a "24 hour" run take
48 hours.)

### Quick Qualification (~30 minutes)
- Stack lifecycle validation
- Basic workload execution with concurrent metrics
- Graceful shutdown
- No failure injection
- Smoke test focus

### Full Qualification (24+ hours)
- Complete stack lifecycle
- Representative workload execution with continuous metrics
- Failure injection **only if `--chaos` is passed**
- Graceful shutdown
- Comprehensive qualification report

## Exit Criteria

### Quick Qualification PASS
- Stack starts successfully
- All services reach healthy state
- Basic workloads execute above the configured success rate
- Metrics collected successfully
- Stack stops gracefully

Best achievable status without `--chaos` is `pass_with_gaps`, because all
resilience criteria are `NOT TESTED`.

### Full Qualification PASS
- Stack runs continuously for the configured window
- Workload success rate meets `acceptanceCriteria.workloadSuccessRate`
- No resource leak detected in the harness process, **or** the run is long
  enough for a trend (a window under 10 minutes reports `PENDING`, not a pass)
- Stack stops gracefully
- Qualification report generated

### What a PASS never covers

Regardless of flags, this harness does not evidence:

- **Data integrity across faults** — durable state is not snapshotted or
  diffed, so this is always reported `NOT TESTED`.
- **Memory behaviour of service processes** — only the harness process is
  instrumented.
- **Database or Redis query correctness** — dependency checks are TCP connect
  probes measuring socket reachability, not query execution.
- **Any resilience property** unless `--chaos` ran and the relevant scenario
  reported `passed`. Scenarios reported `skipped` were not exercised and must
  not be cited as evidence.

## Configuration

Edit `config/qualification-config.json` to customize:

- Service startup order
- Workload patterns
- Metrics collection intervals
- Failure scenarios
- Acceptance criteria
- Report format

## Integration with CI/CD

This harness can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Operational Qualification (Quick, no chaos)
  run: node operational-qualification.js quick

- name: Operational Qualification (Full, no chaos)
  if: github.ref == 'refs/heads/release/v0.9.0'
  run: node operational-qualification.js full
```

Do **not** add `--chaos` to a shared runner. Chaos scenarios terminate
processes and restart containers on the host they run on; they require a
dedicated, isolated environment.

## Troubleshooting

### Stack fails to start
1. Check `services-manifest.json` configuration
2. Verify all dependencies are available
3. Check port conflicts
4. Review service logs

### Workloads fail to execute
1. Verify stack is healthy
2. Check workload configuration
3. Review workload logs
4. Validate service endpoints

### Metrics collection fails
1. Verify monitoring infrastructure
2. Check metrics configuration
3. Review metrics collector logs

### Failure injection fails
1. Verify test environment isolation
2. Check failure injector configuration
3. Review failure injection logs
4. Ensure rollback capability exists

## Security Considerations

- Run in isolated test environment
- Never inject failures in production
- Use test data only
- Never expose production secrets
- Ensure rollback capability before failure injection

## Maintenance

- Update workload patterns as system evolves
- Add new failure scenarios as new dependencies are added
- Adjust acceptance criteria as requirements change
- Review and update configuration regularly
