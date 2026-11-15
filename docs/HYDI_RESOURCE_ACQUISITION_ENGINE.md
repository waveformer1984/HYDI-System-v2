# HYDI Resource Acquisition Engine (v1)

**Evolution of:** `lib/partnerships-funding/` (PR #593)  
**Objective:** Operational **discover → qualify → prioritize → prepare → track → integrate** without always-on agents or automatic external commitments.

## Architecture

```text
Official source / fixture intake
    → PartnershipStore (dedupe)
    → Eligibility (org profile facts only)
    → Priority score (deterministic)
    → Draft (awaiting_approval)
    → SUBMITTED / AWARDED (evidence only — operator)
    → Integration plan (hints, no auto-apply)
```

**Entry class:** `ResourceAcquisitionEngine` in `lib/partnerships-funding/resource-engine.js`  
**Mobile:** `GET /api/heidi-mobile/partnerships` → `acquisitionSnapshot()` with `highest_fit`  
**CLI:** `node scripts/resource-acquisition-pass.js`

## Capabilities (v1)

| Capability | Automated? | Approval |
|------------|------------|----------|
| Discover (fixtures + manual intake) | Yes | No |
| Qualify | Yes | Profile must be owner-approved |
| Prioritize | Yes | No |
| Prepare draft | Yes | Drafts → `awaiting_approval` |
| Submit | **No** | `recordSubmission()` + evidence |
| Award tracking | **No** | `recordAward()` + `award_reference` |
| Integrate resources | **No** | `integrationPlan()` hints only |

## Zero-cost-first prioritization

Higher scores for:

- Open/rolling applications
- Match to `goals.requested_support` (e.g. `api_credits`)
- Zero-cost education (Build Hours, community)
- Eligible > unknown > ineligible

Lower scores for paths that need VC referral when profile has `UNKNOWN` funding facts.

## Recurring discovery

**Not enabled.** `acquisitionSnapshot().recurring_discovery.enabled = false` until operator approves frequency, budget, and failure behavior.

## Execution fabric

Integration step may suggest `health.check` after credentials exist — optional, via existing **ExecutionGateway**, not a second engine.

## Related docs

- `docs/PARTNERSHIPS_FUNDING_WORKFLOW.md`
- `docs/OPENAI_RESOURCE_OPPORTUNITIES.md` (master mission branch)
- `docs/HYDI_ZERO_COST_INFRASTRUCTURE_EXPANSION.md` (master mission branch)

## Tests

```bash
npx jest tests/unit/partnerships-funding.test.js tests/unit/resource-acquisition-engine.test.js --runInBand
```

**Classification:** VERIFIED SIMULATED