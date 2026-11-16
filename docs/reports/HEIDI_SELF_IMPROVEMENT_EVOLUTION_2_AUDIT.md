# Heidi self-improvement Evolution 2.0 — architecture audit

**Audited:** 2026-11-15T23:45:00Z  
**Starting commit:** `b07d4921` (`clean-main` after merge #601 + #602)  
**Frank from cloud:** unreachable (not verified)

## Merge truth (not assumed)

| PR | State | Merge SHA |
|----|--------|-----------|
| #601 Phase 5 ops | **merged** | `ea404dc` (into clean-main) |
| #602 bounded loop | **merged** | `b07d4921` |

## Current architecture

```
Evidence: operations-evidence-snapshot.js, frank-truth-loader.js
Supervisor: operational-supervisor.js (read-only)
Gaps v1: self-improvement-gaps.js
Loop v1: bounded-self-improvement-loop.js
Active mission: self-improvement-store.js → .runtime/self-improvement/
Evolution engine: lib/evolution-engine/* (patches behind EVOLUTION_ALLOW_EXECUTE)
Missions (heidi-core): lifecycle.js — human approval; separate from self-improve
Chat proposals: pages/api/chat.ts deriveSelfImprovementProposal
```

## Existing capabilities (v1)

- Owner-requested bounded loop (≤5 steps)
- Gap catalog from live evidence
- Jest verification for supervisor truthfulness gap
- Improvement brief with proof labels (patch/test/merge/deploy flags)
- JSONL run hook (history.jsonl — lightweight)

## Missing before Evolution 2.0

- Structured **mission history** with fingerprints
- **Duplicate** detection across runs
- **Regression** classification beyond jest pass
- **Scoring** with history success rate
- **Dashboard** API for owner
- Explicit **proof environment** labels

## Overlaps (do not duplicate)

| System | Relationship |
|--------|----------------|
| evolution-engine | Patch execution; self-improve loop calls planner only |
| heidi-core missions | Human-approved actions; not replaced |
| operational-supervisor | Consumed by loop; not duplicated |
| chat self-improvement | Supabase proposals; orthogonal |

## Security

- Owner-requested gate preserved
- `SELF_IMPROVE_ALLOW_PATCH` unchanged
- Secret redaction in history (`redact.js`)
- No shell beyond bounded `npx jest` paths
- No auto merge/deploy
- Service token on dashboard route

## Implementation plan (this PR)

1. `lib/heidi/self-improvement/` — history, duplicates, regression, scoring, verification, dashboard  
2. Integrate loop v1 → persist missions, rank with history, skip duplicates  
3. `pages/api/heidi-operations/improvement-dashboard.js`  
4. `scripts/heidi-self-improve.js dashboard`  
5. Tests: `self-improvement-evolution2.test.js`

## Gap matrix

| Requirement | v1 | v2 |
|-------------|----|----|
| Persistent history | partial | missions.jsonl + index |
| Duplicate detection | no | fingerprints + analyzeDuplicates |
| Regression intel | no | classifyOutcome |
| Scoring | rankGaps | rankWithHistory + WEIGHTS |
| Frank verify | blocked | explicit NOT_VERIFIED / operator_frank |
| Dashboard | no | API + CLI |

## Acceptance criteria

- [x] Unit tests for history, dupes, regression, scoring, redaction  
- [x] E2E duplicate skip after simulated IMPROVED record  
- [x] Cloud-verified loop run with `--simulated`  
- [ ] Frank verification (blocked)  
- [ ] Production deploy (human)

## Frank verification surface

| Check | Cloud | Frank |
|-------|-------|-------|
| local-ci | NOT_VERIFIED | operator |
| production-truth collector | NOT_VERIFIED | operator |
| mobile endpoints | SIMULATED via jest | LOCAL_VERIFIED pending |