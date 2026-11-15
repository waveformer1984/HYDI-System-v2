# GitHub Actions lightweight distributed worker — proposal

**Status:** CONFIGURED BUT UNTESTED until operator runs workflow_dispatch on an approved branch.  
**Cost:** `ubuntu-latest` only; no larger runners; fail closed if secrets missing.

## Design

| Control | Implementation |
|---------|----------------|
| Trigger | `workflow_dispatch` only (no cron until live validation passes) |
| Job allowlist | `diagnostic` task type only |
| Timeout | 5 minutes hard cap |
| Secrets | `HYDI_DISTRIBUTED_WORKER_SECRET` (repo secret) — worker cannot pull Frank queue without coordinator URL |
| Network | Outbound HTTPS only (remotive optional read); no Ollama, no SSH |
| Quota | Script exits 0 with `skipped` notice if secret unset |

## Coordinator coupling

Phase 1 uses **artifact upload** of smoke evidence from GHA (self-contained). Phase 2 adds pull against a hosted control plane URL via `HYDI_DISTRIBUTED_COORDINATOR_URL` (tailnet or private ingress — **REQUIRES_OPERATOR_APPROVAL**).

## File

`.github/workflows/distributed-cloud-worker-dispatch.yml` — added on validation branch; not merged by agent.

## Operator steps

1. Add repo secret `HYDI_DISTRIBUTED_WORKER_SECRET` (random 32-byte hex).
2. Actions → **Distributed cloud worker smoke** → Run workflow.
3. Download `distributed-smoke-evidence` artifact; compare `classification` field.