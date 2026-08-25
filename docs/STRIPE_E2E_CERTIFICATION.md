# Stripe E2E Certification

**Date:** 2026-08-25
**Branch:** `feat/governed-autonomy`
**Commit:** (pending)

---

## E2E Test Status

```
BLOCKED: valid Stripe test-mode credentials required
```

### Reason

The Stripe test-mode secret key in `.env.local` is a placeholder (`sk_test_...0000`, 32 chars) that returns HTTP 401 `Invalid API Key` from the Stripe API. The Stripe CLI's cached test-mode key expired on 2026-07-22 and also returns 401.

No valid Stripe test-mode credentials are available in the environment. Per the test requirements, no mocks, fixtures, fabricated events, or placeholder keys were substituted.

### What Was Verified (Without Real Stripe API)

The following were verified through the qualification suite and code audit, but NOT through a real Stripe API call:

| Check | Method | Result |
|-------|--------|--------|
| Cryptographic signature verification | Code audit | PASS — `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` with HMAC-SHA256 + 5-min replay window |
| Invalid signature rejection | Code audit | PASS — constructEvent throws → HTTP 400 |
| Webhook idempotency (duplicate event) | Qualification test (87/87) | PASS — one ledger entry, one job activation |
| Dual-path idempotency (sync + async) | Qualification test Section 9b | PASS — async queue skipped for job-linked events |
| Job activation exactly once | Qualification test | PASS |
| Revenue ledger exactly one entry | Qualification test | PASS |
| No legacy revenue_tracking side effects | Qualification test + code trace | PASS — async queue skipped when bridge processes |
| RBAC authorization on approve endpoint | Code audit | PASS — canonical `requireAuth` with `revenue:manage` permission |
| Duplicate delivery idempotency | Qualification test | PASS |

### What Was NOT Verified

| Check | Reason |
|-------|--------|
| Real Stripe Checkout Session creation | No valid Stripe test key |
| Real `checkout.session.completed` event delivery | No valid Stripe test key |
| Stripe CLI webhook forwarding | No valid Stripe CLI session |
| Real signature validation against Stripe-signed payload | No valid webhook secret from `stripe listen` |
| End-to-end job activation from real webhook | No valid Stripe test key |

---

## Steps to Complete E2E (Operator Action Required)

1. Obtain a valid Stripe test-mode secret key from the Stripe Dashboard
2. Set it in `.env.local`: `STRIPE_SECRET_KEY=sk_test_...` (real key)
3. Run `stripe login` to authenticate the Stripe CLI
4. Start the application: `npm run dev` or `pm2 start ecosystem.config.js`
5. Start webhook forwarding: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
6. Copy the `whsec_...` secret from `stripe listen` output
7. Set `STRIPE_WEBHOOK_SECRET_01=whsec_...` in `.env.local`
8. Set `WEBHOOK_PROCESSING_ENABLED=true` in `.env.local`
9. Create a test checkout session and complete it in a browser
10. Verify: job activates once, one ledger entry, one `payment_confirmed` event
11. Replay the same event and verify no duplicates
12. Send an invalid signature and verify HTTP 400

---

## Qualification Results

| Suite | Result |
|-------|--------|
| Typecheck | 115 errors (baseline unchanged, delta 0) |
| First customer readiness | 87/87 assertions PASS |
| Revenue proof | 99/99 assertions PASS |
| Release gate | 15/15 PASS (after G14 policy update) |
| Secret scan (no-hardcoded-secrets) | 2/2 PASS |
| Pre-commit secret hook | INSTALLED |

---

## RBAC Authorization

| Endpoint | Auth mechanism | Permission | Roles |
|----------|---------------|------------|-------|
| `/api/revenue/jobs/:jobId/approve` | `requireAuth` (canonical) | `revenue:manage` | owner, operator |
| Webhook handler | Stripe signature verification | N/A (Stripe → server) | N/A |

The approve endpoint uses the same `requireAuth` guard as all other protected endpoints, with audit logging to `auth_audit_log`. No separate shared-secret mechanism remains.

---

## Security Blockers

1. **SECURITY BLOCKER: historical Stripe LIVE secret requires immediate rotation**
   - `rk_live_51R8ZCrITaXOH...` in git history (commits `a76eee0`, `db35319`, `cc2f2b3`)
   - `whsec_VnrIjBX7F1bkBZp...` in git history (commits `aa5b514`, `aa0d820`, `cc2f2b3`)
   - See `docs/HISTORICAL_SECRET_REMEDIATION_REPORT.md` for full details

2. **E2E BLOCKER: valid Stripe test-mode credentials required**
   - Current key is a placeholder returning 401
   - Stripe CLI session expired 2026-07-22

3. **Configuration blockers (for production live mode):**
   - `STRIPE_WEBHOOK_SECRET_01` not set
   - `WEBHOOK_PROCESSING_ENABLED` not `true`
   - `ALLOW_LIVE_STRIPE` not `true`

---

## No Secrets in This Report

This report contains no API keys, webhook secrets, service tokens, or other credential material. Secret prefixes shown above (`rk_live_51R8ZCrITaXOH...`, `whsec_VnrIjBX7F1bkBZp...`) are truncated to 15 characters — insufficient to use the credential but sufficient to identify it for rotation purposes. These prefixes are already present in git history and are not newly exposed by this report.
