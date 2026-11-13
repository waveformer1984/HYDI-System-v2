# Heidi job scout

Heidi scans public freelance and contract job boards every 3 hours, ranks
what she finds against the ProtoForge divisions, and shows the results in
Ursula → **Freelance**. She **never applies, bids, messages or logs in**:
you shortlist, edit the starter draft and apply on the site yourself, then
mark the lead *applied* in Ursula.

## Sources

| Source | Endpoint | Notes |
|---|---|---|
| Freelancer.com | `GET /api/projects/0.1/projects/active/` | Public project search, one request per configured query |
| Remotive | `GET https://remotive.com/api/remote-jobs` | Jobs delayed 24h by Remotive's terms; links back to Remotive; filtered to contract/freelance/part-time |
| RemoteOK | `GET https://remoteok.com/api` | Links back to RemoteOK; filtered to posts tagged contract/freelance/part-time |
| Hacker News | Algolia API, latest "Ask HN: Freelancer? Seeking freelancer?" thread | Only top-level `SEEKING FREELANCER` comments |

**Not included: Upwork.** It retired its RSS feeds in August 2024, its API
needs an approved app key, and its pages refuse automated readers.

## How it runs

- `hydi-schedulers` runs `scripts/job-scout.js --once` every
  `JOB_SCOUT_INTERVAL_MS` (default 3h, timeout `JOB_SCOUT_TIMEOUT_MS` 4 min).
- Requests are GET only, sequential, with a 15s timeout each
  (`JOB_SCOUT_HTTP_TIMEOUT_MS`).
- A failing source is recorded and skipped. The run fails only if every
  enabled source failed, and then `leads.json` is left untouched.

## Files (`.runtime/job-scout/`, gitignored)

| File | Written by | Contents |
|---|---|---|
| `leads.json` | the scout | ranked leads, scores, reasons, starter drafts, first/last seen |
| `status.json` | the scout | last run time, per-source ok/count/error, new lead counts |
| `decisions.json` | Ursula only | your shortlist / dismissed / applied markers |

The two writers never share a file, so a scan can't overwrite a decision.
Leads not seen for `retentionDays` (30) are dropped unless shortlisted or
applied.

## Ranking (`config/job-scout.json`)

Each division has keywords and a one-line pitch. A keyword scores 30 in the
title, 20 in the listed skills, 8 in the description; the best division
wins (max 100). A negative keyword drops the lead; a budget under
`minFixedBudgetUsd` / `minHourlyUsd` costs 30; older than 14 days costs 15.
Leads under `minScore` (35) are not kept. Leads at `draftScore` (60) or
above get a template starter draft with an `[EDIT: …]` placeholder.

**The shipped division keywords and pitches are a starter profile.** Edit
them to match the work you actually want.

## Using it

- **Ursula → Freelance** (live mode): ranked leads, scan status, Open post /
  Shortlist / Mark applied / Dismiss / Draft.
- **Heidi chat:** `jobs` lists the top open leads.
- **Manual run:** `node scripts/job-scout.js --once`.
