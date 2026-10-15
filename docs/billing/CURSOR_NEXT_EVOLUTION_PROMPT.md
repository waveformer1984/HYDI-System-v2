# Cursor prompt — Hydi's next evolution (billing → first paying customer)

Paste the block below into Cursor **running on Frank** (the local Windows machine).
Cursor's cloud agents cannot reach the local services this work depends on.

It continues from the Revenue Streams Module merged in PR #320
(`docs/billing/REVENUE_STREAMS_MODULE.md`). The work is phased, and it stops for an owner
decision at Phase 2 (identity provider) and before any go-live (Phase 5).

```text
You are working in the canonical HYDI tree (C:\Users\Owner\HYDI-System-v2, branch clean-main).
First run `git rev-parse --is-inside-work-tree` and `git status`; if either fails or the tree is
dirty with work you didn't make, STOP and tell me.

Read before writing anything:
- CLAUDE.md (architecture, local-first rules, secret handling, test tiers)
- .cursor/rules/*.mdc
- docs/billing/REVENUE_STREAMS_MODULE.md (especially §B, §J, §K, §L)
- COMMERCIAL_MODEL.md §4–§6

MISSION — "Hydi's next evolution": take the Revenue Streams Module (lib/billing, merged in PR #320)
from sandbox-tested code to a system that could take its first real paying customer, and make
Heidi aware of it. Work in small vertical slices. One branch + one PR per phase.

GROUND RULES
- Never run live charges, use a live Stripe key, or set ALLOW_LIVE_STRIPE=true. Test mode only.
- Never print, log or paste secrets; inject them per SECURITY_PROTOCOL.md.
- No floating-point money. Tenant id comes only from authenticated identity, never from the request body.
- Keep the provider behind lib/billing/providers; do not import `stripe` elsewhere.
- Every new migration needs tests/migrations/<version>.test.js and must be additive and idempotent
  (`npm run lint:migrations` must show it ✓).
- Before each PR, run and report REAL results: `npm run typecheck`, `npm run lint`,
  `npx jest tests/unit/billing`, `npm run test:local` (Postgres acceptance suite; it truncates
  billing_* tables — local Supabase only), and `npm test`. Compare any failures against clean-main;
  only claim "no new failures" if you checked.
- GitHub-hosted CI may still be down (ROADMAP P0 #2): run `npm run ci:local` and paste its results.
- Don't commit the AGENTS.md / tsconfig.json edits that `next dev` makes on its own.
- If a decision is mine (pricing, tax, legal terms, which identity provider), ask; don't guess.

PHASE 1 — Real sandbox run (verify before building more)
1. `npx supabase start`, apply migrations, confirm the billing_* tables exist.
2. With a Stripe TEST key: `stripe listen --forward-to localhost:3000/api/billing/webhook`,
   then set BILLING_STRIPE_WEBHOOK_SECRET and BILLING_CUSTOMER_TOKEN_SECRET.
3. `node scripts/billing-sandbox-setup.js --tenant-name "Sandbox Co" --tenant-email <mine>`.
4. Walk the full flow in a browser: /pricing → test card 4242… → /billing shows "Active" only
   after the webhook → POST /api/billing/ai/complete works until the limit, then returns 429.
5. Negative paths: a declining card (no access), `stripe trigger` duplicates (no duplicate rows),
   webhook listener off then reconcile (access appears), cancel at period end, a refund.
6. Fix every bug you find with a regression test. Write the evidence (commands, outcomes, row
   counts — no secrets) to docs/billing/SANDBOX_RUN_<date>.md.
7. Fix `npm run dev` failing under Turbopack (custom webpack config) the minimal way, or switch
   the script to `--webpack` with a comment explaining why.

PHASE 2 — Real customer identity (launch blocker #1)
Replace the interim operator-issued customer tokens with real sign-in. First propose two options
to me — e.g. Supabase Auth on the local stack vs. reusing the owner sign-in from the Walkie
QR flow (#355) — with tradeoffs, and wait for my choice. Then implement:
- users ↔ tenants membership with roles (owner, billing_admin, member)
- a server session that resolves the tenant
- self-serve sign-up that creates a tenant
- member-only billing pages
- an `actions`-style audit of membership changes
Keep the old token path behind a flag for a deprecation window. Add tenant-isolation tests for
every customer route.

PHASE 3 — Operate it
- Run scripts/billing-worker.js under PM2: add it to ecosystem.config.js and to the boot plan only
  if `npm run boot:plan` shows it fits, then document the change in BOOT_AGENT.md.
- Health: expose dead-letter count, due-retry age, and last reconcile result in the existing health
  surfaces (api/mobile-status.js and the Heidi daily loop / morning brief). Alert on dead-letters
  > 0 and on reconcile errors.
- Fees: fetch the Stripe balance transaction on invoice.paid so `processing_fees` and net
  collections stop being "unknown". Test this against Stripe-shaped fixtures.

PHASE 4 — Make money visible to Heidi (pipeline integration)
- Publish normalized billing events (checkout.completed, subscription.state_changed,
  payment.succeeded/failed, refund, dispute, usage.quota_exceeded) through
  lib/commercial/ingress-adapter into the Event Fabric, per COMMERCIAL_MODEL.md §6. The billing
  tables stay the source of truth for billing state; the events are the timeline.
- Let CASCADE classify them, KILO hypothesize (e.g. churn risk from a cancellation plus a usage
  drop, upgrade candidates near their quota), and ProtoForge gate. Heidi may only PROPOSE actions
  — refunds, outreach, price changes — through the existing approval flow (heidi_action_proposals);
  she never executes them.
- Add read-only MCP tools to mcp/protoforge-mcp: billing_overview, revenue_report (with metric
  definitions), dead_letters. Risk tier `read` only.
- The replay determinism gate (`npm run test:replay`) must stay green.

PHASE 5 — Launch readiness (stop here and hand back to me)
Produce docs/billing/LAUNCH_READINESS.md covering:
- every §L blocker: done / evidence / remaining owner decision
- a proposed pricing and allowance table, marked as a PROPOSAL that needs my approval
- the tax decision options
- terms and refund text that matches the configured BILLING_*_POLICY values
- a go-live runbook: live key, live webhook, live prices, rollback
Do not perform the go-live.

OUTPUT FOR EACH PHASE: files changed, behaviour added, the exact commands run with their actual
results, configuration needed (variable names only), known limitations, and what's next.
Never claim something ran, passed, deployed or charged unless you saw it happen.
```
