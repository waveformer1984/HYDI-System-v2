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

---

## Heidi / Rezonate Authority Model (Phase 3 — Control-Plane Hardening)

### Verified Heidi → Rezonate operations

| Task | Permission | Read / Mutation | Auth success tested | Auth rejection tested | Malformed input tested | No repo access after auth failure |
|---|---|---|---|---|---|---|
| `REZONATE_LIST_PROJECTS` | `rezonate:manage` (all operations gated by it) | READ | yes | yes (viewer, agent, unknown role) | yes (empty/invalid) | yes — no repository call if `hasPermission` fails |
| `REZONATE_GET_PROJECT` | `rezonate:manage` | READ | yes | yes | yes (missing `id`) | yes |
| `REZONATE_CREATE_PROJECT` | `rezonate:manage` | MUTATE | yes | yes | yes (missing/empty `name`) | yes |
| `REZONATE_LIST_TRACKS` | `rezonate:manage` | READ | yes | yes | yes (missing `projectId`) | yes |
| `REZONATE_CREATE_TRACK` | `rezonate:manage` | MUTATE | yes | yes | yes (missing `name` or `projectId`) | yes |

`viewer`, `agent`, and any unknown role are denied before the task is routed or the repository is touched.

### Forbidden / unsupported Rezonate requests

| Task | State | Behavior | Tested |
|---|---|---|---|
| `REZONATE_GET_TRACK` | MISSING | Rejected before routing; no `getTrack()` canonical method | yes |
| `REZONATE_UPDATE_PROJECT` | MISSING | Rejected before routing; no `updateProject()` canonical method | yes |
| `REZONATE_UPDATE_TRACK` | MISSING | Rejected before routing; no `updateTrack()` canonical method | yes |
| `REZONATE_NFT`, `REZONATE_MARKETPLACE`, `REZONATE_MASTERING`, `REZONATE_BLOCKCHAIN` | FORBIDDEN | Rejected by intent normalizer / capability guard; never reach the router | yes |

`REZONATE_CREATE_JOB`, `REZONATE_GET_JOB`, `REZONATE_START_JOB`, `REZONATE_EXPORT_PROJECT` are canonical but **not verified through Heidi** and are now blocked by the `HeidiController` capability gate (state `FUNCTIONAL`/`SCAFFOLD`, not `VERIFIED`).

---

## Heidi / Rezonate Authority Model (Phase 2)

Authority classifications for the Heidi → Rezonate operational control plane.

| Class | Meaning |
|---|---|
| **READ** | Heidi may query and report a value. No mutation. |
| **PLAN** | Heidi may assemble parameters and recommend an action. No execution. |
| **EXECUTE** | Heidi may perform a verified, non-mutating operation within an explicitly granted permission. |
| **MUTATE** | Heidi may change persistent state. Requires `rezonate:manage` and, for some operations, explicit user confirmation. |
| **ADMIN** | Heidi must not perform this; only a human admin with direct access may do it. |

## Rezonate Operation Authority

| Operation | Heidi Authority | What Heidi May Do | User / Role Requirement | What Heidi Must Refuse | What Heidi May Report But Not Execute | Confirmation Required? |
|---|---|---|---|---|---|---|
| **List projects** | **READ** | Return the list or count of projects | `viewer`+ read permission or `operator`/`owner` | Cannot modify | The existence or count of projects | No |
| **Get project** | **READ** | Return one project by id | `viewer`+ or `operator`/`owner` | Cannot modify | Project metadata | No |
| **List tracks** | **READ** | Return tracks for a project | `viewer`+ or `operator`/`owner` | Cannot create/modify tracks | Track count and names | No |
| **Get track** | **READ** | Return one track by id | `viewer`+ or `operator`/`owner` | Cannot modify | Track metadata | No |
| **Create project** | **MUTATE** | Call `createProject()` after `rezonate:manage` is granted | `operator`/`owner` with `rezonate:manage` | Must refuse if `viewer`, `agent`, or missing permission | That the parameters are valid and the capability exists | No for default project; Yes if cost threshold or external side effects are attached |
| **Create track** | **MUTATE** | Call `createTrack()` after `rezonate:manage` is granted | `operator`/`owner` with `rezonate:manage` | Must refuse without `rezonate:manage` | That the target project exists and the track name is available | No for local track creation |
| **Update project** | **MUTATE** | Call `updateProject()` (if/when canonical repo supports it) | `operator`/`owner` with `rezonate:manage` | Must refuse without permission; should refuse to change ownership/rights automatically | The requested change and current state | Yes — any update is destructive to prior state |
| **Update track** | **MUTATE** | Call `updateTrack()` (if/when canonical repo supports it) | `operator`/`owner` with `rezonate:manage` | Same as update project | The requested change and current state | Yes |
| **Retrieve processing job** | **READ** | Return job status | `viewer`+ or `operator`/`owner` | Cannot start/alter the job | Job state and progress | No |
| **Create / start job** | **MUTATE** | Call `createProcessingJob()` / `startProcessingJob()` | `operator`/`owner` with `rezonate:manage` | Must refuse if job would call remote/Cloud AI without approval | The job specification and resource cost | Yes if job invokes remote AI or incurs real cost |
| **Export project** | **MUTATE** | Call `exportProject()` to produce files | `operator`/`owner` with `rezonate:manage` | Must refuse without permission | Export format and destination | No for local export |
| **Create ownership record** | **PLAN / HUMAN APPROVAL** | Prepare the record; do not submit without human approval | `operator`/`owner` with `rezonate:manage` plus human sign-off | Must never submit autonomously | The prepared ownership payload and risk summary | Yes — always |
| **Register rights / collaborators** | **PLAN / HUMAN APPROVAL** | Prepare rights record; do not apply without approval | `operator`/`owner` with `rezonate:manage` plus human sign-off | Must never apply autonomously | The prepared rights payload | Yes — always |
| **Delete project or track** | **ADMIN** | Report that a deletion was requested; do not execute | None through Heidi | Must refuse to delete | The request for a human operator | N/A |
| **Mint / publish / NFT** | **ADMIN / FORBIDDEN** | Report that the capability does not exist or is PLANNED | N/A | Must refuse | The current state (`PLANNED`) | N/A |

## What Heidi Must Refuse (Rezonate)

1. Any mutating operation (`create`, `update`, `start`, `export`, ownership/rights) when the caller does not hold `rezonate:manage`.
2. Any operation on a `PLANNED`, `SCAFFOLD`, or `PARTIAL` capability.
3. Any delete, publish, or blockchain operation.
4. Any request whose intent is ambiguous or whose parameters are malformed.
5. Any operation that would bypass the canonical repository or use a second persistence path.

## What Heidi May Report But Not Execute

1. Project/track counts and health status.
2. Capability contract state (`VERIFIED`, `FUNCTIONAL`, etc.).
3. Prepared-but-not-executed plans for ownership/rights changes.
4. Failure reasons and repository errors.
5. The current authority level of the caller.
