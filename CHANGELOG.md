# Changelog

All notable changes to HYDI System v2 are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Secret redaction and correlation-ID propagation (`AsyncLocalStorage`) in `lib/structured-logger.js`, plus its first test coverage (`tests/unit/structured-logger.test.js`, 11 tests). See `ISSUES_FOUND.md` #72.
- End-to-end shutdown and recovery test suite `tests/unit/hydi-v3/ShutdownRecovery.test.js` covering graceful shutdown persistence, restart state restoration, repeated start/stop cycle integrity, and `GracefulShutdown`-coordinated flush with recovery-time assertions.

### Changed
- Migrated `console.*` logging to the structured logger in `workers/` (all 19 files, 302 calls) and mostly in `agents/`/`revenue-engine/` (118 of 204 calls; the rest is deliberately-preserved interactive CLI output). `src/`, `api/`, `lib/`, `pages/` still use `console.*` and are tracked as a follow-up (`ROADMAP.md` near-term item 11).
- Expanded `next.config.js`'s `eslint.dirs` to cover `workers/`, `agents/`, `revenue-engine/`, `api/`, `kilo/` — `npm run lint` (and therefore CI's lint gate) had silently never scanned them before. Set `no-console` to `"warn"`.

### Fixed
- Eliminated all 201 `no-unused-vars` ESLint warnings across 49 files in `pages/`, `components/`, `lib/`, `src/` (`ROADMAP.md` P2 #8, `ISSUES_FOUND.md` #71). Two entirely dead functions removed (`src/queue/RedisStreamBroker.js`'s `redisCommand`, `src/server.js`'s `persistEventToDatabase`); no exports, signatures, or runtime behavior changed.
- Corrected `ISSUES_FOUND.md` #19's stale status — the `WatchdogSupervisor.test.js` flaky-race fix had already landed in a prior commit but was still documented as open.
- 4 real runtime bugs found by the lint-scope expansion above, all previously invisible to CI: an undefined-variable `ReferenceError` in `workers/InventoryMaterialsWorker.js`'s material-reservation insert, a `ReferenceError` on every *successful* task completion in `revenue-engine/revenue-engine-v2.js`'s `executeTask()`, and a `TypeError`-on-certain-inputs `const` reassignment bug in two `agents/specialized/business-agents.js` revenue calculators. See `ISSUES_FOUND.md` #74.
- Debounced `persist()` in `MissionPlanner`, `DecisionIntelligence`, and `ReflectionEngine` to eliminate O(n) file writes per mutation, cancel pending writes on `destroy()`, and resolve the `ArchitectureAudit` warning about unawaited async persists. `tests/unit/hydi-v3/PerformanceBenchmark.test.js` now passes (dropped from ~30s to ~6s) and the `reports meet targets` test has an explicit 30000ms timeout aligned with the suite's long-running benchmark tests.
- Fixed incorrect named-destructuring imports of `LocalModelAdapter` in `src/models/heartbeat.js` and `modules/ursula-service-bundle.js`; `src/models/local-model-adapter.js` exports the class as `module.exports`, so `require(...).LocalModelAdapter` was `undefined` and `new LocalModelAdapter()` threw "LocalModelAdapter is not a constructor". The heartbeat now initializes correctly and `subscription-manager.test.js` / `ursula-service-bundle.test.js` no longer log that error.

## [2026-06-27] — Documentation suite expansion

### Added
- `.github/ISSUE_TEMPLATE/pipeline-violation.md` — dedicated template for reporting pipeline layer boundary violations (KILO executing, Emission Layer adding logic, ledger mutation, Replay non-determinism, cooldown bypass), with evidence fields and reproduction steps
- `GOVERNANCE.md` — RFC process for significant changes (pipeline contract, schema, architectural constraints); new agent/worker approval policy requiring WorkerOrchestrator registration; security reference; see-also footer
- `SUPPORT.md` — issue template selection guide; "What to expect" section (response timings, urgency tiers, RFC pointer); see-also footer

### Changed
- `.github/PULL_REQUEST_TEMPLATE.md` — enriched with pipeline integrity checklist, DB migration section (migration test requirement, STATE_MACHINE_APPROVED gate, `.sql.skip` convention), worker registration check, `npm run typecheck` step, `SUPABASE_SERVICE_ROLE_KEY` server-side constraint, `unknown` catch guard, Edge Function ESM purity, `system_dashboard` stability, `nnotification.service.ts` rename warning
- `.github/ISSUE_TEMPLATE/bug_report.md` — added pipeline layer/subsystem checkboxes, `npm run typecheck` output field, log safety reminder
- `.github/ISSUE_TEMPLATE/feature_request.md` — added full pipeline layers checklist and pipeline constraint check section
- `CONTRIBUTING.md` — added first-time contributors section, `./verify-supabase.sh` note in migration checklist, changelog policy section, see-also table
- `SECURITY.md` — added GitHub private security advisory as preferred channel, coordinated disclosure timeline table, see-also footer
- `CODE_OF_CONDUCT.md` — added reporter confidentiality paragraph, see-also footer

## [2026-06-22] — Documentation suite

### Added
- `CLAUDE.md` — comprehensive AI assistant reference covering pipeline architecture, API routes, workers, DSL policy engine, and ops scripts
- `README.md` — rewritten to reflect current architecture (six-layer pipeline, named agents, API routes, Edge Functions, CI workflows)
- `.cursorrules` — prescriptive Cursor IDE AI rules covering pipeline constraints, KILO execution prohibition, PolicyEngine fail-closed, TypeScript conventions, and secret handling
- `AGENTS.md` — autonomous AI agent guidelines covering verification commands, codebase navigation, and hard constraints
- `CONTRIBUTING.md` — full contributor guide with setup, PR checklist, DB migration governance, and CI summary
- `SECURITY.md` — vulnerability reporting process, scope, known limitations, and security controls
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1

## [2026-06-19] — Worker stability fix

### Fixed
- Restored `DecisionAssistWorker` registration in `WorkerOrchestrator.js` — omission was causing a startup crash loop

## [2026-06-18] — Mobile status endpoint + stream health watchdog

### Added
- `api/mobile-status.js` — compact, 3G-safe single-round-trip endpoint returning `{ ok, alert, system, drift, heals_24h, streams, silent, ms, ts }`
- `supabase/functions/stream-health-watchdog/` — Edge Function monitoring Redis stream health

## [2026-06-17] — Security hardening: SECURITY DEFINER search_path

### Security
- Pinned `search_path` on 17 `SECURITY DEFINER` functions across Supabase migrations to prevent SQL injection via search path manipulation (#88)

## [2026-06-16] — DSL policy engine, KILO entry point, ops tooling

### Added
- `kilo/index.js` — CommonJS entry point for the KILO hypothesis generator; exports `{ KiloEngine, createKiloEngine }`; `execute()` throws unconditionally (KILO never acts)
- `lib/protoforge/policy-engine.js` — DSL rule evaluator with operators `gte`, `lte`, `gt`, `lt`, `eq`, `neq`, `in`, `nin`; fail-closed (default `'reject'`); hot-reloads via Supabase Realtime
- `lib/protoforge/auto-gate.js` — automatic wrapper that runs PolicyEngine on every KILO output before Emission Layer
- `supabase/functions/protoforge-calibration/` — calibration feedback loop adjusting rule weights via `calibrate_protoforge_decisions()` RPC
- `workers/DecisionAssistWorker.js` — polls for decision-assist tasks across financial_planning, resource_allocation, risk_assessment, system_optimization
- `verify-supabase.sh` — health check script verifying Supabase connectivity and key tables

### Fixed
- CI action versions pinned to v4 to resolve broken `clean-main` CI (#86)

### Security
- Resolved multiple npm CVEs (form-data CR/LF escape, tar PAX header, postcss)

## [2026-05-28–29] — KILO→ProtoForge automatic gating pipeline

### Added
- `lib/protoforge/` foundation: `policies` and `decisions` Supabase tables
- KILO→ProtoForge automatic gating pipeline — every KILO hypothesis now passes through PolicyEngine before reaching the Emission Layer
- ProtoForge calibration worker and migration (feedback loop layer 3)
- 29 unit tests for the DSL policy engine

### Fixed
- 10 bugs across Ursula heartbeat, SSE stream, and SSE manager

## [2026-05-27] — Ops substrate + security hardening

### Added
- Ops substrate: infrastructure health bridge, enforcement modules re-enabled
- HeidiCoreLoop unit test suite (35 tests)
- `selfHealing` and `redisStream` integrated into `HeidiCoreLoop.executeLoop()`
- Stripe Connect setup script

### Fixed
- RLS enabled on 4 previously unprotected public tables (Advisor CRITICAL)
- Resolved all 9 failing unit test cases
- Resolved postcss CVE GHSA-qx2v-qp2m-jg93 via dependency override
- Scoped Babel to Jest only; Next.js build now uses SWC

## [2026-05-19–21] — Phase 5: meta-cognition + local mobile chat

### Added
- Phase 5 autonomous reasoning queue wired to real HYDI infrastructure
- Phase 5 meta-cognition and knowledge synthesis engine
- Context feedback loop — synthesized insights injected into `/think` prompt
- Local mobile chat with streaming, TTS, voice input, and Ollama integration
- HYDI cognitive loop, governance gate, and automated deployment
- HEIDI diagnostic script and PM2 service setup

## [2026-05-16] — Phase 1+2: telemetry, self-healing, Redis, ProtoForge runtime

### Added
- Telemetry self-healing engine (`SelfHealingService`) and Redis stream broker for the core loop
- Replay history migration, traces API (`api/events/stream.js`), and trace viewer UI pages
- ProtoForge core runtime: task engine, message bus, memory, safety, observability modules
- Service-to-service HMAC auth on `api/chat` (#30)
- TermuxBridge JS client (`termuxClient`)
- `api/mobile-status.js` precursor: lazy env loading and unit tests for self-healing + Redis broker
- Registered Rezonate as HYDI federation node
- Heidi self-optimization: Vercel admin handler + TermuxBridge infra integration
- Deploy hook self-provisioning and end-to-end smoke test

## [2026-04-24] — Monetization deployment + initial foundation

### Added
- Complete HYDI monetization deployment: Stripe Connect sub-accounts for `galactic_bytes`, `detailer_bot`, `lipi_v2`, `protogrance_aromatics`, `rezonate`, `waveformer_studio`
- Adaptive feedback loop with working memory buffer
- Supabase migrations for core ledger, clients, payouts, and revenue pipeline tables
- Phase 1 repository: clean repo initialization with full file tracking
- `hdi-governance-gate.yml` CI workflow (7-gate schema review for migrations)
- `unit-tests.yml` CI workflow with Codecov integration

[Unreleased]: https://github.com/waveformer1984/HYDI-System-v2/compare/HEAD...HEAD
