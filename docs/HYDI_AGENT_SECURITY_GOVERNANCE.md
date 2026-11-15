# HYDI agent security and governance

## Threat areas audited

| Area | Control | Gap |
|------|---------|-----|
| Secrets in repo | `SECURITY_PROTOCOL.md`, pre-push scan | Operator env hygiene |
| Worker impersonation | HMAC v2 + JTI replay (PR #590) | v1 token migration |
| Replay attacks | `auth_replay_used` | File reset clears cache |
| Prompt injection | ProtoForge + mission approval | User content to tools — monitor |
| Tool permissions | RBAC `lib/auth/rbac` + fabric permissions | Per-agent workforce registry new |
| Privilege escalation | Registration ≠ admin | Enforce permission lists |
| Approval bypass | Fail-closed PolicyEngine | Audit new routes against ingress gate |
| Financial actions | Stripe behind approval + test-mode detection | Operator live boundary SQL |
| Merge/deploy | Branch protection; agents forbidden | Human only |

## Capability-based permission model

**Layers:**

1. **Ingress** — `lib/security/ingressGate.js` public allowlist  
2. **Fabric** — capability `permission` + `confirmRequired`  
3. **Workforce** — `lib/dev-workforce/types.js` `PERMISSIONS`  
4. **Paid LLM** — `paid-llm-gate.js`  
5. **Heidi unattended** — `heidi_decision_bounds`, `HYDI_ALLOW_EXEC`

## Actions requiring explicit authorization

| Action | Gate |
|--------|------|
| Financial transaction | Stripe + approval |
| External submission | Mission / task approval |
| Purchasing | Not automated in HYDI core |
| Publishing | Human operator |
| Repository merge | GitHub UI / human |
| Deployment | PM2 / Frank — human |
| Destructive ops | Fabric confirm + role |
| Credential change | Operator only |

## Workforce vs distributed hardening (PR #590)

New dev-workforce agents **cannot** invoke privileged fabric capabilities (`confirmRequired` or `build` risk) until the operator sets `HYDI_WORKFORCE_DISTRIBUTED_READY=true` after deploying PR #590 concurrency + HMAC replay fixes. Read-only diagnostics (e.g. `git.inspect`) remain allowed.

## Worker vs dev agent vs PAO agent

| Type | Auth | Execution |
|------|------|-----------|
| Distributed worker | HMAC token | Claim queue tasks only |
| Dev workforce agent | Registry permissions | ExecutionGateway |
| PAO TS agent | In-process bus | Not fabric by default |

## Logging and evidence

- Fabric task rows — outcome + verification  
- `heidi_events` — decision evidence  
- Distributed `history[]` — schedule audit  

## Classification

**VERIFIED SIMULATED** — design audit + unit tests on PR #590 security suite; not a full penetration test.