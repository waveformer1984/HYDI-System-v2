# REVENUE_OPPORTUNITY_REPORT

**Mission:** HYDI-REVENUE-001  
**Scoring weights:** Time to first payment 25%, Verified demand 25%, Profit potential 20%, Startup cost 15%, Delivery automation 10%, Recurring revenue 5%.  
**Machine-readable catalog:** `lib/revenue-ops/product-catalog.js`  
**Ranker:** `lib/revenue-ops/product-opportunity-score.js`

> Unless labeled **FACT**, items are **HYPOTHESIS** or **ESTIMATE**.

## Ranked summary

| Rank | Opportunity | Weighted score | Selected |
|------|-------------|----------------|----------|
| 1 | San Antonio Detailer Bot | **70.5** | **Yes** |
| 2 | Website + booking automation | **69.6** | No |
| 3 | Heidi ops retainer | **68.8** | No |
| 4 | SMB AI automation | **59.0** | No |
| 5 | LiPi lead packs | **55.5** | No |
| 6 | Galactic Bytes | **48.5** | No |

---

## 1. San Antonio Detailer Bot (SELECTED)

| Field | Content |
|-------|---------|
| Target customer | Independent mobile detailers / small appearance shops, San Antonio metro |
| Problem | Missed calls, manual booking, weak follow-up after quotes |
| Demand evidence | **HYPOTHESIS** — high local service density; no HYDI-counted paid Detailer customers in audit |
| Competitors | Square Appointments, Jobber, generic web agencies |
| Offer | “Detailer Bot Lite”: SMS/booking page + automated follow-up + deposit via Stripe |
| Pricing | **ESTIMATE** $149 setup + $79/mo or $299/mo managed |
| Delivery cost | **ESTIMATE** $40–80/mo infra + owner time for onboarding |
| Margin | **ESTIMATE** 60–75% at 5+ subscribers |
| Acquisition | Local SEO, chamber/referral, in-person demo |
| First customer | One shop owner known to operator; pilot at **50% off** with case study consent |
| Risks | Churn, support load, SMS compliance |
| Validation | 10 interviews + 1 live demo (see `scripts/seed-revenue-prospects.js` research list) |

**Why selected:** Lowest cash need, leverages existing `detailer_bot` stream + automation stack, fastest path to demonstrable ROI for one owner-operator.

---

## 2. AI-powered small-business automation

| Field | Content |
|-------|---------|
| Target customer | 1–10 person service businesses on Gmail/Sheets |
| Problem | Owner time on repetitive admin |
| Demand evidence | **HYPOTHESIS** — broad market; differentiation weak without niche |
| Competitors | Zapier, Make, vertical SaaS |
| Offer | Inbox triage + task drafts (human-approved sends) |
| Pricing | **ESTIMATE** $199–499/mo |
| Delivery cost | **ESTIMATE** High scoping per client |
| Margin | **ESTIMATE** 40–55% until templated |
| Acquisition | Content, referrals |
| First customer | Existing warm contact with Heidi deployment |
| Risks | Scope creep, liability on wrong automated action |
| Validation | Time-boxed workflow audit for one business |

**Score:** 59.0

---

## 3. Website + booking automation

| Field | Content |
|-------|---------|
| Target customer | Local services without online booking |
| Problem | Phone tag and no-shows |
| Demand evidence | **FACT (repo):** Next.js + Stripe patterns exist; **HYPOTHESIS:** local demand |
| Competitors | Wix/Squarespace, freelancers |
| Offer | Next.js site + Stripe checkout + calendar embed |
| Pricing | **ESTIMATE** $1.2k–2.5k project + $49/mo hosting care |
| Delivery cost | **ESTIMATE** 15–25h first build |
| Margin | **ESTIMATE** 50–65% on fixed projects |
| Acquisition | Portfolio, local outreach |
| First customer | Cross-sell from detailer pilot |
| Risks | Design revisions, hosting support |
| Validation | Ship one template demo site in staging |

**Score:** 69.6

---

## 4. LiPi v2 lead packs

| Field | Content |
|-------|---------|
| Target customer | Solo B2B consultants |
| Problem | Low-quality purchased lists |
| Demand evidence | **HYPOTHESIS** — `lipi_v2` stream in repo only |
| Competitors | Apollo, ZoomInfo, niche list vendors |
| Offer | Curated CSV + research notes (no spam sending) |
| Pricing | **ESTIMATE** $99–299/pack |
| Delivery cost | **ESTIMATE** Research time per pack |
| Margin | **ESTIMATE** 70%+ if templated research |
| Acquisition | LinkedIn/content (manual, approved) |
| First customer | Waitlist of 5 consultants |
| Risks | Data accuracy, CAN-SPAM if user misuses |
| Validation | Sell one pack to friendly buyer |

**Score:** 55.5

---

## 5. Galactic Bytes

| Field | Content |
|-------|---------|
| Target customer | Indie creators / devs |
| Problem | Tooling fragmentation |
| Demand evidence | **HYPOTHESIS** |
| Competitors | Gumroad, itch.io, template marketplaces |
| Offer | Digital asset / template bundle |
| Pricing | **ESTIMATE** $19–79 one-time |
| Delivery cost | **ESTIMATE** Low marginal cost |
| Margin | **ESTIMATE** High if product fits |
| Acquisition | Marketplaces, community |
| First customer | Existing audience |
| Risks | Long time-to-audience |
| Validation | Landing page + 50 email signups |

**Score:** 48.5

---

## 6. Heidi ops retainer (discovered)

| Field | Content |
|-------|---------|
| Target customer | Owner-operators with one Windows host (“Frank”) |
| Problem | No honest health signal when systems degrade |
| Demand evidence | **FACT (repo):** `frank-observer`, mobile status; **HYPOTHESIS:** paid demand |
| Competitors | MSPs, Datadog (overkill for solo) |
| Offer | Monthly health + mobile approvals + fix-list review |
| Pricing | **ESTIMATE** $199–399/mo |
| Delivery cost | **ESTIMATE** Low once observability wired |
| Margin | **ESTIMATE** 70%+ |
| Acquisition | Tailscale/mobile demo |
| First customer | Self (dogfood) then one peer |
| Risks | On-call expectations |
| Validation | 30-day dogfood report |

**Score:** 68.8