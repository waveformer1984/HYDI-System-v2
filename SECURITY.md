# Security Policy

## Supported Versions

HYDI System v2 is a continuously deployed platform. Security fixes are applied to the **`clean-main`** branch and deployed immediately. There are no separately versioned release lines — always use the latest commit on `clean-main`.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities by email to **waveformer1984@gmail.com** with the subject line `[SECURITY] HYDI System v2 — <brief description>`. Include:

- A description of the vulnerability and the affected component
- Steps to reproduce or a proof-of-concept (safe / non-destructive only)
- Potential impact assessment
- Any suggested remediation

You can expect an acknowledgement within **48 hours** and a status update within **7 days**. We will coordinate a fix and disclosure timeline with you before making anything public.

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
| Stripe webhook signature validation | `api/stripe-connect-webhook.js`, `api/webhooks/stripe.js` |
| `search_path` pinning on `SECURITY DEFINER` functions | `supabase/migrations/` |
| KILO execution authority blocked unconditionally | `kilo/index.js` — `execute()` throws |
| PolicyEngine fail-closed (default `'reject'`) | `lib/protoforge/policy-engine.js` |
| CodeQL static analysis | `.github/workflows/codeql.yml` (scheduled) |
| Governance gate for DB migrations | `.github/workflows/hdi-governance-gate.yml` |
