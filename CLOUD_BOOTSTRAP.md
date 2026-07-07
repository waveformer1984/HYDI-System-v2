# Cloud Bootstrap

Idempotent provisioning for the cloud services Hydi depends on: Supabase (data
plane), Vercel (deploy target), Stripe (webhook config). Built so Heidi can run
this herself, incrementally, without a human re-deriving state each time.

## Run it

```bash
node scripts/cloud-bootstrap/index.js               # verify + provision all three
node scripts/cloud-bootstrap/index.js --only=supabase
node scripts/cloud-bootstrap/index.js --force        # ignore the cache, re-check everything
```

Each service module (`scripts/cloud-bootstrap/{supabase,vercel,stripe}.js`)
exposes `verify()` and `provision()`. The orchestrator (`index.js`) calls
`verify()` first; if the service isn't already verified, it calls
`provision()` once and re-verifies. Results land in
`.cloud-bootstrap-state.json` (gitignored — describes this machine's view,
never commit it) with three possible outcomes per service:

- **verified** — confirmed live and working.
- **blocked** — the platform refused for a reason only a human can resolve
  (billing, missing login, org suspension). `actionRequired` says exactly
  what to click.
- **failed** — an unexpected error; safe to re-run once the cause is fixed.

A verified result is cached for 10 minutes (`ttlMs` in `state.js`) so repeat
runs don't hammer the APIs; blocked/failed results are always retried, since
that's what lets the *next* run pick up the moment a human fixes the dashboard
side.

## Why Heidi can call this herself, no wiring needed

`heidi-core/actions/action-executor.js` already allowlists the `run_script`
action type for anything under `scripts/`. Because this whole module lives at
`scripts/cloud-bootstrap/`, Heidi can already invoke
`{ type: 'run_script', target: 'scripts/cloud-bootstrap/index.js' }` through
the existing safety gate — no executor changes were needed.

## Safety boundaries

- **Never prints or logs secret values.** The Supabase Management API token is
  read from `SUPABASE_ACCESS_TOKEN` or the OS credential store and held only
  in memory (`scripts/cloud-bootstrap/util.js:getSupabaseAccessToken`).
- **Vercel env var values are never set automatically** — only var *names* are
  checked. Per `SECURITY_PROTOCOL.md`, values must be direct-injected by an
  operator: `<secret-source> | vercel env add NAME production`.
- **Stripe module is webhook-config only.** It never creates a charge,
  transfer, or payout, and defaults to test mode unless
  `CLOUD_BOOTSTRAP_STRIPE_LIVE=1` is explicitly set.
- **Supabase schema reconciliation is additive-only** (not part of this
  module — see the local data plane docs) — provisioning here restores/verifies
  the project, it does not touch schema or data.

## Current known state (last live run, 2026-07-07)

- **Stripe: verified.** The `stripe-webhook` endpoint is already configured.
- **Vercel: verified.** Repo linked to `forgefinder/hydi-system`; all required
  env-var names present (values were injected earlier, out of band).
- **Supabase: blocked.** Restore attempt returns HTTP 402 — the org is
  Vercel-Marketplace-managed, and the Supabase resource is *suspended on the
  Vercel side*, not simply paused. Fix: Vercel dashboard → team `forgefinder`
  → Integrations → the Supabase resource → resolve the suspension/billing.
  Re-run `node scripts/cloud-bootstrap/index.js --only=supabase` afterward —
  it will restore, and the next step is a `supabase db push` reconciliation of
  the local schema against the newly-live cloud project.
