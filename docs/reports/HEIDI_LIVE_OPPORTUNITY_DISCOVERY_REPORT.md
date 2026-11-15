# Live opportunity discovery report

**Generated:** 2026-11-15 (cloud agent VM, **LIVE** network)  
**Script:** `scripts/generate-live-opportunity-report.js`  
**Raw JSON:** `docs/reports/HEIDI_LIVE_OPPORTUNITY_DISCOVERY.json`

## Summary

| Metric | Value |
|--------|-------|
| Sources polled (authorized public APIs) | Freelancer.com, Remotive, RemoteOK, HN |
| Raw rows fetched | 424 (362 + 35 + 27 + 0) |
| New leads retained (scout) | 130 |
| Assessed in report | 50 |
| **Qualified** (verified capability + economics) | **24** |
| Blocked marketplaces | Upwork, Fiverr, PPH, Contra, Guru, LinkedIn, Indeed — no permitted read-only integration |

**Human approval required before:** client contact, proposal submission, contract acceptance.

## Recommended first opportunity

| Field | Value |
|-------|--------|
| Title | AI Workflow Automation Specialist |
| Source | Freelancer.com |
| URL | https://www.freelancer.com/projects/ai-workflow-automation/Workflow-Automation-Specialist |
| Budget | USD 3,000–5,000 fixed |
| Scout score | 100 |
| Division | Build-A-Mind |
| Match score | 95 (capabilities: `ai_agent_dev`, `automation_workflow`, … executionReady) |

Proposal draft is stored in JSON (`proposal_draft` on each lead where scout generated one).

## Evidence classification

| Claim | Evidence |
|-------|----------|
| Live API fetch | `mode: "LIVE"` in JSON; connector `lastOk: true` per source |
| No Upwork/Fiverr scraping | `lib/revenue-ops/connectors.js` `BLOCKED` list |
| Capability match uses verified registry | `lib/revenue-ops/capabilities.js` + `assessOpportunity()` |
| Not submitted anywhere | Read-only scout; no login adapters |

## Limitations

- Assessment uses **registry-declared** capabilities (`executionReady` flags), not Frank E2E proof.
- Cloud VM is not the production delivery environment.
- Draft proposals are **templates** — operator must edit before approval.