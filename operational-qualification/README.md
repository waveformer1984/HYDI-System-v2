# Operational Qualification Harness

**Purpose:** Repeatable operational validation infrastructure for HYDI System production certification.

**Philosophy:** Production systems tend to fail in motion, not while sitting in a repository. This harness validates operational behavior through actual runtime execution, not static analysis.

## Components

- `orchestrator/` - Stack launch/shutdown orchestration
- `workloads/` - Representative workload drivers
- `metrics/` - System metrics collection
- `failures/` - Controlled failure injection
- `reports/` - Qualification report generation
- `config/` - Harness configuration

## Usage

```bash
# Run full qualification (recommended: dedicated host, 24+ hours)
node operational-qualification.js full

# Run quick qualification (smoke test, ~30 minutes)
node operational-qualification.js quick

# Run specific phase
node operational-qualification.js phase <phase-name>

# Available phases:
# - stack-lifecycle
# - workload-execution
# - metrics-collection
# - failure-injection
# - report-generation
```

## Output

All qualification reports are timestamped and stored in `qualification-reports/`:

```
qualification-reports/
  ├── 2026-08-01-qual-full.json
  ├── 2026-08-01-qual-quick.json
  └── 2026-08-01-qual-phase-stack-lifecycle.json
```

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

### Quick Qualification (~30 minutes)
- Stack lifecycle validation
- Basic workload execution
- Snapshot metrics collection
- No failure injection
- Smoke test focus

### Full Qualification (24+ hours)
- Complete stack lifecycle
- Representative workload execution
- Continuous metrics collection
- Controlled failure injection
- Comprehensive qualification report

## Exit Criteria

### Quick Qualification PASS
- Stack starts successfully
- All services reach healthy state
- Basic workloads execute successfully
- No unexpected errors
- Metrics collected successfully

### Full Qualification PASS
- Stack runs continuously for 24+ hours
- All representative workloads execute successfully
- No resource leaks detected
- No performance degradation
- All failure scenarios recover successfully
- Comprehensive metrics collected
- Qualification report generated

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
- name: Operational Qualification (Quick)
  run: node operational-qualification.js quick

- name: Operational Qualification (Full)
  if: github.ref == 'refs/heads/release/v0.9.0'
  run: node operational-qualification.js full
```

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
