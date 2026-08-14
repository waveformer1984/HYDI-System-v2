# Stripe Post-Rotation Verification

Date: 2026-08-14

## 1. Secret containment status

| Location | STRIPE_SECRET_KEY | STRIPE_WEBHOOK_SECRET | Notes |
|---|---|---|---|
| `lib/stripe/client.js` | ABSENT (uses `process.env`) | N/A | no value hardcoded |
| `api/stripe/checkout.js` | ABSENT (uses `process.env`) | N/A | no value hardcoded |
| `api/stripe/webhook.js` | N/A | ABSENT (uses `process.env`) | no value hardcoded |
| `api/stripe/connect/accounts.js` | ABSENT (uses `process.env`) | N/A | no value hardcoded |
| `.env` (untracked) | **PRESENT — LIVE** | PRESENT | human-rotated live credential |
| `.env.local` (untracked) | ABSENT | **PRESENT — LIVE** for `SUPABASE_SERVICE_ROLE_KEY` | no Stripe keys here |
| `.env.example` | `sk_test_...` placeholder | `whsec_...` placeholder | safe, updated |
| `.next/` | ABSENT | ABSENT | build does not embed server secrets |
| `public/` | ABSENT | ABSENT | scanned |
| `dashboard/` | ABSENT | ABSENT | scanned |
| `docs/` | ABSENT | ABSENT | scanned |
| `tests/` | **dummy redaction examples only** | **dummy redaction examples only** | `tests/unit/structured-logger.test.js` uses fake `sk_live_abcdefghijklmnop` and `whsec_1234567890abcdef` for redaction tests |
| `%APPDATA%/devin/mcp_config.json` | **REMOVED** | N/A | live key removed from MCP server config |
| Vercel env | UNVERIFIED | UNVERIFIED | no access |
| Supabase Edge Function env | UNVERIFIED | UNVERIFIED | no access |

## 2. Code safety

No actual Stripe live secret values are present in tracked source, build artifacts, public assets, or documentation.

## 3. Provider test-mode readiness

- A live `STRIPE_SECRET_KEY` exists in `.env`.
- No `sk_test_...` value was found in `.env` or `.env.local`.
- No `STRIPE_WEBHOOK_SECRET` (test or otherwise) was found in `.env` or `.env.local`.
- Without test-mode credentials, **webhook forwarding, checkout, and Connect tests cannot be run**.

Status: **BLOCKED — HUMAN SECRET CONFIGURATION REQUIRED**

Required from the operator:

1. Add a Stripe **test** secret key to `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   ```
2. Add a Stripe **test** webhook secret to `.env.local`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
3. Create test products and prices in the Stripe Dashboard and set:
   ```
   STRIPE_HYDI_STARTER_PRICE_ID=price_test_...
   STRIPE_HYDI_PRO_PRICE_ID=price_test_...
   STRIPE_HYDI_ENTERPRISE_PRICE_ID=price_test_...
   ```

`.env.local` is `.gitignore`d and will not be committed.

## 4. Standard regression

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS** (exit 0) |
| `npm run build` | **PASS** (exit 0, warnings only) |
| `npm run hydi:readiness` | **READY** |

## 5. Stripe-specific verification

| Test | Status | Reason |
|---|---|---|
| Stripe account verified via MCP | **UNVERIFIED / INVALIDATED** | Stripe MCP server removed from `mcp_config.json` to remove live-key exposure. Re-add only with a test key. |
| Webhook forwarding | **UNVERIFIED** | requires `STRIPE_WEBHOOK_SECRET` and `npx @stripe/cli listen` |
| Checkout session creation | **UNVERIFIED** | requires `STRIPE_SECRET_KEY=sk_test_...` and test `price` |
| Connect account onboarding | **UNVERIFIED** | requires test `STRIPE_SECRET_KEY` and is not yet production-scoped |
| Security scan | **PASS** (code) | no live values in tracked files/build; `.env` still contains live key for runtime |

## 6. Recommended P0 decision

| Criterion | Result |
|---|---|
| Rotated credentials no longer in MCP | **PASS** |
| New credentials installed in approved locations | **PARTIAL** — `.env` has live, no test key installed |
| Live credentials absent from repository/build/browser | **PASS** for tracked/build artifacts; `.env` is untracked but still live |
| MCP does not contain live credential | **PASS** (removed) |
| Stripe test-mode integration verified | **FAIL** (blocked by missing test keys) |
| Security scan passes | **PASS** (code) |
| Regression passes | **PASS** |

**P0 = BLOCKED for Stripe test-mode verification.**

Do not deploy production. Do not migrate the 259 direct Supabase consumers. Do not begin broad refactoring.

## 7. Next required action

Provide a Stripe **test-mode** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (and test `STRIPE_HYDI_*_PRICE_ID` values) in `.env.local`, then re-run:

1. `npx @stripe/cli listen --forward-to http://localhost:3000/api/stripe/webhook`
2. `npm run hydi:readiness`
3. Test `api/stripe/checkout.js` with `mode: 'payment'` and `mode: 'subscription'`
4. Test `api/stripe/connect/accounts.js` with `type: 'express'`
5. Test webhook signature validation with both valid and invalid signatures
