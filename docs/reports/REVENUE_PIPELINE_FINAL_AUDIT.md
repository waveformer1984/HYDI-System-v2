# Revenue pipeline final audit

**Discovery artifact:** `docs/reports/HEIDI_LIVE_OPPORTUNITY_DISCOVERY.json`  
**Generated:** `2026-11-15T21:50:14.230Z`  
**Mode:** `LIVE` (public APIs: Freelancer, Remotive, RemoteOK; Upwork/Fiverr blocked per connectors)

## Provenance

| Field | Value |
|-------|-------|
| Script | `scripts/generate-live-opportunity-report.js` |
| qualified in discovery | **24** (`opportunities[].assessment.qualified === true`) |
| assessed total | 50 (per report narrative) |
| Human gates in artifact | `human_approval_required_before`: client_contact, proposal_submission, contract_acceptance |

## Import audit (`sync-revenue-pipeline-from-discovery.js`)

| Metric | Value | Notes |
|--------|-------|-------|
| Rows read from discovery | 24 | Filter `assessment.qualified` |
| Store rows created | 24 | `syncFromScoutLeads` |
| Still qualified after **store reassessment** | **18** | 6 rejected on re-run of `assessOpportunity` (config/score drift vs discovery snapshot) |
| Pipeline JSON rows | 18 | Acceptance lists only post-reassessment qualified |
| States after sync | 18 × `AWAITING_APPROVAL` (from `PROPOSAL_READY`) | No `SUBMITTED` |

**Integrity finding:** Discovery and store assessors can disagree. Before external submit, re-run assessment on Frank or refresh discovery; do not treat all 24 as pipeline-ready without reconciling the 6 rejects.

## Duplicate detection

- Opportunity IDs are stable hashes in discovery JSON; store upserts by `id` — **no duplicate IDs** in acceptance export (2026-11-15 re-sync).

## Listing freshness

- **Not verified at final acceptance** — discovery timestamps are ~21:50 UTC 2026-11-15 only.
- **Next action:** optional re-run `generate-live-opportunity-report.js` before human approval.

## Revenue potential

- Ranked by `opportunity_score` / economics in `HEIDI_REVENUE_PIPELINE_ACCEPTANCE.json`
- Top row at audit: `c42fdafa52473930` — React & Supabase CRM (score 87)

## Forbidden actions (verified by code review)

- Sync script: no HTTP submit, no email, no account APIs
- All exported rows: `human_approval_required_before_submit: true`

## Evidence files

- `docs/reports/HEIDI_REVENUE_PIPELINE_ACCEPTANCE.json`
- `docs/reports/HEIDI_REVENUE_PIPELINE_REPORT.md`