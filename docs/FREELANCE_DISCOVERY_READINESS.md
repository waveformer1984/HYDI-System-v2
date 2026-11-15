# Freelance discovery readiness (#587 / Mission 2 Phase 6)

## Pipeline (required)

`DISCOVER → FILTER → SCORE → PRESENT → OPERATOR APPROVAL`

| Stage | Implementation | Status |
|-------|----------------|--------|
| DISCOVER | `lib/job-scout/scout.js`, `hydi-schedulers` job `heidi-job-scout` | **VERIFIED SIMULATED** (unit tests); **VERIFIED LIVE** remotive HTTP 200 from cloud VM (read-only) |
| FILTER | `lib/job-scout/score.js`, negative keywords, min budget | VERIFIED SIMULATED |
| SCORE | capability + economics in #589 `lib/revenue-ops/` | CONFIGURED BUT UNTESTED on clean-main (open PR #589) |
| PRESENT | Ursula Freelance + mobile Revenue tab (#589) | CONFIGURED BUT UNTESTED live mobile |
| APPROVAL | `distributed-cloud/approval.js`, `REVENUE_OPS_ALLOW_SUBMIT` | VERIFIED SIMULATED |

## Supported sources (code truth)

| Source | Mechanism | Live from cloud VM | Cost |
|--------|-----------|-------------------|------|
| Remotive | Public API | VERIFIED LIVE (HTTP 200) | $0 |
| RemoteOK | Public API | NOT RUN this mission | $0 |
| Freelancer | Public search API | NOT RUN (needs fetch test) | $0 |
| HN Algolia | Public search | NOT RUN | $0 |
| Upwork, Fiverr, LinkedIn, Indeed | — | **BLOCKED** (documented in #589) | N/A |

## Autonomous actions prohibited (enforced)

- No `freelance.submit_proposal` without `awaiting_approval`
- `REVENUE_OPS_ALLOW_SUBMIT` default off
- External consequential tools escalate in intelligence layer (separate branch)

## Integration with distributed cloud

PR #590 `freelance-bridge.js` enqueues `freelance.discover` — **VERIFIED SIMULATED** in acceptance tests only.  
**Follow-up:** wire `hydi-schedulers` to enqueue + let cloud worker run `runScout` when Frank offline — **REQUIRES_OPERATOR_APPROVAL**.