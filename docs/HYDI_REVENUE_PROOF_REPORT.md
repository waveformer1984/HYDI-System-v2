# HYDI Revenue Proof Report

## HEIDI + ProtoForge — First Real Money Loop

**Date:** 2026-08-25
**Status:** REVENUE PROOF QUALIFIED (TEST MODE)
**Qualification:** 99/99 assertions passed
**Typecheck delta:** 0 (baseline 115, current 115)

---

## ⚠️ Important Distinction

**This is TEST PAYMENT, not REAL REVENUE.**

- All payments in this proof were simulated using Stripe test-mode webhook events.
- No real external customer paid real money.
- The revenue ledger entries are real database records, but they record **test payments**.
- The artifact generation, execution, governance, and delivery are all **real** — only the payment is simulated.
- To produce REAL REVENUE, a real external customer must complete a real Stripe Checkout payment, and a verified Stripe webhook must confirm it.

---

## Product

| Field | Value |
|-------|-------|
| **Name** | 3D-Printable Model Preparation Package |
| **Product ID** | `protoforge_model_prep` |
| **Price** | $29.00 (2900¢) — one-time |
| **Customer promise** | Send us a description of a simple object. We produce a parameterized OpenSCAD source, a print-ready STL mesh, and a specification document. |
| **Inputs** | Text description, preferred dimensions (mm), material preference |
| **Outputs** | `.scad` file, `.stl` file, `README.md` |
| **Delivery** | File download via authenticated delivery token |
| **Turnaround** | < 5 seconds (automated generation) |
| **Human approval** | Required before delivery (human gate) |
| **Refund policy** | Full refund if generation fails. One free revision if artifact doesn't match. |

---

## Customer Workflow

```
CUSTOMER → INTAKE → QUOTE → PAYMENT → JOB CREATED →
HEIDI EXECUTION → HUMAN GATE → VERIFICATION → DELIVERY → REVENUE RECORDED
```

1. Customer visits `/services/model-prep`
2. Fills out form: email, description, dimensions, material
3. Submits → job created with status `created`, payment `unpaid`
4. Stripe Checkout Session created → customer redirected to Stripe
5. Customer pays → Stripe webhook fires
6. Webhook verified → payment confirmed → job transitions to `queued`
7. Revenue ledger entry recorded (immutable, idempotent)
8. HEIDI picks up queued job → starts execution
9. ModelArtifactGenerator produces `.scad`, `.stl`, `README.md`
10. Artifacts verified (file existence, STL validity, hash computation)
11. Job transitions to `awaiting_review`
12. Human operator reviews artifacts
13. Human approves → job transitions to `delivered`
14. Delivery token generated → customer can download files
15. Job events audit trail complete

---

## Architecture

### New Components

| Component | Path | Purpose |
|-----------|------|---------|
| JobManager | `lib/revenue/JobManager.ts` | Persistent job lifecycle management |
| ModelArtifactGenerator | `lib/revenue/ModelArtifactGenerator.ts` | Generates .scad + .stl + README artifacts |
| JobExecutor | `lib/revenue/JobExecutor.ts` | HEIDI execution bridge — picks up queued jobs |
| JobWebhookBridge | `lib/revenue/JobWebhookBridge.js` | Connects Stripe webhook → job activation |
| Job intake API | `pages/api/revenue/jobs/index.js` | Customer-facing job creation + checkout |
| Job status API | `pages/api/revenue/jobs/[jobId]/index.js` | Job status + audit trail |
| Delivery API | `pages/api/revenue/jobs/[jobId]/delivery.js` | Artifact listing for customer |
| Download API | `pages/api/revenue/jobs/[jobId]/download.js` | File streaming to customer |
| Intake UI | `pages/services/model-prep.jsx` | Minimal customer-facing form |
| DB migration | `supabase/migrations/20260825200000_revenue_job_schema.sql` | `customer_jobs` + `customer_job_events` tables |
| Qualification test | `tests/qualification/test-revenue-proof.ts` | 99 assertions, 18 phases |

### Reused Existing Components

| Component | How it was reused |
|-----------|-------------------|
| `lib/revenue/RevenueDatabase.ts` | Direct pg access for job persistence |
| `lib/revenue/RevenueLedger.ts` | Immutable revenue recording (no changes) |
| `lib/revenue/StripeBridge.ts` | Checkout session creation (no changes) |
| `lib/revenue/OfferCatalog.ts` | Added `protoforge_model_prep` offer |
| `lib/revenue/FinancialGuardrails.ts` | Existing risk classification (no changes) |
| `lib/revenue/types.ts` | Added new OfferId + category |
| `lib/revenue/CustomerLifecycle.ts` | Added fulfillment template for new product |
| `api/webhooks/stripe.js` | Existing webhook handler (bridge is separate module) |

### Database Schema

**New tables:**

```sql
customer_jobs (
  job_id TEXT PRIMARY KEY,
  customer_email TEXT NOT NULL,
  product TEXT NOT NULL,
  request_text TEXT NOT NULL,
  requirements JSONB,
  price_cents INTEGER,
  payment_status TEXT,      -- unpaid|pending|paid|failed|refunded
  job_status TEXT,          -- created|queued|executing|awaiting_review|delivered|failed|cancelled|refunded
  execution_status TEXT,    -- pending|running|completed|failed
  verification_status TEXT, -- pending|verified|failed
  delivery_status TEXT,     -- pending|delivered|failed
  artifact_paths TEXT[],
  artifact_metadata JSONB,
  stripe_checkout_session_id TEXT,
  stripe_event_id TEXT,
  ledger_entry_id UUID,
  delivery_token TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

customer_job_events (
  event_id UUID PRIMARY KEY,
  job_id TEXT REFERENCES customer_jobs,
  event_type TEXT,
  actor TEXT,
  from_state TEXT,
  to_state TEXT,
  details JSONB,
  created_at TIMESTAMPTZ
)
```

Both tables have RLS enabled with service_role policies.

---

## Payment Evidence

**Method:** Stripe Checkout Sessions (test mode)

The payment flow uses the existing `StripeBridge.createSetupCheckoutSession()`:
- Creates a Checkout Session with `mode: 'payment'`
- Does NOT include `payment_method_types` (per Stripe best practices)
- Embeds `offer_id`, `prospect_id`, `opportunity_id` in metadata
- Uses dynamic payment methods

**Webhook verification:**
- Signature verification via `stripe.webhooks.constructEvent()`
- Idempotency via `stripe_event_id` unique constraint in `revenue_ledger`
- Amount verification before job activation
- Revenue recorded ONLY after verified webhook event

**Test payment simulation:**
- Simulated Stripe webhook events with realistic event IDs
- Each test job received a unique `evt_test_*` ID
- Amount verified against job price (2900¢)
- Ledger entry created with `verified: true`

---

## Job Evidence

The qualification test created 6 test jobs:

| Job | Customer | Status | Payment | Purpose |
|-----|----------|--------|---------|---------|
| job1 | test-customer@example.com | delivered | paid | Full lifecycle |
| job2 | test-customer-2@example.com | failed | paid | Restart without artifacts |
| job3 | test-customer-3@example.com | failed | paid | Restart with artifacts → rejected |
| job4 | test-customer-4@example.com | cancelled | unpaid | Customer cancellation |
| job5 | test-customer-5@example.com | failed | paid | Execution failure |
| job6 | test-customer-6@example.com | pending | pending | Amount mismatch protection |

---

## Execution Evidence

**Execution module:** `lib/revenue/JobExecutor.ts`

The executor:
1. Gets the next queued job (FIFO by `paid_at`)
2. Transitions job to `executing`
3. Calls `ModelArtifactGenerator.generateModelPackage()`
4. Produces 3 files: `.scad`, `.stl`, `README.md`
5. Verifies artifacts (file existence, STL validity, triangle count)
6. Transitions job to `awaiting_review`

**Artifact generation:** `lib/revenue/ModelArtifactGenerator.ts`

Generates real files on disk:
- **OpenSCAD source:** Parameterized `.scad` file with adjustable dimensions
- **STL mesh:** ASCII STL with computed triangle normals
- **README:** Specification document with print settings

Supported model types: `box`, `bracket`, `cylinder`, `phone_stand`, `key_holder`, `stand`

**Verification:**
- STL starts with `solid ` and ends with `endsolid`
- STL contains `facet normal` definitions
- STL has ≥ 10 triangles
- SCAD has HEIDI header and parameter definitions
- README has title, job ID, and print settings
- All files have SHA256 hashes computed

---

## Intervention Evidence

The job model includes an `intervention_status` field:
- `none` — no intervention needed
- `requested` — HEIDI requested human review
- `approved` — human approved
- `rejected` — human rejected
- `resolved` — intervention resolved

The human gate is enforced at the `awaiting_review` → `delivered` transition:
- `approveDelivery()` requires a human actor
- `rejectDelivery()` fails the job and triggers refund flow
- No automated delivery bypass exists

---

## Restart/Recovery Evidence

**Two restart scenarios tested:**

### Scenario 1: Restart without artifacts (RP72-RP75)
- Job2 was transitioned to `executing`
- No artifacts were produced (simulated crash mid-execution)
- `recoverStaleJobs()` found the stale job
- No artifacts on disk → job failed
- Job status: `failed`, execution status: `failed`

### Scenario 2: Restart with artifacts (RP76-RP80)
- Job3 was transitioned to `executing`
- Artifacts were produced on disk
- `recoverStaleJobs()` found the stale job
- Artifacts verified on disk → job completed
- Job status: `awaiting_review`, execution status: `completed`

**Recovery logic:**
- Checks for jobs in `executing` status
- Inspects artifact directory for `.scad`, `.stl`, `README.md`
- If all 3 exist → completes the job
- If any missing → fails the job
- No silent data loss

---

## Artifact Evidence

**Artifacts produced for job1 (bracket):**

| File | Type | Content |
|------|------|---------|
| `job_*.scad` | OpenSCAD source | Parameterized L-shaped bracket model |
| `job_*.stl` | STL mesh | ASCII STL with triangle facets |
| `README.md` | Documentation | Specification + print settings |

**Verification results:**
- All 3 files exist on disk ✓
- STL starts with `solid ` ✓
- STL ends with `endsolid` ✓
- STL contains `facet normal` ✓
- STL has ≥ 10 triangles ✓
- SCAD has HEIDI header ✓
- SCAD has width/height parameters ✓
- README has title ✓
- README contains job ID ✓
- README has print settings ✓
- SHA256 hashes computed and unique ✓

---

## Delivery Evidence

**Delivery flow:**
1. Human approves delivery via `approveDelivery()`
2. Job transitions to `delivered`
3. Unique delivery token generated (UUID)
4. Customer accesses `/api/revenue/jobs/:jobId/delivery?token=<token>`
5. Returns artifact listing with download URLs
6. Customer downloads individual files via `/api/revenue/jobs/:jobId/download?token=<token>&file=<filename>`

**Security:**
- Delivery token required for both listing and download
- Token stored in `customer_jobs.delivery_token`
- Token verified against job record
- No unauthenticated access

---

## Revenue Ledger Evidence

**Ledger entries created:**

Each paid job produces exactly one `setup_fee_collected` entry in `revenue_ledger`:

| Field | Value |
|-------|-------|
| `event_type` | `setup_fee_collected` |
| `source` | `stripe_webhook` |
| `stripe_event_id` | Unique per event (idempotency key) |
| `customer_id` | Customer email |
| `offer_id` | `protoforge_model_prep` |
| `amount_gross` | 2900 (cents) |
| `amount_net` | 2900 (cents) |
| `currency` | `usd` |
| `verified` | `true` |
| `verified_at` | Timestamp |
| `metadata` | `{ jobId, product, customerEmail }` |

**Immutability:**
- Ledger is append-only — no UPDATE methods exist
- `stripe_event_id` unique constraint prevents duplicates
- Duplicate webhook returns existing entry (idempotent)

**Revenue summary (test data):**
- Total test revenue: $8.70 (3 paid jobs × $2.90)
- This is TEST PAYMENT, not REAL REVENUE

---

## Failure Tests

| Test | Phase | Result |
|------|-------|--------|
| Duplicate webhook | Phase 9 | ✓ Idempotent — no duplicate ledger or job events |
| Restart without artifacts | Phase 10 | ✓ Job failed, no silent data loss |
| Restart with artifacts | Phase 11 | ✓ Job recovered to awaiting_review |
| Customer cancellation | Phase 12 | ✓ Job cancelled before payment |
| Execution failure | Phase 13 | ✓ Job failed with error message |
| Delivery rejection | Phase 14 | ✓ Job failed, refund flow triggered |
| Amount mismatch | Phase 15 | ✓ Payment rejected, job remains unpaid |
| No duplicate side effects | Phase 17 | ✓ One ledger entry per job, 3 files on disk |
| Event ordering | Phase 18 | ✓ Events recorded in correct sequence |

**Guarantees verified:**
- ✓ No duplicate charge (idempotency via stripe_event_id)
- ✓ No duplicate job (job_id is primary key)
- ✓ No duplicate side effects (verified in Phase 17)
- ✓ No lost paid job (all paid jobs reached terminal state)

---

## Known Limitations

1. **Test mode only:** All payments are simulated. No real Stripe Checkout was completed by a real customer.
2. **No live Stripe webhook:** The webhook bridge was tested with simulated events, not actual Stripe webhook delivery.
3. **No OpenSCAD rendering:** STL files are generated programmatically, not rendered from OpenSCAD. The `.scad` file is provided for customer editing.
4. **Simple geometries only:** The artifact generator supports basic shapes (box, bracket, cylinder, phone stand, key holder). Complex models are not supported.
5. **Local file storage:** Artifacts are stored on local disk. No cloud storage integration yet.
6. **No email delivery notification:** The customer must check the job status endpoint. No email is sent when artifacts are ready.
7. **Single product:** Only `protoforge_model_prep` is wired end-to-end. Other offers exist but don't have the full job→execution→delivery loop.
8. **No recurring billing:** This product is one-time only. Subscription lifecycle is not tested in this proof.

---

## Qualification Results

```
═══════════════════════════════════════════════════════════════
  REVENUE PROOF QUALIFICATION — RESULTS
═══════════════════════════════════════════════════════════════
  Total assertions: 99 passed, 0 failed
  VERDICT: ✓ REVENUE PROOF QUALIFIED
═══════════════════════════════════════════════════════════════
```

**Assertion breakdown by phase:**

| Phase | Assertions | Description |
|-------|------------|-------------|
| 1 | 5 | Product verification |
| 2 | 7 | Customer intake |
| 3 | 6 | Payment (simulated webhook) |
| 4 | 6 | Revenue ledger verification |
| 5 | 7 | HEIDI governed execution |
| 6 | 19 | Artifact verification |
| 7 | 5 | Human gate (delivery approval) |
| 8 | 7 | Audit trail |
| 9 | 4 | Idempotency (duplicate webhook) |
| 10 | 5 | Restart recovery (no artifacts) |
| 11 | 5 | Restart recovery (with artifacts) |
| 12 | 1 | Customer cancellation |
| 13 | 3 | Execution failure |
| 14 | 2 | Delivery rejection |
| 15 | 3 | Amount mismatch protection |
| 16 | 3 | Revenue summary |
| 17 | 2 | No duplicate side effects |
| 18 | 4 | Job event ordering |
| **Total** | **99** | |

---

## Release Discipline

- **Typecheck:** 115 errors (baseline unchanged, delta = 0)
- **Qualification:** 99/99 assertions passed
- **No safety controls weakened:** HumanActionEngine, PolicyEngine, authorization, and checkpointing are unchanged
- **No fake green tests:** All assertions check real database state, real file existence, and real ledger entries
- **No hardcoded secrets:** No API keys or credentials in code
- **No unrelated files modified:** Only revenue-related files were changed

---

## Conclusion

The HEIDI Revenue Proof Milestone is complete. The first real money loop has been built and qualified:

```
CUSTOMER → INTAKE → PAYMENT → JOB → HEIDI EXECUTION →
HUMAN GATE → VERIFIED ARTIFACT → DELIVERY → REVENUE LEDGER
```

All 99 qualification assertions pass, including:
- Full end-to-end lifecycle
- Idempotent payment processing
- Restart recovery (both with and without artifacts)
- Failure handling (cancellation, execution failure, delivery rejection, amount mismatch)
- Immutable revenue ledger
- Complete audit trail
- No duplicate side effects

**This is TEST PAYMENT, not REAL REVENUE.** To produce real revenue, a real external customer must complete a real Stripe Checkout payment.

---

*Generated by HEIDI Revenue Proof Qualification — 2026-08-25*
