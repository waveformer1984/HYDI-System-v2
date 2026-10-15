# Billing identity lifecycle (Phase 2 — A+B)

## Design decisions (2026-10-15)

### Walkie “pending” binding state

**Decision: no pending row in `billing_walkie_tenant_bindings`.**

Pairing registers/approves a device in `devices`; billing access requires an operator to create an explicit binding row. Until that POST succeeds, Walkie requests behave as “no binding” (401 on customer routes). A separate pending state would duplicate device approval semantics and is not required for the product model chosen in Phase 2.

### Revoking device-to-tenant bindings

**Decision: delete the binding row (hard revoke) with operator audit.**

- API: `POST /api/billing/admin/walkie-bindings` with `{ op: 'revoke', device_id, tenant_id, reason, confirm: true }`.
- Permission: `billing:tenants:manage`.
- Effect: **next request** — `getWalkieBinding` returns null; customer resolver no longer grants tenant from that device. Device HMAC may still authenticate for non-billing routes; billing is fail-closed without a binding.
- Cross-tenant rebind: still rejected with 409 unless the device is revoked first (no silent transfer).

### Revoking or reactivating memberships

**Decision: soft revoke via `billing_tenant_members.status = 'revoked'`.**

- API: `POST /api/billing/admin/memberships` with `{ op: 'revoke' | 'reactivate', tenant_id, auth_user_id, reason, confirm: true }`.
- Active membership lookup filters `status = 'active'` only.
- Effect: **next request** — Supabase session may still exist, but `resolveCustomerIdentity` no longer maps the user to a tenant (falls through to Walkie/legacy or 401). Operators should treat session cookies as orthogonal to billing authorization.

### Sessions and credentials after revocation

| Credential | After membership revoke | After walkie binding revoke |
|------------|-------------------------|-----------------------------|
| Supabase session cookie | Still valid for Auth; billing routes deny unless legacy/Walkie | N/A |
| Legacy hbc1 token | **Revoke via nonce or tenant `min_valid_iat` floor** (Phase 3) | N/A |
| Device token | N/A | Still valid for device auth; billing denied without binding |

### Audit

All bind/revoke/reactivate operations append to `billing_audit_events` with actor, reason, before/after snapshots (no secrets).

### Concurrency

Bind and revoke are last-write-wins at the database layer (`UNIQUE (device_id)` on bindings; membership unique on `(tenant_id, auth_user_id)`). Operators must serialize conflicting bind/revoke for the same device through normal change control; 409 on conflicting rebind is intentional.
