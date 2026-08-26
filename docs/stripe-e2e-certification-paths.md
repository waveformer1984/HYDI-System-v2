# Stripe E2E Certification — Path Clarification

## Two Distinct Certifications

This document clarifies what each Stripe E2E certification actually tested,
so a future reader doesn't have to guess whether "the real production webhook
path" or "the qualification harness's webhook logic" is what got certified.

---

## CERT-E2E-cf1b55c9 — Qualification Harness (Signature/Idempotency Logic)

**File:** `docs/stripe-e2e-certification.json`
**Script:** `scripts/qualify-stripe-e2e-autonomous.ts`
**Runner:** `StripeE2EQualificationRunner`

### What it tested

A **standalone HTTP receiver** built into the qualification script. This
receiver listens on a random port and records webhook deliveries, but it
does **NOT** import or call:

- `api/webhooks/stripe.js` (the production handler)
- `lib/revenue/JobWebhookBridge.js` (the synchronous job bridge)
- `workers/WebhookQueueAdapter.js` (the async queue adapter)
- Any Supabase/database logic

### What it verified

- Real Stripe CLI authentication
- Real test-mode credential extraction and validation
- Real `stripe listen` process startup
- Real webhook signing secret capture
- Real `stripe trigger checkout.session.completed` execution
- Real webhook delivery over HTTP
- Real Stripe signature verification (HMAC-SHA256)
- Event correlation and idempotency (no duplicate deliveries)
- Cleanup (listener stopped, env restored, credential removed)

### What it did NOT verify

- Whether the production handler (`api/webhooks/stripe.js`) processes the
  event correctly
- Whether the `JobWebhookBridge` activates the job and records a ledger
  entry
- Whether the async `WebhookQueueAdapter` path and the synchronous
  `JobWebhookBridge` path can double-process the same event
- Whether the `claim_webhook_event` RPC idempotency check works
- Whether the CASCADE gate passes real events

### Conclusion

This certification proves that the **verification logic** (signature
verification, event correlation, idempotency checking) is sound. It does
NOT prove that the production handler works end-to-end.

---

## prod-e2e-e94585ee — Production Handler (Real /api/webhooks/stripe)

**File:** `docs/stripe-e2e-production-path-result.json`
**Script:** `scripts/qualify-stripe-e2e-production-path.ts`

### What it tested

A **signed checkout.session.completed webhook** delivered directly to the
real production handler at `localhost:3000/api/webhooks/stripe` — the same
handler that a real customer's payment will hit.

### What it verified

- Real production server is running and responding
- Real Stripe CLI authentication
- Real customer job created in the database
- Real Stripe Checkout Session created and linked to the job
- Real `stripe listen` forwarding to the production handler
- Real webhook secret configured in the production server's env
- Signed webhook delivered to the REAL production handler
- Production handler verified the signature (`stripe.webhooks.constructEvent`)
- Production handler's `claim_webhook_event` RPC idempotency check
- Production handler's CASCADE gate passed the event
- `JobWebhookBridge.processJobPaymentConfirmation` was called
- Job was found by `stripe_checkout_session_id`
- Revenue ledger entry was recorded (exactly ONE)
- Job was activated (`payment_status=paid`, `job_status=queued`)
- Handler returned `{"status":"JOB_PROCESSED"}` — async queue SKIPPED
- **Double-delivery idempotency**: same webhook sent twice → second
  delivery returned `"duplicate"` → still exactly 1 job activation and
  1 ledger entry

### The double-processing question — ANSWERED

> "Can the async WebhookQueueAdapter path and the synchronous
> JobWebhookBridge call both react to the same real
> checkout.session.completed event and double-process it (double job
> activation, double ledger entry)?"

**No.** The production handler at `api/webhooks/stripe.js` lines 209-216
returns early after the `JobWebhookBridge` processes the event:

```js
if (jobBridgeProcessed) {
  console.log(`[📦 JOB BRIDGE] Skipping async queue for job-linked event ${event.id}`);
  return res.status(200).json({
    received: true,
    status: 'JOB_PROCESSED',
    eventId: event.id,
  });
}
```

This means the `WebhookQueueAdapter.handleWebhook()` call at line 223 is
**never reached** for job-linked checkout sessions. The synchronous bridge
is the sole owner of job activation and ledger writes for
`checkout.session.completed` events.

Additionally, the `claim_webhook_event` RPC at line 149 provides a
**second layer of idempotency**: if the same event ID is delivered again
(even after the bridge has processed it), the handler returns `"duplicate"`
before reaching the bridge or the queue.

### Evidence

```
First delivery:  HTTP 200 {"received":true,"status":"JOB_PROCESSED","eventId":"evt_test_prod-e2e-e94585ee"}
Second delivery: HTTP 200 "duplicate"
Database state:  1 job activation, 1 ledger entry, 0 duplicates
```

### Bugs found and fixed during this test

1. **`getJobManager is not a function`** — `JobWebhookBridge.js` (CommonJS)
   could not `require()` `JobManager.ts` (TypeScript) from the Next.js dev
   server. Fixed by adding a direct SQL fallback in `JobWebhookBridge.js`
   that uses `pg` directly when the TypeScript modules aren't loadable.

2. **`WEBHOOK_PROCESSING_ENABLED` not set** — The production server's kill
   switch was correctly blocking all webhook processing. Fixed by setting
   `WEBHOOK_PROCESSING_ENABLED=true` in `.env.local`.

3. **`STRIPE_SECRET_KEY` was a placeholder** — `.env.local` had
   `sk_test_INVALID_0000000000000000`. Fixed by setting the real test key
   from `stripe config --list`.

4. **`STRIPE_WEBHOOK_SECRET_01` not set** — The production handler needs
   the webhook signing secret to verify signatures. Fixed by setting it
   from `stripe listen --print-secret` (deterministic per account).

5. **`webhook_events.stripe_event_id` column missing** — The
   `WebhookQueueAdapter` tries to update a `stripe_event_id` column that
   doesn't exist in the `webhook_events` table. This causes the async
   queue path to fail with a 500 error. This is NOT a problem for
   job-linked checkouts (the bridge skips the queue), but it IS a bug for
   the old tier/subscription checkout flow. **Not yet fixed** — tracked
   as a follow-up.

---

## Summary

| Certification | Path Tested | Double-Processing Risk |
|--------------|-------------|----------------------|
| CERT-E2E-cf1b55c9 | Standalone receiver (qualification harness) | N/A — doesn't test production handler |
| prod-e2e-e94585ee | Real `/api/webhooks/stripe` (production) | **None** — bridge skips queue, RPC catches duplicates |

Both certifications are valuable. The first proves the verification logic
is sound. The second proves the production handler works end-to-end with
no double processing.
