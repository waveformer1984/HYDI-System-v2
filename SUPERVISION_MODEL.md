# HYDI Supervision Model

## Purpose

This document answers three questions with evidence from the actual code:

1. What does each supervision actor watch for, and how often?
2. What happens today if two of them react to the same failure at the same time?
3. What is the recommended coherent model so there is exactly one decision-maker per failure type?

This exists because the project's original problem (Heidi "hanging" on boot) traced back to multiple uncoordinated things trying to manage the same processes. Phase 3/4 added a `RecoveryEngine` that can independently kill and restart processes. If it's wired up without checking how it relates to the existing PM2 `autorestart`, `boot-agent.js`, `preflight.js`, and `watchdog.js`, the project will recreate the exact class of bug it spent the last several sessions fixing.

---

## The Four Actors (Current State, With Evidence)

### 1. PM2 (`ecosystem.config.js`)

**What it watches:** The `hydi-boot` process only — which is `scripts/boot-agent.js`. PM2 does NOT watch `protoforge-core`, `heidi-web`, or `heidi-mobile-chat` directly. Those are child processes spawned by boot-agent.

**How often:** Continuous (PM2 event-driven, not polling).

**What it does on failure:** If `hydi-boot` exits, PM2 restarts it. Config: `autorestart: true`, `max_restarts: 10`, `restart_delay: 5000`, `min_uptime: 30s`.

**Evidence:** `ecosystem.config.js` lines 48-53:
```js
autorestart: true,
watch: false,
max_memory_restart: '1G',
min_uptime: '30s',
max_restarts: 10,
restart_delay: 5000,
```

**Scope:** Only the boot-agent process itself. PM2 is the safety net for "the orchestrator crashed."

### 2. `scripts/preflight.js` (Boot-Time Only)

**What it watches:** Port occupancy on all boot.config.json process ports. If a port is occupied but the health endpoint doesn't answer, it kills the occupying process.

**How often:** ONCE, at boot time, before boot-agent spawns anything.

**What it does on failure:** Kills zombie processes holding boot ports. Also checks Docker, Supabase CLI version, env vars, and live Stripe key guardrail.

**Evidence:** `scripts/preflight.js` lines 211-251 (`checkPorts` function):
```js
async function checkPorts() {
  section('Port & zombie-process check');
  for (const { port, healthUrl, label } of PORT_CHECKS) {
    const occupied = await canConnect(port);
    if (!occupied) { ok(`port ${port} free`); continue; }
    if (healthUrl) {
      const { ok: healthy } = await httpGet(healthUrl);
      if (healthy) { info(`port ${port} occupied by a healthy process`); continue; }
    }
    // Occupied but not healthy — kill it.
    const pids = findPidsOnPort(port);
    for (const { pid } of pids) { killPid(pid); }
  }
}
```

**Scope:** Boot-time only. Does not run continuously. No overlap with anything during normal operation.

### 3. `scripts/boot-agent.js` (Child Process Monitor + Shutdown)

**What it watches:** Child processes it spawned (protoforge-core, heidi-web, heidi-mobile-chat). Listens for `exit` events on each child.

**How often:** Event-driven (child exit event), not polling.

**What it does on failure:** If a REQUIRED child exits unexpectedly, boot-agent logs it, sets `failed = true`, and **shuts down the entire system** (all children). PM2 then restarts boot-agent, which runs preflight and re-spawns everything from scratch.

**Evidence:** `scripts/boot-agent.js` lines 225-235:
```js
child.on('exit', (code, signal) => {
  if (shuttingDown) return;
  child.exitedEarly = true;
  log(mod.id, `process exited unexpectedly (${how})`);
  if (mod.required) {
    failed = true;
    log(mod.id, 'required module down -> initiating shutdown');
    shutdown(1);
  }
});
```

**Scope:** All spawned children. Response to required child failure = full system restart via PM2. Does NOT restart individual children — it shuts down everything.

### 4. `scripts/watchdog.js` (Observe-Only)

**What it watches:** Health endpoints of all boot.config.json process modules.

**How often:** Every 2 minutes (configurable via `WATCHDOG_INTERVAL_MS`).

**What it does on failure:** Logs to `logs/watchdog.log` and optionally POSTs a webhook alert to `WATCHDOG_WEBHOOK_URL`. Does NOT restart anything. Does NOT kill anything. Observe-only.

**Evidence:** `scripts/watchdog.js` lines 134-151:
```js
async function runCheck() {
  const results = await Promise.all(ENDPOINTS.map(checkEndpoint));
  const failures = results.filter((r) => !r.ok);
  if (allOk) {
    log(`OK    all ${results.length} endpoints healthy`);
  } else {
    for (const f of failures) { log(`FAIL  ${f.name}  ${f.url}`); }
    sendWebhook(failures);
  }
}
```

**Scope:** Observe-only. No restart authority. No kill authority.

### 5. `RecoveryEngine` (Phase 3/4 — Manual Invocation Only)

**What it watches:** Health state of components, via `HealthProvenanceChecker`. Checks port + process identity + endpoint + dependency state + functional probes.

**How often:** On-demand only. Invoked via `npm run hydi:recover`. NOT wired to run continuously.

**What it does on failure:** Evaluates policy, checks risk level, checks authorization, checks budget/circuit breaker, acquires recovery lock, spawns a replacement process, verifies postconditions, records decision.

**Evidence:** `lib/operational/RecoveryEngine.ts` — `recover()` method. `scripts/hydi-recover.js` — CLI entry point. No cron, no setInterval, no PM2 process, no scheduled task. Manual only.

**Scope:** Individual components. Can restart `protoforge-core`, `heidi-web`, `heidi-mobile-chat` within policy bounds (R1, max 2 attempts, 30s cooldown, circuit breaker at 3 failures).

---

## Overlap Analysis: What Happens Today If Two React to the Same Failure

### Scenario: `protoforge-core` crashes (process exits)

| Actor | Reaction | Timing |
|-------|----------|--------|
| PM2 | No reaction — PM2 only watches boot-agent, not protoforge-core directly | N/A |
| boot-agent | Detects child exit → shuts down ALL children → exits with code 1 | Immediate (event-driven) |
| PM2 | Detects boot-agent exit → restarts boot-agent | After `restart_delay: 5000` (5s) |
| preflight | Runs as part of boot-agent restart → kills any remaining zombies on ports | During re-boot |
| watchdog | Logs failure to watchdog.log, sends webhook | Within 2 minutes (polling) |
| RecoveryEngine | No reaction — not running continuously | N/A |

**Result today:** No overlap. boot-agent handles it by full system restart. watchdog observes and logs. RecoveryEngine is not running. This is safe but heavy — a single protoforge-core crash restarts everything.

### Scenario: `protoforge-core` is unhealthy but still running (e.g., wrong process on port, or health endpoint failing)

| Actor | Reaction | Timing |
|-------|----------|--------|
| PM2 | No reaction — process hasn't exited | N/A |
| boot-agent | No reaction — child hasn't exited (only watches exit events, not health) | N/A |
| watchdog | Logs failure, sends webhook | Within 2 minutes |
| RecoveryEngine | No reaction — not running continuously | N/A |

**Result today:** Nobody restarts anything. watchdog logs it. This is the gap that RecoveryEngine is designed to fill — but only if explicitly wired to run continuously (which requires user approval).

### Scenario: IF RecoveryEngine were wired to run continuously AND protoforge-core crashes

| Actor | Reaction | Timing |
|-------|----------|--------|
| boot-agent | Detects child exit → shuts down ALL children → exits | Immediate |
| RecoveryEngine | Detects UNAVAILABLE → tries to restart protoforge-core | Within polling interval |
| PM2 | Detects boot-agent exit → restarts boot-agent | After 5s |

**THIS IS THE OVERLAP THE USER IDENTIFIED.** boot-agent would be shutting down everything (including killing heidi-web) while RecoveryEngine tries to restart just protoforge-core. They would fight over the same failure. boot-agent kills heidi-web, RecoveryEngine restarts protoforge-core, boot-agent's shutdown completes, PM2 restarts boot-agent, preflight kills the protoforge-core that RecoveryEngine just started, boot-agent re-spawns everything. This is the exact class of bug the project originally had.

---

## Recommended Model

The right shape is what the user suggested, confirmed by the code evidence:

```
┌─────────────────────────────────────────────────────────┐
│ PM2                                                      │
│ Watches: hydi-boot (boot-agent.js) only                  │
│ Reacts to: boot-agent process exit                       │
│ Action: restart boot-agent                               │
│ Safety net for: orchestrator crash                       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ boot-agent.js                                            │
│ Spawns: protoforge-core, heidi-web, heidi-mobile-chat   │
│ Watches: child exit events                               │
│ Reacts to: child process exit                            │
│ Action (DEFAULT): shut down all children → exit          │
│   → PM2 restarts boot-agent → full system re-boot        │
│ Action (DELEGATE_MODE): log exit, do NOT shut down       │
│   → RecoveryEngine handles individual restart            │
│ Controlled by: HYDI_DELEGATE_RECOVERY env var            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ watchdog.js                                              │
│ Watches: health endpoints (every 2 min)                  │
│ Reacts to: unhealthy endpoint (process alive but sick)   │
│ Action (DEFAULT): log + webhook alert                     │
│ Action (DELEGATE_MODE): call RecoveryEngine              │
│ Controlled by: HYDI_DELEGATE_RECOVERY env var            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ RecoveryEngine (Phase 3/4)                               │
│ Watches: nothing continuously (called by watchdog)       │
│ Reacts to: invocation from watchdog or manual CLI        │
│ Action: policy-governed restart of individual component   │
│ Bounds: R1, max 2 attempts, 30s cooldown, circuit breaker│
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ preflight.js                                             │
│ When: boot-time ONLY (before boot-agent spawns anything) │
│ Action: kill zombies on ports                            │
│ No overlap: runs once, before any other actor is active  │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **PM2 stays as the bottom-layer safety net.** It only watches boot-agent. If boot-agent itself crashes, PM2 restarts it. This is correct and should not change.

2. **boot-agent gets a `HYDI_DELEGATE_RECOVERY` flag.**
   - DEFAULT (flag not set): Current behavior. Required child exits → shut down everything → PM2 restarts. This is the safe default — no continuous RecoveryEngine, no overlap.
   - DELEGATE_MODE (flag set to `true`): Required child exits → log it, do NOT shut down. RecoveryEngine (called by watchdog) will handle the restart. This mode is ONLY safe when RecoveryEngine is actually running continuously.

3. **watchdog.js gets an optional RecoveryEngine integration.**
   - DEFAULT: Observe-only (current behavior). Log + webhook.
   - DELEGATE_MODE: When it detects an unhealthy endpoint, it calls RecoveryEngine to evaluate and potentially restart. This is the "unhealthy-but-still-running" case that boot-agent can't see (boot-agent only watches exit events, not health).

4. **RecoveryEngine never runs on its own timer.** It is always called by watchdog or by manual CLI invocation. It never polls independently. This prevents it from competing with boot-agent.

5. **preflight.js stays as-is.** Boot-time only. No overlap during normal operation.

### One Decision-Maker Per Failure Type

| Failure Type | DEFAULT Mode | DELEGATE_MODE |
|-------------|--------------|---------------|
| Process exits (crash) | boot-agent → full restart | boot-agent logs → watchdog → RecoveryEngine |
| Process alive but unhealthy | watchdog logs | watchdog → RecoveryEngine |
| Boot-agent itself crashes | PM2 restarts boot-agent | PM2 restarts boot-agent |
| Zombie on port at boot | preflight kills | preflight kills |

In DEFAULT mode, there is no overlap: boot-agent handles crashes, watchdog observes, RecoveryEngine is manual-only.

In DELEGATE_MODE, there is no overlap: boot-agent delegates to RecoveryEngine (doesn't shut down), watchdog calls RecoveryEngine for unhealthy-but-alive cases, PM2 handles boot-agent crashes only.

**Never can two actors act on the same failure simultaneously.**

---

## Implementation

The implementation adds the `HYDI_DELEGATE_RECOVERY` flag to boot-agent.js and watchdog.js. The flag defaults to OFF (current behavior). It must be explicitly set to `true` to enable RecoveryEngine delegation.

### Decision: CONTINUOUS SELF-RECOVERY ENABLED

**Date:** 2026-08-18  
**Decision:** `HYDI_DELEGATE_RECOVERY=true` — continuous governed self-recovery is enabled.

The flag is set in `ecosystem.config.js` for both `hydi-boot` and `hydi-watchdog` PM2 processes. The watchdog is configured as a second PM2 process (`hydi-watchdog`) that runs continuously and polls health endpoints every 2 minutes.

This means:
- **boot-agent** delegates to RecoveryEngine on required child exit (does NOT shut down)
- **watchdog** calls RecoveryEngine on unhealthy endpoints (every 2 minutes)
- **RecoveryEngine** restarts within policy bounds (R1, max 2 attempts, 30s cooldown, circuit breaker at 3 failures)
- **PM2** watches boot-agent and watchdog (restarts them if they crash)

To disable continuous self-recovery, set `HYDI_DELEGATE_RECOVERY=false` (or remove it) in `ecosystem.config.js` and restart PM2. The system reverts to the DEFAULT mode: boot-agent does full shutdown on required child exit, watchdog is observe-only.

### Safety Guarantees (verified by supervision-model.test.js)

1. **One decision-maker per failure type** — no two actors can act on the same failure simultaneously
2. **RecoveryEngine never self-schedules** — it is always called by watchdog or manual CLI
3. **RecoveryLock prevents concurrent recovery** — two recovery requests for the same component result in one execution
4. **Circuit breaker stops infinite loops** — 3 consecutive failures → ESCALATION_REQUIRED
5. **Policy governs every action** — R5 prohibited, R3/R4 human-required, R1 autonomous within bounds
6. **Confidence ≠ authorization** — high confidence does not authorize prohibited actions
