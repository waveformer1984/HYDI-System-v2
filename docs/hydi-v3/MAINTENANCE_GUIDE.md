# HYDI V3 Maintenance Guide

This guide describes routine maintenance, backup, upgrade, and integrity procedures for HYDI V3.

## Daily Maintenance

1. **Check status**:
   ```js
   const status = manager.getStatus();
   ```
   Look for:
   - `heartbeat.missing` > 0
   - `watchdog.dead` > 0
   - `selfHealing.escalations` not empty
   - `missions.failed` increasing

2. **Review dashboard**:
   ```js
   const dashboard = manager.getDashboard();
   ```
   Watch `agentHealth`, `missionProgress`, `queueDepth`, and `errors`.

3. **Inspect logs** for `persist_error`, `escalated`, or `agent_dead` events.

## Weekly Maintenance

1. **Run memory integrity scan**:
   ```js
   await manager.runMemoryIntegrity();
   ```

2. **Run security audit**:
   ```bash
   npm run security-audit
   ```

3. **Run performance benchmark**:
   ```bash
   npm run benchmark:performance
   ```
   Confirm `meetsTargets.startup`, `missionPlanning`, and `taskDispatch` are `true`.

4. **Backup `data/`**:
   ```bash
   tar czf hydi-data-$(date +%Y%m%d-%H%M%S).tar.gz data/
   ```

5. **Review decision history** for low-confidence or rejected decisions:
   ```js
   const rejected = manager.decisionIntelligence.searchHistory({ outcome: 'rejected' });
   ```

## Monthly Maintenance

1. **Upgrade dependencies**:
   ```bash
   npm outdated
   npm update
   npm run lint
   npm run typecheck
   npm test
   ```

2. **Rotate credentials** if the `SecurityAuditor` flagged any findings.

3. **Archive completed missions** to keep `missions.json` small:
   ```js
   const completed = manager.missionPlanner.getMissions({ status: 'completed' });
   for (const m of completed) {
     manager.missionPlanner.archiveMission(m.id);
   }
   ```

4. **Review strategy rankings**:
   ```js
   const best = manager.reflectionEngine.getBestStrategy('revenue');
   const worst = manager.reflectionEngine.getWorstStrategy('revenue');
   ```

## Upgrade Procedure

1. Take a full backup of `data/` and the source tree.
2. Pull the new version and run `npm install`.
3. Run the full validation suite:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run test:integration
   npm run benchmark:performance
   npm run security-audit
   npm run test:soak
   ```
4. Stop the running HYDI process.
5. Apply any required environment variable changes.
6. Start the new version.
7. Verify `manager.getStatus()` and `manager.getDashboard()`.

## Backup and Restore

### Backup

Persist `data/` and any environment-specific `.env` files:

```bash
rsync -av --delete data/ /backup/hydi/data/
```

### Restore

1. Stop HYDI.
2. Replace `data/` with the backup.
3. Start HYDI.
4. Run `node scripts/production-readiness-score.js` to verify.

## Integrity Scans

`MemoryIntegrity.verify()` checks:

- `reflectiveMemory` Maps are correctly typed.
- No duplicate reflection, mission, agent, task, or conversation IDs.
- Timestamps are valid.
- Mission tasks are a `Map`.
- Tasks are not orphaned from missions.

Trigger manually:

```js
await manager.runMemoryIntegrity();
```

Or schedule a scan via `config.scanIntervalMs` (default 24 hours).

## Log Rotation

Rotate HYDI process logs with `logrotate` or a container logging driver. Keep at least 30 days of logs for incident analysis.
