# Controlled First Transaction Runbook

This runbook guides an operator through executing a single controlled
real customer transaction against the production build. It does NOT
execute the transaction automatically — each step requires explicit
human confirmation.

## Pre-Conditions

Before starting:
1. `npm run build` succeeds
2. `npm run typecheck` passes (0 errors)
3. `npm test` passes (all unit tests)
4. `npm run boot:prod` starts cleanly
5. Health endpoint returns `environment: production`
6. Stripe is in test mode (`sk_test_...`)
7. `WEBHOOK_PROCESSING_ENABLED=true`
8. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` is running

## Steps

### Step 1: Confirm production mode
```bash
curl -s http://localhost:3000/api/health | jq .environment
# Expected: "production"
```

### Step 2: Confirm legacy checkout is blocked
```bash
curl -s -X POST http://localhost:3000/api/checkout \
  -H "Content-Type: application/json" \
  -d '{"tier":"starter","email":"test@test.com","company":"Test"}'
# Expected: 410 Gone with qualifiedPath: /api/revenue/jobs
```

### Step 3: Create the customer job
```bash
curl -s -X POST http://localhost:3000/api/revenue/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "customerEmail": "customer@example.com",
    "customerName": "Real Customer",
    "product": "protoforge_model_prep",
    "requestText": "Customer's actual request",
    "requirements": {}
  }' | jq .
# Record: jobId, checkoutUrl, sessionId
```

### Step 4: Confirm payment
- Send the `checkoutUrl` to the customer (or use Stripe test card)
- Wait for the Stripe webhook to arrive
- Confirm the job is now `paid` and `queued`:
```bash
curl -s http://localhost:3000/api/revenue/jobs/<jobId> | jq .job
# Expected: paymentStatus: "paid", jobStatus: "queued"
```

### Step 5: Verify webhook receipt
```bash
curl -s http://localhost:3000/api/revenue/jobs/<jobId> | jq .events
# Expected: payment_confirmed event in the events list
```

### Step 6: Verify job state
```bash
curl -s http://localhost:3000/api/revenue/jobs/<jobId> | jq .job.jobStatus
# Expected: "queued" (after payment) or "executing" (if started)
```

### Step 7: Execute and produce artifacts
- The job executor produces artifacts (.scad, .stl, README.md)
- The job transitions to `awaiting_review`
```bash
curl -s http://localhost:3000/api/revenue/jobs/<jobId> | jq .job.jobStatus
# Expected: "awaiting_review"
```

### Step 8: Verify artifacts
- Confirm artifacts exist on disk in `artifacts/customer-jobs/<jobId>/`
- Confirm at least 3 files including .scad, .stl, README.md
- Confirm STL is structurally valid (starts with `solid `, contains `endsolid`)

### Step 9: Human approval (EXPLICIT — do not skip)
```bash
curl -s -X POST http://localhost:3000/api/revenue/jobs/<jobId>/approve \
  -H "Content-Type: application/json" \
  -H "x-hydi-service-token: <valid-token>" \
  -d '{"action":"approve","notes":"First transaction approval"}' | jq .
# Record: jobStatus (should be "delivered"), deliveryToken
```

### Step 10: Verify delivery
```bash
curl -s http://localhost:3000/api/revenue/jobs/<jobId> | jq .job
# Expected: jobStatus: "delivered", deliveryStatus: "delivered",
#           delivery_token: present, verification_status: "verified"
```

### Step 11: Verify ledger
```bash
curl -s http://localhost:3000/api/revenue/jobs/<jobId> | jq .job.ledger_entry_id
# Expected: a UUID (not null)
```

### Step 12: Final reconciliation
```bash
curl -s http://localhost:3000/api/revenue/jobs/<jobId>/reconcile \
  -H "x-hydi-service-token: <valid-token>" | jq .
# Expected: state: "CONSISTENT", violations: []
```

### Step 13: Evidence capture
Save the reconciliation result and job events as evidence:
```bash
curl -s http://localhost:3000/api/revenue/jobs/<jobId>/reconcile \
  -H "x-hydi-service-token: <valid-token>" > evidence-reconciliation.json
curl -s http://localhost:3000/api/revenue/jobs/<jobId> > evidence-job.json
```

## Failure Handling

If any step fails:
- Do NOT proceed to the next step
- Run reconciliation to identify the problem:
  ```bash
  curl -s http://localhost:3000/api/revenue/jobs/<jobId>/reconcile \
    -H "x-hydi-service-token: <valid-token>" | jq .
  ```
- If state is MISMATCH: investigate the violations array
- If state is BLOCKED: this is expected at Step 8 (awaiting approval)
- If state is INCOMPLETE: the transaction is still in progress

## Post-Transaction

After a successful transaction:
1. Verify reconciliation is CONSISTENT
2. Save evidence artifacts
3. Review the complete event audit trail
4. Confirm no duplicate ledger entries
5. Confirm no duplicate webhook processing
