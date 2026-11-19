# REVENUE_30_DAY_PLAN

**Mission:** HYDI-REVENUE-001  
**North star:** First **cleared** paid pilot → verified delivery → hardware reserve ledger nonzero.

**Selected offer:** San Antonio Detailer Bot Lite (`detailer_bot` stream).

## Week 1 — Validate and prepare (no outbound without approval)

| Day | Action | Owner |
|-----|--------|-------|
| 1–2 | Run `npm test` revenue suites on Frank; snapshot `REVENUE_CAPABILITY_AUDIT.md` with live connector health | Agent |
| 2 | `node scripts/seed-revenue-prospects.js`; owner reviews 10 records | Agent + Owner |
| 3 | Build demo: booking page stub + Stripe test checkout for `detailer_bot` | Agent |
| 4–5 | 3–5 **approved** owner calls/interviews (not bulk email) | Owner |
| 5 | Pick pilot candidate; document in `customer-pipeline` → CONTACT_APPROVED | Owner |

## Week 2 — Pilot sale (approval gates)

| Day | Action | Owner |
|-----|--------|-------|
| 6–7 | Draft proposal from template; `AWAITING_APPROVAL` in revenue-ops store | Agent |
| 8 | Owner sends proposal (first external comms) | Owner |
| 9–10 | Demo on call; adjust offer | Owner + Agent |
| 11–12 | Stripe invoice/checkout **test mode** dry run | Agent |
| 13–14 | Live pilot invoice after owner confirms price | Owner |

## Week 3 — Deliver and verify

| Day | Action | Owner |
|-----|--------|-------|
| 15–18 | Configure bot workflows (booking + follow-up); test on pilot number | Agent |
| 19 | Customer acceptance sign-off (written) | Owner |
| 20–21 | `recordClearedPayment` only after webhook/Stripe dashboard confirms **cleared** | Agent + Owner |
| 22 | Transition pipeline → DELIVERED → VERIFIED | Agent |

## Week 4 — Repeat and report

| Day | Action | Owner |
|-----|--------|-------|
| 23–25 | Second prospect from QUALIFIED queue (one at a time) | Owner approves contact |
| 26–28 | Weekly profitability report from ledger | Agent |
| 29–30 | Acceptance matrix update; hardware reserve % snapshot | Agent |

## Daily autonomous checklist (operator Frank)

1. `node -e "require('./lib/revenue-ops/revenue-agent').runDailyWorkflow().then(console.log)"`  
2. Review `nextActions` and `blockers`  
3. No duplicate research without new evidence  
4. Update ledger only from Stripe evidence  

## Explicit non-goals (30 days)

- No paid ads, no new GPU, no hardware purchase without owner sign-off.  
- No claim of revenue until Stripe cleared payment ID recorded.