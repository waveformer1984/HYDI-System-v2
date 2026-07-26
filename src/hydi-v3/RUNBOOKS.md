# HYDI V3 Runbooks

## 1. Start HYDI V3

Use the `HYDIAutonomyManager` entry point. For example:

```js
const HYDIAutonomyManager = require('./src/hydi-v3');

const manager = new HYDIAutonomyManager({
  coreLoop,
  config: {
    enableWatchdog: true,
    enableHeartbeat: true,
    enableMissionPlanning: true,
    enableDecisionIntelligence: true,
    enableReflection: true,
    enableSelfHealing: true,
    enableDistributedCompute: true,
    enableMemoryIntegrity: true,
    enableObservability: true,
    enableSecurity: true,
  }
});

await manager.start();
```

The V3 layer patches the core loop and begins watchdog, heartbeat, mission planning,
reflection, self-healing, and observability automatically.

## 2. Graceful Shutdown

Press `Ctrl+C` or send `SIGTERM`. `boot-agent.js` already catches these signals and
calls `HYDISystem.shutdown()`, which stops the autonomy layer and persists a checkpoint.
If running `HYDIAutonomyManager` standalone, `GracefulShutdown` can be enabled with
`config.enableGracefulShutdown: true`.

## 3. Check System Status

```js
const status = await hydiSystem.autonomyManager.getStatus();
console.log(JSON.stringify(status, null, 2));
```

Or inspect the dashboard:

```js
const dashboard = hydiSystem.autonomyManager.getDashboard();
```

## 4. Create and Run a Mission

```js
const missionId = await manager.createMission('revenue-push', 'Launch outreach campaign');
manager.missionPlanner.addObjective(missionId, { description: 'Build contact list' });
const taskA = manager.missionPlanner.addTask(missionId, { type: 'automation', description: 'Find leads' });
const taskB = manager.missionPlanner.addTask(missionId, { type: 'outreach', description: 'Send email', dependencies: [taskA] });
await manager.executeMission(missionId);
```

The core loop will pick up ready tasks automatically via `getPendingTasks()`.

## 5. Watchdog Alerts

Listen on `manager.watchdog`:

- `agent_healthy` — normal heartbeat
- `agent_warning` — one or two non-critical issues
- `agent_dead` — critical issue or multiple failures; `SelfHealingEngine` is triggered
- `agent_recovered` — restart succeeded
- `agent_restart_failed` — escalate manually

## 6. Self-Healing

`SelfHealingEngine` reacts automatically to `agent_dead` and `heartbeat_missing`.
To manually heal a symptom:

```js
const result = await manager.selfHealing.heal(
  { type: 'database_disconnect', target: 'supabase' },
  { reconnect_database: async () => ({ success: true }) }
);
```

If `maxAttempts` is exceeded, `SelfHealingEngine` emits `escalated`.

## 7. Security Audit

```bash
npm run security-audit
```

The audit scans `src/hydi-v3` and `src/HYDISystem.js` for secrets, keys, and
dangerous patterns. It also reports environment-variable coverage and database
permission policy checks.

## 8. Memory Integrity Scan

```js
const result = await manager.runMemoryIntegrity();
// result.passed, result.issues, result.repairs
```

A scheduled scan runs every 24 hours by default. It checks reflective memory,
mission memory, agent memory, task memory, and conversation memory.

## 9. Performance Benchmark

```bash
npm run benchmark:performance
```

Benchmarks must report `meetsTargets` as `true` for startup, mission planning,
and task dispatch.

## 10. Long-Running Stability Simulation

```bash
npm run test:soak
```

Runs the `TestingFramework` scenarios: 60 simulated iterations, crash recovery,
power-loss checkpoint, DB disconnect, network outage, queue corruption, mission
replay, reflection replay, distributed execution, and memory serialization. Exits
non-zero if any scenario fails.

## 11. Production Readiness Checklist

1. `npm run lint` passes
2. `npm run typecheck` passes
3. `npm test` passes
4. `npm run test:integration` passes
5. `npm run benchmark:performance` passes
6. `npm run security-audit` passes
7. `npm run test:soak` passes
8. All required environment variables are set
9. Supabase `system_dashboard` view is healthy
10. `boot-agent.js` preflight passes

## 12. Executive Operator Surface

Two interfaces onto the same executive stack. Both boot an `OperatorSession`
(BusinessMemory → ExecutiveOperatingSystem → TaskEngine → BusinessWorkflowEngine
→ ExecutionGateway → ExecutiveCockpit) and render through `BriefingRenderer`,
so they always report identical state.

### Readline CLI

```bash
npm run cockpit                                   # interactive prompt
npm run cockpit:brief                             # one briefing, then exit
node scripts/operator-cli.js --priority resonate  # set owner priority at boot
node scripts/operator-cli.js --once "focus" --no-colour
node scripts/operator-cli.js --data-path ./data   # override persistence dir
```

Commands: `good morning`, `status`, `focus`, `approvals`, `history`,
`workflows`, `approve <id>`, `reject <id>`, `priority <p>`, `help`, `exit`.

Valid priorities: `resonate`, `operations`, `manufacturing`, `music`,
`research`, `revenue`, `creative`, `default`.

### Local Dashboard

```bash
npm run dev
# open http://localhost:3000/api/cockpit
```

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/cockpit` | GET | HTML briefing with a command console |
| `/api/cockpit/briefing` | GET | `{ briefing, model, text }` for integrations |
| `/api/cockpit/command` | POST | `{ text }` — one cockpit command |

The routes are **loopback only**. Non-local requests, and any request carrying
`X-Forwarded-For` / `X-Real-IP` / `Forwarded`, receive `403`. Do not put the
cockpit behind a reverse proxy — the guard treats a proxy hop as non-local by
design, and the surface exposes unredacted business memory and approval
controls.

Both surfaces route approvals through `ExecutionGateway` unchanged. Neither
grants any authority the gateway would otherwise withhold.

### Verifying the surface

```bash
npm run cockpit:brief        # expect a 13-section briefing
node scripts/minitest.js tests/unit/hydi-v3/OperatorSession.test.js
```

`scripts/minitest.js` is a minimal Jest-compatible runner for environments where
Jest cannot run (e.g. over a slow network mount). `npm test` remains
authoritative.
