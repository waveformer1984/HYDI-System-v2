# Partnerships & Funding workflow

**Objective:** Discover programs from **official sources**, evaluate fit against an **owner-approved profile**, prepare **evidence-backed drafts**, and queue **explicit owner approval** before any external action. This is not an autonomous application bot.

## Reused HYDI components

| Concern | Reuse |
|---------|--------|
| Persistence | File store `.runtime/partnerships-funding/` (`HYDI_PARTNERSHIPS_DIR`) — same pattern as job-scout |
| Approvals | Pipeline state `awaiting_approval`; no `submitted` without `submission_reference` evidence |
| Mobile | `GET /api/heidi-mobile/partnerships` (guard + snapshot) |
| Execution | **No** ExecutionGateway for external submit v1 — drafts only |
| Missions | Future: heidi-core mission for owner Q&A on `missing_facts` |

**Not used yet:** Frank, recurring cron, paid research APIs, production Postgres migration.

## Bounded roles (one coordinator)

| Role | Module | Output |
|------|--------|--------|
| Opportunity Scout | `roles/scout.js` | Deduplicated opportunity record |
| Eligibility Analyst | `roles/eligibility.js` | eligible / ineligible / unknown + missing facts |
| Application Writer | `roles/writer.js` | Owner-reviewable draft |
| Partnership Coordinator | `coordinator.js` | Pipeline transitions, dedupe |
| Portfolio Monitor | `roles/monitor.js` | Deadlines + status counts |

## Pipeline

```text
discovered → needs_verification → needs_owner_information | qualified
  → drafting → awaiting_approval → submitted (evidence required)
  → follow_up → awarded (evidence required) | declined | closed
```

## Organization profile

Template: `docs/partnerships/organization-profile.template.json`

- `approved_by_owner` must be **true** after operator review  
- Unknown facts stay `UNKNOWN` — eligibility returns **unknown**, not eligible  

## First milestone (implemented)

**Program:** OpenAI for Startups — API credits via eligible VC partners  
**Source:** https://openai.com/business/why-openai/startups/  
**Fixture:** `tests/fixtures/partnerships/openai-for-startups-vc-api-credits.json`  

**Honest result with default profile:** `unknown` / `needs_owner_information` — VC backing and referral not confirmed. Draft is generated for **owner review only** with unresolved questions.

## Mobile UI

`GET /api/heidi-mobile/partnerships` returns:

- `research_status` — `no_verified_opportunities_loaded` vs `opportunities_loaded` vs `unavailable` on error  
- Highest-fit list with `eligibility_result`, deadlines, drafts awaiting review  
- `org_profile_approved` flag  

**Future:** PWA card in `components/heidi-mobile/` (not in v1 PR).

## Research rules

1. v1 **does not** scrape the web in production — intake via fixtures or operator-provided official fields  
2. Directory sites (e.g. awesome lists) are **leads only** — not stored as authoritative  
3. Anthropic / GitHub programs: add separate opportunity records with distinct `dedup_key` (fixtures phase 2)  

| Program | Official URL | Benefit type |
|---------|----------------|--------------|
| Anthropic Claude for Startups | https://claude.com/programs/startups | credits / support (verify terms) |
| GitHub for Startups | https://github.com/enterprise/startups | platform credits (not cash) |
| GitHub Fund | https://github.com/open-source/github-fund | investment / OSS (separate from startup credits) |

## Phase 2 (requires approval)

| Item | Gate |
|------|------|
| Scheduled discovery | Operator approves frequency + budget |
| Web fetch of official pages | Sandboxed + citation storage |
| Postgres mirror | Migration + RFC |
| External submit automation | **Out of scope** until manual track record |

## Tests

```bash
npx jest tests/unit/partnerships-funding.test.js --runInBand
```

## Environment

- `HYDI_PARTNERSHIPS_DIR` — isolated store path for tests and cloud agents  
- Never write `.runtime/state.json`