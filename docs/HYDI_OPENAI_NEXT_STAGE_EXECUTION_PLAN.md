# Next-stage execution plan (post–Master Mission)

**Orchestrator:** Agent 01 · [#587](https://github.com/waveformer1984/HYDI-System-v2/issues/587)  
**Branches:** [#590](https://github.com/waveformer1984/HYDI-System-v2/pull/590) distributed · [#591](https://github.com/waveformer1984/HYDI-System-v2/pull/591) OpenAI mission

## Security sequencing (mandatory)

```text
1. Merge PR #590 distributed hardening → clean-main (operator review)
2. Frank: run distributed-cloud tests + smoke on local HYDI_DISTRIBUTED_CLOUD_DIR
3. Operator sets HYDI_WORKFORCE_DISTRIBUTED_READY=true on hosts that run workforce + workers
4. Only then enable workforce privileged fabric capabilities (confirmRequired / build risk)
5. Only then enable HYDI_ALLOW_PAID_LLM=true after OpenAI credits approved
```

Until step 3, `lib/dev-workforce/security-gate.js` **blocks** privileged capabilities for all workforce agents.

## Phase A — Integration (week 1 operator)

| Step | Owner | Classification when done |
|------|-------|-------------------------|
| Review & merge #590 | Operator | VERIFIED LIVE on Frank |
| Merge #591 docs + adapter | Operator | VERIFIED SIMULATED in CI |
| Post issue #587 status comment | Operator | — |
| Submit OpenAI startup materials | Operator | REQUIRES OPERATOR APPROVAL |

## Phase B — Live workers (no unattended production)

| Step | Evidence |
|------|----------|
| Frank worker register + claim | Tailnet HMAC v2, classification VERIFIED LIVE |
| GHA workflow manual dispatch | One job, VERIFIED SIMULATED or LIVE |
| Cross-machine claim | **Not claimed** until shared lock backend exists |

## Phase C — Workforce API

| Work | Blocker |
|------|---------|
| Persist `DevWorkforceRegistry` | Postgres migration (needs RFC) |
| `pages/api/dev-workforce/*` BFF | After #590 merge |
| Mobile roster UI | CONFIGURED BUT UNTESTED |

## Phase D — OpenAI live

| Work | Gate |
|------|------|
| Responses API production path | `HYDI_ALLOW_PAID_LLM` + operator |
| Wire adapter into Heidi chat | Behind existing ModelManager policy |
| Usage accounting table | Migration + RFC |

## Phase E — Revenue agents

Coordinate with open #589; keep proposal submit behind approval + fabric confirm.

## Remaining blockers (inventory)

1. Frank / Tailscale — **BLOCKED** from cloud agents  
2. OpenAI application submit — **REQUIRES OPERATOR APPROVAL**  
3. Multi-host distributed state — **BLOCKED** (design)  
4. Workforce privileged actions — **BLOCKED** until `HYDI_WORKFORCE_DISTRIBUTED_READY`  
5. GHA worker — **CONFIGURED BUT UNTESTED**

## Success metrics

- 30/30 distributed tests green on Frank post-merge  
- 19/19 master-mission tests green in CI  
- Zero simulated labels in operator-facing health if claiming LIVE  
- No merge of #590 without human approval