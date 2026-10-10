# Checkpoint Audit — Operator Runbook

The single authoritative operational guide for the **$49 Checkpoint Workflow
Audit** (`checkpoint_audit`) path to first live revenue. Live state is always
obtained from the readiness gate — this document describes the procedure and
links every requirement to its durable Human Action.

```bash
# Live readiness state (authoritative, evidence-derived):
GET /api/revenue/first-sale-readiness          # verdict + per-area checks
GET /api/human-actions?status=open             # open Human Actions
GET /api/revenue/prospects                     # demand experiment funnel
```

## Current state summary (as of 2026-10-10)

| Requirement | State | Governing action |
|---|---|---|
| Public purchase page | VERIFIED — `/services/checkpoint-audit` serves 200 locally + via tunnel | — |
| Backend availability | VERIFIED — 14 PM2 processes, :3000/:3005/:5000 healthy | — |
| Stable public URL | OPEN — ngrok-free URL rotates on tunnel restart | `protoforge:stable-public-url` (`ha_790273a0…`) |
| Stripe live credentials | BLOCKED — test key only, `ALLOW_LIVE_STRIPE=false` | `stripe:live-credential` (`ha_d5ee4cb7…`) |
| Per-transaction authorization | BLOCKED — none on file | `stripe:live-transaction-authorization` (`ha_3e92026b…`) |
| Live webhook endpoint | DORMANT — activates once live credential exists | `stripe:live-webhook-endpoint` (detector rule) |
| Legitimate prospects (5) | OPEN — 0/5 recorded | `checkpoint:demand-prospects` (`ha_422beaab…`) |
| Outreach consent | OPEN — not authorized | `checkpoint:outreach-authorization` (`ha_ca8ddffe…`) |
| Fulfillment engine | VERIFIED — Ursula healthy, test-mode E2E proven | — |
| Ledger + reconciliation | VERIFIED — modules wired, test txn CONSISTENT | — |

## Operator procedure

### 1. Supply prospects (highest value)

Record each real prospect through the governed API — never chat:

```
POST /api/revenue/prospects
{ "op": "add",
  "businessName": "Acme Solar Installers",
  "source": "operator's local business network",
  "relevanceReason": "runs sequential rooftop installs; undocumented handoffs",
  "contactChannel": "operator's direct email — authorized personal contact",
  "contactVerified": true }
```

Required evidence: business name, source, why they plausibly need a workflow
audit, and a contact channel the operator owns or is authorized to use.
`checkpoint:demand-prospects` resolves automatically once 5
evidence-backed records exist (`prospect-count` verifier — no attestation).

### 2. Authorize outreach

`checkpoint:outreach-authorization` is human-only (manual verifier). The
operator attests they have consent to contact the recorded prospects. Stage
transitions to `contact_attempted` are refused by the prospects API until
this action is RESOLVED — consent is not self-granted.

### 3. Supply the live Stripe credential

`stripe:live-credential` requires an `sk_live_`/`rk_live_` key set as
`STRIPE_SECRET_KEY` in `.env.local` plus `ALLOW_LIVE_STRIPE=true`. R2 —
human-only by design (Stripe does not permit programmatic key creation).
Verify via the workspace actions tab or `POST /api/human-actions/{id}` op
`verify` — prefix-only inspection, the value is never displayed.

### 4. Stable public URL

`protoforge:stable-public-url`: decide the durable surface — reserved ngrok
domain, custom domain, or deployed host — then set `NEXT_PUBLIC_APP_URL`.
The ngrok-free URL rotates on restart and will re-trigger
`protoforge:public-base-url-stale`.

### 5. Live webhook endpoint

Once the live credential exists, `stripe:live-webhook-endpoint` activates.
Required events: `checkout.session.completed`, `invoice.payment_succeeded`,
`invoice.payment_failed`, `charge.refunded` → `{BASE}/api/webhooks/stripe`.
Store the `whsec_` signing secret as `STRIPE_WEBHOOK_SECRET_01` — never in
chat, logs, or action descriptions. The R1 resolver can register it via the
Stripe API once upstream authorization exists.

### 6. Per-transaction authorization

`stripe:live-transaction-authorization`: issue a signed, single-use,
amount-bounded authorization via `LiveTransactionAuthorizationManager`
before each real charge. The `live-auth-issued` verifier resolves the
action when a fresh PENDING/RESERVED authorization exists.

### 7. Track the funnel

```
POST /api/revenue/prospects { "op": "stage", "prospectId", "stage", "note" }
```

Stages: `qualified_prospect → outreach_authorized → contact_attempted →
reply_received → purchase_intent → checkout_started → payment_completed →
service_delivered → ledger_reconciled`. External-event stages require an
evidence note. Replies, clicks, and checkout attempts are stages — never
revenue. Only `ledger_reconciled` (a live payment matched by the
reconciler) counts.

### 8. Readiness gate

`GET /api/revenue/first-sale-readiness` returns exactly one of:

- `VERIFIED_LIVE_TRANSACTION` — a real `cs_live_` payment + delivery +
  ledger + reconciliation (never produced by test records)
- `READY_FOR_OPERATOR_REVIEW` — machine green, no gating actions open
- `BLOCKED_HUMAN_ACTION` — human-owned boundaries open (each listed with
  its action ID and blockerKey)
- `BLOCKED_MACHINE_FAILURE` — a machine prerequisite is failing

## Never do

- Do not paste secrets, API keys, or signing secrets into chat, action
  descriptions, or prospect records — use `.env.local` and the verifier
  pathway.
- Do not send outreach before `checkpoint:outreach-authorization` resolves.
- Do not record synthetic prospects — the API requires evidence fields and
  the verifier counts only evidence-complete records.
- Do not count test-mode transactions, replies, or clicks as revenue.
- Do not enable `ALLOW_LIVE_STRIPE` before the live credential is in place.
