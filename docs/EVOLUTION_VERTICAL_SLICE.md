# Evolution vertical slice (Frank / heidi-pc)

End-to-end operator path: real fix-list findings → plan → async job → evidence on disk. **Does not merge to `clean-main` without human PR review.**

## Prerequisites on host

```bash
export EVOLUTION_ALLOW_EXECUTE=true
# Optional git + PR (separate gates):
export EVOLUTION_ALLOW_GIT=true
export EVOLUTION_ALLOW_PR=true   # only after reviewing plan; never implies merge
```

Heidi memory DB at `heidi-core/data/heidi_memory.db` enables measured `memory_retrieval_accuracy` in audits.

## One-shot demo

```bash
cd /path/to/HYDI-System-v2
node scripts/evolution-architecture-audit.js
node scripts/evolution-vertical-slice-demo.js
# With git + PR (requires gh auth + push access):
EVOLUTION_ALLOW_GIT=true EVOLUTION_ALLOW_PR=true node scripts/evolution-vertical-slice-demo.js --git --approve-pr
```

## Mobile

1. Run objective **`ops.evolution-vertical-slice`** (audit → plan → `evolution.execute_async` with confirm).
2. Poll **`evolution.run_status`** with `run_id` from the response.
3. Poll job status via existing mobile job API (`job_id` in response).
4. Inspect `.runtime/evolution/evidence/<run_id>.json`.

## Emergency stop

Mobile: **`evolution.emergency_stop`** (confirm). Clears only after operator removes `.runtime/evolution/EMERGENCY_STOP` or restarts with `EVOLUTION_EMERGENCY_STOP` unset.
