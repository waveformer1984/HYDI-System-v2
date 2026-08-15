# HYDI Phase 12 — Recovery Matrix

## Workflow

1. **Observe** — `LocalHealthProbes` reports service status.
2. **Detect** — `HealthAggregator` returns `UNAVAILABLE` or `DEGRADED` for the target.
3. **Decide** — `HeidiExecutive` evaluates the `health.recover` capability (LOW, no approval).
4. **Authorize** — `PolicyEngine` confirms the capability is registered and allowed.
5. **Execute** — `ControlledExecutor` performs the predefined `docker restart <container>`.
6. **Audit** — `AuditLog` appends the full event to `data/audit.jsonl`.
7. **Verify** — `LocalRecoveryWorkflow` re-probes the service and confirms `HEALTHY`.

## Sequence

```
HealthProbe → HealthAggregator → HeidiExecutive.run(health.recover)
   ↓
ControlledExecutor.validateTask()
   ↓
docker restart supabase_inbucket_HYDI-System-v2
   ↓
AuditLog.record()
   ↓
HealthProbe.reprobe() = HEALTHY
```

## Test Coverage

`tests/unit/heidi-executive/phase12-autonomous.test.js` simulates:

- `UNAVAILABLE` health state
- `health.recover` authorization
- mocked `docker restart`
- audit trail persistence
- re-probe returning `HEALTHY`

## Limitations

- Only `supabase_inbucket` is in the safe-recovery allowlist.
- No other container or service is automatically restarted.
- The workflow does not retry beyond the capability retry policy.
- Real-world recovery depends on local Docker being available.
