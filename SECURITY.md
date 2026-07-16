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

### Integration tests require live credentials

`npm run test:integration` requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment. These must never be committed or logged. See `SECURITY_PROTOCOL.md` for the secret-handling protocol.

### `workers/SecurityIdentityWorker.js` must not be wired into a real auth path

`processAuthentication()` currently simulates a successful authentication for
any submitted email with no credential check at all (its own comment says
so). The hardcoded fallback JWT secret this worker used to sign/verify with
was fixed 2026-07-15 (it now fails closed if `JWT_SECRET` is unset), but the
auth-always-succeeds stub is untouched and unrelated to that fix. No startup
path in this repo (`package.json` scripts, `ecosystem.config.js`,
`scripts/start-hydi.js`, `boot.config.json`) currently starts this worker,
so it is believed dead today — but that isn't independently verifiable from
outside the operator's real host. **Do not enqueue `auth.attempt` tasks to
the `security_identity` queue in production until real credential
verification is implemented.** See `ISSUES_FOUND.md` #44.

### Several parallel, unreachable Stripe implementations exist

Beyond the two webhook handlers and one checkout handler documented as "in
scope" above (now bridged into `pages/api/` and confirmed reachable — see
`DEPLOYMENT.md`), the repo contains at least three other Stripe
checkout/webhook code paths that are **not** part of the confirmed-live
`pages/api` surface: `src/webhook-handlers/stripe-webhook.js` (a
class-based handler targeting a different `users`/`api_keys` schema),
`src/api/services/index.js`'s `/subscriptions/checkout` +
`/webhooks/stripe` (mounted into the separate, unclear-reachability
Express server at `src/server.js`), and the standalone
`stripe-webhook-server.js` micro-server (not referenced by any
`package.json` script). None of these are covered by this policy's
Stripe-webhook-signature-bypass scope unless/until a maintainer confirms
one of them is actually live — report against the confirmed-live pair
(`api/stripe-connect-webhook.js`, `api/webhooks/stripe.js`) unless you have
independent evidence one of the others is deployed.

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
| CodeQL static analysis | `.github/workflows/codeql.yml` (scheduled) |
| Governance gate for DB migrations | `.github/workflows/hdi-governance-gate.yml` |

## See also

- [`SECURITY_PROTOCOL.md`](SECURITY_PROTOCOL.md) — secret injection and rotation procedures
- [`GOVERNANCE.md`](GOVERNANCE.md) — decision-making and maintainer responsibilities
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — development guidelines and architecture constraints
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — community standards
