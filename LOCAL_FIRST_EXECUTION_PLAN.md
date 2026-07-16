# Local-First Execution Plan

Dated 2026-07-16. Concrete, phased path to replace every external platform
this system depends on with a locally/self-hosted equivalent, wherever one
exists. Extends the Local-First Architecture decision already recorded in
`CLAUDE.md` (made 2026-07-10) from "which pieces are already local" into
"what's the executable path for the rest."

Status markers: ✅ done · 🔜 planned, not started · 🚫 not applicable (no
local substitute, or deliberately deferred by an existing decision).

## Inventory

| Service | Current reality | Locally replaceable? | Verdict |
|---|---|---|---|
| **Supabase (data plane)** | Local dev already runs fully self-hosted via `supabase start` (Docker) — Postgres, PostgREST, Realtime, Auth, Storage, pg_cron, pg_vector, the same open-source stack Supabase Cloud runs on top of. Production still targets the *cloud* project (`akbnfovjdcobifeupvbn`) per `.mcp.json`, migration tooling, and `health-monitor.yml`. | **Yes — already proven in dev, just not promoted to production.** | 🔜 Phase 1 |
| **Vercel** | Already fully disabled per the 2026-07-10 decision — no git integration, nothing deploys on push. | **Already done.** | ✅ Phase 0 (this doc) |
| **Stripe** | Real credit-card processing. | **No.** No self-hosted processor can move real money — a hard external dependency by definition. | 🚫 out of scope, keep |
| **GitHub (repo host + Actions CI)** | Kept deliberately — `CLAUDE.md` already records that self-hosting (e.g. Gitea) was "considered and explicitly declined for now." | Yes, but this is an existing decision, not a gap this plan should reopen. | 🚫 deferred by prior decision |
| **GitHub Pages** (static mobile-chat/Ops shell) | Publishes `docs/index.html`; the page itself talks to your own API + a secret you type in — GitHub only hosts static files. | **Yes, trivially** — a handful of static files. | 🔜 Phase 3 (low priority) |
| **Anthropic / OpenAI APIs** | Keys unset/dead; inference and embeddings already run on local Ollama (`nomic-embed-text`). | **Already done.** | ✅ |
| **Tailscale** | Mesh VPN for remote access (`heidi-pc.tailc50af2.ts.net`). Not a data-plane dependency — no application data lives there, it's a tunnel. | Technically yes (self-hosted WireGuard), but low value relative to effort. | 🚫 not pursued unless requested |

No other external SaaS SDKs exist in `package.json` — checked for
Sentry/Twilio/SendGrid/AWS/Firebase/etc.; none are dependencies. The real
surface is exactly the rows above.

## Phase 0 — cleanup ✅ done 2026-07-16

Vercel deployment has been confirmed dead since 2026-07-10, but three
artifacts still implied otherwise. All archived to
`archive/dead-vercel-config/` (see that directory's `README.md` for the
per-file rationale):

- Root `.vercelignore`
- `apps/ursula-frontend/vercel.json` (that app actually runs via the PM2
  fleet in `ecosystem.config.js`, not Vercel)
- `scripts/cloud-bootstrap/vercel.js` (the auto-provisioning module for a
  Vercel project) — also removed from `scripts/cloud-bootstrap/index.js`'s
  `SERVICES` map, which now only orchestrates `supabase` and `stripe`.

Deliberately **not** touched in this phase:
- `hydi-monitor-deploy/vercel.json` — that whole directory is a separate
  stale sub-deployment already tracked under `ROADMAP.md`'s P1 item to
  consolidate the four parallel Stripe checkout/webhook implementations.
  Archiving it belongs to that decision, not this cleanup.
- `.github/workflows/health-monitor.yml`'s `vercel-api-check.js` step —
  an intentionally-kept read-only diagnostic, not a deploy trigger.

## Phase 1 — promote local Supabase to production 🔜

The self-hosted Docker stack already exists and is exercised every time a
dev session runs `supabase start` (`STARTUP_GUIDE.md`). The work here is
promoting that same stack from "local dev convenience" to "the actual
production data plane," replacing the cloud project entirely:

1. Run the Docker stack persistently on a real always-on host — `heidi-pc`
   is already that host per the existing docs.
2. Re-point every env var currently aimed at
   `https://akbnfovjdcobifeupvbn.supabase.co` (`SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_URL`) at the local instance, reachable over
   Tailscale rather than exposed to the public internet.
3. Migrate data: `pg_dump` from the cloud project, restore into the local
   Postgres.
4. Re-point `.mcp.json` and `health-monitor.yml`'s health checks at the
   local instance.
5. Decommission the cloud project once the local one has run clean for a
   burn-in period.

This is the one phase with real operational weight (data migration,
host uptime, backup strategy) — the rest of this plan is comparatively
cheap. Not started; needs a maintainer go-ahead on hosting logistics
(backup/restore strategy, uptime expectations) before execution.

## Phase 2 — Edge Functions 🔜

All 42 Supabase Edge Functions already run identically under `supabase
functions serve` (Deno) locally — no code changes needed. Once Phase 1's
host is up, confirm each function's env vars resolve against the local
instance (most already do, per the Local-First work already done in
`CLAUDE.md`).

## Phase 3 — GitHub Pages → local static serving 🔜, low priority

Serve `docs/index.html` from the same host via a lightweight static
server (Caddy/nginx), reachable over Tailscale. Low priority since
Tailscale already provides remote access without needing GitHub Pages at
all — this only removes GitHub as a hosting dependency for a page that's
already just a shell pointing at your own API and secret.

## Explicitly out of scope

- **Stripe** — no self-hosted substitute exists for real payment
  processing. Already correctly scoped down to "touch only at the actual
  charge step" per `CLAUDE.md`.
- **GitHub itself** (repo host + Actions CI) — self-hosting this (e.g.
  Gitea + a self-hosted CI runner) was already considered and explicitly
  declined per the 2026-07-10 decision recorded in `CLAUDE.md`. This plan
  does not reopen that call. (Separately, GitHub Actions CI is currently
  blocked by an Actions spending-limit issue being tracked independently —
  not a Local-First concern, just a billing configuration issue.)
- **Tailscale** — a tunnel, not a data-plane dependency; no application
  data lives there. Not pursued unless specifically requested.
