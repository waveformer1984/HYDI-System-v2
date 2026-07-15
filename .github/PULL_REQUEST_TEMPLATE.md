## What does this PR do?
<!-- One sentence summary -->

## Why?
<!-- Context: what problem does this solve, what issue does it close? -->
Closes #

## Changes
- 
- 

## Subsystems affected
- [ ] Ingestion Layer
- [ ] RAW EVENT LEDGER
- [ ] CASCADE (classifier)
- [ ] KILO (hypothesis generator)
- [ ] ProtoForge (policy engine / DSL)
- [ ] Emission Layer
- [ ] Replay Engine
- [ ] PAO System (`pao-system/`)
- [ ] API Layer (`api/`)
- [ ] Supabase Edge Functions (`supabase/functions/`)
- [ ] Revenue Engine (`revenue-engine/`)
- [ ] Workers (`workers/`)
- [ ] Frontend (`pages/`, `components/`)
- [ ] HeidiOrchestrator / HybridModelStack / HeidiCoreLoop
- [ ] Config / Infrastructure

## Pipeline integrity
<!-- The six-layer pipeline constraint: each layer does exactly one job. Verify before submitting. -->
- [ ] Ingestion Layer: normalizes structure only — no interpretation
- [ ] CASCADE: classifies events only — no execution, no hypothesis generation
- [ ] KILO: generates hypotheses only — `execute()` remains unconditionally throwing, never produces side effects
- [ ] ProtoForge: policy decisions only — accepts/rejects/escalates KILO output, does not execute
- [ ] Emission Layer: SSE/API/logs only — no logic
- [ ] RAW EVENT LEDGER is unchanged (append-only, immutable, hashed)
- [ ] Not applicable — no pipeline layer was modified

## Database / migrations
<!-- Every item below must be checked if a new `.sql` migration file was added. -->
- [ ] No new migrations in this PR
- [ ] New migration has a corresponding test in `tests/migrations/<version>.test.js`
- [ ] Any enum or allowed state-machine transition changed → add `STATE_MACHINE_APPROVED` to the PR description body
- [ ] Superseded migration uses `.sql.skip` suffix

## Worker registration
- [ ] No new workers added
- [ ] New worker added to `workers/` and registered in `WorkerOrchestrator.js`

## Testing
- [ ] `npm run typecheck` passes — zero new TypeScript errors introduced
- [ ] `npm test` passes (all unit tests)
- [ ] `npm run test:integration` passes, or intentionally skipped with reason (requires live env vars)
- [ ] New behaviour covered by a new test
- [ ] Coverage not decreased

## Security
- [ ] No secrets, API keys, or service-role credentials committed
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is server-side only — never passed to client bundles
- [ ] All `catch` variables typed `unknown` and guarded: `error instanceof Error ? error.message : 'Unknown error'`

## Checklist
- [ ] No breaking changes to public API — or breaking changes are explicitly documented in this PR
- [ ] Modified Edge Functions remain pure ESM (Deno-compatible; no `require()`)
- [ ] `system_dashboard` Supabase view is unaffected, or health endpoints updated to handle any schema change gracefully
- [ ] `nnotification.service.ts` double-`n` filename preserved (do not rename until all imports are updated together)
