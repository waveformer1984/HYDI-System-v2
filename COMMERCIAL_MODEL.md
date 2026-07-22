# Commercial Domain Model — Phase 4

## Status

Draft. Written against the codebase as of 2026-07-22. This document defines the commercial
domain — products, services, entities, entitlements, and events — as a layer that sits
*above* Stripe, so that billing, reporting, and access control become projections of
commercial events rather than places where pricing logic gets re-implemented.

This is not a greenfield design. Section 3 maps every entity below onto tables that already
exist. The point of Phase 4 is to name the domain that's currently implicit and scattered
across `clients`, `hydi_subscriptions`, `leads`→`quotes`→`checkout_sessions`, and raw Stripe
webhook handling, then close the gaps that fragmentation has created.

---

## Phase 4 blockers

The following three mismatches must be resolved before Phase 4 implementation begins.
They are not feature work — they are convergence work. Building more commercial code on top
of any of them makes the platform harder to reason about and harder to change later.

### 1. Customer identity split — RESOLVED by `customers` table

`clients.client_id` was a UUID while `hydi_subscriptions.client_id` was free-form text with no
FK to `clients`. This was resolved by introducing `customers` as the canonical identity table
(`customer_id uuid primary key`) and adding `customer_id` FKs to `clients`, `payouts`,
`hydi_subscriptions`, `hydi_client_health_runs`, and `hydi_schedules`. Legacy `client_id`
columns are preserved for backward compatibility; new code and projections should use
`customers.customer_id`.

### 2. Dual event systems

There are two unrelated event logs with confusingly similar names:

* `lib/event-bus/` (the runtime Event Fabric — NDJSON-backed, replay/trace-capable, used by
  the six-layer pipeline and the dashboard).
* `event_bus_events` in Postgres (used by billing Edge Functions and Supabase Realtime).

Long term there should be one logical event model. If the database is needed for durability
or worker queue semantics, it should act as durable storage *for* the Event Fabric rather
than a parallel event universe. Decide the relationship before implementing the commercial
event catalog.

### 3. Ledger naming collision

"RAW LEDGER" is the immutable operational event history (the pipeline truth-anchor).
`ledger` is the financial transactions table. They are entirely different things that share
a name. This document uses **RAW Ledger** and **Financial Ledger** (`financial_ledger`) to
disambiguate them. The table rename (`ledger` → `financial_ledger`) is the smaller
blast-radius change, since "RAW LEDGER" is pipeline terminology used across multiple docs.
Confirm no external tooling (Stripe reconciliation scripts, BI queries, Edge Functions)
references the old `ledger` table name directly before renaming.

---

## 1. Why now

Phase 3 (the six-layer pipeline — Ingestion → RAW LEDGER → CASCADE → KILO → ProtoForge →
Emission, see `CLAUDE.md` and `HEIDI_V2_ARCHITECTURE.md`) is functionally complete and gives
the system a deterministic, replayable event backbone (the Event Fabric — `lib/event-bus/`).

Commercial activity — leads, quotes, checkouts, subscriptions, payouts — currently bypasses
that backbone entirely. `api/stripe-connect-webhook.js` writes straight to the `ledger` table
(`.from('ledger')` at lines 113/151/158/171/184) and never touches `EventBus`/`EventRecorder`.
That means the most consequential events in the system — money moving — are invisible to
CASCADE, KILO, ProtoForge, replay, and every other consumer of the Event Fabric. Starting
Phase 4 with more Stripe primitives (more webhook branches, more ad-hoc table writes) would
deepen that split. Defining the commercial domain first, and routing it through the same
Event Fabric as everything else, is the fix.

---

## 2. Two commercial motions that already exist, undeclared

The schema currently encodes two different business models with no shared entity between
them:

| | Project motion | Subscription motion |
|---|---|---|
| Entry table | `leads` → `outreach` → `proposals` → `quotes` → `checkout_sessions` | `hydi_subscriptions` |
| Customer identity | `clients` (`client_id` uuid, `stripe_customer_id`) | `hydi_subscriptions.client_id` (**text**, unrelated to `clients.client_id`) |
| Billable unit | one-off project fee (`quotes.total`) | `tier` (`starter`/`pro`/`enterprise`) → flat `monthly_revenue` |
| Money ledger | `ledger` → **Financial Ledger** (per-transaction, fee split) | `hydi_mrr` view only — no per-charge row |
| Entitlements | none — proposal `deliverables` (jsonb) is descriptive, not enforced | `features text[]` — flat, unversioned |

These aren't two features of one model — they're two unconnected commercial systems sharing
a codebase. A client who both buys a one-off project *and* subscribes has two disconnected
identities and no combined view. The taxonomy below treats them as two **Service** types
under one **Customer**, which is the minimum fix.

---

## 3. Entity taxonomy (mapped to existing tables)

| Entity | Backing table today | Gap |
|---|---|---|
| **Customer** | `customers` (canonical), `clients` (project account), `hydi_subscriptions` (subscription) | `customers.customer_id` is the canonical UUID. `clients.customer_id`, `payouts.customer_id`, `hydi_subscriptions.customer_id`, `hydi_client_health_runs.customer_id`, `hydi_schedules.customer_id` are FKs. Legacy `client_id` columns preserved for backward compatibility. |
| **Product** | Implicit — the six Stripe Connect sub-accounts (`galactic_bytes`, `detailer_bot`, `lipi_v2`, `protogrance_aromatics`, `rezonate`, `waveformer_studio`) | No `products` table. Sub-account env vars (`STRIPE_ACCOUNT_*`) are the only record of what a "product" is. |
| **Service / billable unit** | `quotes` (project pricing) / `hydi_subscriptions.tier` (subscription pricing) | Pricing is inlined per-row (`quotes.total`, `hydi_subscriptions.monthly_revenue`), not a reusable Price object. Changing a price means editing code, not data. |
| **Subscription** | `hydi_subscriptions` | Fine as a start; needs the Customer FK fix above. |
| **License / Entitlement** | `hydi_subscriptions.features text[]` | Not queryable per-capability, not versioned, no record of *why* a feature was granted (plan vs. manual override vs. trial). See §4. |
| **Invoice** | none locally — `billing-engine` edge function operates directly on Stripe invoice IDs (`create_invoice`, `finalize_invoice`) | No local projection of invoice state; Stripe is the only source of truth, so "show a client their invoice history" requires a live Stripe call, not a local query. |
| **Payment / Financial Ledger Entry** | `ledger` → `financial_ledger` | Already close to right shape (gross/fee split/net, `status`, `payout_batch_id`). Naming collision with RAW Ledger — see §6. |
| **Payout** | `payouts` | `payouts.customer_id` now FKs to `customers.customer_id`; legacy `payouts.client_id` preserved for backward compatibility. |
| **Usage Meter** | none | No metered billing exists yet (all six streams are flat-fee or subscription-tier). Add only when a stream needs it — don't build ahead of demand. |

---

## 4. Entitlement model, decoupled from pricing

Today `hydi_subscriptions.features text[]` is the only entitlement record, and it only covers
the subscription motion — a project client (`clients` table) has no entitlement record at
all; whatever they're allowed to do is implicit in application code.

Target shape: an `entitlements` table keyed by `(customer_id, capability)`, with a `source`
column (`'subscription:<tier>'`, `'project:<quote_id>'`, `'manual_grant'`, `'trial'`) and an
optional `expires_at`. ProtoForge's policy engine (`lib/protoforge/policy-engine.js`) already
evaluates rules with `gte/lte/gt/lt/eq/neq/in/nin` operators against arbitrary fields loaded
from Supabase — an `entitlements` table is a natural input to that engine instead of a new
enforcement mechanism. This keeps "what can this customer do" separate from "how much are
they paying," which is the point of decoupling entitlements from pricing: a manual comp, a
trial, and a paid tier all *grant* the same capability through the same table, they just have
different `source` values.

---

## 5. Commercial event catalog

Event `type` strings, namespaced like the `billing.updated` event the retry worker already
emits (`billing-system-complete.md`):

```
customer.created
customer.merged                 # when the two Customer identities in §2 get unified
lead.captured
lead.converted
proposal.sent
proposal.accepted
quote.created
checkout.started
checkout.completed
subscription.started
subscription.tier_changed
subscription.canceled
entitlement.granted
entitlement.revoked
invoice.generated
invoice.finalized
payment.succeeded
payment.failed
payout.scheduled
payout.completed
financial_ledger.entry_recorded
```

Each event's `payload` carries the entity id(s) involved and enough context to project from
(§7) without a join back to Stripe. Reuse the existing `BusEvent` shape
(`lib/event-bus/types.ts`) as-is — `id`, `type`, `payload`, `priority`, `timestamp`, `source`,
`traceId`, `causationId` already give commercial events the same causation-chain tracing
non-commercial events get via `EventRecorder.getCausationChain()`.

---

## 6. Publishing to and replaying from the Event Fabric

**Current state:** `apps/ursula-frontend/src/app/api/stripe-webhook/route.ts` now publishes
`payment.received` events through the **Ingress Adapter** into `lib/event-bus/EventBus` before
creating downstream tasks/offers. `api/stripe-connect-webhook.js` and `supabase/functions/stripe-webhook/index.ts`
still write directly to `ledger`/`event_bus_events` and must be brought into the same path.
The `billing-engine` / `billing-retry-worker` Edge Functions still emit directly to
`event_bus_events` (Postgres) rather than through the Event Fabric. The relationship between
`event_bus_events` and `lib/event-bus/EventRecorder` must be documented and converged.

Fix, in order:
1. Every Stripe webhook handler, manual invoice action, ForgeFinder sale, and future marketplace
   transaction enters through the `lib/commercial/ingress-adapter` **Ingress Adapter** that
   normalizes the external payload into a `BusEvent` and publishes it to the shared `EventBus`
   instance. The adapter then performs the direct table write — not instead of it, since the
   write is the source of truth for billing state and the event is the source of truth for the
   timeline.
2. `event_bus_events` (Postgres, async worker queue) is the durable fan-out projection of the
   Event Fabric. New code must not write directly to it; it should publish to the Event Fabric
   and a projection adapter will fan out to Postgres. Existing direct writes in Edge Functions
   and SQL are legacy and will be migrated in Phase 6.
3. Replay reuses `EventRecorder.replay(query, handler)` unchanged — a "replay all commercial
   events for customer X" query is just `query({ source: 'stripe-webhook' })` filtered
   client-side by payload, no new replay infrastructure needed.

### Projection engine

Once a commercial event is in the Event Fabric, every subsystem becomes a projection:

```
External System  (Stripe, marketplace, manual invoice, ForgeFinder, ...)
        │
        ▼
Ingress Adapter  (normalize to BusEvent)
        │
        ▼
Commercial Event
        │
        ▼
Event Fabric  (lib/event-bus/EventBus + EventRecorder)
        │
        ├── Financial Ledger Projection  → financial_ledger table
        ├── Customer Projection          → clients / customers view
        ├── Subscription Projection      → hydi_subscriptions + entitlements
        ├── Analytics Projection         → revenue dashboards, MRR views
        ├── Dashboard Projection         → Unified Dashboard panels
        └── Automation                   → billing retry, entitlement grants, alerts
```

The source differs; the internal processing pipeline does not.

---

## 7. Projection targets

Already-real projections to extend, not new surfaces to build from scratch:

- **`api/client-dashboard.js`** — per-project ledger view with fee breakdown. Becomes the
  Billing projection once it reads from commercial events instead of querying `financial_ledger`
  directly.
- **`api/mobile-status.js`** — compact per-stream revenue snapshot. Becomes the Revenue
  projection's mobile view.
- **`system_dashboard` (Supabase view)** — health metrics; add commercial event volume/error
  rate alongside existing infra metrics.
- **`pages/traces.jsx` / `pages/trace-viewer.jsx`** — already visualize Event Fabric traces;
  once commercial events flow through the same fabric (§6), a customer's full lifecycle
  (lead → proposal → subscription → payout) becomes traceable in the same UI with zero new
  code, just new event types to filter on.
- **CRM / Analytics** — net-new, out of scope until the above projections prove the event
  catalog is complete enough to build from.

---

## 8. Relationship to the six-layer pipeline

Commercial events are not a parallel system — they're one more classification lane through
the existing pipeline:

```
Stripe webhook / internal action
        ↓ (normalizes structure only)
[1] Ingestion Layer
        ↓
[2] RAW EVENT LEDGER  (immutable — distinct from `financial_ledger`, see §6)
        ↓
[3] CASCADE            classifies as e.g. "COMMERCIAL_SUBSCRIPTION_EVENT"
        ↓
[4] KILO                generates hypotheses (e.g. "churn risk" from a cancellation pattern) — never executes
        ↓
[5] ProtoForge          policy decision — e.g. approve/reject an entitlement grant
        ↓
[6] Emission Layer      SSE/API/logs — drives the projections in §7
```

No new enforcement mechanism, no new truth store. The six-layer pipeline and RAW LEDGER stay
exactly as documented in `CLAUDE.md`; this document only says which event `type` strings
belong to the commercial domain and which tables they read from and write to.

---

## 9. Open questions before implementation starts

1. ~~Unify `clients.client_id` (uuid) and `hydi_subscriptions.client_id` (text) — which
   direction does the migration go?~~ **Resolved:** new canonical `customers` table with
   `customer_id` UUID; existing tables gain `customer_id` FKs (`supabase/migrations/20260722000001_customer_identity_convergence.sql`).
2. ~~Does `event_bus_events` get deprecated in favor of `lib/event-bus`, or do they stay
   separate with a documented sync? (§6)~~ **Resolved:** `lib/event-bus/EventBus` is the
   single logical bus; `event_bus_events` (Postgres) is a durable fan-out projection/queue.
   New code publishes to the Event Fabric; legacy direct Postgres writes will be migrated in
   Phase 6.
3. `financial_ledger` rename — confirm no external tooling (Stripe reconciliation scripts,
   BI queries) references the `ledger` table name directly before renaming.
4. Which of the six revenue streams, if any, need metered billing (Usage Meter) in the next
   two quarters? Don't build it speculatively.

### Phase 4 projection completeness note

Until Phase 6 migrates the remaining Edge Function/SQL `event_bus_events` writers, the Event
Fabric only contains commercial events from Node/Next.js ingress points (`api/stripe-connect-webhook.js`,
`apps/ursula-frontend/src/app/api/stripe-webhook/route.ts`). Phase 4 projections must treat
this as a known-partial stream and document that events arriving through Supabase Edge Functions
(`billing-engine`, `billing-retry-worker`, `stripe-webhook`) are not yet mirrored to the Fabric.
