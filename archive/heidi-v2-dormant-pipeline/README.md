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
break `npm test` / CI. Before archiving them, either port that test to
exercise the `kilo/` + `lib/protoforge/` pipeline the roadmap recommends
building on instead, or decide this family — not `kilo/`/`lib/protoforge/` —
is the one to keep and wire up. That decision is deferred, not made here.

## Also NOT touched in this pass

The JS specialist-agent roster (`agents/specialized/agent-factory.js` and
siblings) and its entry point `protoforge-main.js` were initially proposed
for archiving alongside this pipeline, but turned out to be more entangled
than expected: `protoforge-main.js` is registered as a real app in
`ecosystem.config.js` (PM2), and `agents/specialized/security-agent.js` is
imported by `agents/ursula/ursula.js`, a separate live system. Archiving
that island needs its own dedicated review pass, not a batch move — left
in place pending that review.
