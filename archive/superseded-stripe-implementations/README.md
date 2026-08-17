# Archived: superseded Stripe checkout/webhook implementations

Moved here 2026-07-19, resolving part of `ROADMAP.md`'s P1 item 5
("consolidate the 4 parallel, unreachable Stripe checkout/webhook
implementations"). A full audit of all five Stripe surfaces in the repo
(two live, four candidate-orphans) found this wasn't really "4 copies of
one thing" — it was 5 genuinely different billing/data models, two of
which are already live simultaneously. Full comparison in the PR that made
this change. Summary:

**Still live (unchanged, not part of this archive):**
- `api/checkout.js` + `api/webhooks/stripe.js` (bridged into `pages/api/`)
  — tiered SaaS model (starter/pro/enterprise), `customer_services` /
  `customers` / `leads` / `webhook_events` tables, `claim_webhook_event`
  idempotency RPC. Recently hardened (clobbered-export fix, raw-body fix,
  kill switch, test coverage) — this is the de facto current tiered
  implementation.
- `api/stripe-connect-webhook.js` (bridged) — the Connect sub-account
  model for the six named revenue streams `CLAUDE.md` describes as
  current, writing fee-broken-down `ledger` entries.
- `stripe-webhook-server.js` (repo root) — **not archived**, and not
  actually a competing model at all: a standalone Express wrapper that
  calls `api/webhooks/stripe.js`'s `handleStripeWebhook` directly, for
  running the same live logic outside Next.js if ever needed.

**Archived here:**

- **`webhook-handlers-stripe-webhook.js`** (was
  `src/webhook-handlers/stripe-webhook.js`) — a class-based
  `StripeWebhookHandler` targeting `users`/`api_keys` tables, a 3rd,
  distinct tiered-SaaS data model with the same tier names as the live
  implementation above but no shared schema. Fully orphaned: the only
  thing in the repo that referenced it was its own unit test (moved
  alongside it, see below). Superseded by `api/webhooks/stripe.js`, which
  already implements the same tier concept live, tested, and hardened.
- **`stripe-webhook.test.js`** (was `tests/unit/stripe-webhook.test.js`)
  — moved with its subject rather than deleted, since it exercised
  real, correct logic (tier resolution, API-key hashing, idempotent event
  routing) that may be useful reference if this data model is ever revived
  intentionally. `jest.config.js`'s `testMatch` only covers `tests/unit/**`,
  so it no longer runs from here — that's intentional.
- **`hydi-monitor-deploy/`** — a fully separate, self-contained old Next.js
  sub-project (own `package.json`, `vercel.json`, `netlify.toml`, checked-in
  `.next` build output). Its `pages/api/checkout.js` and
  `pages/api/webhook.js` are near-identical, obvious *predecessors* of
  today's live `api/checkout.js` / `api/webhooks/stripe.js` (same tier
  names, same `PRICE_MAP` shape) but wrote to a now-orphaned
  `hydi_subscriptions` table via a `sync_hydi_stripe_subscription` RPC that
  the live implementation doesn't use. Not referenced by the root
  `package.json` or anything else in the main app's dependency graph. Also
  shipped `pages/api/webhook-debug.js` / `webhook-test.js` endpoints that
  logged Stripe signatures and header contents — a real liability if this
  sub-deployment were ever accidentally stood up. `dead-vercel-config`'s
  README (2026-07-16) already flagged this directory but deliberately left
  it in place pending this exact consolidation decision.

**Deliberately not touched:** `src/api/services/index.js` (the "Ursula
service bundle" Express router, mounted into `src/server.js` via
`npm run server`) — a 4th, genuinely different model (per-service metered
execution, not just subscription tiers). Its fate is a separate, still-open
product decision — see `ROADMAP.md`. Note for whoever makes that call: its
`subscriptionManager.serviceBundle` is currently commented out
("Temporarily disabled") in `src/services/subscription-manager.js`, so most
of this router's routes (`/services`, `/services/:id/execute`, `/bundle`)
would throw at runtime even if `src/server.js` were confirmed running in
production.
