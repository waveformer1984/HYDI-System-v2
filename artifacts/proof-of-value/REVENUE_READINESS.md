# REVENUE_READINESS

## Shortest path to first paying customer (analysis)

| Offer | Existing code | Time to first $ | Blockers |
|-------|---------------|-----------------|----------|
| **Billing module (AI Ops subscription)** | `lib/billing/`, `pages/pricing.tsx`, sandbox workflow | Low–medium | Stripe test keys, PG, customer token secret |
| **Galactic Bytes (Connect stream)** | `api/checkout*.js`, Stripe Connect | Medium | Connect account IDs, live/test keys |
| **LiPi lead packs** | Revenue engine + catalog | Medium | Product packaging + delivery SOP |
| **Detailer Bot** | Operational bot + Stripe | Higher | Ops automation + support |
| **Freelancer discovery pipeline** | #601 import, 24× `AWAITING_APPROVAL` | Low for *lead* | Human submit approval; not recurring product |

## Selected workflow (this mission)

**Primary:** Billing revenue module **slice 1** — hosted checkout, entitlements, usage reservation (documented in `docs/billing/REVENUE_STREAMS_MODULE.md`).

**Rationale:** Hermetic memory tests already pass; clearest PROSPECT→PAYMENT path in-repo without custom greenfield code.

```text
PROSPECT → LEAD → CUSTOMER → QUOTE → APPROVAL → PAYMENT → DELIVERY → CONFIRMATION
         (pricing page)     (checkout)  (human)   (Stripe test) (entitlement grant) (usage meter)
```

## Verified this audit

| Check | Result |
|-------|--------|
| `tests/unit/billing/acceptance.memory.test.js` | **pass** (included in `npm run test:pov`) |
| `npm run billing:preflight` | **fail** — missing Stripe, secrets, Postgres |

Log: `/opt/cursor/artifacts/billing-preflight.log`

## Sandbox path (Frank, not executed here)

```bash
# After Supabase + env configured (never paste secrets in chat)
npm run billing:preflight          # all PASS in test mode
node scripts/billing-sandbox-workflow.js start
node scripts/billing-sandbox-workflow.js run-automated --task-id <id>
stripe listen --forward-to localhost:3000/api/billing/webhook
```

## Revenue verdict

| Item | Status |
|------|--------|
| Commercial **code** ready for sandbox | **VERIFIED_PARTIAL** |
| Sandbox payment lifecycle E2E | **BLOCKED_EXTERNAL** (credentials + DB) |
| Live customer / real revenue | **Requires human approval** — not claimed |
| Discovery leads | **IMPLEMENTED_UNVERIFIED** until owner submits one |