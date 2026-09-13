# HEIDI STATE OF THE SYSTEM

**Generated:** 2026-08-21T14:25:00Z  
**Branch:** `feat/governed-autonomy`  
**HEAD:** `0d15f4f` (fix(demo): correct field name in blocker resolution filter)

---

## 1. Full Commit List for This Session

Each commit: what it fixed, how it was verified. "Live test" = ran against real services/persistence. "Unit test only" = Jest only. "Self-reported" = code change with no independent verification.

| Commit | Date | What it fixed | How verified |
|--------|------|---------------|--------------|
| `0d15f4f` | 2026-08-21 | Demo script read `report.status` (nonexistent field) instead of `report.state`, causing Phase 6 to report "0 blockers" despite 4 blocked capabilities | **Unit test** (6 new regression tests) + **live test** (demo rerun confirmed 4 blockers) |
| `8d12b3a` | 2026-08-21 | Commercial bridges passed raw Postgres rows (snake_case) to OutreachDraftGenerator expecting camelCase — caused "Hi undefined team," | **Live test** (real cognitive cycle produced correct draft "Hi Mike Reynolds,") + **unit test** (10/10 qualification tests) |
| `4f2ce87` | 2026-08-20 | Self-repair oscillation: two capabilities perturb each other, each cycle does 1 repair but system never converges | **Unit test** (oscillation test in `heidi-self-repair-oscillation.test.ts`) |
| `da5a526` | 2026-08-20 | Docs: synced `ecosystem.config.js` comment with measured IPC numbers | **Self-reported** (documentation only) |
| `95d083b` | 2026-08-20 | Daemon `kill_timeout` too low (45s) based on measured IPC delay distribution | **Live test** (daemon shutdown measured, 50s set) |
| `c8d821f` | 2026-08-20 | Shutdown timing budget incorrect; PM2 `--no-stabilization` flag missing | **Live test** (daemon restart cycle) |
| `8dd59c6` | 2026-08-20 | `kill_timeout` 45s insufficient for Windows IPC delivery delay | **Live test** (daemon shutdown) |
| `9c62991` | 2026-08-20 | Graceful shutdown via signal relay fails on Windows (no SIGTERM) — switched to IPC | **Live test** (daemon shutdown on Windows) |
| `d99d816` | 2026-08-20 | PM2 launcher didn't resolve `process.cwd()` correctly; `/api/status` path broke | **Live test** (PM2 + `/api/status` verified) |
| `36decee` | 2026-08-20 | Daemon didn't wait for in-flight work on shutdown; history unbounded; lock non-atomic | **Live test** (daemon shutdown + history cap) |
| `9f2827d` | 2026-08-20 | Daemon status not exposed through HTTP | **Live test** (`/api/status` endpoint verified working) |
| `0b8eb2b` | 2026-08-20 | No continuous cognitive-loop daemon with self-sufficiency | **Live test** (daemon running 600+ cycles) |
| `2381c23` | 2026-08-20 | `getCognitiveCore()` production path missing `dbConfig` — database probe and repair handler not registered | **Live test** (daemon capability health showed database READY) |
| `bcdec0e` | 2026-08-20 | Docs: self-sufficiency production qualification report | **Self-reported** (documentation) |
| `4c237de` | 2026-08-20 | Production smoke test — real CognitiveCore, no mocks | **Unit test** (smoke test) |
| `6fc6a8f` | 2026-08-20 | Production qualification tests (no mocks) | **Unit test** (qualification suite) |
| `257c54a` | 2026-08-20 | Governed self-repair not wired into CognitiveCore production | **Live test** (daemon self-repair cycles) |
| `397e21e` | 2026-08-20 | Docs: self-sufficiency qualification report | **Self-reported** (documentation) |
| `7f0490d` | 2026-08-20 | New: CapabilityHealthManager, BlockerResolutionEngine, SelfRepairEngine | **Unit test** + **live test** (daemon uses them) |
| `bf3afae` | 2026-08-20 | Docs: real revenue qualification report | **Self-reported** (documentation) |
| `a745a46` | 2026-08-20 | Real campaign execution + 21 e2e qualification tests | **Unit test** (21 tests) |
| `ea429a0` | 2026-08-20 | Docs: commercial autonomy qualification report | **Self-reported** (documentation) |
| `8571c32` | 2026-08-20 | 21 campaign loop qualification tests with unique fixtures | **Unit test** (21 tests) |
| `96a399d` | 2026-08-20 | Unified commercial execution through CognitiveCore + campaign loop manager | **Unit test** + **live test** |
| `8dcf7f6` | 2026-08-20 | Chore: commit base revenue and communication infrastructure | **Self-reported** (infrastructure commit) |
| `a9ca883` | 2026-08-19 | Prospect-to-payment commercial workflow with discovery, outreach, authorization | **Unit test** (21 tests) |
| `b5a7481` | 2026-08-19 | Bounded autonomous revenue campaign with 11 qualification tests | **Unit test** (11 tests) |
| `a4b6ddb` | 2026-08-19 | Endurance test script for bounded continuous loop | **Self-reported** (script, not run to completion) |
| `7f5295c` | 2026-08-19 | Bounded continuous autonomous loop with state machine, kill switch, cooldown | **Unit test** (14 tests) |
| `4f6b3be` | 2026-08-19 | CognitiveCore live in production with real adapters | **Live test** (cognitive cycle ran) |
| `050340d` | 2026-08-19 | Live qualification tests for governed execution bridge | **Unit test** (qualification tests) |
| `535ad71` | 2026-08-19 | Wire real execution bridge with adapters, builder, revenue capabilities | **Live test** (cognitive cycle) |
| `da3d6e1` | 2026-08-19 | Governed execution bridge with capability registry, verification, memory | **Unit test** |
| `93682fc` | 2026-08-19 | Unified HEIDI identity, hierarchical goals, world model, trust model, guardian | **Unit test** |
| `4a90f5e` | 2026-08-19 | Recovery-intelligence: dependency check ordering, durable budget, doctor logic | **Unit test** |
| `657c984` | 2026-08-19 | Recovery failure classification, bounded retry, structured escalation | **Unit test** |
| `e93dab9` | 2026-08-19 | Governed multi-layer autonomous container recovery | **Unit test** |
| `bd7767d` | 2026-08-19 | Observation confidence, corroboration, anti-flap hysteresis | **Unit test** |
| `11ab77f` | 2026-08-19 | Windows: `windowsHide:true` on all child process spawns | **Live test** (no console window popups) |
| `9119bb0` | 2026-08-19 | Operational evolution — bounded, observable, evidence-driven | **Unit test** |
| `2ef50a0` | 2026-08-18 | Wire ActionRegistry, fix dead code, eliminate qualification false positives | **Unit test** |
| `195c5b5` | 2026-08-18 | Docs: Phase 5 final acceptance report | **Self-reported** (documentation) |
| `95aa2d8` | 2026-08-18 | Phase 5 local-first qualification + failure injector fix | **Unit test** |
| `643b256` | 2026-08-18 | Phase 5 autonomous runtime fabric — action registry, self-health, failure injection | **Unit test** |
| `430e010` | 2026-08-18 | Supervision: optional components skip RecoveryEngine, timeout increase | **Unit test** |
| `c5a5e56` | 2026-08-18 | Enable continuous governed self-recovery — `HYDI_DELEGATE_RECOVERY=true` | **Unit test** |
| `4fa186e` | 2026-08-18 | Resolve supervision overlap — `HYDI_DELEGATE_RECOVERY` flag | **Unit test** |
| `81371ea` | 2026-08-18 | Docs: Phase 4 governed autonomy report | **Self-reported** (documentation) |
| `018103f` | 2026-08-18 | Phase 4 governed autonomy tests — 4 suites, 66 tests | **Unit test** (66 tests) |
| `9846382` | 2026-08-18 | Phase 4 — decision records, escalation, operator view | **Unit test** |
| `1195508` | 2026-08-18 | Phase 4 — action selector, recovery budget, concurrency lock | **Unit test** |
| `1a3f2ab` | 2026-08-18 | Phase 4 — state machine, risk classifier, autonomy policy model | **Unit test** |
| `0d25eac` | 2026-08-18 | Phase 3 operational tests — 6 suites, 51 tests | **Unit test** (51 tests) |
| `63281eb` | 2026-08-18 | Phase 3 — operational intelligence & self-recovery framework | **Unit test** |

**Summary:** 57 commits. ~15 verified with live tests against real services. ~35 verified with unit tests only. ~7 are documentation/self-reported.

---

## 2. Bugs Found and Explicitly NOT Fixed

### Bug 1: `commercial.create_opportunity` bridge — `this.pipeline.getProspect is not a function`

**Status: FIXED** (commit `8d12b3a`)

**Was:** `CommercialWorkflow.createOpportunityForProspect()` called `this.pipeline.getProspect()`, but the bridge wrapper passed to `CommercialWorkflow` didn't expose `getProspect()`.

**Now:** `ExecutionBridgeAdapters.ts:238-240` adds `getProspect()` and `getOpportunity()` to the bridge wrapper. Verified live: `createOpportunityForProspect('prospect_1787277545537_d36tyf', 'ai_operations_setup')` returned a valid opportunity (`opp_1787322142193_5yiffv`).

**Risk if unfixed:** None — it's fixed.

---

### Bug 2: Verification column mismatch — `SELECT id FROM revenue_opportunities WHERE id = $1`

**Status: STILL PRESENT**  
**Location:** `lib/heidi/CognitiveCore.ts:1909`

**What:** The verifier for `revenue.create_opportunity` queries `SELECT id FROM revenue_opportunities WHERE id = $1`, but the table uses `opportunity_id`, not `id`. Verified against live schema:

```
revenue_opportunities columns:
  opportunity_id  ← primary key
  prospect_id
  offer_id
  status
  proposed_price
  ...
```

There is no `id` column. The query will throw `column "id" does not exist`, caught by the `catch` block at line 1919, returning `verified: false` with `verificationStrategy` evidence.

**Is it on a production path?** **YES.** `revenue.create_opportunity` is a registered capability (`CapabilityRegistry.ts:722`). The cognitive-cycle runner selects it when no opportunity exists for a prospect (`scripts/run-real-cognitive-cycle.ts:108`). The daemon's `CognitiveCore` has it wired (`CognitiveCore.ts:541`). If the cognitive core ever selects `revenue.create_opportunity` (e.g., for a new prospect without an existing opportunity), the execution will succeed but verification will fail, marking the action as unverified.

**Actual risk:** Medium. The opportunity IS created successfully — the bug only affects the verification step, causing the cognitive cycle to record `verified: false` for a successful action. This pollutes the audit trail with false negatives and may trigger unnecessary replanning. It does NOT cause data corruption.

---

### Bug 3: ModelManager API mismatch — `generate()` vs `generateResponse()`

**Status: NOT A CURRENT BUG**

**What:** The user's report mentioned a mismatch between `ModelManager.generate()` and `ModelManager.generateResponse()`. Investigation:

- `lib/ModelManager.ts:180` exposes `generateResponse(prompt, sessionId, context?)` — the correct method.
- All 7 call sites in `lib/orchestrator.ts` use `this.modelManager.generateResponse(...)` — correct.
- No code anywhere calls `modelManager.generate()` (without `Response`).
- `heidi-core/server.js:187` calls `this.brain.generate(prompt, options)` — but `this.brain` is an `OllamaClient` instance (`heidi-core/brain/ollama-client.js:90` defines `async generate(prompt, options)`), not a `ModelManager`. This is correct for that class.
- `evolution/heidi-goals.js:176` calls `this.brain.generate(prompt, options)` — same pattern, `OllamaClient`, not `ModelManager`.

**Risk if unfixed:** None — there is no bug. The two classes (`ModelManager` and `OllamaClient`) have different method names by design, and each is called correctly by its respective callers.

---

### Bug 4: `createStaleStateRepairHandler` fabricated-success stub

**Status: STILL PRESENT (in source), NOT REGISTERED (not on any path)**  
**Location:** `lib/operational/SelfRepairEngine.ts:729-739`

**What:** The function returns `{ success: true, evidence: 'Stale state cleared for ${capabilityId}' }` without performing any real repair. It is explicitly labeled `// FABRICATED-SUCCESS STUB` with a warning not to wire it without implementing real state-clearing.

**Is it on a production path?** **NO.** Verified:
- `scripts/heidi-daemon.ts` does NOT call `registerRepairHandler` at all — it uses the bridge-wired `SelfRepairEngine` from `CognitiveCoreBuilder`, which only registers `createDatabaseRepairHandler` for `system.database` (`CognitiveCoreBuilder.ts:386`).
- No file in `lib/` or `scripts/` calls `createStaleStateRepairHandler()`.
- The only references are: the definition itself, and a test (`tests/unit/heidi-daemon-bugfix-regression.test.ts:373-375`) that verifies the warning label exists in the source.

**Actual risk:** None today. The risk would materialize only if someone wires it to a real capability without reading the warning. The test guards against removing the warning.

---

### Bug 5: Phase 6 status-classification bug (demo script)

**Status: FIXED** (commit `0d15f4f`, this session)

**Was:** `scripts/live-autonomous-demo.ts` read `report.status` (nonexistent field) instead of `report.state`, causing all reports to appear as "unknown" and the blocker filter to match nothing.

**Now:** Fixed to use `report.state` with uppercase values. Regression test added (`tests/unit/heidi-blocker-classification-regression.test.ts`, 6 tests). Production code was already correct — the bug was exclusively in the demo script.

**Risk if unfixed:** None — it's fixed, and the production code (CapabilityHealthManager, BlockerResolutionEngine, SelfRepairEngine) was never affected.

---

### Bug 6 (NEW, not previously reported): `orchestrator.ts` SQL quote bug — `column "active" does not exist`

**Status: STILL PRESENT**  
**Location:** `lib/orchestrator.ts:466`

**What:** Line 466 uses double quotes for string literals:
```sql
SELECT count(*) as cnt FROM customer_services WHERE status IN ("active", "provisioning")
```
In PostgreSQL, double quotes denote identifiers (column names), not string literals. This query throws `column "active" does not exist`. The `Promise.all` at line 462 fails, and the `catch` at line 529 returns a degraded dashboard with all zeros.

**Is it on a production path?** **YES.** `pages/api/status.ts:19` calls `orchestrator.getRevenueDashboard()`. The `/api/status` endpoint is the daemon's status surface. Verified live: the endpoint returns `"revenueDashboard":{"available":false,"error":"column \"active\" does not exist"}`.

**Actual risk:** Low-medium. The revenue dashboard in `/api/status` always shows zeros because of this bug. This doesn't affect cognitive cycles or self-repair — it only affects the dashboard display. But it means the operator cannot see real pipeline metrics through the status endpoint.

---

### Bug 7 (NEW, not previously reported): `revenue.create_opportunity` verification uses wrong column

This is the same as Bug 2 above. Listed separately here because it was found by direct schema inspection this session, not from a prior report.

---

## 3. What's Verified With Live Evidence vs. Unit-Tested vs. Self-Reported

### Live-verified (ran against real services + persistence, evidence in DB/audit log)

| Claim | Evidence | When |
|-------|----------|------|
| CognitiveCore builds with 42 capabilities | `run-real-cognitive-cycle.ts` output: "Capabilities: 42 total, 42 available" | 2026-08-21T13:26 |
| Cognitive cycle completes: observe→plan→authorize→act→verify→learn | Two cycles run, both `Verified: true`, memory stored (`mem-1787318847521-sfzc25`) | 2026-08-21T13:27 |
| Outreach draft generated with real prospect data | Draft `draft_1787318847361_14cmz6`, "Hi Mike Reynolds,", $500.00 | 2026-08-21T13:27 |
| CapabilityHealthManager probes real services | 6 probes: Ollama HTTP 200, Supabase credentials present, 4 missing-credential BLOCKED | 2026-08-21T13:24 |
| SelfRepairEngine works around missing credentials | 4 issues, 4 worked around, 0 fabricated | 2026-08-21T13:24 |
| Daemon runs continuously | PID 23940, 13.78 hours uptime, 809 self-sufficiency cycles | 2026-08-21T14:20 |
| `/api/status` endpoint works | HTTP 200 with full JSON including daemonStatus, capabilityHealth | 2026-08-21T14:21 |
| Process kill + recovery (Class A) | Killed PID 26588 (port 3005), detected unhealthy, restarted, recovered | 2026-08-21T13:24 |
| Observer vs target distinction (Class B/C) | Bad Ollama probe returned 404, Ollama stayed healthy; provenance checker distinguished observer failure from target failure | 2026-08-21T13:24 |
| `commercial.create_opportunity` bridge works | `createOpportunityForProspect()` returned `opp_1787322142193_5yiffv` | 2026-08-21T14:22 |
| `heidi_events` persistence | 2093 events in DB, recent `cognitive_cycle` records with phase/outcome | 2026-08-21T13:24 |
| Daemon audit log | 809 entries, last cycle `ssf-1787321933935-807` | 2026-08-21T14:20 |

### Unit-tested only (Jest, no live service verification)

| Claim | Test | Limitation |
|-------|------|------------|
| BlockerResolutionEngine resolves BLOCKED capabilities | `heidi-blocker-classification-regression.test.ts` (6 tests) | Uses test env vars, not real credentials |
| Cognitive core qualification (10 tests) | `heidi-cognitive-core-qualification.test.ts` | Uses mocked DB for some tests, real DB for others |
| Campaign loop (21 tests) | Campaign loop test suite | Mocked commercial workflow |
| Self-repair oscillation guardrail | `heidi-self-repair-oscillation.test.ts` | Simulated, not real oscillation |
| Phase 4 governed autonomy (66 tests) | Phase 4 test suites | Pure unit tests |
| Phase 3 operational (51 tests) | Phase 3 test suites | Pure unit tests |

### Self-reported only (never independently checked)

| Claim | Source | Why it's not verified |
|-------|--------|----------------------|
| "System is ALIVE" | `HYDI_LIVE_STATUS_REPORT.md` | Based on live tests, but the verdict itself is an interpretation |
| "Endurance test passes" | `a4b6ddb` commit | Endurance test script exists but was not run to completion |
| Phase 5 "final acceptance" | `195c5b5` | Documentation report, no independent verification |
| Revenue qualification reports | Multiple `.md` files | Reports of unit test results, not live revenue |

### Honest assessment

The **cognitive cycle** and **self-sufficiency daemon** are genuinely live-verified — they run against real Postgres, real Ollama, and produce real DB records. The **commercial path** (prospect → opportunity → outreach draft) is live-verified end-to-end. The **capability health** and **self-repair** systems are live-verified against real services.

The **governed autonomy policy** (R0/R1/R2 authorization, guardian blocks) is unit-tested but not live-verified against real high-risk actions — because no high-risk actions exist in the current state (all commercial capabilities are credential-blocked).

The **revenue dashboard** is broken (Bug 6) and returns zeros — this is not a self-reported claim, it's a verified failure.

---

## 4. Current Live State (checked right now, 2026-08-21T14:25)

### Daemon

| Field | Value |
|-------|-------|
| Running | **YES** |
| PID | 23940 |
| Started | 2026-08-21T00:34:06.331Z |
| Uptime | 13.78 hours |
| Self-sufficiency cycles | 809 |
| Last cycle | 2026-08-21T14:20:57.401Z |
| Last capability health | total=7, ready=3, blocked=4, unavailable=0 |
| Last self-repair | totalIssues=4, repaired=0, workedAround=4, escalated=0 |

### Services

| Service | Port | Status | Evidence |
|---------|------|--------|----------|
| protoforge-core | 3005 | **UP** | `{"status":"ok","modules":0,"events":0}` |
| heidi-web | 3000 | **UP** | `/api/health` 200, `/api/status` 200 |
| heidi-mobile-chat | 3006 | **UP** | Port listening (no `/health` endpoint) |
| Ollama | 11434 | **UP** | 7 models, HTTP 200 |
| Supabase DB | 54322 | **UP** | `SELECT 1` OK, 121 tables |
| Ursula Suite | 5000 | **UP** | (not re-checked this session, was up earlier) |

### `/api/status` endpoint

**WORKING** on port 3000. Returns full JSON including:
- `cognitiveCore`: initialized, 42 capabilities (38 available, 4 unavailable)
- `cognitiveLoop`: state=stopped, cycleCount=0 (the loop is not running in the web process; the daemon runs it separately)
- `capabilityHealth`: total=7, ready=3, blocked=4 — **correct**
- `daemonStatus`: running=true, pid=23940, 809 cycles — **correct**
- `revenueDashboard`: **available=false, error="column \"active\" does not exist"** — Bug 6
- `commercialState`: discovery BLOCKED, email BLOCKED, stripe BLOCKED, sms BLOCKED — **correct**

### LLM inference

Ollama is reachable (HTTP 200, 7 models). Direct inference with `qwen2.5:7b` timed out at 120s in the last cognitive cycle run. The cognitive cycle completed successfully using the evidence-based `OutreachDraftGenerator` instead. This is correct governed degradation — the system does not fail when LLM inference is slow.

---

## 5. Prioritized Punch List

### P0 — On production paths, causes incorrect behavior now

1. **Fix `orchestrator.ts:466` SQL quote bug** — `("active", "provisioning")` → `('active', 'provisioning')`. This breaks the revenue dashboard in `/api/status`. One-line fix. **Do this first.**

2. **Fix `CognitiveCore.ts:1909` verification column mismatch** — `SELECT id FROM revenue_opportunities WHERE id = $1` → `SELECT opportunity_id FROM revenue_opportunities WHERE opportunity_id = $1`. This causes `revenue.create_opportunity` verification to always fail. One-line fix.

### P1 — Degrades capability but system continues operating

3. **LLM inference timeout** — `qwen2.5:7b` times out at 120s. Investigate: is the model loaded? Is Ollama constrained on memory? Try a smaller model (`llama3.2:3b`) or increase timeout. The system degrades correctly, but live AI inference is a core capability that should work.

4. **Missing commercial credentials** — Stripe, SendGrid, Google Places, Twilio. These require human action to provision. The system correctly works around them. No code fix needed — this is an operational task, not a bug.

### P2 — Not on any production path, but should be addressed

5. **`createStaleStateRepairHandler` fabricated-success stub** — Still in source at `SelfRepairEngine.ts:729`. Not registered anywhere. Either implement real state-clearing + verification, or remove it entirely. Leaving a fabricated-success stub in source is a future hazard even with the warning label.

6. **Loose runner scripts have type errors** — `scripts/run-real-cognitive-cycle.ts` and `scripts/live-autonomous-demo.ts` have ~80 implicit-`any` type errors. They run correctly via `tsx` but fail `tsc --noEmit`. Either add types or exclude them from the production typecheck scope.

### P3 — Cleanup, no functional impact

7. **Uncommitted working tree** — 35+ `.commit-msg-*.txt` files, runtime artifacts (`.heidi-daemon.lock`, `.heidi-daemon-audit.jsonl`, `pm2-state.json`, `_boot2.txt`), and generated reports (`HYDI_LIVE_*.md`, `HYDI_LIVE_*.json`). These should be `.gitignore`d or deleted, not committed.

8. **`scripts/live-status-probe.js` / `scripts/live-status-probe.ts`** — Temporary probe scripts created during this session. Should be deleted or consolidated into existing tooling (`scripts/health-check.js`, `scripts/hydi-diagnose.js`).

9. **Pre-existing zero-price opportunity** — `opp_1787277560830_cdus02` has `proposed_price=0, estimated_value=0, probability=0`. The zero-price bug was fixed for new opportunities (`8d12b3a`), but this old row remains in the DB. Consider a cleanup migration or manual delete.
