# REVENUE_FINANCIAL_MODEL

**Mission:** HYDI-REVENUE-001  
**Implementation:** `lib/revenue-ops/financial-ledger.js`

## Hardware expansion target

| Metric | Value |
|--------|-------|
| Hardware reserve goal | **$5,000 USD** |
| Source of reserve | **Net operating profit** (cleared payments minus refunds, fees, operating costs, tax reserve) |
| Gross revenue | Does **not** increase hardware reserve until costs and refunds applied |

## Ledger fields

- Gross revenue (informational; mirrors cleared unless partial captures added later)
- **Cleared payments** (authoritative for profit)
- Refunds
- Payment processing fees (default planning rate in `config/revenue-ops.json`: 2.9%)
- Operating costs
- Taxes reserved (owner-set; not auto-calculated in v1)

## Distributable profit allocation (planning policy)

Subject to taxes, obligations, and owner approval:

| Bucket | Share | Use |
|--------|-------|-----|
| Hardware expansion | 50% | Measured bottleneck hardware (GPU/RAM/disk) |
| Operating reserve | 30% | Runway, Stripe balance buffer |
| Business development | 20% | Tools, approved subscriptions |

Function: `hardwareReservePlan(ledger)`.

## Pilot economics (Detailer Bot — ESTIMATE)

| Line | Amount |
|------|--------|
| Pilot price | $149/mo (50% promo → $74.50 mo 1) |
| Stripe fee ~2.9% + $0.30 | ~$2.46 |
| Infra (SMS/hosting) | ~$15/mo |
| Net month 1 (promo) | **~$57** (not hardware-grade until volume) |

**Break-even toward $5k hardware (50% slice):** Need **~$175k cumulative net profit** at 50% allocation — or fewer customers at full price and lower delivery cost. Plan assumes **10+ recurring** detailers at $79–99/mo within 12–18 months (HYPOTHESIS).

## Reporting

| Report | Function | Cadence |
|--------|----------|---------|
| Daily revenue | `dailyReport(ledger)` | Daily |
| Weekly profitability | Export ledger + `hardwareReservePlan` | Weekly (manual/script) |

## Payment integrity rule

`recordClearedPayment` requires `stripePaymentId`. Never set `PAID` state from chat text alone.