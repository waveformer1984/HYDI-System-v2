# Heidi Local Operational Authority

## Scope

This document maps what Heidi can actually do in the current local-first runtime, not what is planned. Authority is bounded by `CapabilityRegistry`, `PolicyEngine`, `ApprovalManager`, and the in-memory `AuditLog`.

## Authority by Domain

### 1. Health

| Operation | Permission | Capability | State | Persistence | Audit | Failure behavior |
|---|---|---|---|---|---|---|
| READ health | `health.read` (READ) | `health.read` | `READ` | Local DB `system_dashboard` | `AuditLog.record` | Returns `UNKNOWN` if not registered |
| RECOVER safe local service | `health.recover` (LOW) | `health.recover` | `LOW` | Local DB + controlled executor | `AuditLog.record` | Bounded retry; logs failure |

### 2. Rezonate

| Operation | Permission | Capability | State | Persistence | Audit | Failure behavior |
|---|---|---|---|---|---|---|
| READ projects | n/a (API auth token) | `api/rezonate/route.js` GET `list_projects` | Works locally | `rezonate_projects` table | Per-request `actions` insert for `dispatch_task` | Returns 400/404 for invalid payload or ownership |
| CREATE project | n/a | `create_project` | Works locally | `rezonate_projects` table | Recorded | Returns 400 if `name` missing |
| READ tracks | n/a | `list_tracks` | Works locally | `rezonate_tracks` table | Recorded | 404 if project not owned |
| CREATE track | n/a | `add_track` | Works locally | `rezonate_tracks` table | Recorded | 400 if fields missing |
| DISPATCH task | n/a | `dispatch_task` | Works locally | `actions` table | Recorded | 400 if `task_type` not in node manifest |

### 3. Apex

Apex is not an independent subsystem in the current tree. The Apex-like operational semantics are covered by the HEIDI executive (`src/heidi-executive/`) and chat router. No dedicated `apex:*` capability or API route was found.

| Verdict | `NOT APPLICABLE` as a separate domain. |
|---|---|

### 4. Workers

| Operation | Permission | Capability | State | Persistence | Audit | Failure behavior |
|---|---|---|---|---|---|---|
| REGISTER worker | `workers/WorkerOrchestrator.js` startup | `workers/` | Required at boot | Local DB | Crash if not registered | Hard constraint in `AGENTS.md` |
| POLL queue | Worker internal | `LOW` | Depends on worker | Local DB queue tables | Worker logs | Stops polling on repeated failure |

### 5. ProtoForge Policy

| Operation | Permission | Capability | State | Persistence | Audit | Failure behavior |
|---|---|---|---|---|---|---|
| EVALUATE hypothesis | n/a | `lib/protoforge/policy-engine.js` | Fail-closed | `policies` table (hot-reload) | `decisions` table | Returns `reject` if no rule matches |

### 6. CASCADE

| Operation | Permission | Capability | State | Persistence | Audit | Failure behavior |
|---|---|---|---|---|---|---|
| CLASSIFY event | n/a | `cascade/` | Local classification | RAW LEDGER + `cascade_log` | Immutably hashed | Divergence triggers drift alert |

### 7. Chat / Memory

| Operation | Permission | Capability | State | Persistence | Audit | Failure behavior |
|---|---|---|---|---|---|---|
| ROUTE chat message | `x-hydi-service-token` | `api/chat/route.js` | Works locally with service token | `chat_conversations` / `chat_messages` tables | `operator_actions` | 401 on bad token, 400 on unknown system |
| GENERATE embedding | n/a | `lib/embeddings.ts` | Ollama or OpenAI | `memories` table (1536-dim) | n/a | Returns `null` on provider failure |

### 8. Revenue

| Operation | Permission | Capability | State | Persistence | Audit | Failure behavior |
|---|---|---|---|---|---|---|
| CREATE checkout | n/a | `lib/stripe/client.js` | Mock by default | Local ledger | `ledger` table | Returns mock session if not live |
| CREATE subscription | n/a | `lib/stripe/client.js` | Mock by default | Local ledger | `ledger` table | Returns mock subscription if not live |
| PROCESS webhook | `STRIPE_WEBHOOK_SECRET` (when live) | `api/webhooks/stripe.js` | Optional live | `ledger` table | Audit log | 400 if signature invalid |

### 9. External Integrations

| Operation | Permission | Capability | State | Persistence | Audit | Failure behavior |
|---|---|---|---|---|---|---|
| SEND email | `RESEND_API_KEY` or `SENDGRID_API_KEY` | `src/actions/HeidiActionLayer.js` | Optional | Local notification queue | `notifications` table | Returns `not_configured` if no key |
| CALL OpenAI | `OPENAI_API_KEY` | `lib/embeddings.ts` / `lib/heidi-agent.ts` | Optional | n/a | n/a | Returns `null`/fallback |
| CALL Anthropic | `ANTHROPIC_API_KEY` | `lib/heidi-agent.ts` | Optional | n/a | n/a | Falls back to orchestrator |
| CALL Stripe | `STRIPE_SECRET_KEY` + `STRIPE_MODE=live` | `lib/stripe/client.js` | Optional | Local ledger | `ledger` table | Mock mode returns deterministic objects |

## Key Constraints

- **No execution without capability.** `HeidiExecutive.run()` checks `CapabilityRegistry.has(id)`.
- **No critical action without approval.** `ApprovalManager` records an approval for `HIGH`/`CRITICAL`.
- **No self-approval.** A model/operator cannot approve its own `CRITICAL` action.
- **No raw secrets in reasoning/logs.** `SecretBroker.redact()` strips `sk_live_`, `whsec_`, `sb_secret_`, and JWT shapes.
- **Health is truthful.** Unknown components return `UNKNOWN`, not `HEALTHY`.

## What Heidi Cannot Do Autonomously Today

- `make_operational` end-to-end mission is not yet exercised against real stopped services.
- `HealthAggregator` is not wired to live local service probes (Docker, Ollama, Supabase).
- `ControlledExecutor` for `docker.local` / `wsl.local` / `database.local` is not yet demonstrated.
- `AuditLog` and `ApprovalManager` are in-memory in the unit tests; persistent storage path exists but is not integrated.
