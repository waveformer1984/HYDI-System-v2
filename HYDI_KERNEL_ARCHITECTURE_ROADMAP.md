# HYDI Kernel: Architecture Roadmap

**Status:** Proposal — no code changed by this document
**Date:** 2026-07-13
**Scope:** Answers "if AGI-grade autonomy is the long-term goal, what's the highest-leverage architectural work right now?"
**Relationship to other docs:** `ROADMAP.md` covers the six-layer event pipeline's near/medium/long-term feature work. `HYDI_GAME_PLAN.md` covers this week's operational punch list (env repair, PWA, core-loop bugs). This document is neither — it's the missing layer between them: which of the many orchestration systems already built in this repo becomes *the* kernel, and in what order to wire it up for real.

---

## Known gap in the Phase 0 audit (found 2026-07-14, during Phase 3 prep)

`lib/replay-engine.ts` — a fourth independent CASCADE/KILO/ProtoForge-shaped
implementation, predating this whole roadmap effort — was never found by the
original audit. It has its own inline classify/hypothesize/decide logic
(regex-matches real Stripe webhook event types), reads from `keymaker_events`
(a real, live, populated table — the actual Stripe billing event ledger
written by the `keymaker-gate`/`stripe-webhook` Edge Functions), and writes
to `replay_history`. It's reachable only via `api/traces.js` (repo root),
which — like `api/chat/route.js` before it — isn't actually mounted
anywhere (no `vercel.json`, no `src/server.js` require, and Vercel
deployment is confirmed disabled). The real `/api/traces` route,
`pages/api/traces.js`, queries `keymaker_events` directly and doesn't use
this file at all.

Net effect: dormant, same as everything else Phase 0 archived, so it
doesn't contradict the `kilo/`+`lib/protoforge/` canonical-pipeline
decision. Left in place rather than archived (2026-07-14 decision) since
it's not urgent and doesn't conflict with anything merged — flagged here
as a known gap. **Implication:** the original Phase 0 audit was not
exhaustive; treat "nothing else was found" claims elsewhere in this repo's
history with appropriate skepticism, and re-check before relying on them
for a new decision.

## Recommendation, in priority order

1. **Stop building new orchestrators. Delete or archive the dead ones.** The repo already contains at least five independent orchestration implementations and three independent specialist-agent rosters. Four of the five orchestrators are never instantiated outside their own unit tests — see audit below. Adding a sixth ("the Kernel") without removing the others just makes the map worse.
2. **The kernel is not a new system — it's `pao-system/core/heidi.controller.ts` (or its replacement) wired to the pipeline that's already documented in `HEIDI_V2_ARCHITECTURE.md` and already implemented in `kilo/` + `lib/protoforge/`, both of which are currently orphaned.** Reusing what's built is faster than redesigning, and both pieces already encode the right ideas (single source of truth; hypothesis-generation separated from policy decision).
3. **World model**: consolidate on the existing `memories` (pgvector, already centralized through `lib/heidi-memory.ts`) and `sessions` tables — do not start a new store. Fix `sessions`' three uncoordinated writers first (`lib/ModelManager.ts`, `lib/protoforge/dispatcher.ts`, and the `update_database` tool in `lib/action-executor.ts`) since a kernel that owns state can't have three other things also owning that same state.
4. **Hierarchical planning**: extend the KILO→ProtoForge hypothesis/policy-gate shape rather than inventing a parallel planner. It's currently classification-shaped (flat `{confidence, risk, revenue_impact}` per hypothesis); generalizing it into multi-step task planning means adding a plan/step representation on top of the same gate, not replacing the gate.
5. **Tool ecosystem, self-evaluation, episodic memory, multi-model routing, autonomous sessions, metrics** — all real needs, all sequenced *after* 1–4, because right now every one of these would have to pick which of the five dead-vs-live orchestration paths to attach to, and guessing wrong means building on a path nothing else will ever call.
6. **Reliability before autonomy stays the governing principle throughout** — each phase below ends with "this path is the only path" before the next phase adds capability on top of it, rather than autonomy features being layered across multiple competing entry points.

---

## Audit: what's actually live vs. dormant

Traced every `require`/`import` graph from the four real entry points (`pages/api/chat.ts`, `api/chat/route.js`, `api/heidi/route.js`, `src/server.js` / `npm run server`) outward, rather than reading files in isolation.

| System | Reachable from a running entry point? | What it is |
|---|---|---|
| `pages/api/chat.ts` → `lib/heidi-agent.ts` | **Yes** (when `ANTHROPIC_API_KEY` set) | Real Claude native tool-use loop, 6-iteration cap, tools: `create_task`, `fetch_data`, `update_database`, `schedule_event`, `send_email` |
| `pages/api/chat.ts` → `lib/orchestrator.ts` → `lib/ModelManager.ts` | **Yes — the actual production path** per CLAUDE.md's local-first decision (`ANTHROPIC_API_KEY` unset) | Hand-written JSON-contract prompting (`{"response":...,"actions":[...]}`) over a single local Ollama model, with Anthropic/OpenAI as fallback |
| `api/heidi/route.js` → `HeidiLocalHandler` (`local-model.js`) | Yes, separate route | A *third* independent hand-rolled Ollama HTTP client |
| `api/chat/route.js` (Express-style, `system` field required) | Yes, if mounted | Keyword-`includes()` stub handlers over Supabase tables; **calls no LLM at all**; its "KILO" and "ProtoForge" handlers do not call `kilo/` or `lib/protoforge/` — they call unrelated Supabase RPCs |
| `src/server.js` (`npm run server`) | Yes, if deployed | Pulls in yet another module family (`modules/cascade-complete-v2`, `modules/hydi-contextual-conscience`, `modules/protoforge-event-bus`) that overlaps with none of the above |
| `pao-system/core/heidi.controller.ts` + all of `pao-system/*` (16 agents, `EventBus`, `TaskRouter`, `ApprovalEngine`, `RiskEngine`) | **No.** `HeidiController` is never constructed anywhere outside its own file. Confirmed via `grep -rn "new HeidiController"` — zero results. | Fully-built, fully dormant. This is the closest thing to a "kernel" already in the repo — see below. |
| `kilo/index.js` (`KiloEngine`) + `lib/protoforge/policy-engine.js` + `lib/protoforge/auto-gate.js` | **No.** `autoGate` is imported only by its own test (`tests/unit/protoforge-auto-gate.test.js`); confirmed via grep. | Fully-built, fully dormant. This is the real implementation of the pipeline `HEIDI_V2_ARCHITECTURE.md` describes. |
| `modules/heidi-v2-orchestrator.js` + `*-v2.js` family (`raw-event-ledger-v2`, `cascade-classifier-v2`, `kilo-analyzer-v2`, `protoforge-policy-v2`, `emission-layer-v2`, `replay-engine-v2`) | **No.** Reachable only from `test-system.js` / `test-heidi-v2.js` / `test-fixes.js` manual scripts. | Matches `HEIDI_V2_ARCHITECTURE.md` almost exactly, never runs in production. |
| `agents/specialized/agent-factory.js` (JS, `EventEmitter`-based, 15-role roster) | Partially — reachable via `protoforge-main.js`, the PAO README's own quick-start command | Only 3 of 15 agents actually implemented (`ArchitectAgent`, `EnergySystemAgent`, `AISystemsAgent`) |
| `pao-system/agents/*.ts` (TS, all 15 roles present, better state model) | **No.** Imported only by each other and by unit tests. | Fully-built, fully dormant, structurally incompatible with the JS roster above (can't merge field-by-field) |
| `workers/WorkerOrchestrator.js` / `DecisionAssistWorker.js` | Unknown — not in `package.json` scripts, no found deploy/process-manager entry | Background queue-worker supervisor; `DecisionAssistWorker`'s only implemented analysis path is a stub |

Also found: `sessions` has three independent, uncoordinated writers (`lib/ModelManager.ts`, `lib/protoforge/dispatcher.ts`, and the `update_database` tool available to the LLM itself via `lib/action-executor.ts`) — likely-divergent assumptions about that table's schema. `memories` (pgvector), by contrast, is already correctly centralized through `lib/heidi-memory.ts` and used by both `heidi-agent.ts` and `orchestrator.ts`.

**The headline implication:** this is not a "merge N orchestrators' logic together" problem. It's "delete or archive four-to-six unreachable orchestration systems, and finish wiring the two well-designed-but-dormant pieces — the Raw Ledger/CASCADE/KILO/ProtoForge pipeline, and one specialist-agent roster — behind the one chat entry point that's actually live in production today (`lib/orchestrator.ts` + `lib/ModelManager.ts`, per the local-first decision)."

---

## Phased plan

### Phase 0 — Triage (prerequisite to everything else)

**Status: mostly executed, 2026-07-14.** Findings changed the shape of this
phase from "delete dead code" to "most of it isn't dead, it's unwired *or*
externally deployed" — see `archive/heidi-v2-dormant-pipeline/README.md`
and `archive/agents-specialized-orphans/README.md` for the full trail.

- ✅ Archived (verified zero references anywhere, full test suite +
  typecheck unchanged both times): `modules/heidi-v2-orchestrator.js`,
  `ingestion-layer-v2.js`, `emission-layer-v2.js` and their two manual test
  scripts → `archive/heidi-v2-dormant-pipeline/`. `agents/specialized/command-center.js`,
  `deployment-manager.js`, `operator-agent.js` → `archive/agents-specialized-orphans/`.
- ✅ **Decided: `kilo/` + `lib/protoforge/` is the canonical hypothesis/policy
  pipeline**, not `modules/{raw-event-ledger-v2,cascade-classifier-v2,kilo-analyzer-v2,protoforge-policy-v2,replay-engine-v2}.js`.
  Deciding fact: `lib/protoforge/policy-engine.js` persists to real Supabase
  tables (`policies`, `decisions` — actual migrations exist); the `modules/*-v2`
  family was 100% in-memory, no persistence anywhere.
- ✅ **Built and archived the rest.** `lib/protoforge/raw-ledger.ts` (real,
  Supabase-backed, append-only —
  `supabase/migrations/20260714120000_raw_event_ledger_table.sql`) and
  `lib/protoforge/replay-engine.ts` (re-runs a stored event through
  `kilo/`+`lib/protoforge/`, diffs the result) now exist, with the
  determinism assertions ported onto them
  (`tests/unit/replay-engine.test.ts`, 24 tests). The remaining 5
  `modules/*-v2` files + their test are archived to
  `archive/heidi-v2-dormant-pipeline/replay-family/`. See that directory's
  parent README for the honesty note this carries forward: there's still no
  real CASCADE classifier, so the replay engine's `classify` stage is a
  deterministic passthrough of the ledger event's stored `event_type`, not
  real classification.
- ✅ **Decided: keep `hydi-protoforge`.** The `agent-factory.js`/`business-agents.js`/
  `execution-agents.js`/`workflow-agent.js`/`security-agent.js` roster and its
  `protoforge-main.js` entry point stay as-is — confirmed as an intentionally
  kept, real PM2 deployment (`ecosystem.config.js`), not dead code. Not part of
  the kernel consolidation; out of scope for Phase 1-3 below unless revisited.
- ⏳ Still open: `pao-system/agents/*.ts` vs. `agents/specialized/*`'s live
  5-file roster as the specialist-agent implementation Phase 3 builds on —
  `pao-system/agents/*.ts` has the cleaner state model but zero production
  usage; `agents/specialized/*`'s roster is a real PM2 deployment but kept
  separate per the decision above. Revisit at Phase 3, not before.
- This directly unblocks `ROADMAP.md`'s existing Q3 2026 items ("Pipeline observability," "PolicyEngine expansion") — those assume the pipeline is live; today it isn't.

### Phase 1 — Wire the kernel spine

**Status: mostly executed, 2026-07-14.**

- ✅ `lib/orchestrator.ts` now calls `kilo/index.js`'s `generateHypotheses()`
  → `lib/protoforge/auto-gate.js`'s `autoGate()` for every proposed action,
  via `lib/protoforge/action-gate.ts`. Real decisions are recorded to the
  `decisions` table on every chat turn. **Enforcement is opt-in**
  (`PROTOFORGE_ENFORCE_ACTIONS=true`) — see `action-gate.ts`'s module
  comment for why blind enforcement would silently reject every action
  today (fail-closed policy engine, seed policy deliberately inactive, no
  real CASCADE ground truth yet). Observe-only by default: nothing is
  blocked, everything is recorded.
- ✅ Fixed the `sessions` triple-write problem — `lib/session-state.ts` is
  now the single writer/reader; `ModelManager`, `dispatcher.ts`, and the
  `update_database` action tool all delegate to it.
- ✅ Built the Raw-Ledger + Replay-Engine equivalent against
  `kilo/`/`lib/protoforge/` (`lib/protoforge/raw-ledger.ts`,
  `lib/protoforge/replay-engine.ts`) and ported the determinism assertions
  (`tests/unit/replay-engine.test.ts`). The `modules/*-v2` family is fully
  archived now (see Phase 0 status above).
- ⏳ **Not yet done**: nothing currently *appends* to the new
  `raw_event_ledger` table on the live chat path — `replay-engine.ts` and
  `raw-ledger.ts` exist and are tested, but `lib/orchestrator.ts` doesn't
  write to the ledger yet, so there's nothing real to replay in production
  today. Wiring that in is a further, separate change (changes write volume
  on every turn) — deliberately not bundled into this pass.
- ⏳ **Not yet done**: no agent roster is wired to `action-gate.ts`'s output
  yet — hypotheses are gated but approved/escalated verdicts don't yet
  route to a specialist agent's `handle_event()`. That's Phase 3.
- ⏳ **Not yet done**: the new `raw_event_ledger` table exists only as a
  migration file — it hasn't been applied to any live Supabase project yet
  (`supabase db push`), consistent with this repo's general migration
  backlog (see `HYDI_GAME_PLAN.md`'s P0 items on `DATABASE_URL`).
- Exit criterion (revised): a message through `/api/chat` in production
  (Ollama path) now does produce a KILO hypothesis and a ProtoForge
  approve/reject/escalate decision recorded in the `decisions` table for
  every action — met, in observe-only mode. Full exit (CASCADE
  classification real, ledger genuinely populated, enforcement safe to
  flip on) is not yet met — tracked above.

### Phase 2 — Planning, episodic memory, self-evaluation

**Status: executed, 2026-07-14.**

- ✅ **Self-evaluation**: `lib/protoforge/policy-engine.js`'s `_buildDecision`
  now assigns a client-generated `decisionId` up front (no need to await
  the insert to know it), and a new standalone `recordOutcome(decisionId,
  outcome, detail)` export backfills it. `lib/orchestrator.ts` calls it
  after every `ActionExecutor.execute()` — success or failure — closing
  the loop the `decisions` table's `outcome`/`outcome_at`/`outcome_detail`
  columns were already built for but nothing wrote to.
- ✅ **Episodic memory**: extended `memories` with a `kind` discriminator
  rather than a new table (`supabase/migrations/20260714130000_memories_episodic_kind.sql`
  — `kind text default 'conversation'`, `metadata jsonb`), so episodic rows
  stay retrievable through the same `search_memories` semantic-search path
  as conversational memory. `lib/episodic-memory.ts`'s `buildExperience()`
  distills a turn's action results into `{problem, actions_taken, outcome,
  lesson}`; `storeExperience()` persists it. Wired into
  `lib/orchestrator.ts` after every turn that attempted at least one
  action.
- ✅ **Plan-step tagging (bounded version)**: `lib/protoforge/action-gate.ts`
  now tags each hypothesis with `plan_step`/`plan_total_steps` — its
  position in that turn's action list — so DSL rules *can* reason about
  multi-step plans (e.g. "only auto-approve step 1"). This is the bounded
  increment, not a new planner: goal → milestones → tasks hierarchical
  planning is still open and probably belongs in Phase 4
  (autonomous work sessions) rather than being retrofitted here.
- 17 new tests across `tests/unit/protoforge-policy-engine.test.js`,
  `tests/unit/protoforge-action-gate.test.ts`, and
  `tests/unit/episodic-memory.test.ts`. Full suite: 1020/1020 passing,
  typecheck clean.

### Phase 3 — Multi-agent collaboration

**Status: executed, 2026-07-14, scope revised from the original plan.**

The original plan ("bring the chosen 15-role agent roster onto the live
path via `AgentRegistry`/`TaskRouter`, replacing the currently-dead
`HeidiController`") assumed `pao-system/agents/*.ts` was a reusable
executor backend once wired up. Investigation before writing any code
found that's wrong: `pao-system/agents/*.ts`'s ~56 event types
(`DESIGN_CONTAINER_MODULE`, `BUDGET_ALLOCATION`, `GRANT_SEARCH`,
`HVAC_MANAGEMENT`, ...) are all specific to a simulated company that
designs/funds/builds physical infrastructure — zero overlap with Heidi's
real 5 action types (`create_task`, `send_email`, `update_database`,
`fetch_data`, `schedule_event`). Its `handle_event()` contract
(`Promise<void>`, fire-and-forget via `console.log`-style event emission)
is also incompatible with `ActionExecutor`'s typed, awaitable
`{status, result|error}` shape. `agents/specialized/*.js` was already
ruled out of scope (Phase 0, it's the separate `hydi-protoforge` PM2
deployment). Neither roster fits.

- ✅ **Built a small, purpose-fit roster instead**: `lib/agents/` —
  `TaskAgent`, `EmailAgent`, `DatabaseAgent`, `DataFetchAgent`,
  `SchedulingAgent`, one per real action type, plus `AgentRegistry`
  (`lib/agents/registry.ts`). Each agent delegates the actual work to
  `ActionExecutor` (no duplicated Supabase/email logic — that would just
  be moving the same code, not adding a layer) and adds per-agent metrics
  (`tasksHandled`/`successCount`/`failureCount`/`lastActiveAt`) that
  `ActionExecutor` alone didn't track. That's the real "multi-agent"
  value this phase adds: per-type ownership and observability, not a
  reused business-simulation roster.
- ✅ Wired into `lib/orchestrator.ts`: approved actions route through
  `agentRegistry.getAgentFor(action.type)` when a matching agent exists,
  falling back to calling `ActionExecutor` directly otherwise (so a 6th
  action type doesn't require touching the routing code). Agent metrics
  surface via `getSystemStatus()`.
- 17 new tests (`tests/unit/agents.test.ts`). Full suite: 1037/1037
  passing, typecheck clean.
- **Known gap found during this phase, not yet resolved**: a fourth,
  previously-unaudited CASCADE/KILO/ProtoForge-shaped implementation,
  `lib/replay-engine.ts`, was found dormant (reachable only via the
  also-unmounted `api/traces.js`) — see the "Known gap in the Phase 0
  audit" note near the top of this document. Left in place; the original
  Phase 0 audit was not exhaustive.

### Phase 4 — Autonomous work sessions
- Depends on Phase 2's plan representation and Phase 3's multi-agent execution. Not meaningfully startable before those land — this is where "improve the ProtoForge website, plan/execute/test/commit/report" becomes possible, and where `HYDI_GAME_PLAN.md`'s P3 ("make Hydi actionable") graduates from bug-fixing individual core-loop methods to running on the consolidated kernel.

### Phase 5 — Metrics and learning from experience
- Task success rate, retry counts, planning accuracy, memory retrieval quality, user-correction rate — instrument once Phase 1-2 give a single place (the kernel spine) where every task passes through once, instead of an unknown number of times across five parallel paths.

---

## Non-goals (explicit, to prevent scope creep back into the fragmented state)

- No new orchestrator class, event bus, or agent base class until Phase 0's triage is done and confirmed with the maintainer.
- No new memory store — extend `memories`/`sessions`, don't add a fourth.
- KILO retains no execution authority at any phase (`execute()` still throws unconditionally) — planning extensions in Phase 2 add *plan steps to gate*, never a bypass of ProtoForge's approve/reject/escalate decision.
