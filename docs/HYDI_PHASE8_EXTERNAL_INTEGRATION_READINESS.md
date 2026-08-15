# HYDI Phase 8 — External Integration Readiness

## Scope

This document records the classification and gating state of every external integration surfaced by the Phase 8 audit (`docs/HYDI_PHASE8_EXTERNAL_DEPENDENCY_INVENTORY.md`).

## Local-First Rule

HYDI's core pipeline must remain operational when optional external providers are unavailable. Provider-backed capabilities may truthfully report `NOT_CONFIGURED` or `UNAVAILABLE` without crashing the system.

## Classification Matrix

| Dependency | Class | Required? | Local Alternative | Gated? | Status |
|------------|-------|-----------|-------------------|--------|--------|
| Local Supabase (Postgres/GoTrue/PostgREST/Realtime) | CORE-LOCAL | Yes | `supabase/config.toml`, `http://127.0.0.1:54321` | Yes | Ready |
| Hosted Supabase (`akbnfovjdcobifeupvbn.supabase.co`) | CORE-LOCAL | No | Local Supabase | Yes | Rejected by `src/persistence/supabase-client.js` |
| Ollama local models | CORE-LOCAL | Yes | `http://localhost:11434`, `llama3.2:3b` | Yes | Ready via `next.config.js` defaults |
| OpenAI API | CLOUD-FALLBACK | No | Ollama | Yes | Calls only when `OPENAI_API_KEY` is real |
| Anthropic API | CLOUD-FALLBACK | No | Ollama | Yes | Calls only when `ANTHROPIC_API_KEY` is real |
| Gemini API | CLOUD-FALLBACK | No | Ollama | Yes | Not enabled by default |
| Stripe (live) | PROVIDER-BACKED | No | Mock in `lib/stripe/client.js` | Yes | `STRIPE_MODE=live` + key required |
| Resend email | OPTIONAL-INTEGRATION | No | Local event log | Yes | Fails gracefully / not_configured |
| SendGrid email | OPTIONAL-INTEGRATION | No | Local event log | Yes | Same as Resend |
| Gmail / SMTP | OPTIONAL-INTEGRATION | No | Local log | Yes | Requires explicit credentials |
| Twilio SMS | OPTIONAL-INTEGRATION | No | Local queue | Yes | Requires `TWILIO_*` env |
| SendGrid SMS/email (Supabase function) | OPTIONAL-INTEGRATION | No | Local queue | Yes | Deno Edge Function scope |
| Discord webhooks | OPTIONAL-INTEGRATION | No | Local log | Yes | Enabled only by `DISCORD_WEBHOOK_URL` |
| Slack webhooks | OPTIONAL-INTEGRATION | No | Local log | Yes | Enabled only by `SLACK_WEBHOOK_URL` |
| Cloudflare DNS probe | UNNECESSARY | No | No probe | Yes | Removed from `lib/health/collectors/external.ts` |
| Vercel / Railway endpoints | PROVIDER-BACKED | No | Local endpoints | Partial | Hardcoded in tooling; not called at runtime if env unset |
| YouTube publishing | PROVIDER-BACKED | No | Local archive | Partial | Optional connector only |
| Deno `deno.land` / `esm.sh` imports | BLOCKED | No | Vendored / offline cache | No | Cannot run offline without vendoring |
| Google Fonts CDN | UNNECESSARY | No | Self-host / remove | No | Present in `hdi-three-agent-panel.html` |
| ProtoForge Industries API | OPTIONAL-INTEGRATION | No | Local mock | Partial | Calls only when configured |

## Core-Local Capabilities Confirmed

The following work without external credentials when using the defaults introduced in this phase:

- `SUPABASE_URL` unset → `http://127.0.0.1:54321` via `next.config.js`
- `STRIPE_MODE` unset → `mock` via `next.config.js` and `lib/stripe/client.js`
- `ENABLE_LOCAL_MODEL` unset → `true` via `next.config.js`
- `EMBEDDING_PROVIDER` unset → `ollama` via `next.config.js`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` unset → no cloud model calls
- `RESEND_API_KEY` / `EMAIL_FROM` unset → `lib/action-executor.ts` returns `failed`, `HeidiActionLayer` returns `not_configured`

## Provider-Backed Capabilities

These remain intentionally external. They do not start without explicit configuration:

- Stripe live payments (`STRIPE_MODE=live` + `STRIPE_SECRET_KEY`)
- Resend / SendGrid / Gmail email
- Twilio SMS
- YouTube publishing
- Vercel/Railway-hosted operational tools

## Blocked / Still External

- **Supabase Edge Functions** (`supabase/functions/*/index.ts`) import `https://deno.land/std/...` and `https://esm.sh/...`. Local-first operation of the full Deno function set requires vendoring or a local Deno registry; not done in this phase.
- **Some HTML dashboards** load Google Fonts from `fonts.googleapis.com`.

## Testing

- `npm run typecheck`: pass
- `npm test`: 252/253 suites passed, 2448/2450 tests passed, 1 skipped, 1 failed
  - The single remaining failure is `tests/unit/no-hardcoded-secrets.test.js`, which flags pre-existing fake placeholder values in `docs/STRIPE_POST_ROTATION_VERIFICATION.md` and `tests/unit/heidi-executive/control-plane.test.js`. These are not live secrets.
