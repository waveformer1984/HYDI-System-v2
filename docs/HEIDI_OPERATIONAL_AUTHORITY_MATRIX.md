# Heidi Operational Authority Matrix

Date: 2026-08-14
Repo: `C:\Users\Owner\HYDI-System-v2`
Branch: `feat/hydi-system-wide-audit`

## Authority Levels

- **OBSERVE** — Heidi may inspect/report only.
- **OPERATE** — Heidi may execute under existing authorization (no extra human step).
- **RECOMMEND** — Heidi may prepare a plan/output but not execute.
- **HUMAN APPROVAL** — Heidi may prepare, but a human must authorize.
- **FORBIDDEN** — Heidi must not perform automatically.

## Authority by Operation

| Operation | System | Authority | Why | Current Enforcer | Notes |
|---|---|---|---|---|---|
| Read system status | URSULA | **OBSERVE** | Read-only, but depends on Supabase view | `verifyServiceToken` (some routes public) | Public health is a security gap |
| Read Rezonate health | REZONATE | **OBSERVE** | Uses canonical `getRezonateHealth()` | `verifyServiceToken` | Now local-first |
| List Rezonate projects | REZONATE | **OBSERVE** | Read operation via canonical repository | `rezonate:manage` (no read-only perm) | `viewer` cannot use this yet |
| Create Rezonate project | REZONATE | **OPERATE** | Functional/verified canonical operation | `rezonate:manage` (owner/operator) | `RezonateAgent` only emits; actual call requires auth |
| Create Rezonate track | REZONATE | **OPERATE** | Functional/verified canonical operation | `rezonate:manage` | Same as above |
| Start Rezonate processing job | REZONATE | **OPERATE** | Functional/verified, may consume CPU/disk | `rezonate:manage` | `generate` type may call remote Gemini if configured |
| Export Rezonate DAW package | REZONATE | **OPERATE** | Writes files to disk | `rezonate:manage` | Local filesystem output |
| Create ownership record | REZONATE | **HUMAN APPROVAL** | Legal/rights implication | `rezonate:manage` | PAO approval engine has money/legal thresholds but is not active |
| Register rights | REZONATE | **HUMAN APPROVAL** | Legal/rights implication | `rezonate:manage` | Same as above |
| Delete Rezonate project/track | REZONATE | **HUMAN APPROVAL** | Destructive; no delete endpoint exists in canonical API | Not exposed | No delete in canonical router |
| Publish/release Rezonate content | REZONATE | **FORBIDDEN** | No publish capability; NFT/marketplace planned | N/A | Not implemented |
| Mint NFT | REZONATE | **FORBIDDEN** | Not implemented | N/A | PLANNED |
| Query revenue ledger | REVENUE | **OBSERVE** | Read `ledger` by revenue stream | `revenue:view` | In `api/revenue` routes |
| Create checkout session | STRIPE | **HUMAN APPROVAL** | Money movement | `requireAuth`? Actually `api/checkout.js` is rate-limited only | **No human approval gate** — dangerous |
| Process Stripe webhook | STRIPE | **OPERATE** | Idempotent, HMAC-verified, kill switch | Stripe HMAC + `WEBHOOK_PROCESSING_ENABLED` | Money handling but no human step; operator controls kill switch |
| Refund charge | STRIPE | **HUMAN APPROVAL** | Money out | No explicit gate | Currently handled through webhook parsing; not surfaced to Heidi |
| Deploy / redeploy | INFRA | **HUMAN APPROVAL** | Production infrastructure change | `infrastructure` agent in chat is a stub | Not wired to real Vercel action through Heidi |
| Set env var | INFRA | **HUMAN APPROVAL** | Security/credential exposure risk | `infrastructure` stub | Not wired |
| Restart service | INFRA | **HUMAN APPROVAL** | Availability impact | `infrastructure` stub | Not wired |
| Send email / outreach | OUTREACH | **HUMAN APPROVAL** | External communication, spam risk | PAO matrix has `outreach.agent`, not constructed | Not active |
| Create external account | ANY | **FORBIDDEN** | No auto account creation | N/A | Not implemented |
| Rotate credentials | SECURITY | **FORBIDDEN** | Requires explicit human authorization | N/A | Not authorized this session |
| Modify RBAC | SECURITY | **HUMAN APPROVAL** | Privilege escalation risk | Not exposed via API | Human admin only |
| Generate KILO hypothesis | KILO | **RECOMMEND** | Output is suggestion only | N/A | KILO never executes |
| Execute KILO suggested fix | KILO | **FORBIDDEN** | `execute()` throws unconditionally | Machine-enforced | Correctly blocked |
| CASCADE event classification | CASCADE | **OBSERVE** | Produces classification, no action | N/A | Not connected to Heidi actions |
| Policy engine decision | PROTOFORGE | **RECOMMEND/OPERATE** | Approve/reject/escalate based on rules | Fail-closed default | Not wired to Heidi actions |
| Worker task dispatch | WORKERS | **OPERATE** if non-destructive, **HUMAN APPROVAL** if risky | WorkerOrchestrator currently requires Supabase | N/A | Not connected to Heidi chat |

## Why Important Operations Are Restricted

1. **Financial transactions (checkout, refunds)** — Real money. No test/live mode guard; `api/checkout.js` is only rate-limited. Must not be autonomous without a human approve step and an explicit test environment.
2. **Deletion / data destruction** — No Rezonate delete endpoint exists, but a future one must require human approval because it is irreversible.
3. **Ownership / rights changes** — Legal implications; the canonical API supports these but they should not run on Heidi's word alone.
4. **Credential / env var changes** — Could expose secrets or break the system. Only human admin.
5. **Deployment / infrastructure changes** — Could take the system offline or modify production. Human approval.
6. **External communications** — Reputation/spam risk. Human approval before send.

## Current Gaps

- **PAO approval engine is dormant**, so any "HUMAN APPROVAL" operation is not actually gated through Heidi. A human must use a separate channel.
- **Many operations are stubs** (`infrastructure`, `cascade`, `kilo`, `protoforge` in `api/chat/route.js`) and do nothing; they cannot be mistaken for safe to execute.
- **RBAC is not enforced in the PAO layer** and not on some API surfaces (`api/health.js`, `api/client-dashboard.js`, `api/revenue.js` as top-level non-`requireAuth` routes, though `pages/api/revenue/` may be protected).
- **No read-only Rezonate permission exists**; `viewer` cannot list projects. This is a role design gap.

## Summary

Heidi's actual authority today is:

- **OBSERVE**: system status (if Supabase up), Rezonate status/capabilities, some revenue data.
- **OPERATE**: Rezonate create/list (under `rezonate:manage`), some chat keyword responses.
- **RECOMMEND**: KILO hypotheses, ProtoForge policy suggestions.
- **HUMAN APPROVAL**: ownership/rights, deletion, publish/release, money, deployment, credential changes, external comms.
- **FORBIDDEN**: credential rotation, external account creation, KILO execution, anything not implemented.

The system should not be considered **autonomous-ready** because the approval orchestration is not active and the enforcement of `HUMAN APPROVAL` is not machine-gated.
