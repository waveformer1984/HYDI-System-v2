# Billing sandbox run — 2026-10-15

Environment: Cursor cloud agent VM (`/workspace`), branch `clean-main` at `ce438024`.
Canonical operator tree: `C:\Users\Owner\HYDI-System-v2` (same repo).

**Scope:** Phase 1 — verify Revenue Streams Module before building more (§J, §L).

---

## 1. Git / tree

| Check | Result |
|-------|--------|
| `git rev-parse --is-inside-work-tree` | `true` |
| Working tree | **clean** (on `clean-main` before Phase 1 branch) |
| Phase 1 branch | `Cusor_agent01billing-sandbox-phase1-1ec4` |

---

## 2. Local Supabase + billing tables (§J.1)

| Command | Exit | Outcome |
|---------|------|---------|
| `npx supabase start` | **1** | `DbSetupError: error running container: exit 1` (database init failed; containers stopped) |

**Not verified in this environment:** `npx supabase migration up`, manual `\dt billing_*` row counts.

**Operator machine (expected):** After `supabase start` succeeds, run:

```bash
node scripts/billing-preflight.js
```

Expect `PASS billing_tables: 8 billing_* core tables present` when migration `20261011120000_billing_revenue_streams_module.sql` is applied.

---

## 3. Stripe test key + webhook listener (§J.2–3)

| Prerequisite | This VM |
|--------------|---------|
| `STRIPE_SECRET_KEY` (`sk_test_…`) | **Not set** in `.env.local` (placeholder/absent) |
| `BILLING_CUSTOMER_TOKEN_SECRET` | **Not set** |
| `BILLING_STRIPE_WEBHOOK_SECRET` | **Not set** |
| `stripe` CLI on PATH | **Not installed** |

**Not run:** `stripe listen --forward-to localhost:3000/api/billing/webhook`

---

## 4. Sandbox setup script (§J.4)

**Not run** (requires test Stripe key + live Postgres from §2).

Documented command for the operator tree:

```bash
node scripts/billing-sandbox-setup.js --tenant-name "Sandbox Co" --tenant-email <your-email>
```

(Script refuses live keys; prints customer link once — treat as credential per SECURITY_PROTOCOL.md.)

---

## 5. Browser checkout flow (§J.5–6)

**Not executed** in this environment (no `npm run dev` + Stripe + browser session with operator email).

Checklist for operator verification:

- [ ] `/pricing?token=…` → Subscribe → card `4242 4242 4242 4242`
- [ ] `/billing` shows **Active** only after webhook (not on redirect alone)
- [ ] `POST /api/billing/ai/complete` succeeds until quota, then **429**

---

## 6. Negative paths (§J.7)

**Not executed** (depends on §5).

| Scenario | Expected | Verified here |
|----------|----------|---------------|
| Decline card `4000 0000 0000 0341` | No access | No |
| Duplicate `stripe trigger` events | No duplicate rows | No (covered by acceptance tests — see below) |
| Webhook off → reconcile | Access after reconcile | No |
| Cancel at period end | Policy `period_end` | No |
| Refund | Per `BILLING_REFUND_POLICY` | No |

---

## 7. Automated tests (real commands, this VM)

| Command | Result |
|---------|--------|
| `npm run typecheck` | **exit 0** |
| `npx jest tests/unit/billing --runInBand` | **79/79 pass** (4 suites) |
| `npm run lint:migrations` (billing file) | `20261011120000_billing_revenue_streams_module.sql` **✓** |
| `npm run test:local` | **279 failed** — `connect ECONNREFUSED 127.0.0.1:54322` (Postgres not up). **27** tier-2 suites failed; **3** passed. Time ~330s. |
| `npm run ci:local` | **exit 1** — GitHub commit status POST **403** (`Resource not accessible by integration`); checks did not complete in this cloud agent. On the operator PC use `npm run ci:local -- --no-post` to run the same gates without posting. |

**Note:** Pipe exit code for `npm run test:local | tail` is misleading; Jest failed when Postgres is down. Re-run after `npx supabase start` on the operator PC.

**Tier 1 billing coverage without Postgres:** memory acceptance + routes + reporting + providers-and-auth (fake Stripe-shaped provider, HMAC webhooks) — **no real Stripe API calls**.

---

## 8. `npm run dev` / Turbopack (§J note)

On `clean-main`, `package.json` already uses:

```json
"dev": "next dev --webpack --hostname 0.0.0.0 --port 3000"
```

Custom `webpack` config in `next.config.js` requires `--webpack`; default Turbopack dev is **not** used by `npm run dev`.

---

## 9. §L blocker status after this run

| Blocker | Status |
|---------|--------|
| Real sandbox run (§J.5–7) | **Still open** — blocked here by Supabase Docker failure + missing test Stripe env |
| Customer identity | **Open** — Phase 2 (needs owner choice) |
| Tax / terms / pricing / cost rates | **Open** — owner decisions |

---

## 10. Next steps (operator on `C:\Users\Owner\HYDI-System-v2`)

1. Ensure Docker Desktop is running; `npx supabase start` then `node scripts/billing-preflight.js --require-stripe-env`.
2. Inject secrets per SECURITY_PROTOCOL.md (variable names only): `STRIPE_SECRET_KEY`, `BILLING_CUSTOMER_TOKEN_SECRET`, `BILLING_STRIPE_WEBHOOK_SECRET`, `HYDI_SERVICE_SECRET`.
3. Terminal A: `stripe listen --forward-to localhost:3000/api/billing/webhook`
4. Terminal B: `npm run dev` → sandbox setup → browser flow §5–6 → negatives §7.
5. Append a **SANDBOX_RUN_&lt;date&gt;-operator.md** section with row counts and outcomes (no secrets).
6. `npm run test:local` and `npm run ci:local` on that machine; paste results into PR.
