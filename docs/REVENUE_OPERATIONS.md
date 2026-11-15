# Revenue operations — freelance discovery & proposal pipeline

Extends the existing **Heidi job scout** (`lib/job-scout/`, `docs/JOB_SCOUT.md`) with capability matching, economics, approvals, and Execution Fabric handoff.

## Reused components

| Component | Role |
|-----------|------|
| `lib/job-scout/scout.js` | Read-only marketplace scan (Freelancer, Remotive, RemoteOK, HN) |
| `scripts/job-scout.js` / `hydi-schedulers` | Scheduled discovery (default 3h; configurable via `JOB_SCOUT_INTERVAL_MS`) |
| `lib/execution-fabric/gateway.js` | Contract execution tasks after operator approval |
| `pages/api/heidi-mobile/revenue-ops.js` | Mobile BFF (session + CSRF guard) |
| `heidi-core` missions | `job_scout_scan` allowlisted action |

## New components

| Path | Purpose |
|------|---------|
| `lib/revenue-ops/connectors.js` | Connector registry; **blocked** platforms reported honestly (Upwork, Fiverr, …) |
| `lib/revenue-ops/capabilities.js` | Verified capability catalog (repository evidence) |
| `lib/revenue-ops/scoring.js` | Match + opportunity score |
| `lib/revenue-ops/economics.js` | Gross/net profit and risk estimates |
| `lib/revenue-ops/store.js` | `.runtime/revenue-ops/opportunities.json` lifecycle store |
| `lib/revenue-ops/proposal.js` | Tailored proposals (no fabricated portfolio) |
| `lib/revenue-ops/approval.js` | Proposal version binding; blocks submission without approval |
| `lib/revenue-ops/execution-bridge.js` | Simulated contract → fabric task |
| `config/revenue-ops.json` | Economics thresholds (`scanIntervalMs` default **6h** proposal for ops policy) |
| `components/heidi-mobile/RevenueOpsView.tsx` | Mobile **Revenue** tab |

## Marketplace access matrix

| Marketplace | Access in repo | Notes |
|-------------|----------------|-------|
| Freelancer.com | **active** | Public API adapter |
| Remotive | **active** | Public API |
| RemoteOK | **active** | Public API |
| HN Seeking Freelancer | **active** | Algolia |
| Upwork | **blocked** | No permitted read-only integration |
| Fiverr, LinkedIn, Indeed, … | **blocked** | Not implemented; requires authorized APIs |

## Lifecycle

`DISCOVERED` → … → `PROPOSAL_READY` → `AWAITING_APPROVAL` → `SUBMITTED` → `ACCEPTED` → `EXECUTING` → `DELIVERED` → `PAID` (+ `REJECTED` / `EXPIRED` / `FAILED` / `CANCELLED`).

**Live marketplace submission is disabled** unless `REVENUE_OPS_ALLOW_SUBMIT=true`. Tests use `simulate: true`.

## Operator activation (Frank / host)

```bash
# One-shot scan + revenue-opportunity sync
node scripts/job-scout.js --once

# Verify stores
ls -la .runtime/job-scout/ .runtime/revenue-ops/

# Mobile: pair device → Revenue tab → approve proposals
```

Requires paired Heidi Mobile session and `HYDI_SERVICE_SECRET` on the host (unchanged from `docs/HEIDI_MOBILE.md`).

## Tests

```bash
npx jest tests/unit/revenue-ops-acceptance.test.js
npx jest tests/unit/job-scout.test.js
```

Master audit cross-reference: GitHub issue [#587](https://github.com/waveformer1984/HYDI-System-v2/issues/587).