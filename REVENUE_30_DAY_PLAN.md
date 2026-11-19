# REVENUE_30_DAY_PLAN

**Mission:** HYDI-REVENUE-001  
**North star:** First **cleared** paid pilot → verified delivery → hardware reserve ledger nonzero.

**Selected offer:** San Antonio Detailer Bot Lite (`detailer_bot` stream).

## Week 1 — Real prospects only (Jordan; no outreach before VERIFIED evidence)

Checklist (max 8):

1. Jordan finds **10 real** San Antonio mobile detailers via **Google Maps** and/or **Yelp** (no seed auto-qualify).
2. For each business, record **one public `source_url`** (listing permalink) in `customer-pipeline` evidence as `type: VERIFIED`, `verified_by: jordan`.
3. Enter prospects manually (or import) — **do not** use synthetic seed rows for outreach decisions.
4. Transition each record `DISCOVERED` → `RESEARCHED` only after the listing is opened and problem noted from public info.
5. Transition to `QUALIFIED` only when VERIFIED evidence exists; **HYPOTHESIS-only rows stay blocked**.
6. Run `npm test` revenue suites on Frank; refresh `REVENUE_CAPABILITY_AUDIT.md` connector health snapshot.
7. Build **demo only** (booking stub + Stripe test checkout for `detailer_bot`); no live charges.
8. **No calls, email, or DMs** in week 1 — outreach waits until week 2 with owner `CONTACT_APPROVED`.

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