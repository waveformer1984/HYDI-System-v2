# PHASE 2.5 — gate coverage, proposal reconciliation, RAM truth, PR chain

`HEIDI_ALLOW_EXEC` stayed off throughout. Branch: `heidi-spine/phase-2` (extends PR #553).

## 1. Gate coverage — every execution path

| # | Path | File(s) | What it can execute | Triple gate? | What stops it / what changed |
|---|---|---|---|---|---|
| 1 | agent_bus poller | `heidi-core/heidi-agent.js` | `financial_approval`, `operational_decision` tasks | **YES** (Phase 2) | `adviseProposal` in `makeDecision`; `executeTask` requires `outcome='authorized'` |
| 2 | Orchestrator/agents/approvals | `lib/action-executor.ts` (via `base-agent.ts`, `orchestrator.ts`, `action-approval.ts`) | `create_task`, `fetch_data`, `update_database`, `schedule_event`, `cancel_task`, `send_email`, MCP reads | **YES — wired this phase** | `evaluateAction` chokepoint + NEW: every non-R0 action now also passes `adviseProposal` (advisor + bounds); R0 reads stay chokepoint-only |
| 3 | heidi-core HTTP/tools/missions | `heidi-core/server.js` → `heidi-core/actions/action-executor.js` (via `/act`, `executeActionAsync`, `tool-registry`, `mission-worker`) | `run_script`, `run_command`, `write_file`, `api_call`, `read_file`, `log_event` | **YES — wired this phase** | allowlists + `isSafe()`/permission ladder + NEW: the four side-effect types pass `adviseProposal` inside `execute()` — one chokepoint covers every caller |
| 4 | Autonomous task queue | `heidi-core/autonomous-task-queue.js` | posts to heidi endpoints (client, not an executor) | n/a — executes nothing itself | downstream paths (#1/#3) are gated |
| 5 | Unattended resolver sweep | `lib/human-actions/detector.js` → resolvers | R0/R1 resolver capabilities | **YES — wired this phase** | `AuthorityBounds` (exec+lease+bounds+denied) THEN `adviseProposal`; advisor consulted only after authority passes — dormant while exec off, fail-closed on error |
| 6 | Cognitive loop | `lib/heidi/CognitiveCore.ts` `executeAction` → `CapabilityRegistry.execute` | contract-authorized capabilities; mission dispatch via `MissionRunner` | **YES — wired this phase** | contract authority + approval bridge + NEW: non-R0 capabilities pass `adviseProposal` before `registry.execute`; mission dispatch keeps its lifecycle gates (awaiting_approval) |
| 7 | ProtoForge dispatch | `lib/protoforge/{auto-gate,dispatcher}` | pipeline actions rows | gated upstream by protoforge action gate + `actions` row lifecycle | registered in bypass test |

**Bypass test hardened:** `tests/unit/action-executor-bypass.test.js` now has two layers — (a) any file with an execution sink not in `EXECUTOR_REGISTRY` fails; (b) `REQUIRED_GATES` asserts the five gate call-sites literally contain `adviseProposal` — removing the wiring fails the suite even if the file stays registered. 8 tests pass.

## 2. Proposal reconciliation — 49 proposed vs 36 decided

**Gap explained:** 13 proposals had a `proposed` row but no terminal `action_gate_decision` row. Causes: (a) decision-write failures were silently swallowed (fail-soft catch), (b) the high-risk-small-amount proposal's evidence write flaked mid-drill, (c) any process kill between the two writes orphans a proposal.

**Fix (`lib/governance/action-advisor.js`):**
- Decision row now gets **one retry** (500 ms backoff).
- If both writes fail and the outcome wasn't already `blocked`, outcome downgrades to **`errored_blocked`** — an unevidenced approval is not an approval.
- Every gate-log entry records `decidedRecorded: true|false`.

**Orphan metric:** `spine.gateLog.orphaned` in `.heidi-daemon-status.json` counts gate-log entries with `decidedRecorded:false`. (DB-side truth: `SELECT payload->>'proposalId' FROM heidi_events WHERE event_type='action_proposal'` minus decided IDs — the JSONB filter needs an index before it's cheap on 281k rows; noted as follow-up.)

**Tests added (3):** double-write-failure → `errored_blocked` + orphan flag; single-failure-then-success → outcome preserved; already-blocked stays `blocked` on write failure. 31 advisor tests pass.

## 3. RAM truth (Frank: 15.7 GB total)

- **After cleanup:** idle free ≈ **0.9–1.0 GB** (was 0.20–0.54 GB). During cognitive cycles it still dips — `hydi-daemon` is the largest PM2 process (~420 MB) and cycles time out under pressure.
- **Root cause found + fixed:** `scripts/ollama-serve.js` spawned `ollama serve` as a *grandchild*; PM2 force-kills the wrapper without tree-kill → orphaned serves accumulated (176 restarts), fought over :11434, and left a stale `llama-server` holding ~1.7 GB. **Fix:** wrapper now sweeps stale `ollama.exe serve`/`llama-server.exe` processes at startup (powershell CIM, 15 s bound, `windowsHide`) before spawning — self-healing every restart. Deployed: `pm2 delete` + `start --only` + `pm2 save`; ollama-serve online, ↺0, :11434 → 200. (Briefly tried pointing PM2 at the exe directly — PM2 still wraps it in `cmd.exe`, same orphan problem one level down; reverted to the sweeping wrapper.)

**Per-app table** (PM2 census, ~2 h uptime unless noted):

| App | Mem | Role | Last useful work | Recommendation |
|---|---|---|---|---|
| hydi-daemon | ~420 MB | cognitive spine (snapshots/reflect/gates) | continuous cycles | **keep** — the spine |
| heidi-web-standalone | ~73 MB | :3000 UI + /api/health | serving phone path | keep |
| hydi-watchdog | ~58 MB | health/split-brain/reaper | every cycle | keep |
| hydi-boot | ~10 MB | boot orchestrator | at boot | keep |
| heidi-core | ~27 MB | :3459 brain/chat/act | chat + missions | keep |
| heidi-agent | ~22 MB | agent_bus + advisor gate | polls 30 s | keep |
| hydi-system-health | ~21 MB | health probes | periodic | keep |
| hydi-model-prep-executor | ~18 MB | model prep jobs | occasional | keep |
| frank-observer | ~18 MB | Frank snapshot/fix-list | 60 s passes | keep |
| rezonate-app | ~18 MB | Rezonate UI | on demand | **lazy-start candidate** |
| hydi-billing-worker | ~15 MB | billing jobs | periodic | keep |
| hydi-daily-loop | ~15 MB | daily tasks | daily | keep |
| hydi-local-ci | ~10 MB | CI runner | on demand | lazy-start candidate |
| pm2-logrotate | ~25 MB | log rotation | continuous | keep (module) |
| hydi-protoforge-scout | ~8 MB | scouting | periodic | keep |
| hydi-stuck-job-scheduler | ~9 MB | job reaper | periodic | keep |
| hydi-revenue-reconciliation | ~9 MB | revenue checks | periodic | keep |
| hydi-failed-webhook-retry | ~9 MB | webhook retries | periodic | keep |
| hydi-schedulers | ~8 MB | job scheduler (hosts job-scout) | periodic | keep |
| hydi-stripe-webhook-listener | ~7 MB | stripe webhooks | on events | keep |
| frank-auto-deploy | ~8 MB | auto-deploy | 5 min loop | keep |
| frank-storage-guard | ~9 MB | disk guard | 15 min loop | keep |
| hydi-public-tunnel | ~4 MB | tunnel | continuous | keep |
| ursula-local | ~1 MB | :3100 wrapper (real cost is containers) | serving | keep PM2; **lazy-start the Ursula containers** (~376 MiB) if RAM needed |
| heidi-mobile-chat | 0 | :3006 | **down — missing HEIDI_MOBILE_TOKEN** | keep stopped until token exists |
| ollama-serve | ~15 MB + model | local inference | advisor/reflections/chat | keep; model residency is the real cost (~2 GB loaded) |

**Docker containers:** supabase_db 206 MiB, realtime 251 MiB (**keep per instruction**), kong ~139 MiB, storage 113 MiB, rest ~9–44 MiB, auth ~14 MiB; ursula-hub 247 MiB, flask 87 MiB, postgres 32 MiB, redis 11 MiB. Lazy-start candidates if ≥4 GB headroom needed: `ursula-*` stack (~377 MiB), `supabase_storage`+`realtime`… (realtime excluded per instruction), Ollama `KEEP_ALIVE` already 2 m.

## 4. PR chain verification

Phase branches are **independent** (each off clean-main), not stacked:

| PR | Branch | Contents | Depends on |
|---|---|---|---|
| #550 | heidi-spine/phase-0 | AUDIT.md | — |
| #551 | heidi-spine/phase-0.5 | boot-resurrect.ps1, watchdog-split-brain fallback, census retry, **Kong REST gate + em-dash parse fix** (`f2341c1b`, pushed after PR opened — included) | — |
| #552 | heidi-spine/phase-1 | snapshots/reflections spine, cycle-timeout metrics, pm2-update reaper | — |
| #553 | heidi-spine/phase-2 | action-advisor triple gate, gate-drill, bypass test, producerKey index | — |

No file overlaps between branches → clean merges in any order, but **recommended: 550 → 551 → 552 → 553** (audit → stabilize → spine → gate). Note: `scripts/hydi-boot-resurrect.ps1` exists ONLY on phase-0.5 — merging #552/#553 without #551 leaves the boot script absent from main.

## Verification

- `node --check` clean on all edited JS; `tsc --noEmit` clean.
- Jest: action-advisor 31 ✓, bypass 8 ✓, action-executor 10 ✓, enforcement 12 ✓ — 61 total.
- Live: ollama-serve ↺0 online, :11434 → 200 after sweep fix; `pm2 save` done.
- `HEIDI_ALLOW_EXEC` unset/false throughout; nothing executed.
