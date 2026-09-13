# Live Transaction Qualification — Certification Report

## Status: `LIVE_TRANSACTION_BLOCKED`

The live transaction has not been executed. The engineering qualification
is complete, but the live Stripe transaction is blocked because:

1. `ALLOW_LIVE_STRIPE` is not set to `true`
2. The Stripe key is in test mode (`sk_test_`)
3. `LIVE_QUALIFICATION_CUSTOMER_EMAIL` is not set

This is the correct and expected state. No live transaction will proceed
without explicit operator authorization.

---

## Environment

| Field | Value |
|-------|-------|
| Commit | `7aba9b1` (engineering changes staged separately) |
| Branch | `feat/governed-autonomy` |
| Node runtime | Node >= 20 |
| Production mode | Confirmed (`environment: production`) |
| Stripe mode | `test` (`sk_test_...`) |
| Live allowed | `false` (`ALLOW_LIVE_STRIPE=unset`) |

## Engineering Qualification Summary

### Phase 1 — Freeze and Verify: PASS

| Check | Result |
|-------|--------|
| Branch | `feat/governed-autonomy` ✓ |
| HEAD | `7aba9b1` ✓ |
| Typecheck | 0 errors ✓ |
| Revenue tests | 80/80 pass ✓ |
| Failure injection | 30/30 pass ✓ |
| Build | PASS ✓ |
| Production boot | PASS ✓ |
| Legacy checkout | 410 Gone ✓ |
| Reconciliation endpoint | reachable ✓ |
| Webhook endpoint | reachable ✓ |

### Phase 2 — Live Stripe Safety Gate: PASS

- `StripeBridge` already enforces `ALLOW_LIVE_STRIPE` guard for live keys
- Added `ALLOW_LIVE_STRIPE` guard to webhook handler (`api/webhooks/stripe.js`)
  - Two `require('stripe')` calls now check for live key + opt-in
  - Returns 503 if live key detected without authorization
- Created `lib/revenue/stripe-mode.ts` — shared mode detection utility
- Never exposes secret key values (uses prefix only)

### Phase 3 — Live Transaction Preflight: PASS

- Created `scripts/live-transaction-preflight.js`
- Created `pages/api/revenue/preflight.js` (API endpoint)
- Returns deterministic: `READY` / `BLOCKED` / `FAILED`
- Checks: production mode, build, server, database, schema, routes,
  legacy checkout, webhook, Stripe mode, auth, reconciliation, evidence
- Current result: `BLOCKED` (Stripe is in test mode — correct)

### Phase 4 — Transaction Limiter: PASS

- Hard-coded constraints in `scripts/live-transaction-controller.js`:
  - `maxTransactions: 1`
  - `allowedProduct: 'protoforge_model_prep'`
  - `allowedAmountCents: 2900` ($29.00)
  - `allowedCurrency: 'usd'`
  - `allowedCustomerEmail` from `LIVE_QUALIFICATION_CUSTOMER_EMAIL`
- Blocks if any constraint is violated
- Blocks if a transaction has already been completed

### Phase 5 — Customer/Job Correlation: PASS

- Controller captures all identifiers:
  - Pre-payment: `qualificationRunId`, `jobId`, `customerEmail`, `product`, `amount`, `currency`, `checkoutSessionId`
  - Post-payment: `stripeEventId`, `paymentIntentId`, `ledgerEntryId`
  - Post-approval: `deliveryToken` (hash only in evidence), `approvalActor`
  - Post-artifact: `artifactHashes`
- No transaction may be declared qualified if correlation is incomplete

### Phase 6 — Live Webhook Verification: PASS (engineering)

- Controller's `--await-webhook` stage polls for payment confirmation
- Verifies: signature verification, idempotency, job linkage, payment state
- Checks exactly 1 `payment_confirmed` event (no duplicates)
- Does NOT manually mutate the database to simulate payment

### Phase 7 — Human Approval Boundary: PASS

- Controller's `--inspect-artifacts` stage stops at the boundary
- Operator must explicitly inspect artifacts before approval
- Verifies: required files exist, SHA-256 hashes match, STL structural validity
- `--approve` stage is a separate explicit invocation

### Phase 8 — Delivery Verification: PASS (engineering)

- Controller's `--approve` stage uses existing `approveForDelivery` path
- Verifies: state is `awaiting_review`, artifact verification, approval event,
  delivery token generated, delivery state becomes `delivered`

### Phase 9 — Financial Reconciliation: PASS (engineering)

- Controller's `--reconcile` stage calls the reconciliation endpoint
- Expected result: `CONSISTENT`
- If not CONSISTENT: BLOCK, ESCALATE, DO NOT DECLARE QUALIFICATION SUCCESS

### Phase 10 — Evidence Package: PASS (engineering)

- Controller's `--evidence` stage generates `docs/live-transaction-evidence.json`
- Captures: run ID, timestamp, git commit, environment, job ID, offer, amount,
  currency, Stripe IDs, job state transitions, artifact hashes, approval,
  delivery token hash, ledger entry ID, reconciliation result
- Never captures: Stripe secret key, auth token, webhook secret, full payment
  credentials, unnecessary customer PII
- Explicitly confirms: `secretsCaptured: false`, `secretKeyExposed: false`

### Phase 11 — Post-Transaction Safety: PASS (engineering)

- Controller's `--post-transaction-safety` stage verifies:
  - Replay approval returns 409
  - Reconciliation remains CONSISTENT
  - Unauthorized access returns 401
  - Legacy checkout remains 410
  - Exactly 1 ledger entry (no duplicates)
  - Exactly 1 job for qualification customer
  - No secrets in evidence file

### Phase 12 — Live Mode Shutdown: PASS (engineering)

- Controller's `--shutdown` stage marks transaction as completed
- Reminds operator to unset `ALLOW_LIVE_STRIPE`
- Does not leave live mode enabled after the transaction

### Phase 13 — Certification Report: COMPLETE

This report.

---

## Safety

| Gate | Status |
|------|--------|
| Authentication | Enforced (401 without credentials) ✓ |
| RBAC | Enforced (revenue:manage for approval, revenue:view for read) ✓ |
| Webhook signature | Verified (400 on failure) ✓ |
| Idempotency | Enforced (claim_webhook_event RPC + stripe_event_id uniqueness) ✓ |
| Artifact verification | Required (3+ files, .scad/.stl/README.md, SHA-256 match) ✓ |
| Human approval | Required (409 if not awaiting_review, 409 on duplicate) ✓ |
| Delivery protection | Required (delivery token, no bypass) ✓ |
| Live Stripe guard | Enforced (ALLOW_LIVE_STRIPE required for live keys) ✓ |
| Legacy checkout | Blocked in production (410 Gone) ✓ |
| Transaction limiter | Enforced (1 transaction, 1 product, 1 amount) ✓ |

## Reconciliation

Expected for a completed live transaction: `CONSISTENT`

Current state: N/A (no live transaction has been executed)

## Evidence

No live transaction evidence exists because no live transaction has been
executed. The evidence harness (`scripts/first-transaction-evidence-harness.js`)
demonstrates the evidence format using test-mode data.

## Result

```
LIVE_TRANSACTION_BLOCKED
```

The engineering qualification is complete. The live transaction is blocked
because explicit human authorization (live Stripe key + `ALLOW_LIVE_STRIPE=true`
+ `LIVE_QUALIFICATION_CUSTOMER_EMAIL`) has not been provided.

To proceed with a live transaction:

1. Set `ALLOW_LIVE_STRIPE=true` in `.env.local`
2. Replace `STRIPE_SECRET_KEY` with a live key (`sk_live_` or `rk_live_`)
3. Set `LIVE_QUALIFICATION_CUSTOMER_EMAIL` to the controlled customer's email
4. Set `STRIPE_WEBHOOK_SECRET_01` to the live webhook signing secret
5. Start Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
6. Rebuild and restart the production server
7. Run: `node scripts/live-transaction-controller.js --preflight`
8. Run: `node scripts/live-transaction-controller.js --create-job`
9. Complete the payment at the checkout URL
10. Run: `node scripts/live-transaction-controller.js --await-webhook`
11. Run: `node scripts/live-transaction-controller.js --inspect-artifacts`
12. **Inspect the artifacts personally**
13. Run: `node scripts/live-transaction-controller.js --approve`
14. Run: `node scripts/live-transaction-controller.js --reconcile`
15. Run: `node scripts/live-transaction-controller.js --evidence`
16. Run: `node scripts/live-transaction-controller.js --post-transaction-safety`
17. Run: `node scripts/live-transaction-controller.js --shutdown`
18. Unset `ALLOW_LIVE_STRIPE` and restart the server

## Remaining Blockers

1. `ALLOW_LIVE_STRIPE` is not set — by design
2. No live Stripe key is configured — by design
3. `LIVE_QUALIFICATION_CUSTOMER_EMAIL` is not set — by design
4. No live transaction has been executed — by design

These are not defects. They are the intended safety state. The system
will not proceed with a live transaction without explicit operator action.
