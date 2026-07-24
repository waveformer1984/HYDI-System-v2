# HYDI V3 Troubleshooting Manual

## Manager fails to start

**Symptoms**
- `manager._started` is `false`.
- `autonomyManager` not present on `HYDISystem`.

**Causes and Fixes**
1. Missing `coreLoop` or malformed components.
   - Ensure `coreLoop` has `getStatus`, `getPendingTasks`, and `takeAction`.
2. `data/` directory not writable.
   - Check permissions and disk space.
3. Corrupt checkpoint JSON.
   - Delete `data/checkpoints/latest.json` and restart.

## Missions are not dispatching

**Symptoms**
- `coreLoop.getPendingTasks()` returns `[]`.
- Tasks remain in `pending` state.

**Causes and Fixes**
1. Mission not planned.
   - Call `manager.executeMission(missionId)` or `missionPlanner.planMission(missionId)`.
2. Task dependencies not completed.
   - Inspect `task.dependencies` and complete prerequisites.
3. `enableMissionPlanning` is `false`.
   - Set `config.enableMissionPlanning: true`.
4. Mission status is not `active` (`paused`, `cancelled`, `failed`).
   - Call `resumeMission` or create a new mission.

## Heartbeat missing alerts

**Symptoms**
- `heartbeat_missing` events fire repeatedly.
- Service marked degraded.

**Causes and Fixes**
1. Service stopped publishing.
   - Verify `provider.getStatus()` or `provider()` does not throw.
2. `missingThresholdMs` too aggressive.
   - Increase `config.missingThresholdMs` for slow services.
3. Clock skew between hosts.
   - Sync NTP across nodes.

## Self-healing escalation

**Symptoms**
- `SelfHealingEngine` emits `escalated`.
- Same failure repeats beyond `maxAttempts`.

**Causes and Fixes**
1. No recovery handler registered.
   - Pass real action handlers to `heal(symptom, actions)`.
2. Persistent external outage.
   - Pause affected missions and investigate upstream.
3. `maxAttempts` too low for transient issues.
   - Tune `baseBackoffMs`, `maxBackoffMs`, and `maxAttempts`.

## Persist errors

**Symptoms**
- `persist_error` event from `HYDIAutonomyManager`.
- JSON files not updating.

**Causes and Fixes**
1. Disk full or read-only filesystem.
   - Free space or remount filesystem.
2. Missing parent directory.
   - `initialize()` creates directories recursively; verify it was called.
3. Concurrent writes.
   - Only one HYDI process should write to `data/` at a time.

## Lint or typecheck failures

**Symptoms**
- `npm run lint` reports warnings/errors.
- `npm run typecheck` fails.

**Causes and Fixes**
1. New file not included in lint/typecheck globs.
   - Update `package.json` `lint` and `tsconfig.typecheck.json` includes.
2. `no-unused-vars` warning.
   - Remove unused variables or prefix with `_`.
3. `no-undef` for Node globals.
   - Verify `.eslintrc.json` sets `"env": { "node": true }`.

## Security audit findings

**Symptoms**
- `SecurityAuditor.runAudit()` returns `passed: false`.
- Findings include `critical` or `high` severity.

**Causes and Fixes**
1. Hardcoded secret or API key in source.
   - Move to environment variables or secret manager.
2. Missing required environment variables.
   - Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.
3. SQL injection pattern in string concatenation.
   - Use parameterized queries.

## Performance benchmark failures

**Symptoms**
- `benchmark:performance` exits non-zero.
- `meetsTargets` contains `false`.

**Causes and Fixes**
1. Slow startup due to network/database calls at init.
   - Defer cold-path initialization until needed.
2. Mission planning > 500ms.
   - Reduce initial task count or optimize sorting.
3. Task dispatch > 100ms.
   - Reduce mission backlog or increase `maxConcurrent`.

## Integration test failures

**Symptoms**
- `npm run test:integration` fails.

**Causes and Fixes**
1. Missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`.
   - Set environment variables; integration tests require live credentials.
2. Leftover temporary data.
   - Tests clean tempdirs in `afterEach`; verify permissions.
3. Module state leaked between tests.
   - Ensure `manager.destroy()` is called in `afterEach`.

## Decision rejected unexpectedly

**Symptoms**
- `takeAction` returns `{ status: 'rejected' }`.

**Causes and Fixes**
1. Action matches dangerous keywords (`delete`, `drop`, `rm`).
   - Avoid dangerous action names or set explicit `riskScore` < `dangerScoreThreshold`.
2. Confidence below `lowConfidenceThreshold` (default `0.3`).
   - Increase `confidence`.
3. Missing required credential or permission.
   - Provide `requiredCredentials` env vars or `hasPermissions: true`.
