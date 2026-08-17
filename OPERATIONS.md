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

### 5. Self-hosted Actions runner outage — mitigated 2026-07-16, see issue #195

Discovered 2026-07-16: no self-hosted runner was picking up GitHub Actions
jobs. Every workflow requiring `runs-on: self-hosted` (`unit-tests.yml`,
`codeql.yml`, `hdi-governance-gate.yml`, `health-monitor.yml`,
`test-procedural-memory.yml`) had been stuck `queued` — never
`in_progress`, never completing — repo-wide, across every branch, for at
least ~9 days. This was the same class of incident `CLAUDE.md` already
describes as happening 2026-07-08, except the evidence gathered this time
indicated it never actually recovered; the pre-push hook and repeated
admin-merges (including PR #194) had been masking a dead runner, not
routing around a one-off blip.

**Mitigation applied**: all five workflows above were switched from
`runs-on: self-hosted` to `runs-on: ubuntu-latest`, since the actual
runner host (a Windows machine, `heidi-pc`) is outside what a coding
session can reach or restart. `health-monitor.yml` also gained a "Check
for stuck Actions runs" step that fails (and trips its existing
`health-alert` issue escalation) whenever any workflow run has sat
`queued` for 15+ minutes, so a future runner outage — self-hosted or
otherwise — surfaces as an alert instead of silently masking for 9 days.

**Update, still 2026-07-16, GitHub-hosted runners are also blocked**: after
switching to `ubuntu-latest`, every job has instead completed with
`conclusion: failure` in ~3-5 seconds with `runner_id: 0` and `0ms`
billable runtime — meaning GitHub rejects the job before any runner is
ever assigned, not a real test/lint/CodeQL failure. This persisted through
two account-side fixes attempted in sequence (raising the Actions spending
limit, then clearing a past-due account balance), so it isn't either of
those — and since this repo is public, GitHub-hosted minutes should be
free regardless of spending limit. Remaining unexplored candidates:
Settings → Actions → General → "Actions permissions" restricting runners
below what the workflows request, or an org-level policy overriding the
repo. Nobody has chased this further yet.

**Decision (2026-07-16)**: rather than keep chasing the GitHub-side block,
the local pre-push hook (`.githooks/pre-push`, wired up automatically via
`npm install`'s `postinstall` → `git config core.hooksPath .githooks`) is
the actual gate for day-to-day work — it runs `typecheck`, `lint`, and the
full Jest suite before every push. GitHub Actions is treated as
best-effort/optional until someone confirms hosted runners actually pick
up a job end-to-end; do not treat a red or stuck GitHub Actions check as
blocking, and do not treat a green one as more trustworthy than the local
hook having passed.

## Verification steps after any deployment-affecting change

**Note**: GitHub Actions is not currently a trustworthy signal (see item 5
above) — hosted runners reject jobs before they start, for reasons still
unconfirmed. The local commands below (already run automatically by the
pre-push hook) are the real source of truth today.

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
