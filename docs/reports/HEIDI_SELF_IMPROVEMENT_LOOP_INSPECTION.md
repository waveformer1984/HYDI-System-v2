# Heidi bounded self-improvement — inspection and demo

## Existing mechanisms (reused)

| Concern | Location | Role in loop |
|---------|----------|----------------|
| Operational evidence | `lib/heidi/operations-evidence-snapshot.js` | Observe |
| Read-only supervisor | `lib/heidi/operational-supervisor.js` | Verify / recommendations |
| Frank truth | `lib/observation/frank-truth-loader.js` | Gap detection (not live) |
| Evolution backlog ranking | `lib/evolution-engine/improvement-planner.js` | Deduped defer list |
| Evolution execution (patches) | `lib/evolution-engine/execution-coordinator.js` | **Not invoked** in v1 — requires `EVOLUTION_ALLOW_EXECUTE` |
| Mission lifecycle | `heidi-core/missions/lifecycle.js` | **Not duplicated** — improvement record uses `.runtime/self-improvement/` only |
| Health observer | `heidi-core/missions/health-observer.js` | Proposes restart missions; separate path |
| Chat self-improvement proposal | `pages/api/chat.ts` `deriveSelfImprovementProposal` | Supabase proposals; orthogonal |

## What was incomplete

- No single **owner-requested** loop with step caps and explicit brief.
- Supervisor did not surface **failed live probes** vs file-based evidence (status accuracy gap).

## Smallest integration added

| File | Purpose |
|------|---------|
| `lib/heidi/self-improvement-gaps.js` | Evidence-backed gap catalog + ranking |
| `lib/heidi/self-improvement-store.js` | Durable record under `.runtime/self-improvement/` (gitignored) |
| `lib/heidi/bounded-self-improvement-loop.js` | Observe → diagnose → propose → test → verify → record |
| `scripts/heidi-self-improve.js` | CLI: `assess` / `run --owner-requested` |

## Bounds (v1)

- Explicit `--owner-requested` only; no cron, no subagents.
- One active mission file at a time.
- ≤ 5 execution steps; stop at approval boundaries.
- No merge/deploy/restart/paid LLM.
- `SELF_IMPROVE_ALLOW_PATCH` **not required** for observe/diagnose/test/verify demo (patch landed via PR).

## Demonstrated gap (real, low-risk)

**Gap:** `status-live-probes-failed-not-surfaced` — when `checkSystem` probes fail, `live_probe_rollup` is null but operators lacked a supervisor warning.

**Fix:** `operational-supervisor.js` — `failures[]`, `treat_status_degraded` recommendation, `status_truthfulness: degraded`.

**Acceptance:** `tests/unit/operational-supervisor.test.js`, `tests/unit/bounded-self-improvement-loop.test.js`.

## Run demo (cloud)

```bash
node scripts/heidi-self-improve.js assess --demo-failed-probes
node scripts/heidi-self-improve.js run --owner-requested --demo-failed-probes --force-new
```

## Next approval needed

- **Merge/deploy** of supervisor + loop code (human).
- **Frank-only gaps** (local-ci, production-truth) — operator runbooks; loop stops with `operator_frank`.
- **Repo patches from loop** — requires `SELF_IMPROVE_ALLOW_PATCH=true` + future evolution coordinator wiring.