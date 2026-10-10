# PROTOFORGE OPERATIONAL CHAIN MAP

**Agent:** AGENT I (PROTOFORGE OPERATIONAL CHAIN) — CODE TRACK, read-only analysis.
**Date:** 2026-09-18. **Tree:** `C:\Users\Owner\HYDI-System-v2` (canonical, per CLAUDE.md).
**Method:** source + migration + test + PM2 process list + live log/audit-file inspection. No live actions taken.

---

## 0. Headline finding

The "HYDI → scheduler → ProtoForge → mission → Scout → persistence → opportunity → briefing → verification"
chain is **not one chain**. In the running system it is **three disjoint live chains plus one dead one**:

| Chain | What it is | Live? |
|---|---|---|
| **A — Scout mission chain** | PM2 `hydi-protoforge-scout` → mission runner → scouts → analyzer → `protoforge_opportunities` / `protoforge_mission_runs` → briefing → human approval → (nothing) | **OPERATIONAL** — daily persisted runs through 2026-09-18 |
| **B — Chat action gating** | `/api/chat` → `lib/orchestrator.ts` → `action-gate.ts` → real KILO → `auto-gate.js` → `policy-engine.js` → `decisions` table | **LIVE but OBSERVE-ONLY** — enforcement env off; decisions recorded, nothing blocked |
| **C — HEIDI cognitive daemon** | PM2 `hydi-daemon` → `heidi-daemon.ts` → `CognitiveCore` 15-phase loop + self-sufficiency interval | **OPERATIONAL** — 6,970 cognitive cycles / 7,374 ssf cycles as of today — but it does **not** drive Chain A or B |
| **D — protoforge-core `/process`** | `src/server.js` CASCADE V2 → *simulated* KILO → derived "protoforge state" label → `heidi_events` | **LIVE but KILO stage is SIMULATED** |
| **E — hydi-orchestrator / src/hydi-v3** | `src/HYDISystem.js` + `src/hydi-v3/*` | **DISABLED** — `boot.config.json:60` `"enabled": false` |

There is **no code path** connecting Chain C (daemon) to Chain A (missions): nothing in
`lib/heidi/*` imports `lib/missions/*`; the daemon's "missions" are revenue goals from
`GoalSystem.getActiveMissions()` (`CognitiveCore.ts:1481`), a different concept operating on
`revenue_prospects`/`revenue_opportunities` — **not** the ProtoForge scout tables.
Likewise Chain A **never invokes the ProtoForge policy engine** — "ProtoForge" in
`protoforge.daily_opportunity_scan` is product branding; its only gate is human `approval_status`.

---

## 1. Stage-by-stage classification

| # | Stage | Implementing file(s) | Status | Evidence | Gaps |
|---|-------|---------------------|--------|----------|------|
| 1 | HYDI cognitive loop / daemon | `scripts/heidi-daemon.ts` (main loop), `scripts/heidi-daemon-launcher.js` (PM2 IPC wrapper), `lib/heidi/CognitiveCore.ts` (15-phase `runCycle()`, line 1412), `lib/heidi/CognitiveCoreBuilder.ts` | **OPERATIONAL** | PM2 `hydi-daemon` (ecosystem.config.js:135-205); live process PID 22812 since 2026-09-13; `.heidi-daemon-audit.jsonl` live, 7,374 self-sufficiency + 6,970 cognitive cycles (last record 2026-09-18T19:54Z); single-instance lock `.heidi-daemon.lock` held | Loop state currently `cooldown`; capability health 2/7 READY — 4 BLOCKED (`commercial.stripe`, `commercial.email`), 2 POLICY_BLOCKED (`commercial.discovery_external`, `commercial.sms`); daemon does not feed Chain A/B |
| 2 | Scheduler | `scripts/protoforge-opportunity-scheduler.js` (`runCycle()` L145, spawn L119-138, `latestRunAt` L96-105), `scripts/mission-run-lock.js` | **OPERATIONAL** | PM2 `hydi-protoforge-scout` (ecosystem.config.js:255-282); `logs/pm2-protoforge-scout.out.log` + `logs/protoforge-opportunity-scheduler.log` show daily `PERSISTED` cycles 09-11 → 09-18; cadence 86,400s (PROTOFORGE_SCOUT_INTERVAL_MS, L72); spawns mission child with 60s timeout, verifies `protoforge_mission_runs.run_at` advanced (L180-191); `MissionRunLock` prevents overlap; tests: `tests/unit/protoforge-opportunity-scheduler.test.js`, `protoforge-mission-run-lock.test.js` | One observed timeout kill (09-13T00:30Z — mission exceeded 60s); scheduler only schedules this ONE mission |
| 3 | ProtoForge policy engine | `lib/protoforge/policy-engine.js` (DSL eval L59-73, `evaluate` L115, `recordDecision` L136, `recordOutcome` L166, Supabase Realtime hot-reload L218), `lib/protoforge/auto-gate.js`, `lib/protoforge/action-gate.ts`, stores in `lib/protoforge/stores/` | **IMPLEMENTED + TESTED; LIVE in observe-only mode** | Tables `policies` + `decisions` exist (migrations 20260528000002/3); real **active** policy `action-type-tiered-v1` promoted (migration 20260714150000, `is_active=true`); invoked per chat action via `lib/orchestrator.ts:1117` (`executeActions` → `gateActions`); tests: `protoforge-policy-engine.test.js`, `protoforge-auto-gate.test.js`, `protoforge-action-gate.test.ts`, `protoforge-policy-local.test.js` | `PROTOFORGE_ENFORCE_ACTIONS` unset → **nothing is ever blocked** (action-gate.ts:57-59); hypothesis inputs are degenerate — `confidence=0, risk=1, revenue_impact=0` for every action (action-gate.ts:116-117,122) because no CASCADE state snapshot exists → KILO truth gate always `verified:false`; only `action_type` differentiates; Chain A never calls this engine |
| 4 | KILO (hypothesis generator) | `kilo/index.js` (`generateHypotheses` L74, `execute()` throws L179), `kilo/modules/truth-filter-gate.js`, `repair-manifest-validator.js` | **IMPLEMENTED + TESTED; partially OPERATIONAL** | Real calls: `lib/protoforge/action-gate.ts:89,105` (every chat action) and `lib/protoforge/replay-engine.ts:303-306`; tests: `tests/unit/kilo-engine.test.js` | In protoforge-core (`src/server.js:478-495`) the KILO stage is **simulated** — `issue_type:'SIMULATED_ISSUE'`, confidence×0.9, comment "we'll simulate this based on certain conditions"; truth-filter gate has no CASCADE snapshot so confidence is always 0 |
| 5 | Mission runner | `scripts/missions/protoforge-daily-opportunity-scan.js` (`discover` L46, `runMission` L72-155) | **OPERATIONAL** | Exits 0 and persists daily (scheduler log); `--json` mode consumed by scheduler; hermetic tests `tests/unit/protoforge-mission-runner.test.js`; also triggerable via `POST /api/missions/protoforge-opportunities {action:'trigger'}` (api/missions/protoforge-opportunities.js:52-54) | Exactly one mission ID (`protoforge.daily_opportunity_scan`) exists; mission is invoked only by its own scheduler and the API trigger — not by the daemon |
| 6 | Scout — HN Algolia | `lib/missions/scouts/hn-algolia-scout.js` | **OPERATIONAL** | Real `fetch()` GET to `hn.algolia.com/api/v1/search_by_date` (L20-27), 10s timeout, honest UA; all 61 baseline opportunities are `hn_algolia` (docs/mission-reviews/2026-09-11-review.json `q4_sourceQuality`); tests: `protoforge-scouts.test.js` | Read-only by design (R0) |
| 7 | Scout — Reddit public | `lib/missions/scouts/reddit-scout.js` | **IMPLEMENTED + TESTED; BLOCKED at runtime** | Real code + tests; `SOURCES.reddit_public.enabled` defaults false (config.js:44-54) — verified 2026-09-10 that this machine's egress IP gets HTTP 403 from Reddit regardless of UA | Effectively dead source until run from unblocked egress or `PROTOFORGE_SCOUT_REDDIT_ENABLED=true` from a different network |
| 8 | Persistence (discoveries) | `lib/missions/opportunity-store.js` (`upsertOpportunity` L28, `listOpportunities` L64, `recordMissionRun` L107) → Supabase tables `protoforge_opportunities`, `protoforge_mission_runs` | **OPERATIONAL** | Migration `supabase/migrations/20260916000000_protoforge_opportunities.sql` (both tables, RLS, dedup UNIQUE); migration test `tests/migrations/20260916000000.test.js`; store tests `protoforge-opportunity-store.test.js`; DB rows verified daily by scheduler read-back and by the 2026-09-11 baseline (61 genuine rows) | None material |
| 9 | Opportunity creation (discovery → record) | `lib/missions/opportunity-analyzer.js` (`analyzeItem` L70, `dedupHash` L53, `classify` L58) | **OPERATIONAL** | Deterministic formula (NOT LLM): relevance×0.5 + engagement×0.3 + recency×0.2 (L75); per-record `scoring_detail` persisted; thresholds `HIGH_CONFIDENCE=70`, `REJECT_BELOW=25` (config.js:69-70); dedup via sha256 of normalized source URL; tests: `protoforge-opportunity-analyzer.test.js` | Quality gap measured in baseline: 0/61 high_confidence, avg recency 12.8/100, `required_action` is one of 2 template strings (`q7_actionability.isTemplated: true`), `estimated_value` hardcoded 'unknown'; only product `rezonate` configured (config.js:13-37) |
| 10 | Briefing | `lib/missions/briefing.js` (`buildBriefing` L30) | **OPERATIONAL** | Real formatter — emits `PROTOFORGE DAILY BRIEF` from persisted rows only (never invented data); stored on `protoforge_mission_runs.briefing_text`; served via `GET /api/missions/protoforge-opportunities?format=briefing` and chat (`api/chat/route.js:252-263`); tests: `protoforge-briefing.test.js` | No delivery/push — a human must ask for it (API/chat); nothing consumes it automatically |
| 11 | Human approval | `lib/missions/approval.js` (`approveOpportunity`/`rejectOpportunity` → `setApproval`), API `POST /api/missions/protoforge-opportunities` (service-token guarded, `lib/auth/verifyServiceToken.js`) | **IMPLEMENTED + TESTED; no evidence of real use** | Only code path allowed to move `approval_status` off `pending`; boundary test `protoforge-approval-boundary.test.js`; baseline shows all 61 opportunities `pending` | Nothing approves programmatically (by design); no evidence a human has approved anything yet |
| 12 | Execution (act on approved opportunity) | `lib/missions/approval.js` `executeApprovedOpportunity` (L43-55) | **MISSING — deliberate** | Throws `NOT_IMPLEMENTED` unconditionally; mission header documents R2+ boundary (no external contact, no spend) | **This is where the chain ends** — an approved opportunity authorizes nothing; no downstream consumer exists |
| 13 | Verification | (a) scheduler `latestRunAt` read-back (protoforge-opportunity-scheduler.js:180-191); (b) `protoforge_mission_runs` row per run incl. failures (opportunity-store.js:107); (c) offline review `scripts/missions/protoforge-opportunity-review.js` (10-question effectiveness metrics, baselines in `docs/mission-reviews/`); (d) cognitive loop `verifyAction` phase (CognitiveCore.ts:1571-1579); (e) `recordOutcome` decision backfill (orchestrator.ts:1186, policy-engine.js:166) | **PARTIAL — run-level verification OPERATIONAL; outcome-level MISSING** | Scheduler proved persistence every day since 09-11; review baseline exists (2026-09-11); daemon verify phase runs per action | A "successful" mission means "≥1 source returned data and the run row landed" — it does **not** verify any opportunity is real/actionable, that the briefing was read, or that anything resulted; no verification that an approved opportunity produced an outcome (there is no execution to verify); decision `outcome` backfill only fires on the chat path |
| 14 | Orchestrator (chat path gating) | `lib/orchestrator.ts` (`executeActions` L1113-1205, `recordActionOutcome` L1212) | **OPERATIONAL (observe-only)** | Runs inside live `heidi-web` (next dev, port 3000); every chat action gets a real KILO hypothesis + real ProtoForge `decisions` row + `actions` row carrying gate metadata | With enforcement off, verdicts are advisory; escalations park as `pending` `actions` rows only when enforcing |
| 15 | protoforge-core pipeline (`/process`) | `src/server.js` (CASCADE V2 `modules/cascade-complete-v2`; KILO block L476-495; protoforge state L497-506), `src/health/protoforge-health.js` | **LIVE but PARTIALLY SIMULATED** | Port 3005 process live (PID 27392 since 09-16); CASCADE + `heidi_events` persistence real; health endpoint reports observed values only | KILO simulated (`SIMULATED_ISSUE`); "Protoforge state" is a derived label — the real policy engine is **not** invoked here; `/process` pipeline does not produce `decisions` rows |
| 16 | hydi-orchestrator / src/hydi-v3 | `src/HYDISystem.js`, `src/hydi-v3/*` (~200 modules), `src/orchestrator/HeidiOrchestrator.js` | **DISABLED (implemented, heavily tested)** | `boot.config.json:57-68` `"enabled": false`, `config.enableAutoActions:false`; extensive `tests/unit/hydi-v3/` suite exists | Not in any live path; nothing currently drives missions from it |

---

## 2. End-to-end chain diagram — where it breaks

```
                        ┌─────────────────────────── LIVE ───────────────────────────┐

 PM2 hydi-daemon (C) ──► CognitiveCore 15-phase loop ──► verify/learn/record ──► audit
   scripts/heidi-daemon.ts      (self-sufficiency: capability health, self-repair,
    PID 22812, 60s interval      credential acquisition) ── 4 caps BLOCKED, 2 POLICY_BLOCKED
        │
        ╳  NO LINK to the mission chain (no import of lib/missions anywhere in lib/heidi)


 PM2 hydi-protoforge-scout (A) ──► scripts/protoforge-opportunity-scheduler.js
   (24h cadence, MissionRunLock, spawn child, verify run_at advanced)
        │
        ▼
   scripts/missions/protoforge-daily-opportunity-scan.js
        │ discover(): PRODUCTS.rezonate.searchTerms × SOURCES
        ├──► hn-algolia-scout.js ── REAL HTTPS GET hn.algolia.com ── ✅ WORKS
        └──► reddit-scout.js ── REAL code ── ⛔ DISABLED (IP-level 403 from this egress)
        │
        ▼ analyze(): opportunity-analyzer.js (deterministic score, NOT LLM)
        ▼ persist:  upsertOpportunity → Supabase protoforge_opportunities (dedup sha256)
        ▼ record:   recordMissionRun  → Supabase protoforge_mission_runs (status/counts/briefing)
        ▼ briefing: buildBriefing → text on the run row; served via API + chat
        ▼ approval: POST /api/missions/protoforge-opportunities {approve|reject} ── human only
        ▼ execute:  executeApprovedOpportunity() ──► ⛔ NOT_IMPLEMENTED — CHAIN TERMINATES HERE
        verify:     scheduler read-back ✅ / mission_runs row ✅ / offline review tool ✅
                    opportunity-outcome verification ──► ⛔ MISSING (nothing to verify against)


 /api/chat (B) ──► lib/orchestrator.ts executeActions ──► action-gate.ts
        ├──► kilo/index.js generateHypotheses ── REAL, but gate_result always
        │    verified:false (no CASCADE snapshot) → confidence=0, risk=1
        ├──► auto-gate.js ──► policy-engine.js ──► active policy action-type-tiered-v1
        │    → decisions row recorded (audit) ── REAL writes
        └──► enforcement: PROTOFORGE_ENFORCE_ACTIONS unset ──► ⛔ verdicts advisory only


 PM2 hydi-boot (D) ──► src/server.js :3005 /process
        ├──► CASCADE V2 (modules/cascade-complete-v2) ── REAL
        ├──► KILO ──► ⛔ SIMULATED ('SIMULATED_ISSUE', server.js:487-491)
        └──► "protoforge state" label → heidi_events ── NOT the policy engine


 boot.config.json ──► hydi-orchestrator (E) enabled:false ──► ⛔ DEAD (src/hydi-v3 unused live)
```

---

## 3. REAL vs placeholder/simulated — explicit list

**REAL (code does what it claims, with live evidence):**
- Scheduler cadence + persistence proof: daily `PERSISTED` lines through 2026-09-18 (`logs/protoforge-opportunity-scheduler.log`).
- HN Algolia scout: real outbound HTTPS GET; produced 61 real rows (baseline `docs/mission-reviews/`).
- Analyzer: real deterministic scoring with per-record `scoring_detail`.
- Persistence: real Supabase tables + rows, dedup enforced.
- Briefing: real text built from persisted rows only; stored on the run row; served via API/chat.
- Daemon: real 15-phase cognitive loop + self-sufficiency cycles, live audit file.
- Policy engine: real DSL evaluation, real `decisions` inserts, real active policy (`action-type-tiered-v1`), Realtime hot-reload.
- KILO `generateHypotheses`: real, and `execute()` really throws.

**PARTIAL / DEGRADED:**
- Policy gating: real decisions but **observe-only** (enforcement off); inputs degenerate (confidence 0 / risk 1 / revenue_impact 0) because no CASCADE snapshot feeds the truth-filter gate.
- Reddit scout: real code, dead source (403 IP block) — disabled by config.
- protoforge-core `/process`: CASCADE real; **KILO simulated**; "protoforge" verdict is a label, not the policy engine.
- Mission "verification": real at the *run* level (persistence proof + per-source ok/error + offline review); absent at the *opportunity outcome* level.
- `required_action` strings: templated (2 distinct strings across 61 rows); `estimated_value` always 'unknown' (deliberately not fabricated).

**MISSING:**
- Execution stage (`executeApprovedOpportunity` — deliberate `NOT_IMPLEMENTED`, R2+ boundary).
- Any link from discovered opportunities → KILO/ProtoForge policy decisions (the two never meet).
- Any consumer of an approved opportunity.
- hydi-orchestrator path (disabled).
- Second product (only Rezonate has search terms).
- No scheduled run of `protoforge-opportunity-review.js` (manual only; one baseline exists).

---

## 4. Live process ownership (verified 2026-09-18)

| PM2 app | Process | Evidence |
|---|---|---|
| `hydi-daemon` | launcher PID 22192 → tsx child PID 22812 (`heidi-daemon.ts --no-stabilization`, since 09-13) | `.heidi-daemon.lock` pid 22812; audit file live |
| `hydi-protoforge-scout` | PM2 fork (one of the ProcessContainerFork pids started 09-13 11:16) | `pm2-protoforge-scout.out.log` written today 11:17 local; `PERSISTED` lines |
| `hydi-boot` → `protoforge-core` | `node src/server.js` PID 27392 (since 09-16) | port 3005 |
| `hydi-boot` → `heidi-web` | `next dev` PID 9804/29100, port 3000 | live |
| `hydi-boot` → `job-executor-poller` | tsx poller PIDs 1644/14044/10672 | live |
| `hydi-boot` → `heidi-mobile-chat` | `launch-heidi-mobile.js` PID 31248 | live |
| `hydi-watchdog` | watchdog fork; `--once` invocation observed PID 29540 | live |
| `hydi-system-health`, `hydi-stuck-job-scheduler`, `hydi-revenue-reconciliation`, `hydi-failed-webhook-retry` | PM2 forks (remaining ProcessContainerFork pids 22252/22292/22320/22352/22392/21812/4832) | PM2 Daemon.js PID 20836 supervising 8 forks total |

Note: `pm2 list` hangs on this machine at time of inspection (PM2 God RPC unresponsive; several `pm2 restart heidi-web` and `hydi-recover.js --governed` processes were in flight — recovery activity by another process, not this agent). Fork→app mapping above is inferred from start times + per-app log files.

---

## 5. Break points (weakest links, ordered)

1. **Execution stage is absent by design** — the chain terminates at "recommendation pending human approval." Approving changes a column; nothing downstream exists.
2. **Mission chain bypasses the policy engine** — the mission never produces a KILO hypothesis or a `decisions` row; "ProtoForge" here is branding, so the policy layer and the mission layer cannot verify or gate each other.
3. **protoforge-core simulates KILO** (`src/server.js:487-491`) — the running pipeline's KILO telemetry is synthetic.
4. **Degenerate gating inputs** — no CASCADE snapshot → every chat action gates with confidence 0 / risk 1; only `action_type` is real signal (acknowledged in action-gate.ts comments).
5. **Enforcement off** — even correct verdicts block nothing today.
6. **Reddit source dead** (403 IP block) — halves source diversity; all signal is HN.
7. **Single product, templated actions, no high-confidence items** — measured in the 09-11 baseline (0/61 high_confidence, avg recency 12.8/100).
8. **Daemon ↔ mission disconnect** — the cognitive loop cannot see, schedule, or act on mission output; the only bridge is a human reading the briefing via chat/API.

---

## 6. LIVE_ACTION_REQUIRED items (none performed — read-only track)

- **None required to keep current state running.** All live chains are self-sustaining under PM2.
- To move a stage from its current status:
  - *Enforce gating:* set `PROTOFORGE_ENFORCE_ACTIONS=true` on `heidi-web` env (env change + restart → LIVE ACTION).
  - *Reddit scout:* requires running from unblocked egress or a proxy; flipping `PROTOFORGE_SCOUT_REDDIT_ENABLED` alone won't help (403 is IP-level).
  - *Execution stage:* new code — `executeApprovedOpportunity` must be implemented behind an explicit policy decision; currently intentionally a loud throw.
  - *hydi-orchestrator:* `boot.config.json` `enabled:false → true` is a boot-config change + restart (and `enableAutoActions` is also false in its module config).
  - *Daemon ↔ mission link:* no code exists; wiring one is new work, not a config flip.

---

## 7. Source-of-truth file index

- Scheduler: `scripts/protoforge-opportunity-scheduler.js`, `scripts/mission-run-lock.js`
- Mission: `scripts/missions/protoforge-daily-opportunity-scan.js`, `scripts/missions/protoforge-opportunity-review.js`
- Mission lib: `lib/missions/{config,opportunity-analyzer,opportunity-store,briefing,approval}.js`, `lib/missions/scouts/{hn-algolia-scout,reddit-scout}.js`, `lib/missions/README.md`
- Policy chain: `lib/protoforge/{policy-engine.js,auto-gate.js,action-gate.ts,dispatcher.ts,raw-ledger.ts,replay-engine.ts}`, `lib/protoforge/stores/{local-policy-store,supabase-policy-store}.js`
- KILO: `kilo/index.js`, `kilo/modules/{repair-manifest-validator,truth-filter-gate}.js`
- Orchestrator (chat): `lib/orchestrator.ts` (executeActions L1113-1205)
- Daemon: `scripts/heidi-daemon.ts`, `scripts/heidi-daemon-launcher.js`, `lib/heidi/CognitiveCore.ts` (runCycle L1412, verify L1571)
- Boot/PM2: `boot.config.json`, `scripts/boot-agent.js`, `ecosystem.config.js`
- protoforge-core: `src/server.js` (/process L440-543, simulated KILO L476-495), `src/health/protoforge-health.js`
- API: `api/missions/protoforge-opportunities.js`, `api/chat/route.js` (brief L252-263)
- DB: `supabase/migrations/20260916000000_protoforge_opportunities.sql`, `20260528000002_policies_table.sql`, `20260528000003_decisions_table.sql`, `20260714150000_promote_action_type_policy.sql`, `20260714120000_raw_event_ledger_table.sql`, `supabase/functions/protoforge-calibration/`
- Evidence: `logs/protoforge-opportunity-scheduler.log`, `logs/pm2-protoforge-scout.out.log`, `.heidi-daemon-audit.jsonl`, `docs/mission-reviews/{2026-09-11-*.json,README.md}`
- Tests: `tests/unit/protoforge-*.test.{js,ts}` (14 files), `tests/migrations/20260916000000.test.js`, `tests/unit/kilo-engine.test.js`, `tests/unit/replay-engine.test.ts`
