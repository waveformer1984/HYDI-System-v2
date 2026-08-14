# Stripe Integration Starter

## What was set up

- `lib/stripe/client.js` — singleton Stripe client using `STRIPE_SECRET_KEY` and API version `2026-04-22.dahlia`.
- `api/stripe/checkout.js` — Checkout Session endpoint supporting:
  - One-time payments (`mode: 'payment'`)
  - Subscriptions (`mode: 'subscription'`)
  - Connect destination charges with `connected_account_id`
  - No `payment_method_types` (uses dynamic payment methods)
  - Tier/env price lookup or explicit `price` ID
- `api/stripe/webhook.js` — webhook handler verifying signatures and handling:
  - `checkout.session.completed`
  - `invoice.paid` / `invoice.payment_failed`
  - `customer.subscription.*`
  - `account.updated`
- `api/stripe/connect/accounts.js` — create/list connected accounts and return an onboarding link.

## Environment variables

```bash
STRIPE_SECRET_KEY=sk_test_... or sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_HYDI_STARTER_PRICE_ID=price_...
STRIPE_HYDI_PRO_PRICE_ID=price_...
STRIPE_HYDI_ENTERPRISE_PRICE_ID=price_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Test the checkout endpoint

```bash
curl -X POST http://localhost:3000/api/stripe/checkout \
  -H "Content-Type: application/json" \
  -d '{"mode":"payment","price":"price_...","email":"test@example.com"}'
```

## Test a subscription with Connect

```bash
curl -X POST http://localhost:3000/api/stripe/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "subscription",
    "tier": "pro",
    "email": "test@example.com",
    "connected_account_id": "acct_...",
    "application_fee_percent": 10
  }'
```

## Create a connected account

```bash
curl -X POST http://localhost:3000/api/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{"email":"seller@example.com","country":"US","stream":"rezonate"}'
```

## Webhook setup

1. Use the Stripe CLI to forward webhooks locally:

```bash
npx @stripe/cli listen --forward-to http://localhost:3000/api/stripe/webhook
```

2. Copy the `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.

## Notes

- Use `STRIPE_WEBHOOK_SECRET` for local testing and `STRIPE_WEBHOOK_SECRET_01` for the existing handler.
- This starter uses destination charges for Connect so the platform remains the merchant of record.
- Do not commit API keys. Keep them in `.env` / `.env.local`.
