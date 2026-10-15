# Billing customer identity (Phase 2 — A+B)

**Owner decision:** Supabase Auth for members **plus** explicit Walkie device→tenant bindings for owner workflow. Walkie pairing alone does **not** grant billing access.

## Modes (priority order)

1. **Supabase session** (`BILLING_SUPABASE_AUTH` not `false`) — cookie session → `billing_tenant_members` → tenant id.
2. **Walkie owner binding** — approved `x-hydi-device-token` **and** row in `billing_walkie_tenant_bindings`.
3. **Legacy customer token** (`BILLING_LEGACY_CUSTOMER_TOKEN` not `false`) — `Authorization: Bearer hbc1…` (interim, deprecation window).

Tenant id is **never** taken from the request body or query.

## Env flags

| Variable | Default behaviour |
|----------|-------------------|
| `BILLING_SUPABASE_AUTH` | enabled unless `false` |
| `BILLING_LEGACY_CUSTOMER_TOKEN` | enabled unless `false` |

## API

| Route | Purpose |
|-------|---------|
| `POST /api/billing/auth/signup` | email/password + tenant_name → user + tenant + owner membership |
| `POST /api/billing/auth/signin` | password sign-in (cookies) |
| `POST /api/billing/auth/signout` | clear session |
| `GET /api/billing/auth/session` | `{ authenticated, tenant_id?, role? }` |
| `POST /api/billing/admin/walkie-bindings` | operator binds device_id → tenant_id (confirm + reason) |

## Migration

`20261015140000_billing_tenant_identity.sql` — `billing_tenant_members`, `billing_walkie_tenant_bindings`.

Membership changes append to `billing_audit_events`.
