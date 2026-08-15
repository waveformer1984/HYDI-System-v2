# HYDI Operational Core Definition

## Principle

A subsystem belongs to the operational core only if HYDI requires it to boot, serve health/status, accept chat/orchestration input, persist events, and remain consistent across restarts. Optional integrations, dormant prototypes, archived code, and cloud-only deployment helpers are not core.

## A. REQUIRED FOR HYDI TO OPERATE LOCALLY

These must be present and healthy for the local-first mode to function.

| Subsystem | Why it is required | Local state | Tested |
|---|---|---|---|
| `src/persistence/supabase-client.js` / `src/database.js` | Canonical local persistence factory; rejects hosted Supabase in local-first mode | Local Supabase (`127.0.0.1:54321`) | `tests/unit/persistence-guard.test.js` |
| `lib/health/collectors/` + `api/health.js` | Reports HYDI status from `system_dashboard` | Local DB | `npm test` |
| `api/ursula/status.js` | Returns bounded local system status | Local DB + workers | `npm test` |
| `src/heidi-executive/` | Capability registry, policy engine, approval, audit, controlled executor | In-memory + local DB | `tests/unit/heidi-executive/control-plane.test.js` |
| `lib/ModelManager.ts` / `lib/embeddings.ts` | Local model and embedding routing | Ollama when enabled | `npm test` |
| `lib/protoforge/policy-engine.js` | Fail-closed policy gate for KILO output | Local DB `policies` table | `npm test` |
| `cascade/` + `kilo/` | Event classification and hypothesis generation | Local | `npm test` |
| `revenue-engine/` + `lib/stripe/client.js` | Revenue ledger and Stripe adapter | Mock by default | `npm test` |
| `workers/WorkerOrchestrator.js` | Background queue/task workers | Local DB | `npm test` (register) |

## B. OPTIONAL LOCAL CAPABILITIES

These improve local operation but can be absent or unhealthy without stopping the core.

| Subsystem | Local usage | Graceful when absent |
|---|---|---|
| Ollama (`lib/ModelManager.ts`) | Local inference | Falls back to degraded/orchestrator mode |
| `api/local-model.js` | Direct local model call | Returns 503 if Ollama unavailable |
| `workers/` individual workers | Optional task processing | Unregistered worker not fatal unless required |
| `pao-system/` agents | Business-domain agents | Not loaded unless explicitly called |
| File operations in `rezonate/`, `agents/rezonate_node/` | Local DAW node / stem processing | Optional connector |
| `supabase/functions/` Edge Functions | Async tasks, billing, notifications | Not called during basic local boot; vendored but not started in this phase |

## C. OPTIONAL EXTERNAL INTEGRATIONS

These are provider-backed adapters. They are gated by env vars and `STRIPE_MODE`.

| Integration | Gate | Default behavior |
|---|---|---|
| Stripe | `STRIPE_MODE=live` + `STRIPE_SECRET_KEY` | `lib/stripe/client.js` returns mock objects |
| OpenAI | `OPENAI_API_KEY` + `EMBEDDING_PROVIDER=openai` | Falls back to Ollama or `null` |
| Anthropic | `ANTHROPIC_API_KEY` | Falls back to orchestrator |
| Resend / SendGrid / SMTP | `RESEND_API_KEY` / `SENDGRID_API_KEY` | Returns `not_configured` / records locally |
| Twilio / Discord / Slack | Provider API keys | Optional; no call without key |
| YouTube / social APIs | Optional connectors in `pao-system/integrations/` | No call without key |

## D. CLOUD-BOUND LEGACY / DORMANT COMPONENTS

These still exist in the tree but are not exercised in local-first mode and do not run without explicit cloud credentials.

| Component | Evidence |
|---|---|
| Hosted Supabase fallback | Hardcoded project ref `akbnfovjdcobifeupvbn` references are in archive/legacy paths; local factory rejects them |
| Vercel deployment helpers | `deploy-production-safe.sh`, `vercel env` commands require `VERCEL_TOKEN` |
| Old Stripe implementations | `archive/superseded-stripe-implementations/` |
| Cloud-only `.env` values | `.env` / `.env.local` are untracked; local defaults ignore them |
| Ursula Suite (Python Flask at `:5000`) | Separate companion boundary; not required for HYDI core |

## E. BLOCKED COMPONENTS

These are not yet runnable as part of the local-first core.

| Component | Blocker |
|---|---|
| 42 Supabase Edge Functions at runtime | Not served in this session; imports are vendored but no `supabase functions serve` verification performed |
| Packet-level network capture | Requires Administrator PowerShell |
| Full `/api/chat` conversational pipeline | Returned schema/timeout errors in this session; needs further debugging with local Ollama schema |
| `make_operational` acceptance mission | Not run end-to-end per `docs/HEIDI_OPERATIONAL_READINESS.md` |

## F. DEPRECATED COMPONENTS

Do not rely on these for new work.

| Path | Status |
|---|---|
| `archive/` | Historical dead code and build artifacts |
| `api/traces.js` (deleted/disabled in working tree) | Superseded by `api/traces.js.disabled` |
| `pages/traces.jsx` | Replaced by newer trace tooling |
| Stale `vercel-sync-analysis.md` / `HYDI_PRODUCTION_READINESS_REPORT.md` | Historical reports, not current runtime docs |
