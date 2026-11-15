# HYDI revenue agent architecture

## Existing foundations

| Module | Role |
|--------|------|
| `lib/job-scout/` | Discovery (fixtures / fetch) |
| `lib/distributed-cloud/freelance-bridge.js` | Queue discover tasks (PR #590) |
| `lib/billing/` | Subscription entitlements (separate from Connect ledger) |
| Stripe Connect APIs | Six revenue streams (`.cursorrules`) |
| `operational_boundary` + stripe mode | Exclude test data from detectors |
| Mobile revenue ops | PR #589 track (coordinate before merge) |

## Proposed agent capabilities

| Agent role | Capability | Approval |
|------------|------------|----------|
| Freelance Discovery | `job_scout` / distributed discover | Read-only default |
| Proposal drafter | `external:draft` permission | Human before send |
| Finance Analyst | `revenue:read`, billing preflight | View-only |
| Business Development | Scoring in mission docs only | No auto-submit |

## Job-to-payment-to-delivery (controlled)

```text
Discover (read-only) → Score (human review) → Draft proposal (approval)
  → [operator] submit → Stripe job / Connect ledger → Delivery via fabric jobs
```

## Integration with ExecutionGateway

- Prefer fabric capabilities from `lib/mobile-ops/action-catalog.js`  
- Do **not** add freelance submit without `confirmRequired` + approval  

## Tests (existing / PR)

- `tests/unit/distributed-cloud-acceptance.test.js` #6–#8 (PR #590)  
- Revenue unit suites on `clean-main`  

**Classification:** VERIFIED SIMULATED for discovery path; live Stripe **REQUIRES OPERATOR APPROVAL**