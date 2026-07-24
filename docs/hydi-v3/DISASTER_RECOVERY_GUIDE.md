# HYDI V3 Disaster Recovery Guide

This guide provides recovery procedures for common disaster scenarios. All recovery actions assume you have a current backup of the `data/` directory and the ability to set environment variables.

## Power Loss

### Detection

- Process does not restart cleanly.
- `manager.getStatus()` shows `started: false` or checkpoint restore error.
- `data/checkpoints/latest.json` may be stale or missing.

### Recovery Procedure

1. Verify power and filesystem integrity of the host.
2. Start HYDI V3. `AutonomyManager.start()` calls `CheckpointStore.loadCheckpoint()` automatically.
3. If the checkpoint is corrupt, delete `data/checkpoints/latest.json` and restart. V3 will re-initialize from persistent mission/decision/reflection JSON files.
4. Verify `manager.getStatus()` shows expected `missionCount`, `decisionCount`, and `reflectionCount`.
5. Run `node scripts/production-readiness-score.js` to confirm recovery.

### Prevention

- `CheckpointStore.saveCheckpoint()` runs on every `manager.stop()` and graceful shutdown.
- Enable UPS or battery backup for the host.
- Back up `data/` every 15 minutes to durable storage.

## Database Outage

### Detection

- `SelfHealingEngine` reports `database_disconnect`.
- Core loop errors include `database`, `supabase`, or `postgres`.
- `api/health` degrades or returns `503`.

### Recovery Procedure

1. Confirm Supabase/project database status.
2. `SelfHealingEngine` will automatically retry with exponential backoff up to `maxAttempts` (default `5`).
3. If automatic recovery fails, `SelfHealingEngine` emits `escalated`.
4. Manually heal if needed:
   ```js
   await manager.selfHealing.heal(
     { type: 'database_disconnect', target: 'supabase' },
     { reconnect_database: async () => ({ success: true }) }
   );
   ```
5. Verify database connectivity by querying the `system_dashboard` view.
6. Restart HYDI if the outage caused corrupted queue state.

### Fallback

- V3 modules cache state locally in `data/`; reads and writes continue to be captured.
- Once the database recovers, pending decisions and missions can replay from local JSON files.

## Network Outage

### Detection

- `HeartbeatSystem` reports `heartbeat_missing` for external APIs.
- `SelfHealingEngine` reports `api_failure`.
- Errors include `timeout`, `network`, `EAI_AGAIN`, `ECONNREFUSED`.

### Recovery Procedure

1. Verify network connectivity from the host.
2. `SelfHealingEngine` retries external calls with exponential backoff.
3. If the outage persists, pause revenue-affecting missions:
   ```js
   manager.missionPlanner.pauseMission(missionId);
   ```
4. Resume once connectivity returns:
   ```js
   manager.missionPlanner.resumeMission(missionId);
   ```
5. Check `manager.getDashboard()` for queue depth and error counts.

### Prevention

- Set conservative `maxBackoffMs` and `maxAttempts` to avoid overwhelming upstream services.
- Use `ReflectionEngine` to identify network-sensitive strategies and add timeouts/retries.

## Corruption

### Detection

- `MemoryIntegrity.runScan()` returns `passed: false`.
- Mission/decision/reflection JSON fails to parse.
- Duplicate IDs, orphan tasks, or invalid timestamps are reported.

### Recovery Procedure

1. Run a full integrity scan:
   ```js
   const result = await manager.runMemoryIntegrity();
   console.log(result.issues, result.repairs);
   ```
2. `MemoryIntegrity` will attempt in-place repairs (rehydrate Maps, reset arrays, etc.).
3. If corruption is severe, stop HYDI and restore `data/` from backup.
4. Delete corrupted JSON files and restart; modules recreate empty files on `initialize()`.
5. Re-run `npm run test` and `npm run test:soak` before returning to production.

### Prevention

- Run `manager.runMemoryIntegrity()` daily.
- Backup `data/missions/missions.json`, `data/decisions/decision_history.json`, and `data/reflections/reflections.json` before upgrades.
- Avoid manual edits to JSON persistence files.

## Escalation

If automatic recovery fails after `maxAttempts`:

1. Capture `manager.getStatus()` and `manager.getDashboard()`.
2. Preserve `data/` and logs.
3. Engage the on-call engineer.
4. If revenue paths are impacted, fail safe: pause active missions and disable auto-actions.
