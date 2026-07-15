# Archived: legacy/duplicate Stripe subscription-webhook implementations

Moved here 2026-07-15 during the checkout/webhook routing consolidation
(see ISSUES_FOUND.md #33 and DEPLOYMENT.md's routing map).

## Background

A repo audit found **four** separate pieces of code that all handled
"a Stripe webhook fires, provision/update a SaaS subscription tier":

1. `supabase/functions/stripe-webhook/index.ts` — a Supabase Edge Function.
   Complete and correct: verifies the Stripe signature (Deno-compatible
   async verification), idempotent via a unique constraint on
   `keymaker_events.event_id`, and its `processEvent()` switch actually
   calls its own handler functions for `checkout.session.completed`,
   `invoice.payment_succeeded`, and the `customer.subscription.*` family.
   `supabase/config.toml` has `verify_jwt = false` for it (correct — Stripe
   can't present a Supabase JWT; the webhook signature itself is the auth).
   **This is the canonical, kept implementation.**

2. `api-webhooks-stripe.js` (was `api/webhooks/stripe.js`) — a Vercel/Express-era
   Node handler. Had a real, live bug: it set
   `module.exports.handler = ...` for Vercel-style invocation, then two
   lines later did `module.exports = { handleStripeWebhook, SERVICE_TIERS }`,
   which *replaced* the whole exports object and silently deleted the
   `.handler` export — so nothing could actually invoke it as an HTTP
   handler through its intended entry point. Its per-event-type handler
   functions (`handleCheckoutCompleted`, `handlePaymentSucceeded`, etc.)
   were also dead code: `handleStripeWebhook` queues every event to a task
   queue via `WebhookQueueAdapter` instead of calling them, and no queue
   worker in this repo consumes `stripe.webhook` tasks and calls back into
   this file. It also ran a second, incompatible idempotency check
   (`webhook_events.stripe_event_id`) layered on top of the
   `claim_webhook_event` RPC the Edge Function and the Connect webhook both
   use, on the same table, in a way that was never reconciled.

3. `stripe-webhook-server.js` — a standalone Express server whose only job
   was to `require('./api/webhooks/stripe')` and call `handleStripeWebhook`
   directly (bypassing the broken export above). Not started by any
   `package.json` script, PM2/ecosystem config, or CI workflow — only ever
   invoked manually, or spawned by `setup-stripe-integration.js` below, for
   local testing against the Stripe CLI.

4. `src-webhook-handlers-stripe-webhook.js` (was
   `src/webhook-handlers/stripe-webhook.js`) — a third, fully independent
   `StripeWebhookHandler` class targeting yet another schema (`users` /
   `api_keys` tables that don't otherwise appear in this codebase's core
   table list). It performs **no signature verification at all** — it
   assumes some caller already verified the event and just hands it a
   parsed object. Nothing in the repo ever imported or invoked this class
   outside of its own test file (`stripe-webhook.test.js.bak`, archived
   alongside it).

`api-webhooks-stripe-test.js` (was `api/webhooks/stripe-test.js`) is a
diagnostic stub ("Simple Stripe Webhook Test Handler") that never verified
a signature and just echoed back whether one was present — not a real
webhook handler, not safe to expose at a production URL under a name that
looks like a real endpoint.

`setup-stripe-integration.js` is a local dev-only helper script (not
wired into any `package.json` script) that spawned `stripe-webhook-server.js`
as a subprocess for testing against the Stripe CLI's `stripe listen`. It's
archived alongside its target since it has no other purpose.

## Why archive instead of just deleting

Same rationale as `archive/src-esm-orphans/`: none of these files were
reachable from any live entry point (`package.json` scripts, PM2/ecosystem
config, CI, or the Next.js `pages/api/**` routing surface actually served
by `next dev`/`next start`), so removing them carries no deployment risk.
Archiving instead of hard-deleting keeps the code recoverable and the
git-blame trail intact if a genuine need to resurrect a subscription
webhook queue path ever comes up.

## What replaced this

- The SaaS subscription-tier webhook (`checkout.session.completed`,
  `invoice.payment_succeeded`, `customer.subscription.*`) is handled by
  the Supabase Edge Function `supabase/functions/stripe-webhook/index.ts`.
  A human must confirm the Stripe Dashboard's webhook endpoint is actually
  configured to POST to
  `https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-webhook`
  (see DEPLOYMENT.md) — this cannot be verified from this sandbox.
- The Stripe Connect revenue-stream → sub-account → ledger webhook (a
  distinct concern, payment routing rather than subscription tiers) is
  `api/stripe-connect-webhook.js`, now bridged into reachability at
  `pages/api/stripe-connect-webhook.js`.
- Checkout session creation is `api/checkout.js`, bridged at
  `pages/api/checkout.js`. Its byte-for-byte duplicate `checkout-v2.js`
  was deleted outright (not archived — it was never anything but a copy of
  `checkout.js`, added in the same commit, and never diverged).

## One thing intentionally *not* preserved as-is: the kill switch's polarity

`api/webhooks/stripe.js`'s `handleStripeWebhook` had a
`WEBHOOK_PROCESSING_ENABLED` emergency kill switch (documented in
`ON_CALL_RUNBOOK.md` / `ROLLBACK_PLAYBOOK.md` / `ON_CALL_EMERGENCY.md`)
that defaulted to **paused** — it required the flag to be explicitly
`'true'` before processing anything. That switch has been ported to both
canonical implementations (`supabase/functions/stripe-webhook/index.ts`
and `api/stripe-connect-webhook.js`), since it's a real operational
control the runbooks depend on and neither canonical handler had it
before.

The polarity was deliberately flipped: both now pause only on an
*explicit* `'false'`, not "process only when explicitly `'true'`".
Reasoning: both canonical handlers have always processed events with no
gate at all, and this sandbox cannot verify whether
`WEBHOOK_PROCESSING_ENABLED` is already configured as `'true'` in the live
Supabase Edge Function secrets or the Next.js process env. Reusing the
archived original's fail-closed-unless-true default onto a route that
just became reachable (Connect webhook) or has been live and ungated
(subscription Edge Function) risked silently zeroing out ledger writes or
pausing subscription provisioning the instant this shipped — a worse
outcome than the emergency lever it's meant to provide. The documented
runbook action ("set `WEBHOOK_PROCESSING_ENABLED=false`") still works
identically either way, so no runbook changes were needed beyond noting
the switch now covers both handlers (see `ON_CALL_RUNBOOK.md`'s header
note).
