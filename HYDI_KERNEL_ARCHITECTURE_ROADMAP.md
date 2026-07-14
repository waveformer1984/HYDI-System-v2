# HYDI Kernel: Architecture Roadmap

**Status:** Proposal — no code changed by this document
**Date:** 2026-07-13
**Scope:** Answers "if AGI-grade autonomy is the long-term goal, what's the highest-leverage architectural work right now?"
**Relationship to other docs:** `ROADMAP.md` covers the six-layer event pipeline's near/medium/long-term feature work. `HYDI_GAME_PLAN.md` covers this week's operational punch list (env repair, PWA, core-loop bugs). This document is neither — it's the missing layer between them: which of the many orchestration systems already built in this repo becomes *the* kernel, and in what order to wire it up for real.

---

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
- Confirm with the maintainer which of the dormant systems are genuinely abandoned vs. "built ahead of being wired up on purpose." Do not delete anything without that confirmation — some of this (e.g. `pao-system/agents/*.ts`'s cleaner state model) is worth keeping as the *target* implementation, just not worth running two more copies of in parallel.
- Pick one specialist-agent roster (`pao-system/agents/*.ts` recommended — better concurrency model via `status`/`load`/`maxConcurrency`, and it's what `AgentRegistry`/`TaskRouter` already assume) and one hypothesis/policy pipeline (`kilo/` + `lib/protoforge/`, since it already matches the documented architecture and has tests). Archive or delete the alternates (`agents/specialized/agent-factory.js`'s 3-of-15 partial roster, the `modules/*-v2.js` family, `src/server.js`'s module set) once Phase 0 confirms they're not load-bearing elsewhere.
- This directly unblocks `ROADMAP.md`'s existing Q3 2026 items ("Pipeline observability," "PolicyEngine expansion") — those assume the pipeline is live; today it isn't.

### Phase 1 — Wire the kernel spine
- Make `lib/orchestrator.ts` (the confirmed production path under the local-first decision) the one caller of: `kilo/index.js`'s `generateHypotheses()` → `lib/protoforge/auto-gate.js`'s `autoGate()` → the chosen agent roster's `handle_event()`. This turns three dormant, individually-tested systems into one live path instead of three.
- Fix the `sessions` triple-write problem: pick one module as the single writer (extend `lib/heidi-memory.ts`'s pattern — it already proves centralization works for `memories`), have `ModelManager` and `dispatcher.ts` call through it instead of writing directly.
- Exit criterion: a message through `/api/chat` in production (Ollama path) actually produces a CASCADE classification, a KILO hypothesis, and a ProtoForge approve/reject/escalate decision recorded in the `decisions` table — today none of that happens on the live path.

### Phase 2 — Planning, episodic memory, self-evaluation
- Extend the hypothesis object (`{confidence, risk, revenue_impact}`) with a step/plan representation so ProtoForge is gating *steps of a plan*, not just single classifications — this is the natural generalization path identified in the audit (item 6), not a new planner.
- Episodic memory: add an `experiences` table (or extend `memories` with a `kind: 'episodic'` row type) storing `{problem, actions_taken, outcome, lesson}`, written by the same action-execution path that already exists in `lib/action-executor.ts`.
- Self-evaluation: after every `ActionExecutor.execute()` call, record success/failure and feed it into the `decisions` audit trail ProtoForge already writes — extending an existing table beats adding a new one.

### Phase 3 — Multi-agent collaboration
- Only once Phase 1's single path is proven reliable: bring the chosen 15-role agent roster onto the live path via `AgentRegistry`/`TaskRouter`, replacing the currently-dead `HeidiController` wiring with a real instantiation behind the kernel spine.

### Phase 4 — Autonomous work sessions
- Depends on Phase 2's plan representation and Phase 3's multi-agent execution. Not meaningfully startable before those land — this is where "improve the ProtoForge website, plan/execute/test/commit/report" becomes possible, and where `HYDI_GAME_PLAN.md`'s P3 ("make Hydi actionable") graduates from bug-fixing individual core-loop methods to running on the consolidated kernel.

### Phase 5 — Metrics and learning from experience
- Task success rate, retry counts, planning accuracy, memory retrieval quality, user-correction rate — instrument once Phase 1-2 give a single place (the kernel spine) where every task passes through once, instead of an unknown number of times across five parallel paths.

---

## Non-goals (explicit, to prevent scope creep back into the fragmented state)

- No new orchestrator class, event bus, or agent base class until Phase 0's triage is done and confirmed with the maintainer.
- No new memory store — extend `memories`/`sessions`, don't add a fourth.
- KILO retains no execution authority at any phase (`execute()` still throws unconditionally) — planning extensions in Phase 2 add *plan steps to gate*, never a bypass of ProtoForge's approve/reject/escalate decision.
