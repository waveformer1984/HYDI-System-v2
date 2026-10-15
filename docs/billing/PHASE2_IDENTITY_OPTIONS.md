# Phase 2 — Customer identity options (proposal only)

**No implementation until the owner selects A, B, or A+B.**

Current state: interim **operator-issued** tenant bearer tokens (`BILLING_CUSTOMER_TOKEN_SECRET`, `lib/billing/customer-auth.js`). Launch blocker §L.

---

## Option A — Supabase Auth (local stack)

| Dimension | Assessment |
|-----------|------------|
| Tenant isolation | Strong: JWT/session → `users` ↔ `billing_tenant_members` with RLS; tenant id from session only |
| Onboarding | Self-serve sign-up → create tenant row + membership |
| Authorization | Standard session cookies / SSR; map roles `owner`, `billing_admin`, `member` |
| Account recovery | Supabase email reset / magic link |
| Security boundary | Auth service separate from billing token HMAC; rotate JWT secrets independently |
| Migration impact | New tables + backfill; deprecate bearer token behind `BILLING_LEGACY_CUSTOMER_TOKEN=true` |
| Testing | Supabase local + RLS tests per route; tenant isolation matrix |
| Mobile usability | Email/magic link works on phone; familiar OAuth patterns |

**Tradeoffs:** New UX and session plumbing on every `pages/api/billing/*` customer route.

---

## Option B — Walkie QR owner sign-in (#355)

| Dimension | Assessment |
|-----------|------------|
| Tenant isolation | **Requires explicit model**: device pairing ≠ billing tenant unless mapped in DB |
| Onboarding | Owner pairs device; members unclear without additional invites |
| Authorization | Reuse HMAC/device tokens (`lib/auth/deviceAuth.js`) — strong for **ops**, not proven for **customers** |
| Account recovery | Device re-pairing; loss of device = recovery policy needed |
| Security boundary | Same secret ecosystem as mobile ops — risk of conflating operator and customer roles |
| Migration impact | Lower if only **owners** pay; poor fit for multi-member billing self-serve |
| Testing | Reuse heidi-mobile tests; must add **negative** tests that pairing alone does not grant billing |
| Mobile usability | Excellent for owner on phone; weak for finance users without Walkie |

**Tradeoffs:** Walkie proves **device** identity, not **billing account** membership — do not assume pairing grants checkout.

---

## Option A + B — Hybrid

| Dimension | Assessment |
|-----------|------------|
| Tenant isolation | Supabase members for day-to-day billing UI; Walkie for **owner break-glass** and mobile ops |
| Onboarding | Self-serve (A) + owner override path (B) with audit |
| Authorization | Two gates: session for `/billing`, device token for sensitive admin only |
| Migration impact | Highest; clearest long-term separation of customer vs operator planes |

**Recommended when:** Frank wants phone-first **operations** and self-serve **customer** billing.

---

## Owner decision required

Reply with **A**, **B**, or **A+B** before any Phase 2 PR.
