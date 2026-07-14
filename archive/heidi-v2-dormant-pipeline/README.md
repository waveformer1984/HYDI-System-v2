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

## Deliberately NOT moved here

Five files from the same pipeline family stay in `modules/` even though they
are equally unreachable from production:

- `raw-event-ledger-v2.js`
- `cascade-classifier-v2.js`
- `kilo-analyzer-v2.js`
- `protoforge-policy-v2.js`
- `replay-engine-v2.js`

They have active Jest coverage in `tests/unit/replay-engine.test.js`, which
exercises the core "same RAW LEDGER input → same pipeline output" determinism
invariant that both architecture docs describe as central. Moving them would
break `npm test` / CI.

**Decision (2026-07-14): `kilo/` + `lib/protoforge/` is the canonical
pipeline, not this family.** `lib/protoforge/policy-engine.js` persists to
real Supabase tables (`policies`, `decisions` — see
`supabase/migrations/20260528000002_policies_table.sql` and
`..._decisions_table.sql`); this `modules/*-v2` family is entirely
in-memory with no persistence anywhere. `kilo/` + `lib/protoforge/` is also
better tested (3 test files vs. this family's 1) and is what real DB schema
already exists for.

That said, `kilo/` + `lib/protoforge/` currently has **no Raw Ledger or
Replay Engine equivalent at all** — that concept exists only in this
deprecated family. So these 5 files stay in `modules/` (not moved to
archive) until Phase 1/2 of `HYDI_KERNEL_ARCHITECTURE_ROADMAP.md` builds a
real ledger + replay capability against `kilo/`/`lib/protoforge/` and ports
`tests/unit/replay-engine.test.js`'s determinism assertions to it. At that
point this family can be archived outright.

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
