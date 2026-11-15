# Threat model — distributed cloud prototype

## Assets

- Task queue and execution history (`.runtime/distributed-cloud/state.json`)
- Worker HMAC secret (`HYDI_DISTRIBUTED_WORKER_SECRET`)
- Job scout leads (via `JOB_SCOUT_DIR`)
- Mobile session cookies (existing heidi-mobile guard)

## Trust boundaries

| Zone | Trust | Notes |
|------|-------|-------|
| `home_trusted` | High | Frank PM2, tailnet only |
| `cloud_light` | Medium | Cloud agent / GH Actions — lightweight tasks only |
| `mobile_operator` | Human-in-loop | Read jobs; approvals for external submit |

## Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Public exposure of Ollama/admin ports | Pull-only workers; bind control plane to loopback by default |
| Forged worker registration | HMAC token with 10-minute skew window |
| Duplicate task execution | Leases + completion idempotency keys |
| Unauthorized client submit | Tasks with external actions stay `awaiting_approval` until approved |
| Paid provider spend | `checkQuota` fail-closed; no billing API calls in this module |
| Credential leakage in logs | `redact` patterns in execution-fabric; no secrets in new logs |
| Queue poisoning | Typed tasks; capability allowlists on claim |

## Out of scope (v1)

- mTLS between workers and control plane
- Multi-tenant row-level isolation in Postgres
- Live Frank connectivity tests from cloud agent