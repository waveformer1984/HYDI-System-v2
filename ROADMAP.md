# Roadmap

This document describes the planned evolution of HYDI System v2. Dates are targets, not guarantees. All items are subject to change at the maintainer's discretion.

## Current state (v1.0, Q2 2026)

The core platform is operational:

- Six-layer deterministic event pipeline (Ingestion → RAW EVENT LEDGER → CASCADE → KILO → ProtoForge → Emission)
- Immutable, append-only RAW EVENT LEDGER with deterministic replay
- DSL policy engine with runtime-configurable rules and Supabase Realtime hot-reload
- KILO hypothesis generator (execution permanently prohibited via unconditional throw)
- 42 Supabase Edge Functions (Deno) covering billing, auth, observability, and marketing
- Stripe Connect with six active revenue sub-accounts
- `DecisionAssistWorker` covering financial planning, resource allocation, risk assessment, and system optimisation
- `api/mobile-status.js` — compact 3G-safe single-round-trip health + revenue snapshot
- Stream health watchdog Edge Function
- 17 `SECURITY DEFINER` functions with pinned `search_path`
- 7-gate DB migration governance CI workflow
- `npm run lint` (ESLint, TypeScript + Next.js aware) gated in CI on every push/PR

---

## Near-term (Q3 2026)

### URGENT: rotate the credentials leaked 2026-07-15
A live Supabase `service_role` key and live Stripe secret/webhook keys were
found hardcoded across 21+ tracked files (see `ISSUES_FOUND.md` #20-#21).
The files have been scrubbed and a Vault-backed replacement wired up, but
the keys themselves are still live until rotated in the Supabase and
Stripe dashboards — this session had no authenticated access to do that
part. Treat as compromised until rotated.

### RESOLVED (2026-07-15, third pass): checkout and Stripe webhooks are now reachable
Checkout (`api/checkout.js`, bridged to `pages/api/checkout.js`) and both
Stripe webhook handlers (`api/stripe-connect-webhook.js`,
`api/webhooks/stripe.js`, bridged to their `pages/api/` equivalents) are
now part of Next.js's actual served route set — confirmed with a real
`npm run build`. Two additional latent bugs that would have broken them
even after bridging were also found and fixed: a clobbered module export
in `webhooks/stripe.js`, and both handlers reading `req.body` directly
instead of buffering the raw request stream (Next.js does not
auto-populate `req.body` when `bodyParser: false` is set, which raw-body
Stripe signature verification requires). See `ISSUES_FOUND.md` #38-#41 and
`DEPLOYMENT.md` for the full routing map.

**Still open**: the top-level `api/` directory as a whole remains a dead
Vercel-only convention under this deployment model (~13 files still
unbridged — see `DEPLOYMENT.md`'s reachability table). More importantly,
**this audit could not confirm from inside the sandbox which of this
repo's several possible "production" processes (`next start`, the separate
Express server at `src/server.js`, or the PM2-managed fleet described in
`ecosystem.config.js` — `heidi-core/server.js`, `hydi-processor.js`,
`protoforge-main.js`, `agents/ursula/ursula.js`, `apps/ursula-frontend`) is
actually running on the real host right now.** `DEPLOYMENT.md` documents
what's *reachable in principle* per each process's own code; whether each
process is *actually started* on the operator's machine is something only
the operator can confirm (e.g. `pm2 list`).

### Security: cryptographic identity verification
Replace the current `x-user-id` header trust model with cryptographically verified identity tokens. This is the highest-priority security item and is a prerequisite for any public-facing expansion.

### Pipeline observability
- Structured trace IDs flowing through all six layers end-to-end
- Per-layer latency metrics surfaced in `api/mobile-status.js`
- Replay Engine automated regression suite running on every PR

### PolicyEngine expansion
- Additional DSL operators (`contains`, `startsWith`, `regex`)
- Multi-condition rule grouping (`all`, `any`)
- Rule version history in the `policies` table

---

## Medium-term (Q4 2026)

### Revenue stream expansion
- Additional Stripe Connect sub-accounts for new projects
- Per-stream real-time P&L dashboard
- Automated payout scheduling via `pg_cron`

### KILO hypothesis quality
- Confidence scoring tied to ProtoForge calibration feedback loop
- Hypothesis deduplication before Emission Layer
- Audit trail for accepted vs. rejected hypotheses in the `decisions` table

### Edge Function hardening
- JWT enforcement audit across all 42 functions
- Rate limiting on public (no-JWT) functions
- Chaos runner integration into CI

---

## Long-term (2027)

### Multi-tenant pipeline
Support isolated pipeline instances per tenant, each with their own RAW EVENT LEDGER partition and PolicyEngine rule set.

### Federated HYDI nodes
Allow external services (Rezonette, ProtoForge, future nodes) to register as first-class pipeline participants with verifiable identities.

### Self-healing automation
Expand the existing `SelfHealingService` to automatically remediate common drift conditions without human intervention, gated behind a human-approval workflow for destructive actions.

---

## Non-goals

The following are explicitly out of scope and will not be added:

- **KILO execution authority** — KILO will never be permitted to execute actions directly; `execute()` throws unconditionally by design
- **Mutable event ledger** — the RAW EVENT LEDGER is append-only; no update or delete paths will be added
- **Unauthenticated pipeline ingestion** — all ingestion endpoints will require authentication once the identity hardening milestone is complete
