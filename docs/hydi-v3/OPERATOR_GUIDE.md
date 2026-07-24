# HYDI V3 Operator Guide

This guide covers daily operation, monitoring, alerts, and common procedures for HYDI V3 in production.

## Starting HYDI V3

If you use `boot-agent.js`, the V3 autonomy layer starts automatically when `HYDISystem.start()` is called:

```bash
node boot-agent.js
```

Standalone:

```js
const HYDIAutonomyManager = require('./src/hydi-v3');
const manager = new HYDIAutonomyManager({ coreLoop, config: { dataPath: './data' } });
await manager.start();
```

## Health and Status

```js
const status = manager.getStatus();
```

Key fields:

- `started` / `stopped`
- `uptime`
- `watchdog` — agent counts and per-agent issues
- `heartbeat` — total, healthy, degraded, failed, missing
- `missions` — active, completed, failed, paused
- `decisions` — total decisions, confidence summary
- `reflections` — total reflections, strategy rankings
- `selfHealing` — active attempts and escalations
- `distributed` — nodes, assignments
- `observability` — snapshot count
- `security` — last audit report

## Dashboard and Metrics

```js
const dashboard = manager.getDashboard();
```

Export Prometheus metrics:

```js
const prometheus = manager.observability.exportMetrics('prometheus');
```

Recommended Prometheus scrape targets:

| Metric | Description |
|--------|-------------|
| `hydi_agent_health` | Aggregate agent health score |
| `hydi_mission_progress` | Mission completion ratio |
| `hydi_revenue_total` | Revenue generated |
| `hydi_queue_depth` | Pending queue depth |
| `hydi_memory_usage` | Current memory usage |
| `hydi_errors_total` | Total errors |

## Monitoring Intervals

| Component | Interval | Timeout |
|-----------|----------|---------|
| Watchdog check | 30s | 90s |
| Heartbeat publish | 30s | 90s |
| Self-healing check | 30s | — |
| Memory integrity scan | 24h | — |
| Observability snapshot | 30s | — |

## Watchdog Alerts

Listen on `manager.watchdog`:

- `agent_healthy` — normal operation
- `agent_warning` — non-critical issues (CPU, memory, queue depth)
- `agent_dead` — critical issue; `SelfHealingEngine` is triggered automatically
- `agent_recovered` — restart succeeded
- `agent_restart_failed` — manual escalation required

## Heartbeat Alerts

Listen on `manager.heartbeat`:

- `heartbeat` — published heartbeat
- `heartbeat_missing` — service missed threshold; triggers self-healing
- `publish_failed` — provider threw during publication

## Common Procedures

### Graceful Shutdown

Send `SIGTERM` or `SIGINT`:

```bash
kill -TERM <pid>
```

If `enableGracefulShutdown` is `true`, `GracefulShutdown` flushes handlers and persists a checkpoint.

### Restart a Single Service

```js
await manager.watchdog.restartAgent('modelStack');
```

### Manually Trigger Self-Healing

```js
await manager.selfHealing.heal(
  { type: 'api_failure', target: 'stripe' },
  { retry_with_backoff: async () => ({ success: true }) }
);
```

### Pause / Resume a Mission

```js
manager.missionPlanner.pauseMission(missionId);
manager.missionPlanner.resumeMission(missionId);
```

### Cancel / Archive a Mission

```js
manager.missionPlanner.cancelMission(missionId);
manager.missionPlanner.archiveMission(missionId);
```

### Run a Memory Integrity Scan

```js
const result = await manager.runMemoryIntegrity();
console.log(result.passed, result.issues, result.repairs);
```

### Run a Security Audit

```bash
npm run security-audit
```

Or programmatically:

```js
const report = await manager.runSecurityAudit();
```

## Alert Runbooks

| Alert | Likely Cause | First Response |
|-------|--------------|----------------|
| `agent_dead: coreLoop` | Dead loop or uncaught exception | Check `coreLoop.metrics.loopsFailed`; restart with `manager.watchdog.restartAgent('coreLoop')` |
| `heartbeat_missing` | Service hung or crashed | Trigger self-healing; verify process health |
| `escalated` | Recovery exceeded `maxAttempts` | Inspect `manager.selfHealing.getStatus()`; engage on-call if financial path is affected |
| `persist_error` | Disk full or permissions | Free disk space; verify `data/` is writable |
| `low_confidence` decisions | Model drift or bad inputs | Review decision history; retrain or adjust thresholds |

## On-Call Checklist

1. Check `manager.getStatus()` and `manager.getDashboard()`.
2. Review recent `decisionIntelligence` history for rejections and failures.
3. Verify `data/` directory is writable and has free space.
4. Confirm required environment variables are set.
5. Run `npm run security-audit` and `node scripts/production-readiness-score.js`.
6. If a mission is stuck, inspect `missionPlanner.getMission(missionId)` and restart failed tasks.
