# Production Credential Remediation Plan

Date: 2026-08-14
Branch: `release/v0.9.0`

## Scope

Remediate P0 credential exposure before any production deployment. This document maps the three exposed credential classes to their providers, purpose, consumers, and the exact rotation steps required. It does **not** contain actual secret values.

## Credential inventory

| Class | Provider | Purpose | Current env var(s) | In source? | In Git history? | In build artifacts? | In logs? | Client-exposed? |
|---|---|---|---|---|---|---|---|---|
| Stripe live secret key | Stripe | Authenticate Stripe API calls, create Checkout/PaymentIntents, manage Connect sub-accounts | `STRIPE_SECRET_KEY` | Yes (variable name only, no value in tracked files) | **Yes** — commit `8c2f4dc5...` in `supabase/functions/.env.production` | No current live value | No | No |
| Stripe webhook secret | Stripe | Verify webhook signatures (`whsec_...`) | `STRIPE_WEBHOOK_SECRET_01`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | Yes (variable names only) | **Yes** — `test-webhook.js`, `supabase/functions/.env.production`, `vercel-sync-analysis.md` | No current live value | No | No |
| Supabase service-role key | Supabase (local) | Bypass RLS for server-side operations | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY_LOCAL`, `SUPABASE_SERVICE_ROLE_KEY_CLOUD` | Yes (variable names only) | **Yes** — `heidi-core/HEIDI.ps1`, `check-*.js`, `task-*.js`, `test-*.js`, `configure-vault.js`, `setup-vault.js` | No current live value | No | No |

## Important current-state clarification

- **Current tracked files do NOT contain live secret values.** The live values are only in `.env` and `.env.local`, which are `.gitignore`d.
- **The exposure is in Git history**, not in the current `HEAD` working tree.
- Because the values exist in Git history, they must be treated as potentially compromised and **rotated**.

## Phase 1 — Impact audit

### Where each credential class is used today

#### 1. Stripe live secret key — `STRIPE_SECRET_KEY`

- **Runtime consumers**:
  - `api/revenue.js`
  - `api/checkout.js`
  - `api/webhooks/stripe.js`
  - `api/stripe-connect-webhook.js`
  - `revenue-engine/index.js`
  - `revenue-engine/revenue-engine-v2.js`
  - `src/revenue/HeidiRevenueEngine.js`
  - `src/services/subscription-manager.js`
  - `src/hydi-v3/connectors/StripeConnector.js`
  - `apps/ursula-frontend/src/lib/revenue-engine/engine.ts`
  - `apps/ursula-frontend/src/lib/reconciliation-service.ts`
  - `supabase/functions/stripe-worker/index.ts`
  - `supabase/functions/stripe-webhook/index.ts`
  - `supabase/functions/stripe-transfer-payout/index.ts`
  - `supabase/functions/stripe-connect-admin/index.ts`
  - many operational scripts in `scripts/`, root, `agents/hid/`, etc.
- **Production dependency**: **Yes** — Stripe checkout, Connect webhooks, revenue engine.
- **Env var name**: `STRIPE_SECRET_KEY`.

#### 2. Stripe webhook secrets — `STRIPE_WEBHOOK_SECRET_01`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`

- **Runtime consumers**:
  - `api/webhooks/stripe.js`
  - `api/stripe-connect-webhook.js`
  - `api/webhooks/stripe-test.js`
  - `src/revenue/HeidiRevenueEngine.js`
  - `src/services/subscription-manager.js`
  - `tests/unit/webhooks-stripe.test.js`
  - `tests/unit/stripe-connect-webhook.test.js`
  - `supabase/functions/stripe-webhook/index.ts`
  - `apps/ursula-frontend/src/app/api/billing/webhook.ts`
- **Production dependency**: **Yes** — webhook signature verification.
- **Env var names**: `STRIPE_WEBHOOK_SECRET_01`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`.

#### 3. Supabase service-role key — `SUPABASE_SERVICE_ROLE_KEY`

- **Runtime consumers**:
  - `src/persistence/supabase-client.js` (canonical factory)
  - `src/database.js`
  - `api/dashboard-status.js`
  - `api/revenue.js`
  - `memory-engine.js`
  - `heidi-core/server.js`
  - 347 files reference the variable name (many root-level scripts, tests, docs)
- **Production dependency**: **Yes** — all server-side Supabase access.
- **Env var names**: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY_LOCAL`, `SUPABASE_SERVICE_ROLE_KEY_CLOUD`.

## Phase 2 — Rotation readiness checklist

Before rotating, ensure every consumer can receive the new value.

### Stripe

| Location | Must receive new `STRIPE_SECRET_KEY`? | Notes |
|---|---|---|
| Local `.env` | Yes | Local dev |
| Local `.env.local` | Yes | Local dev override |
| Vercel production env | Yes | `STRIPE_SECRET_KEY` |
| Vercel preview env | Yes (test value) | `STRIPE_SECRET_KEY` with `sk_test_` |
| Supabase Edge Functions secrets | Yes | `STRIPE_SECRET_KEY` for `stripe-worker`, `stripe-webhook`, `stripe-transfer-payout`, `stripe-connect-admin` |
| `supabase/functions/.env.production` (if reintroduced) | **No** — must not store secrets in tracked files | Use Edge Function secrets or CI injection |
| CI secrets | Yes | If CI runs integration tests |
| Stripe webhook endpoints | No change needed | Webhook endpoint URLs do not depend on secret key |

### Stripe webhook secrets

| Webhook | Stripe Dashboard endpoint | Env var | Consumers |
|---|---|---|---|
| Standard Stripe webhook | One endpoint per deployment | `STRIPE_WEBHOOK_SECRET_01` or `STRIPE_WEBHOOK_SECRET` | `api/webhooks/stripe.js`, `supabase/functions/stripe-webhook/index.ts`, `src/revenue/HeidiRevenueEngine.js` |
| Stripe Connect webhook | Connect webhook endpoint | `STRIPE_CONNECT_WEBHOOK_SECRET` | `api/stripe-connect-webhook.js`, `apps/ursula-frontend/src/app/api/billing/webhook.ts` |

### Supabase service-role key

| Location | Must receive new `SUPABASE_SERVICE_ROLE_KEY`? | Notes |
|---|---|---|
| Local `.env` and `.env.local` | Yes | Local dev |
| Vercel production env | Yes | `SUPABASE_SERVICE_ROLE_KEY` |
| Vercel preview env | Yes | Use local Supabase or cloud project test key |
| Supabase local stack | Yes | Regenerate in `supabase/config.toml` or restart `supabase start` after updating `.env` |
| Supabase Edge Functions | Yes (if they use service role) | `SUPABASE_SERVICE_ROLE_KEY` env |
| CI / GitHub Actions | Yes | If tests/integration run against real Supabase |

### Inter-service HMAC secret

`HYDI_SERVICE_SECRET` is also in `.env` but was **not** found in Git history. It should still be managed as a production secret.

## Phase 3 — Working tree cleanup

### Result of working tree scan

- No live `sk_live_*`, `whsec_*`, or `sb_secret_*` **values** were found in any tracked `.js`, `.ts`, `.md`, `.ps1`, `.sh`, `.py`, `.json`, or `.sql` file when excluding `.env`, `.env.local`, `backups/`, `artifacts/`, `.next/`, `out/`, and `node_modules/`.
- `.env` and `.env.local` contain the live values; they are `.gitignore`d and will not be committed.
- `.env.example` and `.env.template` already exist and contain safe placeholders.
- No tracked file required cleanup of actual secret values.

### `.env.example` status

- `.env.example` is present.
- It uses safe placeholders: `STRIPE_SECRET_KEY=sk_live_...`, `SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here`.
- No action required unless the user wants a local-first-only `.env.example`.

### Verification commands

```bash
git status --short | grep -E "\.(env|local|production|template)$" || true
git diff --name-only | grep -E "\.(env|local|production|template)$" || true
# Confirm no sk_live_, whsec_, sb_secret_ values in tracked source
git grep -n "sk_live_[0-9A-Za-z_]" || true
git grep -n "whsec_[A-Za-z0-9_]" || true
git grep -n "sb_secret_[A-Za-z0-9_]" || true
```

All of the above returned no matches for tracked live values.

## Phase 4 — Provider rotation action list (STOP HERE)

Do **not** proceed with rotation unless explicitly authorized. The following is the precise action list to provide to a human operator.

### Stripe

1. **Live secret key rotation**
   - Log in to Stripe Dashboard.
   - Navigate to Developers → API keys.
   - Roll the live secret key (`STRIPE_SECRET_KEY`).
   - Copy the **new** `sk_live_...` value.
   - Update:
     - `.env` and `.env.local` on local dev machine.
     - Vercel production/preview environment variables.
     - Supabase Edge Function secrets for `stripe-worker`, `stripe-webhook`, `stripe-transfer-payout`, `stripe-connect-admin`.
     - CI/GitHub secrets if applicable.
   - **Do not update `.env.example` or any tracked file with the real value.**

2. **Webhook secrets rotation**
   - In Stripe Dashboard, find each webhook endpoint used by HYDI.
   - Reveal/regenerate the webhook signing secret.
   - Update `STRIPE_WEBHOOK_SECRET_01` / `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` in the same places as above.
   - Ensure webhook endpoint URLs are still correct and reachable.

### Supabase

1. **Service-role key rotation**
   - For the cloud Supabase project (if it is ever reactivated):
     - Project Settings → API → Service Role Key → Regenerate.
   - For the local Supabase:
     - The local `SUPABASE_SERVICE_ROLE_KEY` is generated by `supabase start`. Restarting with `supabase stop` then `supabase start` typically regenerates it, or update it in the local CLI config.
     - Update `SUPABASE_SERVICE_ROLE_KEY` in `.env` and `.env.local`.
   - Update Vercel, CI, and Edge Functions if they use the service role.

2. **Post-rotation verification**
   - Run `npm run hydi:readiness`.
   - Run `npm test`.
   - Run `npm run build`.
   - Run a local health/ursula/collect cycle.
   - Send a Stripe test event to the webhook endpoint and confirm `api/webhooks/stripe.js` accepts it.

## Phase 5 — Post-rotation verification

After the new credentials are installed and the old ones are revoked:

1. Re-run repository-wide secret scan.
2. Confirm `.env` / `.env.local` (untracked) have the new values.
3. Confirm no tracked file contains the **old** or **new** secret values.
4. Confirm `.next/` build artifacts contain no secret values.
5. Confirm the old credentials are no longer accepted by the provider where testable (e.g., an old `sk_live_` request to `api.stripe.com/v1/charges` should fail).
6. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run hydi:readiness`.
7. Run the local-first 1-hour soak to confirm persistence still works.

## Phase 6 — Git history

**Do not rewrite Git history automatically.**

Because the credentials have already been exposed, the primary and most reliable control is **provider-side rotation/revocation**, not history cleanup. Rewriting history would require:

- `git filter-repo` or `git filter-branch` on all branches.
- Force-pushing to `clean-main` and `release/v0.9.0`.
- Re-signing all tags.
- Coordination with every contributor/CI/fork.

See `docs/GIT_HISTORY_SECRET_REMEDIATION.md` for a full assessment.

## Current P0 status

**P0 STATUS: READY FOR ROTATION**

- Credential map is complete.
- Rotation destinations are identified.
- No live values remain in tracked files.
- Provider rotation is the only remaining step.
- No deployment or broad refactoring should occur until rotation is complete and verified.
