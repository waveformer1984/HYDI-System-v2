# Revenue Streams Module — slice 1

Status: **implemented and tested in sandbox conditions; not launched.** Written 2026-10-11.

This module lets an operator configure subscription offers, lets a customer buy one through
provider-hosted checkout, grants paid access only from provider-confirmed state, meters a
billable AI operation against an allowance, tracks variable provider cost, lets the customer
manage billing, and reports revenue with explicit metric definitions.

Code: `lib/billing/`, `pages/api/billing/`, `pages/{pricing,billing,billing-admin}.tsx`,
`scripts/billing-{worker,sandbox-setup}.js`,
`supabase/migrations/20261011120000_billing_revenue_streams_module.sql`, tests in
`tests/unit/billing/` and `tests/migrations/20261011120000.test.js`.

---

## A. Repository findings and assumptions

**Verified facts (from the code, not assumed):**

| Area | Finding |
|---|---|
| Framework | Next.js 16 pages router, React 19, TypeScript strict + mixed CJS/ESM JS (`package.json`, `tsconfig.json`). |
| Database | Supabase Postgres, run **locally** (Docker, `supabase start`, Postgres on :54322) per the local-first decision in `CLAUDE.md`. Direct `pg` access is an established pattern (`lib/revenue/RevenueDatabase.ts`, `PG_*` env). |
| Operator auth | HMAC service token (`lib/auth/verifyServiceToken.js`, `HYDI_SERVICE_SECRET`) → role `owner`; per-device tokens (`lib/auth/deviceAuth.js`) → registered role; RBAC in `lib/auth/rbac.js`; audited gate `lib/auth/requireAuth.js`. |
| Customer auth | **None exists.** There is a `customers` table (`20260722000001_customer_identity_convergence.sql`) but no customer login. |
| Tenancy | Single operator organisation. "Customer" = `customers` row. No multi-tenant isolation layer existed for customers. |
| Billing provider | Stripe SDK v22 (API `2026-06-24`). Live keys gated by `ALLOW_LIVE_STRIPE` (`lib/revenue/stripe-mode.ts`). Connect sub-accounts for six revenue streams. |
| Existing billing code | `api/webhooks/stripe.js` (legacy: kill switch, `claim_webhook_event` RPC idempotency, provisions `customer_services` from tier metadata), `lib/revenue/*` job-based checkout flow, `hydi_subscriptions` with `features text[]`, `financial_ledger`. No product catalog table, no entitlement table, no usage metering (`COMMERCIAL_MODEL.md` §3–4 records these gaps). |
| Background jobs | PM2 (`ecosystem.config.js`), boot agent, Node workers polling Postgres. |
| AI invocation | Local Ollama via `api/local-model.js` (`LocalModelClient.generate` returns token counts); Anthropic SDK when `ANTHROPIC_API_KEY` is set. |
| Deployment | Local machine under PM2; Vercel not used. |

**Reversible assumptions (proposed defaults, change via config):**

1. Currency: USD for the launch plan; the schema is multi-currency and never sums across currencies.
2. Tenant = a paying customer organisation (`billing_tenants`), optionally linked to `customers.customer_id`.
3. Customers authenticate with operator-issued, expiring, tenant-bound signed tokens until a real customer identity provider exists (**launch blocker**, §L).
4. Provider: Stripe (test mode) behind an adapter. The new endpoint uses its **own** webhook secret (`BILLING_STRIPE_WEBHOOK_SECRET`) and leaves the legacy handler untouched.
5. The module does not write to the legacy commercial tables; reconciliation with them is a later convergence step.

## B. MVP scope and deferred capabilities

**Launch revenue model (recommended): monthly subscription with an included monthly usage
allowance (hard quota).**

Why it fits: Hydi(ai) sells an ongoing AI operations service (see `lib/revenue/OfferCatalog.ts`:
*AI Operations Monthly*) whose marginal cost scales with AI calls. A flat subscription gives
predictable revenue and simple customer terms; an included allowance with a hard cap protects
margin without the billing complexity of metered invoicing. Tradeoffs: heavy users hit the cap
(needs an upgrade path or add-on credits later); light users subsidise heavy ones; no
usage-based expansion revenue until metered billing or credit packs ship.

| Implemented in slice 1 | Deferred (extension point) |
|---|---|
| Products → plans → immutable versioned prices; draft/published/archived; grandfathering | One-time purchases, add-ons, coupons managed in Hydi (provider promotion codes can be enabled by env), seat enforcement (`limits.seats` is stored, not enforced) |
| Hosted checkout (subscription mode), trials | Upgrade/downgrade UI (customers change plans in the provider portal; the snapshot handler maps the new price) |
| Verified webhooks, durable inbox, idempotency, ordering, retries, dead-letter, replay, reconciliation | Delivery to the Event Fabric / six-layer pipeline (`COMMERCIAL_MODEL.md` §6) |
| Subscription state machine + documented access policy | Paused-collection handling beyond "no access" |
| Entitlements per feature with per-period quotas | Prepaid credits (the usage reservation ledger is the same shape a credit ledger needs), metered billing, enterprise agreements |
| Atomic usage reservation, idempotent retries | Per-request max-cost guard (only a monthly per-tenant cost cap exists) |
| Provider cost records with operator rate card | Provider invoice reconciliation of costs ("confirmed" status is supported but nothing writes it yet) |
| Refund requests (operator), refund & dispute policies | Credits/account adjustments UI (`billing:credits:adjust` permission reserved) |
| Revenue dashboard with metric definitions | Recognized revenue, cohorts, CAC/LTV, fee capture from balance transactions |
| Customer billing page, provider portal | Email notifications (usage limit, failed payment, renewal) — none are sent automatically |

Affiliate commissions, marketplace payouts and revenue sharing (the existing Stripe Connect
`financial_ledger`/payouts flow) are a separate workstream and untouched.

## C. Architecture and end-to-end event flow

```
 Operator ──(service/device token, RBAC)──► /api/billing/admin/catalog ──► billing_products/plans/price_versions
                                                                            (published price = immutable)
 Customer ──(tenant token)──► /pricing ──► POST /api/billing/checkout
      server: tenant active? price published? no live subscription? idempotency key
      → billing_checkout_intents (created) → provider customer → hosted Checkout Session
      ◄── redirect to provider; card data never touches Hydi
 Provider ──(signed webhook)──► POST /api/billing/webhook
      1 verify signature on raw bytes   2 INSERT billing_webhook_events (unique event id)
      3 claim (atomic) → normalize → handle → processed | ignored | failed(backoff) | dead_letter
         checkout.completed → read subscription FROM PROVIDER → apply snapshot
         subscription.*     → apply snapshot (order-safe, terminal-safe)
         invoice.*          → billing_payments ; charge.refunded → billing_refunds ; dispute → hold
      apply snapshot → billing_subscriptions → recompute billing_entitlements (access_until)
 Customer ──► POST /api/billing/ai/complete
      billing_reserve_usage() [row lock] → LocalModelClient → finalize | release → cost records
 Worker (scripts/billing-worker.js): retry due events · reconcile with provider
 Operator ──► /billing-admin → GET /api/billing/admin/revenue (definitions + numbers)
```

### Subscription states and access policy

Access is computed by `lib/billing/policy.js#computeAccessUntil` and materialised on each
entitlement row as `access_until`. A request is allowed only while `access_until > now`.

| Provider status | Access | Until |
|---|---|---|
| `incomplete` (first payment not confirmed) | **No** | — |
| `trialing` | Yes | `trial_end` + renewal slack (none if cancelling) |
| `active` | Yes | `current_period_end` + renewal slack (`BILLING_RENEWAL_SLACK_HOURS`, default 24h; 0 if `cancel_at_period_end`) |
| `past_due` (renewal failed) | Yes, grace | `past_due_since` + `BILLING_GRACE_DAYS` (default 7) |
| `unpaid`, `paused`, `incomplete_expired`, `canceled` | **No** | — |
| any status with `access_hold` (`dispute`, `refunded`) | **No** | — |

Ordering rules (`compareSnapshot`): a snapshot older than stored state by ≥1 s is ignored;
within 1 s (provider timestamp resolution) and different → re-read the provider; terminal
states (`canceled`, `incomplete_expired`) are never left. The conditional UPDATE also refuses
to overwrite a newer state written concurrently.

Policies (env): cancellation `BILLING_CANCEL_POLICY` = `period_end` (default) | `immediate`;
refunds `BILLING_REFUND_POLICY` = `retain_access` (default) | `revoke_on_full_refund`;
disputes `BILLING_DISPUTE_POLICY` = `suspend` (default) | `ignore`. Refunds never restore
consumed usage units. Expired allowance does not roll over.

### Metering behaviour

- **Concurrency:** `billing_reserve_usage` locks the tenant's entitlement row (`FOR UPDATE`), so concurrent reservations serialize; verified by mutation test (lock removed → 11/20 succeeded on a limit of 5; lock present → exactly 5).
- **Retries:** one row per `(tenant_id, idempotency_key)`. Committed → `duplicate` (not re-run, not re-charged). Released (failed) or expired-unfinalized → may reserve again (`attempts` increments).
- **Partial failure:** operation throws → reservation released, failed-attempt provider costs recorded with `succeeded=false`. Finalize fails after success → reservation expires after `BILLING_RESERVATION_TTL_SECONDS` (default 600) and is never charged (revenue-safe, not cost-safe).
- **Period boundary:** usage counts against the entitlement's `period_start`; a renewal moves the period and the allowance resets.

## D. Database schema

Migration `20261011120000_billing_revenue_streams_module.sql` (additive, idempotent, RLS
service-role only, functions revoked from PUBLIC). Verified by applying twice to Postgres 16.

| Table | Purpose | Key constraints / indexes |
|---|---|---|
| `billing_revenue_streams` | reporting dimension (seeded: `hydi_platform` + the six Connect streams) | PK `stream_key` |
| `billing_tenants` | paying account | UNIQUE `(provider, provider_customer_id)` |
| `billing_products`, `billing_plans` | catalog; plan `features` (jsonb array), `limits` (jsonb object) | UNIQUE keys; status check |
| `billing_price_versions` | agreed prices (integer minor units) | UNIQUE `(plan_id, version)`, `(provider, provider_price_id)`; published ⇒ provider price set; trigger makes published rows immutable |
| `billing_checkout_intents` | every checkout started | UNIQUE `(tenant_id, idempotency_key)`, `(provider, provider_session_id)` |
| `billing_subscriptions` | projection of provider state + `provider_state_at`, `past_due_since`, `access_hold` | UNIQUE `(provider, provider_subscription_id)` |
| `billing_entitlements` | per-feature grant, limit, period, `access_until` | UNIQUE `(tenant_id, feature_key, source_type, source_id)`; partial index on active |
| `billing_usage_events` | reservation ledger | UNIQUE `(tenant_id, idempotency_key)`; index `(entitlement_id, period_start, status)` |
| `billing_provider_cost_records` | internal AI cost (micro-units), never customer billing | `cost_status` ∈ estimated/confirmed/unpriced; unpriced ⇔ NULL cost |
| `billing_payments`, `billing_refunds` | cash as reported by the provider | UNIQUE `(provider, provider_invoice_id)`, `(provider, provider_refund_id)` |
| `billing_webhook_events` | durable inbox | UNIQUE `(provider, provider_event_id)`; partial index on due rows |
| `billing_audit_events` | actor, action, target, tenant, reason, before/after | append-only trigger |

Deletion: every FK is `RESTRICT`; financial and audit rows are never deleted by the
application. Retention (proposal, not yet automated): webhook payloads 13 months, then
null `payload` keeping the row; audit, payments, refunds indefinitely (financial records);
usage and cost records 25 months.

## E. API and webhook contracts

Errors are `{ "error": <code>, "message": <text>, "details"?: {...} }`. Customer routes take
the tenant **only** from `Authorization: Bearer <token>`; ids belonging to another tenant return
`404 not_found`. Customer routes are rate limited per IP.

| Route | Auth | Input | Success | Notable errors |
|---|---|---|---|---|
| `GET /api/billing/catalog` | public | — | `{products:[{plans:[{features,limits,prices:[{price_version_id,currency,unit_amount_minor,billing_interval,interval_count,trial_days}]}]}]}` | — |
| `POST /api/billing/checkout` | customer | `price_version_id` uuid, `idempotency_key` 8–200 `[A-Za-z0-9_-:.]` | `{intent_id,url,reused}` | 401, 404 `price_not_available`, 409 `subscription_exists` / `idempotency_key_reused` / `checkout_closed`, 503 `provider_unavailable` |
| `GET /api/billing/account` | customer | — | plan, status, `has_access`, `access_until`, usage, payments (last 24), pending checkouts | 401 |
| `POST /api/billing/portal` | customer | — | `{url}` (provider portal) | 409 `no_billing_account` |
| `POST /api/billing/subscription` | customer | `action` cancel\|reactivate, `subscription_id`, `reason?` | account overview | 404, 409 `invalid_transition` |
| `POST /api/billing/ai/complete` | customer | `prompt` 1–4000, `idempotency_key` | `{usage_id,text}` or `{usage_id,duplicate:true}` | 402 `not_entitled`, 429 `quota_exceeded`/`spending_cap_reached`, 409 `operation_in_progress`, 503 `model_unavailable` (not charged) |
| `POST /api/billing/webhook` | provider signature | raw body | `200 {received,duplicate,outcome}` | 400 `invalid_signature`/`livemode_mismatch`; 5xx only if storage fails |
| `GET /api/billing/admin/revenue?from&to` | `billing:finance:view` | ISO dates (default: current UTC month) | report with `definitions` | 400 |
| `GET,POST /api/billing/admin/catalog` | `billing:catalog:manage` | ops `create_product` / `create_plan` / `create_price` / `publish_price {confirm,reason}` / `set_status {reason}` | rows | 409 `conflict`/`invalid_transition`, 400 `confirmation_required`/`reason_required` |
| `POST /api/billing/admin/tenants` | `billing:tenants:manage` (owner) | `create {name,email}` / `issue_token {tenant_id}` | tenant + one-time token | 404 |
| `GET,POST /api/billing/admin/webhooks` | view: finance; replay: `billing:webhook:replay` (owner) | `replay {event_row_id,confirm,reason}` / `process_due` | events / outcome | 409 |
| `POST /api/billing/admin/reconcile` | `billing:reconcile` | — | `{subscriptions_checked, subscriptions_changed, checkouts_checked, errors}` | — |
| `POST /api/billing/admin/refunds` | `billing:refund:request` (owner) | `payment_id, amount_minor?, reason, confirm:true` | `{provider_refund_id, amount_minor, status:"requested"}` | 400, 409 |
| `GET /api/billing/admin/audit` | `billing:finance:view` | `tenant_id?, limit?` | audit rows | 400 |

Webhook events handled: `checkout.session.completed|async_payment_succeeded|expired|async_payment_failed`,
`customer.subscription.created|updated|deleted|paused|resumed`, `invoice.paid|payment_succeeded|payment_failed`,
`charge.refunded`, `charge.dispute.created|closed`. Everything else is stored and marked `ignored`.
Events for customers/sessions Hydi did not create (the Stripe account is shared with legacy flows) are `ignored`.

## F. Vertical slices delivered

| Slice | Files | Behaviour | Tests (actual result) |
|---|---|---|---|
| 1 Schema | migration | tables, constraints, atomic functions, triggers, RLS | applied twice to Postgres 16.15 ✔; static test 9/9 ✔ |
| 2 Catalog | `service.js` (catalog), `admin/catalog.js` | versioned prices, publish/archive, grandfathering, audit | acceptance (catalog governance) ✔ |
| 3 Checkout | `service.startCheckout`, `checkout.js`, `providers/*` | server-validated, idempotent, hosted | acceptance + routes ✔ |
| 4 Webhooks | `receiveWebhook/processWebhookEvent`, `webhook.js`, worker | verify→store→process, ordering, retry, dead-letter, replay, reconcile | acceptance (webhook reliability) ✔ |
| 5 Entitlements & metering | `policy.js`, `runMetered`, `ai/complete.js`, `cost-rates.js` | access window, quotas, atomic reservation, costs | acceptance (metering) ✔, mutation test ✔ |
| 6 Billing management | `account/portal/subscription.js`, `pages/billing.tsx` | overview, cancel/reactivate, portal, pending/failed states | acceptance + routes ✔ |
| 7 Reporting | `reporting.js`, `admin/revenue.js`, `pages/billing-admin.tsx` | 11 defined metrics | reporting 12/12 ✔ |
| 8 Admin & security | `http.js`, `customer-auth.js`, RBAC, refunds/replay/tenants/audit | confirmations, reasons, audit, redaction | routes + providers-and-auth ✔ |

Configuration each slice needs is in §I. Known limitations are in §B and §L.

## G. Interfaces

- `/pricing` — published plans, inclusions, limits, interval, trial, renewal terms; buy button needs a customer token (from `?token=` link, kept in `sessionStorage`).
- `/billing` — plan, status in plain words, renewal/cancel/trial dates, grace notice, usage bars, payment history with invoice links, provider portal, cancel (confirm + optional feedback) and reactivate. Returning from checkout shows "confirming payment" and polls; it never grants access.
- `/billing-admin` — metric tiles per currency with formulas on hover, full definitions panel, customers by status, collected by stream/plan, usage & cost labelled ESTIMATE, "not computed" list, dead-letter queue with replay (reason required), reconcile button. Uses the same `hydi.serviceSecret` browser-local scheme as `/coo` and `/workspace`.

## H. Automated tests and results

Run on 2026-10-11 in this environment:

| Suite | Command | Result |
|---|---|---|
| Acceptance, memory store (Tier 1) | `npx jest tests/unit/billing/acceptance.memory.test.js` | **33/33 pass** |
| Acceptance, real Postgres 16 (Tier 2) | `BILLING_TEST_DATABASE_URL=… npx jest -c jest.tier2.config.js tests/unit/billing/acceptance.pg.test.js` | **33/33 pass** |
| Reporting reconciliation | `npx jest tests/unit/billing/reporting.test.js` | **12/12 pass** |
| Providers, tokens, rate card, policy | `npx jest tests/unit/billing/providers-and-auth.test.js` | **24/24 pass** (real Stripe SDK signature scheme, offline) |
| Routes (real Next.js handlers) | `npx jest tests/unit/billing/routes.test.js` | **10/10 pass** |
| Migration static checks | `npx jest tests/migrations/20261011120000.test.js` | **9/9 pass** |
| Full Tier 1 suite | `npx jest` | 449/458 suites; the 9 failing suites (30 tests) fail identically on the base branch without this change |
| Lint / typecheck | `npm run lint`, `npm run typecheck` | 0 errors / clean |

Acceptance-criteria mapping: successful payment → tenant access; redirect alone grants nothing;
forged/tampered webhook rejected; failed first payment → no access; duplicate webhooks → no
duplicates; concurrent event processing → once; out-of-order and post-terminal snapshots
ignored; usage retries charged once; failed operation released; concurrent overspend blocked;
tenant B cannot read/cancel A's records; webhook cannot attach a subscription to another tenant;
cancel at period end / immediate; refunds per policy and counted once; disputes suspend; provider
outage → recoverable failed event, retried after backoff; dead-letter + audited replay;
reconciliation repairs missed webhooks; dashboard reconciles with seeded records.

All tests use synthetic data and the fake provider (Stripe-shaped, HMAC-signed events). **No
real Stripe API call, charge or webhook was made** — no Stripe key exists in this environment.

## I. Environment variables (no secrets)

```
# Billing provider
BILLING_PROVIDER=stripe                     # 'fake' only for local demos; refused when NODE_ENV=production
STRIPE_SECRET_KEY=sk_test_...               # test key for sandbox; live requires ALLOW_LIVE_STRIPE=true
BILLING_STRIPE_WEBHOOK_SECRET=whsec_...     # signing secret of the /api/billing/webhook endpoint (separate from the legacy one)
BILLING_ALLOW_PROMOTION_CODES=false
BILLING_APP_URL=http://localhost:3000       # checkout success/cancel and portal return URLs

# Storage (default: PG_HOST/PG_PORT/PG_DATABASE/PG_USER/PG_PASSWORD → local Supabase :54322)
BILLING_DATABASE_URL=

# Customer access tokens (>= 32 chars, server-side only)
BILLING_CUSTOMER_TOKEN_SECRET=

# Policy (defaults shown)
BILLING_GRACE_DAYS=7
BILLING_RENEWAL_SLACK_HOURS=24
BILLING_CANCEL_POLICY=period_end            # or immediate
BILLING_REFUND_POLICY=retain_access         # or revoke_on_full_refund
BILLING_DISPUTE_POLICY=suspend              # or ignore
BILLING_RESERVATION_TTL_SECONDS=600
BILLING_WEBHOOK_MAX_ATTEMPTS=8
BILLING_TENANT_MONTHLY_COST_CAP_MICROS=0    # 0 = no cap
BILLING_COST_RATES_JSON=                    # operator rate card, see lib/billing/cost-rates.js

# Worker
BILLING_WORKER_INTERVAL_SECONDS=30
BILLING_RECONCILE_INTERVAL_MINUTES=15
```

Generate secrets by direct injection (SECURITY_PROTOCOL.md), never by echoing them.

## J. Local setup and sandbox verification

1. `npx supabase start` (Docker), then `npx supabase migration up` (applies the billing migration locally).
2. Set `STRIPE_SECRET_KEY` (test), `BILLING_CUSTOMER_TOKEN_SECRET`, `HYDI_SERVICE_SECRET` in `.env`.
3. `stripe listen --forward-to localhost:3000/api/billing/webhook` and put the printed `whsec_` into `BILLING_STRIPE_WEBHOOK_SECRET`.
4. `node scripts/billing-sandbox-setup.js --tenant-name "Sandbox Co" --tenant-email you@example.com` — creates the catalog + Stripe test price and prints a customer link (a credential).
5. `npm run dev`, open the link → `/pricing` → Subscribe → pay with a Stripe test card (`4242…`).
6. Check `/billing` shows **Active** only after the webhook lands; `POST /api/billing/ai/complete` succeeds up to the plan limit then returns 429.
7. Negative checks: test card `4000 0000 0000 0341` (attach succeeds, charge fails) → no access; `stripe trigger` duplicates → no duplicate rows; stop the webhook listener, buy, then `POST /api/billing/admin/reconcile` → access appears.
8. Tier 2: `npm run test:local` runs the Postgres acceptance suite against local Supabase (**it truncates billing tables** — never point it at real data).

Note: in this repo `npm run dev` currently fails under Next 16's default Turbopack because of the
custom `webpack` config (pre-existing); `npx next dev --webpack` works. `next dev` also rewrites
`tsconfig.json` and `AGENTS.md`; do not commit those edits with unrelated work.

## K. Deployment, monitoring, reconciliation, rollback

**Deploy:** apply the migration to the local Supabase (`supabase migration up`; additive, safe to
re-run); deploy code; register the Stripe webhook endpoint for the events in §E; run
`node scripts/billing-worker.js` under PM2 (e.g. `pm2 start scripts/billing-worker.js --name hydi-billing-worker`
— not yet added to `ecosystem.config.js`); run the sandbox flow (§J) before live.

**Go-live (requires explicit approval):** live key + `ALLOW_LIVE_STRIPE=true`, a live-mode
webhook endpoint and secret, publish live prices via `publish_price {create_in_provider:true}`.
The endpoint rejects events whose `livemode` does not match the key's mode.

**Monitoring:** alert on `billing_webhook_events` with `status='dead_letter'` (> 0) or
`status IN ('received','failed')` older than 15 min; reconcile report `errors > 0` or
`subscriptions_changed > 0` repeatedly (webhooks being missed); `checkout_conversion` drop;
`billing_usage_events` stuck in `reserved` past expiry. Worker logs are single-line JSON.

**Reconciliation:** worker every 15 min, or `POST /api/billing/admin/reconcile`. Dead-letters:
inspect `last_error`, fix cause (e.g. missing catalog price), replay from `/billing-admin`.

**Rollback:** code rollback is safe at any time — tables are unused without the routes. Disable
the Stripe endpoint first so events queue at Stripe (Stripe retries for up to 3 days). The
migration is additive; do **not** drop the tables after real payments exist (financial records).
For a pre-launch rollback only: `DROP TABLE billing_* CASCADE` and the four `billing_*` functions.

## L. Remaining blockers and launch checklist

**Blockers (must resolve before taking real money):**
- [ ] **Customer identity.** Operator-issued bearer tokens are interim: no self-serve sign-up, no revocation list (rotate `BILLING_CUSTOMER_TOKEN_SECRET` to revoke all), token held in `sessionStorage`. Decide: Supabase Auth or another IdP, then map users → tenants with roles.
- [ ] **Real sandbox run** with a Stripe test key (not available in this environment): steps §J.5–7.
- [ ] **Tax:** decide Stripe Tax vs. none; Hydi only reports what the invoice says.
- [ ] **Terms, refund and cancellation policy text** reviewed and linked on `/pricing` (the configured policies must match the published terms).
- [ ] **Pricing decision** for the launch plan (amount, allowance). Nothing here sets a real price.
- [ ] **Provider cost rates** entered in `BILLING_COST_RATES_JSON` from the providers' current price pages (none are shipped; costs show as unpriced until then).

**Also before launch:** worker under PM2; monitoring alerts above; Stripe portal configured (plan
switching restricted to published prices); backups of the local Postgres include `billing_*`;
legal review of email/consent before enabling any growth/retention messaging (§9 of the brief —
not implemented; no campaign is ever sent automatically).

**Known limitations:** processing fees are not captured (reported as unknown); MRR ignores
coupons; revenue-by-plan attributes to the subscription's current price version; reporting loads
full tables per request (fine at current scale, needs SQL aggregation later); plan upgrades go
through the provider portal only; seats are not enforced; the fake provider is per-process.
