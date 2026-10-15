# Billing sandbox verification — operator runbook (Windows)

Canonical tree: `C:\Users\Owner\HYDI-System-v2`, branch **`clean-main`** or PR **#366** branch.

**Test mode only.** Never use live Stripe keys or `ALLOW_LIVE_STRIPE=true`.

Secrets: inject per `SECURITY_PROTOCOL.md` (variable names below only — never paste values into this file).

---

## 0. Orchestrated task (optional, pause/resume)

```powershell
cd C:\Users\Owner\HYDI-System-v2
node scripts/billing-sandbox-workflow.js start
# note task_id from JSON output
node scripts/billing-sandbox-workflow.js run-automated --task-id <task_id>
node scripts/billing-sandbox-workflow.js report --task-id <task_id>
```

Task state file: `.hydi/billing-verify/<task_id>.json` (gitignored).

From mobile execution fabric (operator role, `billing:finance:view`):

- Objective: `ops.billing-sandbox-verify`
- Or typed actions: `billing.verify_workflow`, `billing.preflight`, `tests.run` suite `billing`

---

## 1. Docker Desktop

| Step | Command / check | Record in `SANDBOX_RUN_*-operator.md` |
|------|-----------------|----------------------------------------|
| Docker running | Docker Desktop UI or `docker info` exit **0** | PASS/FAIL |

---

## 2. Local Supabase

```powershell
npx supabase start
npx supabase migration up
npx supabase status
```

Expected: API URL and DB port **54322** (default).

---

## 3. Environment variables (presence only)

Set in `.env.local` (not committed):

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Must be **`sk_test_`** or **`rk_test_`** |
| `BILLING_STRIPE_WEBHOOK_SECRET` | From `stripe listen` (`whsec_…`) |
| `BILLING_CUSTOMER_TOKEN_SECRET` | ≥ 32 chars, server-only |
| `HYDI_SERVICE_SECRET` | Operator/admin routes |
| `BILLING_APP_URL` | `http://localhost:3000` |

```powershell
npm run billing:preflight
# or strict:
node scripts/billing-preflight.js --require-stripe-env
```

Expect **PASS** on `postgres_connect`, `billing_tables` (14 tables), and env checks.

Migration file: `supabase/migrations/20261011120000_billing_revenue_streams_module.sql`

---

## 4. Stripe webhook forwarding

Terminal A:

```powershell
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Copy the signing secret into `BILLING_STRIPE_WEBHOOK_SECRET` (restart dev server after changing env).

Webhook route (raw body, signature verified): **`POST /api/billing/webhook`**

---

## 5. Sandbox tenant + catalog (idempotent)

```powershell
node scripts/billing-sandbox-setup.js --tenant-name "Sandbox Co" --tenant-email <your-email>
```

- Creates catalog keys `hydi_ai` / `starter` if missing (does not duplicate published price with same amount/interval).
- Prints **one** customer link: `/pricing?token=…` — **credential**; do not log in tickets/chat.

Record **tenant_id** (uuid) from script output for DB snapshots below.

---

## 6. Application

```powershell
npm run dev
```

Uses **`--webpack`** (required for custom `next.config.js`). Do not commit incidental `tsconfig.json` / `AGENTS.md` edits from dev.

Public catalog check: `GET http://localhost:3000/api/billing/catalog` → JSON `{ products: [...] }`

---

## 7. Browser — §J.5–6 (success path)

1. Open customer link → `/pricing` → Subscribe.
2. Test card: **4242 4242 4242 4242** (any future expiry, any CVC).
3. After redirect, `/billing` must **not** show Active until webhook processed (poll if needed).
4. `POST /api/billing/ai/complete` with customer Bearer token:
   - Body: `{ "prompt": "hello", "idempotency_key": "run-1" }`
   - Repeat with new keys until **429** `quota_exceeded` (plan limit from setup, default 500).

Record: HTTP statuses, `has_access` from `GET /api/billing/account`, usage counts — **no tokens**.

---

## 8. Negative paths — §J.7

| Case | Action | Expected (from module docs / acceptance tests) |
|------|--------|-----------------------------------------------|
| Decline | Card **4000 0000 0000 0341** | No entitlement / no access |
| Bad webhook signature | POST garbage to `/api/billing/webhook` | **400** `invalid_signature` |
| Duplicate event | `stripe trigger` same event twice | Single processed row; idempotent inbox |
| Webhook off | Stop listener, complete checkout, then `POST /api/billing/admin/reconcile` (operator auth) | Access appears after reconcile |
| Cancel | Customer `POST /api/billing/subscription` cancel at period end | Status reflects `BILLING_CANCEL_POLICY` |
| Refund | Operator `POST /api/billing/admin/refunds` with confirm | Refund row; access per `BILLING_REFUND_POLICY` |

Tenant isolation (automated reference): `tests/unit/billing/acceptance.scenarios.js` — tenant B cannot read A.

---

## 9. DB evidence (counts only)

After a successful run, with **tenant_id**:

```powershell
node scripts/billing-sandbox-workflow.js snapshot --tenant-id <uuid> --task-id <task_id>
```

Or SQL (psql on :54322):

```sql
SELECT status, count(*) FROM billing_webhook_events GROUP BY status;
SELECT status, count(*) FROM billing_subscriptions WHERE tenant_id = '<uuid>' GROUP BY status;
SELECT feature_key, status, access_until FROM billing_entitlements WHERE tenant_id = '<uuid>';
```

Paste results into **`docs/billing/SANDBOX_RUN_<date>-operator.md`**.

---

## 10. Tests and CI

```powershell
npm run typecheck
npx jest tests/unit/billing --runInBand
npm run test:local
npm run ci:local -- --no-post
```

`test:local` **truncates billing_* tables** — local Supabase only.

---

## 11. §L blockers (unchanged until evidence exists)

- Real sandbox §J.5–7: **operator must complete** this runbook and commit `SANDBOX_RUN_*-operator.md`.
- Customer identity: Phase 2 — owner choice (`docs/billing/PHASE2_IDENTITY_OPTIONS.md`).
- Tax, terms, pricing, cost rates: owner decisions.
