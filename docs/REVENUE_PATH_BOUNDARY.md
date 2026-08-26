# Revenue Path Boundary

## Supported Production Revenue Path

```
Customer
  ↓
POST /api/revenue/jobs  (creates job + Stripe Checkout Session)
  ↓
Stripe Checkout (customer pays)
  ↓
Stripe Webhook → POST /api/webhooks/stripe
  ↓
JobWebhookBridge.processJobPaymentConfirmation
  ↓
JobManager.confirmPayment() → job status: paid/queued
  ↓
RevenueLedger.recordEvent() → ledger entry created
  ↓
JobManager.startExecution() → job status: executing
  ↓
JobManager.completeExecution() → job status: awaiting_review
  ↓
HUMAN APPROVAL GATE (POST /api/revenue/jobs/:jobId/approve)
  ↓
Artifact re-verification on disk
  ↓
JobManager.approveForDelivery() → job status: delivered
  ↓
Delivery token issued
  ↓
Revenue reconciliation (GET /api/revenue/jobs/:jobId/reconcile)
```

**Status: QUALIFIED**

This path has been functionally verified against the production build:
- 38/38 functional route checks pass
- 30/30 failure injection tests pass
- Production-path Stripe E2E passes
- Reconciliation produces CONSISTENT for complete transactions
- Reconciliation produces BLOCKED for transactions awaiting human approval

## Unsupported / Legacy Revenue Path

```
POST /api/checkout  (creates subscription-mode Stripe Checkout Session)
  ↓
Stripe Checkout (customer subscribes)
  ↓
Stripe Webhook → POST /api/webhooks/stripe
  ↓
WebhookQueueAdapter (async queue, NOT JobWebhookBridge)
  ↓
RevenueIngestionWorker / ProvisioningWorker
```

**Status: UNSUPPORTED in production**

The legacy `/api/checkout` route creates subscription-mode sessions for
`starter`/`pro`/`enterprise` tiers. It is NOT linked to the customer job
pipeline. Its webhook events bypass `JobWebhookBridge` and flow through
the async queue to legacy workers.

In production (`NODE_ENV=production`), this route returns **410 Gone**
with a pointer to the qualified path (`/api/revenue/jobs`).

In development, the route remains available for testing.

## Boundary Enforcement

| Check | Mechanism |
|-------|-----------|
| Legacy route blocked in production | `NODE_ENV` gate in `pages/api/checkout.js` |
| Regression test | `tests/unit/legacy-checkout-boundary.test.js` |
| Safety envelope test | `tests/unit/revenue-safety-envelope.test.js` |
| Failure injection | `scripts/failure-injection-tests.js` (Test 10) |

## Reconciliation States

| State | Meaning |
|-------|---------|
| CONSISTENT | All stages agree, transaction is complete and verified |
| INCOMPLETE | Transaction is in progress, not all stages reached yet |
| BLOCKED | Transaction is intentionally blocked (awaiting human approval) |
| MISMATCH | Stages disagree, manual investigation required |

A MISMATCH must never be reported as successful completion. The
reconciler detects safety envelope violations including:
- Payment without ledger entry
- Delivery without approval event
- Delivery without artifact verification
- Failed verification with delivered status
- Missing delivery token on delivered job
- Insufficient artifacts for review/delivered state
- Skip from executing to delivered without human approval
