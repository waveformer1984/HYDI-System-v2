# Vercel Exit Plan — Cloudflare Free Tier

Status: **prepared, not executed.** No Vercel configuration is removed by this change.
All cutover steps below require the owner's Cloudflare + Vercel dashboards and are
listed as owner actions.

Goal: stop paying for Vercel (~$114/period) while keeping every currently-live
surface working. Target platform: **Cloudflare Workers/Pages free tier** (100k
requests/day, no card required) via **OpenNext for Cloudflare**.

---

## 1. What runs where today

| Surface | Where it runs now | Evidence in repo |
|---|---|---|
| `ursula-nine.vercel.app` — Ursula Next.js frontend + ~30 API routes (Stripe webhook, billing, swarm, revenue-engine, etc.) | **Vercel** | `apps/ursula-frontend` (Next.js 16, App Router, Node runtime — no `edge` exports) |
| `heidi-chat-portal.vercel.app` — Stripe webhook target referenced by setup docs | **Vercel** | `STRIPE_WEBHOOK_SETUP.md`, `agents/hardware-controller/*.json` point Stripe at `https://heidi-chat-portal.vercel.app/api/webhooks/stripe`. **The app behind this hostname is not identified in this repo** — the root app's `api/webhooks/stripe.js` serves on Frank (`:3000`) today, so this deployment is likely a stale or duplicate surface. Owner must confirm in the Vercel dashboard. |
| `galacticbytes.vercel.app` — Galactic Bytes storefront (Stripe-enabled, commercial) | **Vercel** | **Source code is NOT in this repo.** Only payout/test scripts reference it (`test-galactic-bytes-payout.js`, `stripe-connect-admin-client.js` — Galactic Bytes appears as a Stripe Connect test client, not a deployable app). See §5. |
| Root Next.js app (`heidi-web`, `:3000`) + all API routes in `api/` | **Frank via PM2** — not Vercel | `vercel.modern.json` at root is legacy config for a deployment that no longer runs there (archived duplicates live in `archive/dead-vercel-config/`). |
| Vercel account plumbing | Vercel API | `lib/vercel/vercelAdmin.js`, `api/chat/route.js` (chat commands `deploy status`/`redeploy`), `audit-vercel-sync.js`, `vercel-api-check.js` (hardcoded project id), `sync-vercel-secrets.ps1`, `vercel-sync-simple.ps1`, `test-vercel-token.ps1`, `debug-vercel-api.js`, `scripts/verify-vercel-api.mjs`, `termux/setup-termux-vercel.sh`, `agents/hardware-controller/vercel_navigator.py` |

Vercel-specific env vars found: `VERCEL_PROJECT_HEIDI`, `VERCEL_PROJECT_HYDI`,
`VERCEL_TEAM_ID`, `VERCEL_ADMIN_TOKEN` — used only by the admin/chat plumbing
above, not by the apps themselves. No `process.env.VERCEL_URL`/`VERCEL_ENV` usage
inside `apps/ursula-frontend`. No Vercel `crons` config exists in this repo.

## 2. New home for each piece

| Piece | New home | Cost |
|---|---|---|
| `apps/ursula-frontend` (frontend + all API routes) | **Cloudflare Workers** via OpenNext (`npm run build:cf`, `deploy:cf`) — worker name `ursula-frontend`, serves as `*.workers.dev` then custom domain | $0 (free tier: 100k req/day) |
| `heidi-chat-portal.vercel.app` Stripe webhook | Point Stripe at the real live handler instead. If that handler is the root app's `api/webhooks/stripe.js` on Frank, the public ingress (existing Tailscale/HTTPS path) already exists — update the Stripe dashboard URL and verify. If it is a separate Vercel deployment, port it to a Cloudflare Worker (single route, ~50 lines) or fold it into the ursula worker's `/api/stripe-webhook`. | $0 |
| `galacticbytes.vercel.app` | **Blocked — code not in repo** (see §5). | — |
| Vercel admin plumbing (`lib/vercel/*`, `*-vercel-*` scripts) | **Decommission after cutover**, not migrate. Replace with `wrangler` CLI / Cloudflare dashboard. Keep for now — they are needed during coexistence. | — |
| `vercel.modern.json` (root) | Keep in place (live config not deleted per task). Mark deprecated in a follow-up once the last Vercel deployment is confirmed dead. | — |

## 3. Cloudflare environment variables (names only)

Recreate these on the `ursula-frontend` worker via `wrangler secret put <NAME>`
(secrets) or `wrangler.toml` `[vars]` (non-secrets). Get current values from the
Vercel dashboard → project `ursula-nine` → Settings → Environment Variables.

**Secrets** (`wrangler secret put`):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
`JWT_SECRET`, `UPSTASH_REDIS_REST_TOKEN`, `URSULA_API_KEY`,
`NEXT_PUBLIC_GATEWAY_MASTER_KEY`, `PAYPAL_LIVE_SECRET`, `NEXT_PUBLIC_RESEND_API_KEY`,
`REVENUE_ENGINE_SUCCESS_URL`/`CANCEL_URL` (URLs but treat as config)

**Vars** (`[vars]` in wrangler.toml or dashboard):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PHASE`, `NEXT_PUBLIC_OLLAMA_URL`,
`NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_RELAY_URL`,
`NEXT_PUBLIC_REZONATE_API_URL`, `NEXT_PUBLIC_COORDINATOR_URL`,
`NEXT_PUBLIC_PROJECT_OPS_URL`, `NEXT_PUBLIC_BETA_PORTAL_URL`,
`NEXT_PUBLIC_SITEGRADE_URL`, `NEXT_PUBLIC_RAILWAY_URL`,
`UPSTASH_REDIS_REST_URL`, `SUPABASE_URL`, `OLLAMA_BASE_URL`,
`OPENVINO_SERVER_URL`, `ETHEREUM_RPC_URL`, `PRODUCTION_ETH_RPC`,
`CONTRACT_ADDRESS`, `PRODUCTION_CONTRACT`, `URSULA_API_URL`,
`URSULA_EXECUTOR_URL`, `HYDI_EXECUTOR_URL`, `HYDI_TRACES_URL`,
`PROJECT_OPS_URL`, `APP_BASE_URL`, `HYDI_EXECUTION_KILL_SWITCH`,
`HYDI_EXECUTION_COST`, `HYDI_REQUIRE_SUBSCRIPTION`

Also set `HYDI_ALLOW_PAID_LLM` — it is **absent = off**, which preserves the $0
model-spend constraint on the worker.

### Repo secrets for CI deploys

`.github/workflows/deploy-cloudflare.yml` (manual `workflow_dispatch` only —
nothing auto-deploys) needs exactly two **repo secrets** before it will run a
deploy; without them it exits green with a `::notice::`:

- `CLOUDFLARE_API_TOKEN` — Cloudflare dashboard → My Profile → API Tokens →
  Create Token → "Edit Cloudflare Workers" template, scoped to this account.
- `CLOUDFLARE_ACCOUNT_ID` — the hex id in `dash.cloudflare.com/<account-id>`.

## 4. Stripe webhook URL that must be updated

Stripe Dashboard → Developers → Webhooks:

- `https://heidi-chat-portal.vercel.app/api/webhooks/stripe` → point at the
  surviving handler (root app on Frank, or the ursula worker's
  `https://<domain-or-workers.dev>/api/stripe-webhook`).
- Any webhook pointing at `ursula-nine.vercel.app/api/stripe-webhook`
  (or `/api/billing/webhook`) → `https://<new-domain>/api/stripe-webhook`.
- `STRIPE_WEBHOOK_SECRET` will be re-issued per new endpoint — put the new value
  in via `wrangler secret put`, not the old Vercel value.

## 5. Galactic Bytes storefront — code not in this repo

`galacticbytes.vercel.app` is commercial (takes Stripe payments) so it cannot
stay on Vercel Hobby — but its source is not here.

**History search (2026-10-23):** `git log --all -S galacticbytes` (and case-
insensitive `-i` variants, `archive/`, all branches) finds only *references*,
never deployable source: `test-galactic-bytes-payout.js`,
`stripe-connect-admin-client.js`, `create-connect-account.js`,
`create-test-connect.js`, `test_payout_flow.js`, `setup-payout-system.sql`,
`COMMERCIAL_MODEL.md` — in every hit Galactic Bytes is a Stripe Connect
sub-account name (`galactic_bytes` / `STRIPE_ACCOUNT_*` env vars), not an app.
The storefront source is **not recoverable from this repo**.

To migrate it, the owner must first export it from Vercel (only place the
source may still exist):

- Vercel dashboard → project `galacticbytes` → Settings → Git — if a Git repo
  is connected, that repo is the source; clone it.
- If no Git link: on a machine with the Vercel CLI and a token for the project,
  `vercel pull galacticbytes` (or `vercel link` inside an empty dir, then
  `vercel pull`) recovers the deployed project files + env-var names.
- Vercel dashboard → project → Settings → Environment Variables — record the
  env-var **names** (same procedure as §3) and Stripe webhook endpoints.
- If it is a static/Next.js storefront, the same OpenNext path applies; if it
  is a plain static export, Cloudflare Pages `wrangler pages deploy` is even
  simpler — decide after the source is available.

## 6. Cutover steps (owner actions, in order)

1. **Cloudflare account** — dashboard.cloudflare.com → Workers & Pages →
   Create Worker. Get account id: dashboard URL `dash.cloudflare.com/<account-id>`.
2. `cd apps/ursula-frontend && npm install && npm run build:cf` — verify
   `.open-next/` output builds clean (done in this PR).
3. `npx wrangler login` (browser auth) — owner must do this; no API token in repo.
4. `npx wrangler deploy` → app lives at `ursula-frontend.<account>.workers.dev`.
5. Recreate all §3 env vars (secrets via `wrangler secret put`, vars via
   dashboard → worker → Settings → Variables).
6. Smoke-test the workers.dev URL: `/`, one API route, `/api/stripe-webhook`
   returns 400 not 500 (signature check must still reject unsigned posts).
7. Update Stripe webhook URLs (§4) — keep the Vercel webhook *and* the new one
   active in parallel; watch Stripe's webhook attempt log until only the new
   endpoint receives events.
8. DNS: Cloudflare dashboard → worker → Settings → Triggers → Custom Domains →
   add `ursula.<your-domain>` (free on Cloudflare-managed DNS; if the domain's
   DNS is elsewhere, either move DNS to Cloudflare — free — or CNAME to the
   workers.dev hostname).
9. Monitor 48h, then Vercel dashboard → each project → Settings → **Delete/Disable
   project** → cancel the paid plan.
9a. Once Vercel is gone, set repo **variable** `VERCEL_RETIRED=true` (repo
    Settings → Secrets and variables → Actions → Variables tab) — the
    `Check Vercel environment` step in `health-monitor.yml` skips on it,
    instead of failing forever against a dead account.
10. After last Vercel deploy confirmed dead: PR to remove `lib/vercel/*`,
    `*-vercel-*` scripts, `vercel.modern.json`, and the `VERCEL_*` env entries.

## 7. Rollback

Every step is reversible until step 9:

- DNS back: remove the Cloudflare custom domain / CNAME — Vercel deploy is still
  live and unchanged (nothing was deleted).
- Stripe webhook: re-point the endpoint URL back to the `*.vercel.app` URL —
  the old secret was never rotated out.
- The Vercel project, its env vars, `vercel.modern.json`, and all `*-vercel-*`
  tooling remain untouched by this PR.

## 8. Cost check

| Item | Cost |
|---|---|
| Cloudflare Workers free tier | $0 — 100k req/day, 10ms CPU/req — ample for this traffic profile |
| Custom domain on Cloudflare DNS | $0 (domain registration already owned) |
| `wrangler`/`@opennextjs/cloudflare` | OSS, $0 |
| Vercel after step 9 | $0 (cancelled) |
