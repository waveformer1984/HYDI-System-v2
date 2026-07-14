# Archived: HEIDI V2 orchestrator (unwired reference implementation)

Moved here 2026-07-14 as Phase 0 of `HYDI_KERNEL_ARCHITECTURE_ROADMAP.md`.

`heidi-v2-orchestrator.js` is the literal reference implementation of the
six-layer pipeline described in `HEIDI_V2_ARCHITECTURE.md` and
`GROUNDED_ARCHITECTURE.md` (Ingestion → RAW LEDGER → CASCADE → KILO →
ProtoForge → Emission). It was never called from any HTTP route, cron, or
process-manager entry — reachable only from the two manual scripts archived
alongside it (`test-heidi-v2.js`, `test-fixes.js`), which are not part of
`npm test` or any `package.json` script.

Moved here: `heidi-v2-orchestrator.js`, `ingestion-layer-v2.js`,
`emission-layer-v2.js`, `test-heidi-v2.js`, `test-fixes.js`.

## replay-family/ — the last 5 files, archived 2026-07-14

`replay-family/raw-event-ledger-v2.js`, `cascade-classifier-v2.js`,
`kilo-analyzer-v2.js`, `protoforge-policy-v2.js`, `replay-engine-v2.js` (plus
their test, `replay-family/replay-engine.test.js.bak`) were initially kept
in `modules/` rather than archived here, because they carried the only Jest
coverage in the repo for the "same RAW LEDGER input → same pipeline output"
determinism invariant.

**Decision (2026-07-14): `kilo/` + `lib/protoforge/` is the canonical
pipeline, not this family.** `lib/protoforge/policy-engine.js` persists to
real Supabase tables (`policies`, `decisions` — see
`supabase/migrations/20260528000002_policies_table.sql` and
`..._decisions_table.sql`); this family was entirely in-memory with no
persistence anywhere, and was less tested (1 test file vs. `kilo/`+
`lib/protoforge/`'s 3).

The blocker — no Raw Ledger or Replay Engine equivalent against
`kilo/`/`lib/protoforge/` — is now resolved:

- `lib/protoforge/raw-ledger.ts` — real, Supabase-backed, append-only
  (`supabase/migrations/20260714120000_raw_event_ledger_table.sql`;
  RLS has no UPDATE/DELETE policy for any role, enforcing immutability at
  the DB layer, not just in application code).
- `lib/protoforge/replay-engine.ts` — re-runs a stored event through
  `kilo/` + `lib/protoforge/` and diffs the result; `normalize()` /
  `compareWithStoredTrace()` / stats logic is a direct, dependency-free
  port of `replay-family/replay-engine-v2.js`'s core logic.
- `tests/unit/replay-engine.test.ts` — the determinism assertions ported
  onto the new engine (24 tests, dependency-injected instead of
  `jest.mock`'d module singletons).

Honesty note carried into the new code (see `replay-engine.ts`'s module
comment): there is still no real CASCADE classifier feeding a ground-truth
state snapshot, so `createReplayEngine()`'s `classify` stage is a
deterministic passthrough of the ledger event's own `event_type` field, not
real classification logic. That gap is unchanged from
`lib/protoforge/action-gate.ts`'s equivalent note — building a real CASCADE
classifier is separate future work.

## Also NOT touched in this pass

The JS specialist-agent roster (`agents/specialized/agent-factory.js` and
siblings) and its entry point `protoforge-main.js` were initially proposed
for archiving alongside this pipeline, but turned out to be more entangled
than expected: `protoforge-main.js` is registered as a real app
(`hydi-protoforge`) in `ecosystem.config.js` (PM2), and
`DIAGNOSTIC_AND_FIX_GUIDE.md` shows an operator actually running/restarting
it via PM2 on a real host. A dedicated review (see
`agents/specialized/README.md`) found this chain — `agent-factory.js`,
`business-agents.js`, `execution-agents.js`, `workflow-agent.js`,
`security-agent.js`, plus `modules/protoforge-integration.js` and its
dependents — is fully self-contained/in-memory (no Supabase, no `kilo/`,
no `lib/protoforge/`) and has zero Jest coverage, but archiving it is a
live-deployment decision, not a dead-code one, so it stays in place pending
the repo owner confirming whether `hydi-protoforge` is still wanted.

Correction: an earlier version of this note claimed
`agents/specialized/security-agent.js` is imported by `agents/ursula/ursula.js`.
That was wrong — the follow-up review found `ursula.js` has no dependency on
`agents/specialized/*` at all; the only real coupling into that roster runs
through `protoforge-main.js`.
