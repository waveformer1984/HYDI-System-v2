# Security Policy

## Supported Versions

HYDI System v2 is a continuously deployed platform. Security fixes are applied to the **`clean-main`** branch and deployed immediately. There are no separately versioned release lines — always use the latest commit on `clean-main`.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

You have two options:

1. **GitHub private security advisory** (preferred) — open a draft advisory at `https://github.com/waveformer1984/HYDI-System-v2/security/advisories/new`. This keeps the report private within GitHub and allows collaborative editing before disclosure.
2. **Email** — send to **waveformer1984@gmail.com** with the subject line `[SECURITY] HYDI System v2 — <brief description>`.

In either case, include:

- A description of the vulnerability and the affected component
- Steps to reproduce or a proof-of-concept (safe / non-destructive only)
- Potential impact assessment
- Any suggested remediation

## Coordinated Disclosure Timeline

| Milestone | Target |
|-----------|--------|
| Acknowledgement | Within 48 hours of receipt |
| Initial assessment | Within 7 days |
| Fix delivered | Within 30 days for critical/high; 90 days for medium/low |
| Public disclosure | After fix is deployed — coordinated with the reporter |

We will not disclose a vulnerability publicly before a fix is available unless the vulnerability is already publicly known. If we need more time than the above targets, we will communicate that proactively.

## Scope

### In scope

- Authentication and authorisation bypasses in API routes (`api/`)
- Injection vulnerabilities (SQL, command, header injection) in any layer
- Secrets exposed in logs, responses, or version control
- Stripe webhook signature bypass (`api/stripe-connect-webhook.js`, `api/webhooks/stripe.js`)
- Supabase RLS policy bypasses on any table
- KILO being reachable for execution (it must only generate hypotheses)
- ProtoForge policy engine bypasses (default must be `'reject'`)
- Supabase Edge Function privilege escalation
- `SUPABASE_SERVICE_ROLE_KEY` reachable from the client

### Out of scope

- Vulnerabilities in third-party dependencies (report upstream; we will patch promptly after upstream fixes)
- Denial-of-service via normal usage patterns
- Issues already listed under [Known Security Limitations](#known-security-limitations) that are documented as accepted risks
- `health-monitor.yml` or `codeql.yml` scheduled workflow failures unrelated to application code

## Known Security Limitations

These are documented, accepted limitations. They do not need to be reported as new vulnerabilities:

### Header-based identity assertion

API routes accept `x-user-id` HTTP headers as the identity claim. These headers are **not cryptographically verified**. A caller that can set arbitrary headers can assert any identity. Cryptographic hardening (signed JWTs or mutual TLS) is on the roadmap. Do not build trust on `x-user-id` alone for high-privilege operations.

Only two routes actually read this header for anything: `api/rezonate/route.js` and the currently-unreachable `api/life-flow/route.js`. `api/rezonate/route.js`'s `get_project`/`list_tracks`/`add_track` previously performed no ownership check at all (fixed 2026-07-16, `ISSUES_FOUND.md` #48 — they now at least confirm the project belongs to whatever `userId` the request claims, closing the "any caller reads/writes any project" gap even though that `userId` itself still isn't verified). Two separate, unconnected identity scaffolds already exist in this codebase that a real fix could build on — the working HMAC device/service-token system (`lib/auth/deviceAuth.js`) already used by `requireAuth`, or the dormant Supabase Auth scaffolding (`rezonate_projects.user_id REFERENCES auth.users(id)` with correct RLS already written) — but there's no login/signup flow anywhere and the route uses the service-role key (bypasses RLS), so neither is actually wired up today. Deciding between them is a product call for the maintainer, not something to guess at silently.

### Integration tests require live credentials

`npm run test:integration` requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment. These must never be committed or logged. See `SECURITY_PROTOCOL.md` for the secret-handling protocol.

### `workers/SecurityIdentityWorker.js` has no real credential verification, even though it now fails closed

`processAuthentication()` used to simulate a successful authentication (and
issue a real JWT) for any submitted email with no credential check at all.
Fixed 2026-07-16: it now unconditionally rejects every `auth.attempt` and
never issues a token, since the task payload it receives (`email`,
`ip_address`, `user_agent`) carries no password/API-key/credential to check
in the first place — this codebase has no password-based user schema at
all; its actual identity model is API-key based (see
`src/middleware/keymaker.js`, the `api_keys`/`keymaker_keys` tables).
`checkTokenPermission()` likewise used to return `true` unconditionally
(no RBAC implementation exists behind it) and now returns `false` by
default. The hardcoded fallback JWT secret this worker used to sign/verify
with was separately fixed 2026-07-15 (fails closed if `JWT_SECRET` is
unset).

**This closes the "anyone can get a token" hole, but does not add real
authentication** — there still is no way for a legitimate caller to
actually authenticate through this worker. Designing that (e.g. extending
the payload to carry an API key checked against the existing
`keymaker_keys` table, vs. a new password-based flow, vs. retiring this
queue-based path in favor of the already-live `Keymaker` Express
middleware) is a product/architecture decision for the maintainer, not
something this fix should guess at. No startup path in this repo
(`package.json` scripts, `ecosystem.config.js`, `scripts/start-hydi.js`,
`boot.config.json`) currently starts this worker, so it is believed dead
today — but that isn't independently verifiable from outside the
operator's real host. See `ISSUES_FOUND.md` #44.

### `pages/api/actions/[id].ts` let anyone bypass ProtoForge's human-review escalation — fixed 2026-07-17

`POST /api/actions/:id` approves or rejects an action ProtoForge specifically escalated for human review before it runs — the whole point of the escalation gate is that a human confirms it. This route had **zero authentication**: any caller could approve (and thereby immediately execute) or reject any pending escalated action. Fixed 2026-07-17 — gated behind `requireAuth('actions:approve')` (owner/operator only). `pages/index.tsx`'s dashboard UI now has a ⚙️ settings panel where the operator enters `HYDI_SERVICE_SECRET` once (stored in `localStorage`, same pattern as the GitHub Pages mobile client); the approve/reject buttons mint an `x-hydi-service-token` client-side via Web Crypto HMAC on each call, verified to match the server's `lib/auth/verifyServiceToken.js` computation exactly. See `ISSUES_FOUND.md` #56.

### `supabase/functions/chat-operator` trusted a client-supplied `user_id` for refund authorization — fixed 2026-07-17

`chat-operator`'s `handleRefund()` checked refund permission and issued real refunds (`issue_refund` RPC) using whatever `user_id` the request body claimed, with **no verification that the caller actually was that user**. Any caller who knew (or guessed) a `user_id` with refund permission could issue refunds in their name. Fixed 2026-07-17 by cross-checking the claimed `user_id` against the real owner returned by `get_session_details(session_id)` — this narrows the gap without requiring the full cryptographic-identity redesign tracked below; the deeper problem (nothing in this codebase yet cryptographically proves a caller's identity end-to-end) remains open. Mitigating context: `chat-operator`'s own backing RPCs (`get_session_details`, `get_user_permissions`, `issue_refund`, etc.) are not part of the tracked `supabase/migrations/` set, so this function is very likely non-functional against the real deployed schema today — but the code-level flaw needed fixing regardless of current reachability, since promoting those RPCs into a real migration later must not also promote this bug. See `ISSUES_FOUND.md` #55.

### Edge Function security audit (2026-07-17) — 15 functions had no explicit `verify_jwt` and no code-level auth check

A full audit of all 42 Supabase Edge Functions against `supabase/config.toml`'s `verify_jwt` table (`ROADMAP.md` P2 #7) found that Supabase's `verify_jwt = true` platform gate only proves *a* validly-signed JWT was presented — the public anon key satisfies that too. 15 functions had no explicit config entry (silently relying on that implicit default) and no code-level check of their own, meaning any caller holding nothing more than the public anon key could invoke functions that retry billing jobs, generate real client payouts, execute whitelisted tools (including `create_invoice`/`pause_subscription`), advance HYDI's state machine, or launch chaos-test runs. Fixed 2026-07-17 — all 15 now check for a service-role Bearer token in code (`supabase/functions/_shared/security.ts`'s `requireServiceRole()`), matching the pattern already established for `stripe-transfer-payout`/`stripe-connect-admin`. `stream-health-watchdog` additionally had a fail-*open* bug (skipped its own auth check entirely if `HYDI_WATCHDOG_KEY` was unset) — fixed to fail closed. None of the 14 functions documented as intentionally public (`verify_jwt = false`, e.g. the marketing-suite stubs) had any rate limiting; all now do, with `notification-service` (real Twilio/SendGrid calls) rate-limited far more tightly given its real cost/spam-relay exposure. Full per-function findings in `ISSUES_FOUND.md`.

### The shared Edge Function auth/rate-limit module had never been tested — two defects found 2026-08-05

`supabase/functions/_shared/security.ts` is the module the 2026-07-17 audit above introduced, and it now gates ~30 of the 45 Edge Functions via `requireServiceRole()` and `rateLimit()`. It shipped with a test file, but that file had **never executed anywhere**: nothing in CI runs Deno, and its first statement imported assertions from a `https://deno.land/std@.../` URL, so it failed at import time — before a single test ran — in any sandboxed or network-restricted environment. Two defects accumulated behind that gap, both fixed 2026-08-05:

- **Unbounded rate-limiter memory growth.** Bucket keys are `name:x-forwarded-for`, and that header is caller-influenced, so a caller can mint a fresh bucket per request. Nothing ever evicted, making the module whose job is absorbing floods a memory-exhaustion vector against the edge isolate. Its Node counterpart `lib/rate-limit.js` explicitly guards the same hazard with a background sweep; that sweep was never carried across. Fixed with request-path eviction (time- **and** size-triggered, since a time-only sweep lets a burst accumulate a full interval of garbage first) under a hard bucket ceiling. Ceiling eviction can return some budget to a key-flooding caller — a documented trade, preferable to OOMing the isolate and taking every route with it.
- **Non-constant-time comparison of the service-role key.** `!==` on strings short-circuits at the first differing byte, leaking guessed-prefix length through response timing. Defense-in-depth rather than a known-exploitable hole — remote timing attacks are noisy — but this comparison guards the service-role key for every privileged Edge Function. Now a constant-time compare (content constant-time; length not hidden, which is fine for a JWT-shaped secret).

The gap itself is closed: assertions moved to `node:assert` (hermetic, a Deno built-in) and `.github/workflows/edge-functions.yml` plus `npm run test:edge` now execute the suite on every change under `supabase/functions/**`. It is scoped to `_shared/` — the other functions import from esm.sh/deno.land at load, so type-checking them needs network egress and would fail the gate on a CDN hiccup rather than a real defect. Widening it is tracked in `ROADMAP.md`. See `ISSUES_FOUND.md` #79-#81.

### Two unhardened duplicates of the `chat-operator` refund handler sat in the deployable tree — archived 2026-08-05

`supabase/functions/chat-operator/` contained three handlers. Supabase deploys a function from its directory's `index.ts`, so `index-new.ts` and `index-deno.ts` were dead code — but dead code carrying a known-fixed vulnerability. The live `index.ts` received both the client-supplied-`user_id` session-ownership check described above and rate limiting; **neither sibling had either control**, leaving a rename or copy-paste between the fixed privilege-escalation bug and production. Both moved to `archive/dead-chat-operator-prototypes/`, with a README recording what must be ported back if either is revived.

Compounding it, `chat-operator-blueprint-summary.md` named `index-new.ts` as *the* chat-operator implementation and credited it with "Conversation ownership verification" — a control that file does not implement — so the blueprint was actively directing implementers at the unhardened variant. Corrected to point at `index.ts`. See `ISSUES_FOUND.md` #82.

### Several parallel, unreachable Stripe implementations exist

Beyond the two webhook handlers and one checkout handler documented as "in
scope" above (now bridged into `pages/api/` and confirmed reachable — see
`DEPLOYMENT.md`), the repo contained several other Stripe checkout/webhook
code paths not part of the confirmed-live `pages/api` surface. **Update
2026-07-19**: `src/webhook-handlers/stripe-webhook.js` (the class-based
handler targeting a `users`/`api_keys` schema) was confirmed fully
orphaned and clearly superseded, and archived to
`archive/superseded-stripe-implementations/` along with the stale
`hydi-monitor-deploy/` sub-deployment — see `ROADMAP.md` item 5 for the
full comparison. `src/api/services/index.js`'s `/subscriptions/checkout` +
`/webhooks/stripe` (the Ursula service-bundle model, per-service metered
execution) was fixed and given real API-key auth 2026-07-19, and
`src/server.js` (which mounts it) was added to `ecosystem.config.js`'s PM2
fleet the same day (app name `hydi-service-bundle`, port 3007) — see
`DEPLOYMENT.md`'s entry-point table. `stripe-webhook-server.js` is not a
separate model — it's a thin wrapper calling the confirmed-live
`api/webhooks/stripe.js` handler directly, so it's out of scope for this
note. This Stripe surface is now in scope for this policy's
Stripe-webhook-signature-bypass reporting alongside the confirmed-live pair
(`api/stripe-connect-webhook.js`, `api/webhooks/stripe.js`); as with the
rest of the PM2 fleet, no sandbox session can confirm the process is
actually running on the real host at any given moment, only that it's
configured to.

### `pages/api/traces.js` and `pages/api/revenue/*.js` were unauthenticated — fixed 2026-07-17

`GET /api/traces` exposed raw RAW EVENT LEDGER payloads (`keymaker_events`) to any caller. `pages/api/revenue/{index,report,leads}.js` (GET) exposed real revenue figures and lead PII; `pages/api/revenue/{index,cycle,leads}.js` (POST) could trigger a real revenue-processing cycle, a real Stripe checkout session, or a real (potentially expensive/external) lead scrape — all with zero authentication. Fixed 2026-07-17 — all five gated behind `requireAuth()` with new `traces:view`/`revenue:view`/`revenue:manage` permissions (see `lib/auth/rbac.js`). See `ISSUES_FOUND.md` #57.

### `supabase/functions/stripe-worker`'s live role is ambiguous — not fixed, needs a maintainer decision

`stripe-worker` performs its own Stripe signature verification (a correct, sufficient gate for a webhook receiver) but has no `verify_jwt` config entry, so the implicit `verify_jwt = true` platform default applies. Real Stripe webhook deliveries never carry a Supabase JWT — if this function is meant to receive them directly, that default would already be silently blocking every real delivery before its own signature check ever runs. It's also invoked internally by `billing-retry-worker` with the service-role key, which does satisfy `verify_jwt = true`. Which of these is the actual live path — and whether `stripe-worker` duplicates the already-public `stripe-webhook` function — needs a maintainer decision (same class of call as the parallel-Stripe-implementations item above), not a guess. Its excessive debug logging (echoing partial webhook-secret material and full request headers to function logs) was cleaned up regardless, since that's safe and correct either way. See `ISSUES_FOUND.md` #58.

## Secret Handling

Secrets must **never** be displayed, echoed, logged, or pasted. Use direct injection:

```bash
# Generate and inject without revealing the value
node -e "require('crypto').randomBytes(32).toString('hex')" | vercel env add SECRET_NAME

# Verify presence only — never reveal the value
vercel env ls | grep SECRET_NAME
```

`SUPABASE_SERVICE_ROLE_KEY` is server-side only and must never be exposed to the browser or included in client-side bundles.

## Security Controls in Place

| Control | Where |
|---------|-------|
| Row-Level Security (RLS) | All Supabase tables |
| Stripe webhook signature validation, with raw-body reading correct for Next.js's `bodyParser: false` semantics | `api/stripe-connect-webhook.js`, `api/webhooks/stripe.js`, `lib/get-raw-body.js` |
| Stripe webhook idempotency (`claim_webhook_event` RPC) | `api/stripe-connect-webhook.js`, `api/webhooks/stripe.js` |
| Checkout + Stripe webhook routes bridged into the confirmed-live `pages/api/**` surface | `pages/api/checkout.js`, `pages/api/stripe-connect-webhook.js`, `pages/api/webhooks/stripe.js` |
| `search_path` pinning on `SECURITY DEFINER` functions | `supabase/migrations/` |
| KILO execution authority blocked unconditionally | `kilo/index.js` — `execute()` throws |
| PolicyEngine fail-closed (default `'reject'`) | `lib/protoforge/policy-engine.js` |
| No hardcoded fallback secrets for HMAC/JWT signing (fail closed if unconfigured) | `supabase/functions/keeper-break-glass{,-simple}`, `workers/SecurityIdentityWorker.js`, `apps/ursula-frontend/runtime/enforcement-boundary/index.js`, `generate-break-glass-jwt.js` |
| Automated secret-pattern scan of every git-tracked file | `tests/unit/no-hardcoded-secrets.test.js` (runs in `npm test`) |
| Service-role Bearer check on privileged Edge Functions, using a constant-time comparison | `supabase/functions/_shared/security.ts` — `requireServiceRole()` |
| Bounded, self-evicting rate limiting on public Edge Functions | `supabase/functions/_shared/security.ts` — `rateLimit()` |
| Deno test + type-check gate for the shared Edge Function security module | `.github/workflows/edge-functions.yml` (`npm run test:edge`) |
| CodeQL static analysis | `.github/workflows/codeql.yml` (scheduled) |
| Governance gate for DB migrations | `.github/workflows/hdi-governance-gate.yml` |

## See also

- [`SECURITY_PROTOCOL.md`](SECURITY_PROTOCOL.md) — secret injection and rotation procedures
- [`GOVERNANCE.md`](GOVERNANCE.md) — decision-making and maintainer responsibilities
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — development guidelines and architecture constraints
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — community standards
