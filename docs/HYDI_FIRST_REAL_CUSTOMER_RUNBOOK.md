# HYDI First Real Customer Runbook

## Operator Procedure for the First Controlled Commercial Transaction

**IMPORTANT:** This is a controlled commercial experiment. A human operator is involved at every critical step. This is NOT an autonomous revenue system.

---

## Prerequisites

Before starting, ensure:

1. The system is running (`npm run boot` or PM2 `pm2 start ecosystem.config.js`)
2. The release gate has passed 15/15
3. The first-real-customer readiness check has passed
4. You have operator credentials (service token)

---

## Step-by-Step Procedure

### Step 1: Start Verified Production Services

```bash
# Verify the system is running
pm2 status
# Expected: hydi-boot is online

# Verify health
curl http://localhost:3000/api/health
# Expected: { ok: true, ... }
```

### Step 2: Run Readiness Check

```bash
npx tsx scripts/first-real-customer-readiness.ts
# Expected: READY_FOR_FIRST_REAL_CUSTOMER
```

If any blocker appears, STOP and resolve it before proceeding.

### Step 3: Confirm Stripe Mode

```bash
# Check Stripe mode (should be "test" for initial test, "live" for real revenue)
# The readiness check output includes the Stripe mode
# For REAL customer payments, you need:
#   - STRIPE_SECRET_KEY set to a live key (sk_live_ or rk_live_)
#   - ALLOW_LIVE_STRIPE=true
#   - STRIPE_WEBHOOK_SECRET_01 set to the live webhook signing secret
#   - WEBHOOK_PROCESSING_ENABLED=true
```

**For the first controlled test, TEST mode is acceptable.**
**For REAL revenue, LIVE mode is required.**

### Step 4: Confirm Webhook Configuration

```bash
# Verify webhook secret is set
# Check .env.local for:
#   STRIPE_WEBHOOK_SECRET_01=whsec_...
#   WEBHOOK_PROCESSING_ENABLED=true

# If using Stripe CLI for local testing:
# stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

### Step 5: Confirm Artifact Storage

```bash
# Verify artifact directory exists and is writable
ls -la artifacts/customer-jobs/
# The readiness check verifies this automatically
```

### Step 6: Confirm HEIDI Health

```bash
# Check that HEIDI is responsive
curl http://localhost:3000/api/health
# Verify: ok=true, system status is healthy

# Check that the job executor can run
# (The readiness check verifies JobManager is instantiable)
```

### Step 7: Accept Customer

1. Direct the customer to: `https://your-domain/services/model-prep`
2. Customer fills out the form:
   - Email (required)
   - Name (optional)
   - Description of desired object (required)
   - Object type, dimensions, material
3. Customer clicks "Submit & Pay $29.00"
4. Customer is redirected to Stripe Checkout
5. Customer completes payment

**Monitor:**
```bash
# Watch for new jobs in the database
# (Use the Supabase dashboard or psql)
```

### Step 8: Monitor Job

After payment, the job should transition automatically:

```
created → pending → queued → executing → awaiting_review
```

Monitor via the customer status page:
`https://your-domain/services/model-prep/status?jobId=<jobId>`

Or via API:
```bash
curl http://localhost:3000/api/revenue/jobs/<jobId>
```

### Step 9: Handle Human Intervention

If HEIDI requests human intervention during execution:

1. Check the job status — it will show `awaiting_review` or `failed`
2. Review the execution error if present
3. If the job failed, decide:
   - Retry execution (if transient)
   - Process a refund (if unrecoverable)

### Step 10: Review Artifact

Once the job reaches `awaiting_review`:

1. Check the artifact files exist:
```bash
ls artifacts/customer-jobs/<jobId>/
# Expected: .scad, .stl, README.md
```

2. Verify the STL is valid:
```bash
# Check STL header
head -1 artifacts/customer-jobs/<jobId>/*.stl
# Expected: "solid <modelname>"

# Check STL footer
tail -1 artifacts/customer-jobs/<jobId>/*.stl
# Expected: "endsolid <modelname>"
```

3. Open the .scad file and verify it matches the customer's request
4. Open the README.md and verify the specifications are correct
5. Optionally: render the STL in a 3D viewer to visually inspect

### Step 11: Approve Delivery

Once you are satisfied with the artifacts:

```bash
# Approve delivery (requires operator token)
curl -X POST http://localhost:3000/api/revenue/jobs/<jobId>/approve \
  -H "Content-Type: application/json" \
  -H "x-hydi-service-token: <your-token>" \
  -d '{"action": "approve", "notes": "Artifacts verified — matches customer request"}'
```

The response will include a `deliveryToken`.

**To reject instead:**
```bash
curl -X POST http://localhost:3000/api/revenue/jobs/<jobId>/approve \
  -H "Content-Type: application/json" \
  -H "x-hydi-service-token: <your-token>" \
  -d '{"action": "reject", "notes": "Artifact does not match request"}'
```

Rejection triggers a refund flow.

### Step 12: Confirm Customer Delivery

After approval:

1. The customer can access their files at:
   `https://your-domain/services/model-prep/status?jobId=<jobId>`
2. The status page will show download links
3. The customer downloads the .scad, .stl, and README.md files

Verify delivery:
```bash
curl "http://localhost:3000/api/revenue/jobs/<jobId>/delivery?token=<deliveryToken>"
# Expected: { artifacts: [...] }
```

### Step 13: Confirm Revenue Ledger

Verify the revenue was recorded:

```bash
# Check the revenue ledger
# (Via Supabase dashboard or psql)
SELECT * FROM revenue_ledger WHERE customer_id = '<customer-email>';
# Expected: one row with event_type='setup_fee_collected', verified=true
```

### Step 14: Record Transaction Evidence

Document the transaction:

1. Job ID: _______________
2. Customer email: _______________
3. Stripe session ID: _______________
4. Stripe event ID: _______________
5. Payment amount: $29.00
6. Ledger entry ID: _______________
7. Delivery token: _______________
8. Artifact hashes:
   - SCAD: _______________
   - STL: _______________
   - README: _______________
9. Approval timestamp: _______________
10. Operator name: _______________

### Step 15: Handle Failure/Refund

If the job fails or the customer requests a refund:

```bash
# Process refund (requires operator access)
# The refundJob method transitions the job to 'refunded'
# A Stripe refund should also be initiated via the Stripe Dashboard
```

**Refund checklist:**
- [ ] Job marked as refunded in database
- [ ] Stripe refund initiated in Stripe Dashboard
- [ ] Customer notified of refund
- [ ] Revenue ledger updated (if applicable)

---

## Emergency Procedures

### Webhook Not Processing

If webhooks are not being processed:

1. Check `WEBHOOK_PROCESSING_ENABLED` is `true`
2. Check `STRIPE_WEBHOOK_SECRET_01` is set correctly
3. Check the webhook endpoint is reachable from Stripe
4. Check server logs for errors

### Duplicate Webhook

If Stripe sends a duplicate webhook:

- The system handles this automatically via idempotency
- The job will not be activated twice
- The ledger will not have duplicate entries
- The response will include `idempotent: true`

### Job Stuck in `executing`

If a job is stuck in `executing` status:

1. Check if artifacts exist on disk
2. If artifacts exist, the restart recovery will complete the job
3. If artifacts don't exist, the restart recovery will fail the job
4. Restart the system to trigger recovery

### Customer Cannot Download

If the customer cannot download artifacts:

1. Verify the delivery token is correct
2. Verify the job status is `delivered`
3. Verify the artifact files exist on disk
4. Verify the download endpoint is accessible

---

## Critical Rules

1. **NEVER approve delivery without reviewing artifacts**
2. **NEVER skip the human gate**
3. **NEVER mark a job as delivered without verifying artifact hashes**
4. **NEVER process a refund without checking the Stripe Dashboard**
5. **NEVER expose the operator token to the customer**
6. **NEVER claim revenue without a verified ledger entry**
7. **ALWAYS record transaction evidence**
8. **ALWAYS monitor the first transaction end-to-end**

---

*This runbook is for the first controlled commercial transaction only. Subsequent transactions may follow a streamlined process once the workflow is proven.*
