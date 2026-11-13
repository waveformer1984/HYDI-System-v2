# PHASE 1 — Minimal Heidi loop on Frank (revised scope)
Executed 2026-11-12 ~21:20–22:10 CT. HEIDI_ALLOW_EXEC stayed `false`.

## 0. Folded-in items from Phase 0.5 review — all addressed

### Boot path tested FIRST (not last)
`pm2 kill` (full daemon+fleet stop) → `scripts/hydi-boot-resurrect.ps1` →
**all 26 apps restored**, `pm2 ping` → pong, ports verified:
:3459 healthy/brain-connected, :3000 200, :3100 200, :11434 200, :54321 200.
Only heidi-mobile-chat down (pre-existing `HEIDI_MOBILE_TOKEN` gap).
Two fixes found by the test: census `jlist` timed out under load → retry via
Start-Job (committed to phase-0.5); **supabase_kong had OOM-died ~20:54**
(RAM crisis) leaving :54321 dead — restarted container, heidi-web's blocked
init recovered on its own once Kong returned (its "/api/health" was 000 for
~8 min while event loop was wedged on Supabase calls — noted as a real
cold-start dependency: Kong must be up BEFORE heidi-web or /heidi stalls).
An actual OS reboot remains untested — `\PM2Resurrect` runs the same script
at logon; risk now low but not zero.

### Watchdog reaps hung `pm2 update` (PM2 defect guard)
`scripts/watchdog.js`: `reapHungPm2Update()` runs every check cycle — finds
`node.exe` processes whose CommandLine matches `pm2 update` AND are older
than 10 min, kills them, logs `PM2-UPDATE-REAP`. A real update finishes in
seconds; anything older is a corpse from the empty-args-ping defect.
Verified live: `{"killed":0,"found":0}` post-cleanup. Deployed via
`pm2 restart hydi-watchdog`.

### Cognitive loop is the hook (no parallel timer)
Reflection and snapshots are inside `CognitiveCore.recordCycle` — the
existing governed writer of `cognitive_cycle` events inside `hydi-daemon`.
No new process, no new PM2 app, no parallel loop.

### Missions governance audit — clean
`heidi_missions` (11.5k rows): every row is `producer_key=mission_runner`
with observational capabilities only — `ops.agent_supervise` (8,072),
`ops.coo_state` (1,610), `ops.dev_investigate` (1,190), plus small counts of
world.sync / self_sufficiency / investigate / diagnostics.
**`authorized_by` is NULL on all 11,547 rows; `awaiting_approval_ref` NULL
on all.** These missions never execute real actions — they are the
supervision/diagnostic work queue. Action execution lives in the cognitive
cycle's authorizationResult (contract layer, advisory mode) — a different
path that does not flow through heidi_missions. The 99.9% success rate is
supervision churn, not gate bypass. No action-taking mission type exists
today; when Phase 2 adds proposed actions they must go through
`heidi_decision_bounds` + the triple gate, not this table's status field.

## 1. What was built

Branch `heidi-spine/phase-1`:

- **`supabase/migrations/20261113000000_heidi_state_snapshots.sql`** — new
  table (`id, cycle_id, captured_at, source, payload jsonb, created_at`),
  RLS enabled, service_role ALL + authenticated SELECT (mirrors
  heidi_reflections). **Applied to local Supabase** — table live, 0→N rows.
- **`lib/heidi/CognitiveCore.ts`** — inside the existing RECORD phase:
  - `recordSnapshot(state)` → INSERT into `heidi_state_snapshots` every
    completed cycle (compact payload: runtimeIdentity, health, components,
    capability, authorized/executed/outcome, errors, durationMs). 5s bound.
  - `maybeReflect(state)` → at most once per `HEIDI_REFLECT_INTERVAL_MS`
    (default 15 min), single-flight, **detached** so the 3B model's
    tens-of-seconds latency can't eat the 30s cycle budget.
  - `reflectOnce(state)` → reads last 5 snapshots, builds a bounded prompt,
    calls `POST $OLLAMA_URL/api/generate` with **`qwen2.5:3b`** (env
    `HEIDI_REFLECT_MODEL`), 120s abort, `num_predict:220`, writes a real row
    to **`heidi_reflections`** (theme, confidence, `evaluations` jsonb with
    model+text+cycleId). First cycle reflects immediately
    (`lastReflectionAt=0`).
  - `getSpineStatus()` → counts + timestamps for status surfaces.
- **`lib/heidi/DaemonStatusSurface.ts` + `scripts/heidi-daemon.ts`** —
  daemon status snapshot gains a `spine` block; `.heidi-daemon-status.json`
  now carries snapshot/reflection counts, last write times, model name.
  This is the /status JSON surface (consumed by `/api/status` readers).
- **`scripts/watchdog.js`** — pm2-update reaper (above).

## 2. Verified live

- `tsc --noEmit` clean.
- Deployed: `pm2 restart hydi-daemon` → loop running, cycles completing.
- **After ~5 min: `heidi_state_snapshots` = 3 rows, `heidi_reflections` = 2
  rows, `heidi_events` cognitive_cycle rows continuing.** All three tables
  have real rows — success criterion met ahead of the 10-minute mark.
- Reflection content is genuine qwen2.5:3b output referencing real evidence
  (it independently surfaced the recurring `missionProducer.produce
  exceeded 20000ms` error visible in snapshots).
- `.heidi-daemon-status.json` → `spine.snapshots:3, lastReflectionId:…,
  reflectionModel:"qwen2.5:3b"`.
- `pm2 kill`+resurrect boot-path proof (above) doubles as the reboot-survival
  mechanism: hydi-daemon is in dump.pm2, so PM2Resurrect restores it.

## 3. Honest caveats
- Cycles still hit the 30s timeout regularly under current RAM pressure
  (~0.7–1.5 GB free); timed-out cycles write the heartbeat row but skip
  snapshot/reflect (they never reach RECORD). Snapshots accrue on completed
  cycles only — currently ~1 per few minutes.
- hydi-daemon restarted once on its own post-deploy (restarts=8) — each boot
  reflects once immediately, which is why 2 reflection rows exist early.
  Self-healed via PM2.
- Reflection `was_correct=false` / `confidence=0.5` defaults — the table's
  calibration fields aren't meaningful for free-text reflections yet;
  `evaluations` jsonb carries the real content. Phase 2/3 can refine.
- heidi-mobile-chat still down (token). protoforge-core intermittent.

## Remaining for success criteria
- 10-minute table-row proof: effectively already shown (rows at ~5 min);
  will re-confirm counts at report time.
- True OS reboot: untested; `\PM2Resurrect` → hydi-boot-resurrect.ps1 path
  proven via pm2 kill equivalent.
