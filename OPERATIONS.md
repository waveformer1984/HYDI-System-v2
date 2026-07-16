# Operations

Current, accurate operator checklist as of the 2026-07-15 production
readiness audit. For incident decision trees see `ON_CALL_RUNBOOK.md` /
`ON_CALL_EMERGENCY.md`; for the full routing/process map see
`DEPLOYMENT.md`; for the security posture see `SECURITY.md`. This document
is the "what do I, the operator, actually need to go do" list — it does not
duplicate those.

## Manual actions required now (cannot be done from this audit's sandbox)

### 1. Rotate every credential that has ever appeared in git history — CRITICAL, still outstanding

A live Supabase `service_role` key and live Stripe secret/webhook keys were
found hardcoded across 21+ tracked files on 2026-07-15 (see
`ISSUES_FOUND.md` #20-#21) and scrubbed from the working tree. **This
audit independently re-confirmed the risk is not stale**: the same
secret-shaped patterns still appear 399 times across `git log --all -p`,
and two real `.env` files (`.env.backup`, `.env.production` — containing
at minimum `STRIPE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY`) were
committed and later untracked, but remain permanently recoverable from
history by anyone with clone access. Editing files does not undo this.

Rotate, in order:

1. **Supabase `service_role` key** — Supabase Dashboard → Project Settings
   → API → reveal/regenerate the service role key. Update everywhere it's
   consumed (`SUPABASE_SERVICE_ROLE_KEY` env var, Supabase Vault secrets
   per the migration in `ISSUES_FOUND.md` #20).
2. **Stripe secret key** (`sk_live_...`) — Stripe Dashboard → Developers →
   API keys → roll the live secret key.
3. **Stripe restricted key** (`rk_live_...`), if still in use.
4. **Both Stripe webhook signing secrets** (`STRIPE_WEBHOOK_SECRET_01`,
   `STRIPE_CONNECT_WEBHOOK_SECRET`) — Stripe Dashboard → Developers →
   Webhooks → each endpoint → roll signing secret.
5. **`KEEPER_BREAK_GLASS_TOKEN`** — regenerate; the emergency
   break-glass Edge Functions fail closed without it, so there's no
   functional risk to rotating it, only a coordination need (any operator
   tooling using the old value needs the new one).

After rotating, verify presence without revealing values:

```bash
vercel env ls | grep -E "SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_CONNECT_WEBHOOK_SECRET"
supabase secrets list --project-ref akbnfovjdcobifeupvbn
```

(Vercel isn't actually the deploy target per `DEPLOYMENT.md` — but if
`vercel env` still holds any of these values, they're additional exposure
that should be rotated/removed too, not left stale.)

**Separately, decide (this is a judgment call this audit will not make
unilaterally): does the exposure history warrant rewriting git history or
making the repository private/re-created?** Rotation neutralizes the
credentials; it does not remove the historical diffs from anyone who
already cloned the repo. If this repository has ever been public, treat
that as a separate incident-response decision.

### 2. Confirm the Stripe Dashboard's webhook endpoint URLs match what's actually live

`DEPLOYMENT.md` documents that `api/checkout.js`,
`api/stripe-connect-webhook.js`, and `api/webhooks/stripe.js` are now
reachable via `pages/api/*` under `next start`. If the Stripe Dashboard
(Developers → Webhooks) currently points at a different URL — an old
`*.vercel.app` domain, for instance — webhooks will keep silently failing
even after this fix. Update the endpoint URL to point at wherever
`next start` is actually reachable from the internet (a domain, reverse
proxy, or tunnel in front of port 3000), and confirm the signing secret
shown there matches `STRIPE_CONNECT_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET_01`.

### 3. Confirm which of the documented processes are actually running

`DEPLOYMENT.md`'s entry-point table lists several processes
(`src/server.js`, the PM2 fleet in `ecosystem.config.js`,
`scripts/start-hydi.js`'s managed set) whose current run-state this audit
could not check from its sandbox. Run the health-check commands at the
bottom of `DEPLOYMENT.md` on the real host and note which are actually up.
If any are running but weren't expected to be (e.g. `src/server.js` with
its separate, less-audited `/api/services/*` surface), evaluate whether
that's intentional.

### 4. Do not enable `workers/SecurityIdentityWorker.js` in production yet

Its hardcoded-fallback JWT secret was fixed 2026-07-15, but
`processAuthentication()` still simulates a successful login for any
submitted email with no real credential check (see `SECURITY.md`). This
worker does not appear to be started by any current entry point, but if
work ever wires `start-workers.js`/`WorkerOrchestrator` into a live
process, this must be fixed first.

## Verification steps after any deployment-affecting change

```bash
npm run typecheck        # tsc --noEmit
npm run lint              # next lint (ESLint, Next.js + TS aware)
npm test                  # full Jest unit suite
npm run build              # confirms pages/api/** actually compiles + lists the route table
```

`npm run build`'s output is the fastest way to confirm a `pages/api/*`
route exists and is picked up by Next.js — look for it in the printed
route table with the `ƒ` (dynamic/server-rendered) marker.

## Standard runbooks (already documented, unchanged by this audit)

- `ON_CALL_RUNBOOK.md` / `ON_CALL_EMERGENCY.md` — incident decision trees
  (webhook overload, duplicate events, provisioning failures)
- `ROLLBACK_PLAYBOOK.md` — rollback procedures
- `MONITORING_SETUP.md` — health/alerting configuration
- `SECURITY_PROTOCOL.md` — secret injection procedure (direct-pipe pattern,
  never echo/log a secret)
