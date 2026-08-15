# HYDI Phase 8 — Network Isolation Report

## Method

Because a clean local boot of the entire stack was not completed in this pass, this report is based on:

1. The static external-dependency inventory in `docs/HYDI_PHASE8_EXTERNAL_DEPENDENCY_INVENTORY.md` (642 distinct dependency×file rows).
2. Source-code gating introduced in Phase 8.
3. The successful `npm test` and `npm run typecheck` runs with all external credentials unset.

A true runtime network-trace verification (Phase 10) still needs to be performed with the full local Supabase/Ollama stack running and a packet-capture tool.

## Core Runtime Network Behavior

| Call Site | Previous Behavior | Phase 8 Change |
|-----------|-------------------|----------------|
| `lib/health/collectors/external.ts:checkNetwork()` | Resolved `cloudflare.com` via DNS every health check | Removed — now returns `unavailable` without any network call |
| `lib/health/collectors/external.ts:checkStripe()` | Reported `degraded` if `STRIPE_SECRET_KEY` missing | Now reports `unavailable` unless `STRIPE_MODE=live` + key |
| `lib/ModelManager.ts` | Could fall back to `api.openai.com` or `api.anthropic.com` | Still key-gated; `next.config.js` defaults to local Ollama |
| `lib/embeddings.ts` | Defaulted to OpenAI if `OPENAI_API_KEY` present | `EMBEDDING_PROVIDER=ollama` default in `next.config.js` |
| `lib/action-executor.ts:sendEmail()` | Called `api.resend.com` if configured | Already returned `failed` when unconfigured; unchanged |
| `src/actions/HeidiActionLayer.js:sendEmail()` | Threw if no email key | Now returns `not_configured` without throwing |
| `lib/stripe/client.js` | Threw if `STRIPE_SECRET_KEY` missing | Mock-by-default; live only with `STRIPE_MODE=live` |

## Outbound Categories Found by Static Audit

- **Supabase `createClient` / cloud URLs** (367 call sites) — now forced to `http://127.0.0.1:54321` or local env.
- **Stripe SDK** (82 call sites) — routed through `lib/stripe/client.js` mock by default.
- **OpenAI/Anthropic/Gemini** (22 call sites) — require real API keys; disabled by default.
- **Email/SMS** (Resend, SendGrid, Twilio, Gmail, SMTP) — gated by credentials.
- **Deno `deno.land` / `esm.sh` CDN** (81 call sites) — still require remote imports.
- **Vercel/Railway tooling** (37 call sites) — deployment/dev scripts, not called at runtime if env unset.
- **CDN fonts / assets** (12 call sites) — frontend HTML, not critical to core.

## Findings

- The Node/Next.js core is no longer making non-local calls by default.
- The `cloudflare.com` DNS probe — the only core health check that performed an unconditional outbound call — has been removed.
- Stripe is fully behind the `lib/stripe/client.js` adapter and defaults to mock.
- Model/embedding paths default to local Ollama via `next.config.js`.
- The main remaining outbound risks are the Deno Edge Function CDN imports and a handful of optional provider adapters.

## Recommended Next Step

Run a full `docker compose up` (Phase 9/10), exercise `/api/chat`, `/api/health`, `/api/ursula/status`, and capture packets to prove no outbound traffic to `*.supabase.co`, `*.stripe.com`, `api.openai.com`, `api.anthropic.com`, `cloudflare.com`, or `fonts.googleapis.com`.
