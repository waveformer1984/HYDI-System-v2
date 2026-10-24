# Galactic Bytes go-live checklist

This flow sells one product with Stripe-hosted Checkout. It starts in Stripe test mode and uses the existing local billing webhook ledger. Live activation is a manual Jordan-only step.

## Environment on Frank

Set these in Frank's protected runtime environment; never commit their values:

- `STRIPE_SECRET_KEY=sk_test_...` initially; replace with the live secret key only at go-live.
- `BILLING_STRIPE_WEBHOOK_SECRET=whsec_...` from the webhook endpoint for the same Stripe mode.
- `BILLING_APP_URL=https://<customer-facing-origin>` with no trailing slash.

### The public origin (ngrok)

The customer-facing origin is the ngrok tunnel PM2 runs as `hydi-public-tunnel`
(`ngrok http 3000`, declared `external: true` in `ecosystem.config.js`). The
ingress gate (`docs/SECURITY_INGRESS.md`) limits public traffic to the
checkout pages, `/api/galactic-bytes/checkout` and the Stripe webhooks;
everything else answers 404. Tailscale Funnel stays off for heidi-pc.

A free ngrok URL changes whenever the tunnel restarts, which breaks the
Stripe webhook and `BILLING_APP_URL`. Before go-live:

1. In the ngrok dashboard, claim the account's free static domain.
2. Point the PM2 entry at it: `args: 'http 3000 --url=https://<static-domain> --log=stdout'`,
   then `pm2 delete hydi-public-tunnel && pm2 start ecosystem.config.js --only hydi-public-tunnel && pm2 save`.
3. Use `https://<static-domain>` as the customer-facing origin below.

`frank-auto-deploy` never restarts `hydi-public-tunnel` or any other
`external: true` app, so deploys don't rotate the URL.
- `GALACTIC_BYTES_STRIPE_PRICE_ID_TEST=price_...` for the test product.
- `GALACTIC_BYTES_STRIPE_PRICE_ID_LIVE=price_...` for the live product.
- `HYDI_BOARD_TOKEN_PROTOFORGE` so failed-closed manual-delivery notices can reach Forge Board `#ops`.
- `BILLING_DATABASE_URL`, or the existing `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, and `PG_PASSWORD` local-Postgres settings.

Leave `ALLOW_LIVE_STRIPE` unset in test mode. The server refuses a live Stripe key unless Jordan manually sets `ALLOW_LIVE_STRIPE=true`.

## Stripe Dashboard

1. In **Test mode**, create a Galactic Bytes product and a one-time USD Price. Copy its `price_...` ID into `GALACTIC_BYTES_STRIPE_PRICE_ID_TEST`.
2. Add `https://<customer-facing-origin>/api/billing/webhook` as a test webhook endpoint.
3. Subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`.
4. Copy that endpoint's test signing secret into `BILLING_STRIPE_WEBHOOK_SECRET`.
5. Build/restart the web app, visit `/galactic-bytes`, and complete a test purchase. Confirm one completed row in `checkout_sessions`, one processed row in `billing_webhook_events`, and one `NEW ORDER — deliver manually` post in Forge Board `#ops`.
6. Switch the Dashboard to **Live mode**. Create the live product and a **$1.00 one-time USD Price** for the first controlled sale. Put its ID in `GALACTIC_BYTES_STRIPE_PRICE_ID_LIVE`.
7. Create the same webhook endpoint in Live mode, select the same events, and manually replace `BILLING_STRIPE_WEBHOOK_SECRET` with its live signing secret.
8. Jordan manually replaces `STRIPE_SECRET_KEY` with the live key and sets `ALLOW_LIVE_STRIPE=true`, then rebuilds/restarts the web app.

## $1 live self-test

1. Open `/galactic-bytes` from the public origin and verify Stripe Checkout displays **$1.00 USD**.
2. Pay with a real card and retain the Stripe receipt. Never paste card details or keys into chat or logs.
3. Confirm `checkout_sessions` has one completed order with the Stripe session, amount `1.00`, currency `usd`, and the delivery email.
4. Confirm `billing_webhook_events` has one processed, `livemode=true` `checkout.session.completed` event. Re-delivering that event must not create another event or board notice.
5. Confirm Forge Board `#ops` contains the ProtoForge manual-delivery notice, then deliver the product manually.
6. Call `/api/phone/revenue-summary` with the phone read token and verify the live USD paid total increased by 100 cents.

After the self-test, replace the $1 live Price ID with the intended live Price ID. Stripe Price amounts are immutable and are never accepted from the browser.
