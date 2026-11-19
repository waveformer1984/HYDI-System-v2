# REVENUE_AGENT_ARCHITECTURE

**Mission:** HYDI-REVENUE-001  
**Principle:** Governed agent **inside** HYDI — not a competing top-level orchestrator.

## Placement

```text
                    ┌─────────────────────┐
                    │  Heidi / PAO chat   │
                    │  (human approval)   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  revenue-agent.js    │  ← daily workflow, read-only default
                    │  (lib/revenue-ops)   │
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           │                   │                   │
   ┌───────▼──────┐   ┌────────▼────────┐  ┌──────▼───────┐
   │ job-scout    │   │ store/lifecycle │  │ customer-    │
   │ (discover)   │   │ proposals       │  │ pipeline.js  │
   └──────────────┘   │ approval.js     │  └──────────────┘
                      │ execution-bridge│
                      └────────┬────────┘
                               │
                      ┌────────▼────────┐
                      │ Stripe Connect  │
                      │ (cleared $ only)│
                      └─────────────────┘
```

## Modules (this mission)

| Module | Role |
|--------|------|
| `revenue-agent.js` | Daily inspect → rank products → next actions; audit blockers |
| `product-catalog.js` | Six scored opportunities (hypothesis flagged) |
| `product-opportunity-score.js` | Mission weight formula |
| `customer-pipeline.js` | Local prospect CRM; **CONTACTED+** needs `contactConsent.ownerApproved` |
| `financial-ledger.js` | Cleared payments only; hardware reserve planning |
| `store.js` / `lifecycle.js` | Freelance opportunity FSM (existing) |
| `approval.js` | Proposal submit gate (existing) |

## Responsibility map (mission §2)

| Responsibility | Implementation |
|----------------|----------------|
| A–E Discovery / research / scoring | `runDiscoveryCycle`, `assessOpportunity`, product ranker |
| F Product development | Prototypes in repo branches; **no prod deploy** without approval |
| G–H Prospects / sales prep | `customer-pipeline.js`, `proposal.js` |
| I Delivery | `execution-bridge.js` (existing; approval for live) |
| J–K Reconciliation / profit | `financial-ledger.js` + Stripe webhooks (live on Frank) |
| L Hardware planning | `hardwareReservePlan()` — planning only |

## Governance

**Autonomous (agent):** research, scoring, draft proposals, ledger math, internal reports.

**Owner approval required (`requiresOwnerApproval`):** external send, contracts, charges, spend, subscriptions, sensitive access, production deploy, marking paid without Stripe ID.

## API surface

Existing: `GET/POST pages/api/heidi-mobile/revenue-ops.js`  
Recommended: wire `runDailyWorkflow` into mobile BFF read path (follow-up PR).

## PAO alignment

`pao-system/agents/business/revenue.agent.ts` remains the typed business agent; **do not** duplicate orchestration — call shared `lib/revenue-ops` from PAO when wired.