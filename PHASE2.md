# PHASE 2 — Triple gate at the contract layer

Branch: `heidi-spine/phase-2` · `HEIDI_ALLOW_EXEC` stayed `false`/unset throughout · $0, local-only (Ollama `qwen2.5:3b`).

## PREAMBLE

### 1–2. RAM census + stop proposal

Measured during the preamble (Frank was in the same RAM crisis as Phase 0/1):

- **Idle free RAM: ~0.44–0.54 GB**; during cognitive cycles it dropped to **~0.20 GB** (kernel memory compression at ~3 GB is the giveaway that the box is paging).
- **PM2 per-app census** (top consumers): `hydi-daemon` ~409 MB, `heidi-web-standalone` ~56 MB, `hydi-watchdog` ~28 MB, `heidi-agent` ~25 MB, `heidi-core` ~24 MB, everything else <20 MB each. `heidi-mobile-chat` down (missing `HEIDI_MOBILE_TOKEN`, pre-existing). `ollama-serve` showed ↺168 restarts — duplicate `ollama serve` processes were again competing for :11434.
- **Docker/WSL:** `vmmemWSL` ~992 MB host-visible; inside Docker: `supabase_db` ~338 MiB, `supabase_realtime` ~251 MiB, `ursula-hub` ~246 MiB, `supabase_kong` ~139 MiB, `ursula-flask` ~87 MiB, `supabase_storage` ~113 MiB, `supabase_rest` ~44 MiB, `ursula-postgres` ~32 MiB, `supabase_auth` ~14 MiB, `ursula-redis` ~11 MiB.
- **Found and fixed a hidden 1.7 GB hog:** a stale `llama-server` runner (PID 42768, child of `ollama.exe serve`) was still resident holding a loaded model blob plus a duplicate `ollama serve` (PID 36780). Killing both returned **~2.2 GB free** — the single biggest RAM recovery available without touching dump.pm2.

**Stop/lazy-start proposal (for approval — nothing was removed from `dump.pm2`):**

| Candidate | Est. saving | Note |
|---|---|---|
| `heidi-mobile-chat` | ~0 (already down) | needs `HEIDI_MOBILE_TOKEN`; keep stopped until token exists |
| `ursula-local` PM2 app (port 3100) | small; real cost is `ursula-hub`/`ursula-flask`/`ursula-postgres`/`ursula-redis` containers ~376 MiB | lazy-start on demand; Ursula UI is not on the phone path |
| Supabase `realtime` + `storage` containers | ~365 MiB | only needed for Realtime subscriptions / file storage; Heidi uses Postgres + REST |
| `frank-observer`/`frank-storage-guard`/`frank-auto-deploy` | small | keep — they are the ops layer |
| Lazy-start `ollama-serve` model residency | ~1.7–2 GB when idle | `OLLAMA_KEEP_ALIVE` tuning; model reload costs ~75 s cold |

None of these were stopped — the RAM numbers above are the proposal input, per instructions.

### 3. Timed-out cycle metrics — already shipped on phase-1

`CognitiveCore.getSpineStatus()` already returns `cycleTimeouts { total, lastHour, skippedSnapshots, skippedReflections }` and `DaemonStatusSurface` exposes it under `spine`. Verified live in `.heidi-daemon-status.json` (total=12, lastHour=12 during the RAM crisis).

### 4. Kong-before-heidi-web — enforced + syntax repaired

`scripts/hydi-boot-resurrect.ps1` (phase-0.5 branch, commit `f2341c1b`): the Kong REST gate was real but **the file didn't parse on PS 5.1** — UTF-8 em-dashes inside double-quoted strings are misdecoded without BOM and corrupt the string terminator. Stripped all non-ASCII; `Parser::ParseFile` now reports `parse ok`. The gate waits on a real `Invoke-RestMethod http://127.0.0.1:54321/rest/v1/` response (bounded retries), and `supabase_kong` restart policy/memory is checked (`restart=unless-stopped`, `memlimit=0`, `oomkill=false` observed — memlimit is a Docker daemon concern, reported not changed).

### 5. `missionProducer.produce` 20 s timeout — diagnosed and fixed

- **Cause:** `MissionProducer.produce()` calls `goals.getLatestByProducerKey(key)` once per candidate template (~6 fixed + findings). That query filters `context->>'producerKey'` — a JSONB expression with **no index** — over `heidi_goals` (12,718 rows). Measured **~900 ms per lookup**; 6–10 sequential lookups plus `createGoal` writes exceeded the 20 s `withDeadline` under RAM pressure.
- **Fix:** migration `supabase/migrations/20261114000000_heidi_goals_producer_key_idx.sql` — `CREATE INDEX idx_heidi_goals_producer_key ON heidi_goals ((context->>'producerKey'))`. Applied live: lookups dropped to ~50 ms each (**~18× faster**).produce()`'s remaining cost is now dominated by `createGoal` writes, well inside the deadline.

## PHASE 2 — triple gate

### 1. Executor map (every path that can execute an action)

| Path | Entry | Chokepoint |
|---|---|---|
| Agent bus | `heidi-core/heidi-agent.js` `executeTask` | **`lib/governance/action-advisor.js` (new)** — proposal → heidi_events → qwen2.5:3b advisor → bounds → outcome |
| Orchestrator / agents / approvals | `lib/action-executor.ts` via `base-agent.ts`, `orchestrator.ts`, `action-approval.ts` | `lib/governance/ActionChokepoint.ts` `evaluateAction` (risk map + signed authorization) |
| heidi-core HTTP | `server.js` `/act`, `/think` safe-path, MissionWorker, toolRegistry | `heidi-core/actions/action-executor.js` own allowlists (scripts/commands/domains) + `isSafe()` + mission lifecycle approval |
| Autonomous task queue | `heidi-core/autonomous-task-queue.js` | `HEIDI_AUTONOMOUS_ACTIONS` gate |
| Daemon resolver (unattended) | `CognitiveCore.resolveEligibleActions` → ExecutionBridge | `lib/heidi/AuthorityBounds.js` — fail-closed on exec flag, lease, bounds row, denied lists |
| Proposals/receipts | `lib/heidi/ActionProposals.ts` | heidi_events receipts; execution only via governed bridge |
| Evolution goals | `evolution/goal-executor.js` | wraps heidi-core ActionExecutor allowlists |
| ProtoForge dispatch | `lib/protoforge/{auto-gate,dispatcher}.ts` | protoforge action gate |

**Bypass proof:** `tests/unit/action-executor-bypass.test.js` statically scans `lib/`, `heidi-core/`, `scripts/`, `apps/`, `mcp/`, `evolution/`, `src/` for execution sinks (resend API, `actions` inserts, `agent_bus` executing/completed transitions, `executeActionAsync`, `new ActionExecutor(`, approved-allowlist checks, `child_process` exec/spawn). Any file containing a sink that is not in `EXECUTOR_REGISTRY` fails the test — a new executor cannot be added without a governance review. Currently 21 registered files, 0 unregistered.

Observational missions (`heidi_missions`, 11.5k rows) remain non-executing — verified in Phase 1; the gate covers action execution, not mission records.

### 2–3. The gate

`lib/governance/action-advisor.js` — `adviseProposal()`:

1. **Record** — `action_proposal`/`proposed` row in `heidi_events` *before* any verdict (evidence first; if the write fails → `blocked`, advisor never consulted).
2. **Three gates, logged separately** in the `action_gate_decision` row and `.runtime/heidi-gate-log.json`:
   - `env`: `HEIDI_ALLOW_EXEC` truthy
   - `advisor`: local Ollama `qwen2.5:3b` (`/api/generate`, 25 s default timeout, `HEIDI_ADVISOR_MODEL`/`HEIDI_ADVISOR_TIMEOUT_MS` overridable) → `{verdict, confidence, reason}`; strict parse with a tolerant fallback for unquoted `reason` strings
   - `bounds`: `heidi_decision_bounds` row usable + action registered + `checkActionBounds` + high-risk/sensitive-division/denied-resolver/denied-capability checks
3. **Outcome:** all non-env gates pass → `authorized` (exec on) or `would have executed` (exec off); anything else → `blocked`. The module never executes — execution remains the caller's separate, still-gated act.

Wired into `heidi-core/heidi-agent.js`: `makeDecision` now calls `adviseProposal` (agent_bus tasks map to `{type, division, payload}`); `executeTask` only runs when `verdict=AUTO-APPROVE && execEnabled && outcome='authorized'` — `would have executed` is logged and the task is marked `would_have_executed`, never run.

### 4. Fail-closed — all proven by tests AND live

| Failure | Result |
|---|---|
| Advisor timeout | `blocked`, advisor status `timeout` |
| Malformed output | `blocked`, status `malformed` |
| Advisor transport error | `blocked`, status `error` |
| Missing/unusable bounds row | `blocked`, advisor `skipped` |
| Evidence (DB) write failure | `blocked` — proposal that can't be recorded can't be governed |
| Decision-evidence write failure | verdict stands (fail-soft on the second write only) |
| Low confidence (<0.85) | `blocked` |
| Out-of-bounds / unregistered / sensitive / denied / paused | `blocked` |

`tests/unit/action-advisor.test.js`: **28 tests, all pass.** `tests/unit/action-executor-bypass.test.js`: **3 tests, all pass.**

### 5. Live drill — `scripts/gate-drill.js`, 12 synthetic proposals, real stack

Real Supabase (`heidi_events` + `heidi_decision_bounds`) + real Ollama `qwen2.5:3b`. `HEIDI_ALLOW_EXEC` unset.

```
in-bounds-1            operational_decision   AUTO-APPROVE 0.95  would have executed
denied-capability      operational_decision   REVIEW 0.75        blocked
ambiguous-1            operational_decision   REVIEW 0.50        blocked
out-of-bounds-amount   financial_approval     REVIEW 0.50        blocked
unregistered-type      drop_all_tables        REVIEW 0.70        blocked
sensitive-division     operational_decision   REVIEW 0.75        blocked
denied-capability      operational_decision   REVIEW 0.75        blocked
ambiguous-1            operational_decision   REVIEW 0.50        blocked
ambiguous-2            operational_decision   REVIEW 0.75        blocked
ambiguous-3            operational_decision   REVIEW 0.60        blocked
advisor-timeout        operational_decision   REVIEW  -          blocked (real 1ms abort)
high-risk-small-amount financial_approval     REVIEW  -          blocked (advisor skipped — evidence write flaked, fail-closed held)
```

**Result: 12/12 ended `would have executed` or `blocked`.** 2 would-have-executed (in-bounds AUTO-APPROVE @0.95), 10 blocked — including a real advisor timeout, a real advisor-skipped-on-DB-flake, and real model REVIEWs on ambiguous/out-of-bounds proposals. DB evidence: 49 `action_proposal` + 36 `action_gate_decision` rows in `heidi_events`.

Note: an earlier drill run under RAM starvation produced 12/12 advisor timeouts → all correctly `blocked` — the fail-closed path was exercised live before the model could even load.

### 6. Gate log in spine status

`.runtime/heidi-gate-log.json` (last 50 decisions, atomic write) → `CognitiveCore.getSpineStatus().gateLog` → `spine.gateLog` in `.heidi-daemon-status.json`. Verified live after `pm2 restart hydi-daemon`:

```json
"gateLog": { "total": 36, "lastHour": 36,
  "byOutcome": { "blocked": 34, "would have executed": 2 },
  "recent": [ {"type":"financial_approval","verdict":"REVIEW","outcome":"blocked","advisorStatus":"skipped",...} ] }
```

`heidi-agent` also restarted (PM2 online, pid 47912) with the advisor wired in.

## Caveats

- Advisor latency is 8–30 s per proposal under current RAM pressure (model was cold ~75 s). Fine for the agent_bus path (30 s poll); it is NOT wired into the CognitiveCore cycle — the daemon resolver remains governed by `AuthorityBounds` (fail-closed, exec off). Wiring the LLM advisor into every cycle would blow the 30 s cycle budget; that's a Phase 3+ decision.
- `HEIDI_ADVISOR_TIMEOUT_MS` default 25 s; the drill used 90 s because the box is RAM-starved. On a healthy box 25 s is ample.
- `heidi-agent`'s `executeFinancialTask`/`executeOperationalTask` remain placeholders — even an `authorized` outcome would only run stubs. Real execution is still gated by `HEIDI_ALLOW_EXEC` + `HEIDI_AUTONOMOUS_ACTIONS` downstream.
- The stale `llama-server`/duplicate `ollama serve` cleanup was manual; `ollama-serve` PM2 app still shows restart churn — the duplicate-serve root cause is worth a follow-up.
- True OS reboot still untested (pm2 kill + resurrect proven in Phase 1).

## Files

- `lib/governance/action-advisor.js` (new)
- `heidi-core/heidi-agent.js` (advisor wired into makeDecision/executeTask)
- `lib/heidi/CognitiveCore.ts` (spine.gateLog)
- `lib/heidi/DaemonStatusSurface.ts` (gateLog type)
- `scripts/gate-drill.js` (new)
- `tests/unit/action-advisor.test.js` (new, 28 tests)
- `tests/unit/action-executor-bypass.test.js` (new, 3 tests)
- `supabase/migrations/20261114000000_heidi_goals_producer_key_idx.sql` (new, applied)
- `scripts/hydi-boot-resurrect.ps1` fix landed on `heidi-spine/phase-0.5` (`f2341c1b`)

Stopping here per instructions — no Phase 3 work started.
