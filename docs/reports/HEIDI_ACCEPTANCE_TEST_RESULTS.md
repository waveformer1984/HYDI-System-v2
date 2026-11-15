# Heidi acceptance test results

**Run date:** 2026-11-15  
**Baseline SHA:** `e12fac21` (includes merged NCM experimental, env-gated)

Legend: **PASS** (live) · **SIMULATED** · **BLOCKED** · **FAIL**

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Frank telemetry from real host | **BLOCKED** | Cloud agent cannot reach DESKTOP-I719OIN; use `scripts/frank-production-truth-collect.ps1` |
| 2 | Telemetry reports unavailable services | **SIMULATED** | `tests/unit/frank-truth-loader.test.js` missing/stale files |
| 3 | Agent capabilities registered | **PASS** | `lib/revenue-ops/capabilities.js` + unit tests |
| 4 | Unauthorized actions rejected | **SIMULATED** | `tests/unit/authorization-provenance.test.ts`, mobile token tests |
| 5 | Approved jobs → lifecycle transitions | **SIMULATED** | `tests/unit/heidi-core-loop.test.js`, mission lifecycle |
| 6 | Failed jobs produce evidence | **SIMULATED** | `DecisionEvidence`, mission events |
| 7 | Cancellation works | **SIMULATED** | mission lifecycle tests |
| 8 | Opportunity discovery real records | **PASS** | `HEIDI_LIVE_OPPORTUNITY_DISCOVERY.json` LIVE fetch 2026-11-15 |
| 9 | Scoring uses verified capabilities | **PASS** | `revenue-ops-acceptance.test.js` + live report assessments |
| 10 | Proposal drafts approval-gated | **PASS** | Scout drafts only; connectors document blocked submit |
| 11 | Delivery pipeline tracking | **SIMULATED** | `revenue-ops/store.js` hermetic tests |
| 12 | Payment requires evidence | **SIMULATED** | resource-acquisition guards tests |
| 13 | Model routing respects limits | **SIMULATED** | paid-llm-gate, NCM off by default |
| 14 | Recovery / error handling | **SIMULATED** | execution-fabric recovery unit tests |
| 15 | Full integration objective | **BLOCKED** | Requires Frank + tailnet + human approvals |

## Commands used (this run)

```bash
node scripts/generate-live-opportunity-report.js
npx jest tests/unit/frank-truth-loader.test.js tests/unit/execution-fabric-mission-bridge.test.js
```