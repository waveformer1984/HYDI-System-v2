# REVENUE_CAPABILITY_AUDIT

**Mission:** HYDI-REVENUE-001  
**Date:** 2026-11-19  
**Repo:** HYDI-System-v2 @ branch `cursor/hydi-revenue-001`  
**Environment:** Cursor Cloud Agent (no Frank/PM2; no live Supabase credentials on VM)

Classification legend: **OPERATIONAL** (verified this run), **PARTIAL** (code path exists, live not verified), **UNVERIFIED** (not tested), **BLOCKED** (missing creds or dependency).

## Executive summary

HYDI already contains a substantial revenue stack: job discovery (`lib/job-scout/`), opportunity scoring and lifecycle (`lib/revenue-ops/`), approval-gated proposals, simulated execution bridge, Stripe Connect routing for six streams, and mobile revenue-ops API. This audit confirms **unit-test coverage for the freelance pipeline (mocked)** and **no claim of live collected revenue** on the agent VM.

## Subsystem audit

| Capability | Location | Classification | Evidence |
|------------|----------|----------------|----------|
| Heidi orchestration | `heidi-core/`, `api/chat/`, PAO | PARTIAL | Architecture docs; chat tests not run this mission |
| Model Gateway / local inference | `lib/ModelManager.ts`, Ollama env | UNVERIFIED | No Ollama on cloud VM |
| Web research | `lib/job-scout/`, distributed discover | PARTIAL | Read-only adapters; Upwork blocked honestly |
| Lead discovery | `lib/job-scout/scout.js` | OPERATIONAL (mocked) | `revenue-ops-acceptance.test.js` discover path |
| CRM / pipeline | `lib/revenue-ops/store.js`, **new** `customer-pipeline.js` | OPERATIONAL (unit) | `revenue-agent-mission.test.js` |
| Web / API infra | Next.js `pages/api/heidi-mobile/revenue-ops.js` | PARTIAL | Route exists; not HTTP-tested on VM |
| Payments | Stripe Connect `api/`, `lib/billing/` | PARTIAL | Connect tests in repo; live keys absent on VM |
| Proposal generation | `lib/revenue-ops/proposal.js` | OPERATIONAL (mocked) | Acceptance test proposal_ready |
| Execution fabric | `lib/revenue-ops/execution-bridge.js` | OPERATIONAL (simulated) | Acceptance test fabric job |
| Persistent memory | `heidi-core/memory/` | UNVERIFIED | Not in revenue path this run |
| Revenue reporting | `lib/revenue/stripe-mode.ts`, detectors, **new** `financial-ledger.js` | PARTIAL | Ledger unit-tested; mobile-status not run |
| Revenue Agent slice | `lib/revenue-ops/revenue-agent.js` | OPERATIONAL (read-only) | Daily workflow test passes |
| PAO Revenue Agent | `pao-system/agents/business/revenue.agent.ts` | UNVERIFIED | Typecheck not run this slice |

## Tests executed (this mission)

| Command | Result |
|---------|--------|
| `npx jest tests/unit/revenue-ops-acceptance.test.js` | **PASS** (5/5) |
| `npx jest tests/unit/revenue-agent-mission.test.js` | **PASS** (5/5) |

## Gaps and blockers

1. **No live Stripe** on cloud agent — cannot verify cleared payments without operator keys.
2. **Frank / heidi-mobile-chat** unreachable from cloud — per `docs/PHONE_ACCESS.md`.
3. **Customer conversations and paid pilot** — acceptance criteria 6–8 require operator on Frank with owner approval for outreach and charging.
4. **Detailer Bot product** — `detailer_bot` stream configured in scripts; no audited production customer in this environment.

## Reuse directive

Do **not** build a second orchestrator. Extend `lib/revenue-ops/` + governed `revenue-agent.js` and existing approval gates (`approval.js`).