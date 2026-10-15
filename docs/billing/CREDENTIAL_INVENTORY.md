# Billing credential inventory & revocation matrix (Phase 3)

## Threat model (summary)

Billing customer routes must resolve **one tenant** from **independently validated** credentials. Revoking path A must not assume path B is revoked. Attackers may reuse cookies, bearers, or device tokens after operator offboarding unless each path is explicitly revoked and revalidated.

## Credential inventory

| Credential | Issuance | Validation | Tenant resolution | Revocation | Propagation | Billing access | Audit |
|------------|----------|------------|-------------------|------------|-------------|------------------|-------|
| Supabase Auth session (cookie) | `signup`/`signin` routes | `createBillingSupabaseServer` → `getUser()` | **Only** via active `billing_tenant_members` | Membership `status=revoked`; optional admin `signOut(user, global)` | Next HTTP request (membership); session cookie may persist until expiry/signOut | Yes, with active membership | `membership.*` |
| Legacy hbc1 bearer | `issueCustomerToken` / admin tenants | `verifyCustomerToken` + **revocation store** (Phase 3) | Payload `t` after verify | Per-token nonce revoke; tenant `min_valid_iat` emergency | Next request | Yes, if not revoked | `legacy.token.revoked` |
| Walkie device HMAC | Device registration | `verifyDeviceRequest` | **Only** with `billing_walkie_tenant_bindings` row | Delete binding (+ audit) | Next request | Yes, with binding | `walkie.binding.*` |
| Active membership row | Signup / admin | `getActiveMembershipForUser` | Row `tenant_id` | `status=revoked` | Next request | Indirect (session path) | `membership.*` |
| HYDI service token | Operator mint | `requireAuth` / `requireBillingAdmin` | N/A (operator RBAC) | Rotate `HYDI_SERVICE_SECRET` | Immediate for new requests | Admin only | `billing_audit_events` |
| Device token (non-billing) | Pairing | `devices` table | RBAC role, not billing tenant | Device `status=revoked` | Next request | No (unless binding exists) | `auth_audit_log` (caller) |
| Stripe webhook signature | Stripe | Provider HMAC | Event metadata | N/A (ingress) | N/A | Post-payment state only | `billing_webhook_events` |

## Revocation matrix (independence)

| After action | Session cookie | Legacy hbc1 | Walkie billing | Membership |
|--------------|----------------|-------------|----------------|------------|
| Revoke membership | Cookie may remain; **billing denied** | Unchanged unless revoked | Unchanged | **revoked** |
| Revoke legacy nonce | N/A | **denied** | N/A | N/A |
| Tenant legacy floor (`min_valid_iat`) | N/A | **all older iat denied** | N/A | N/A |
| Revoke walkie binding | N/A | N/A | **denied** | N/A |
| Global Supabase signOut | **Sessions cleared** (if admin API succeeds) | N/A | N/A | Membership unchanged |

## Invariants

1. Protected billing routes call `requireCustomer` → fresh membership/binding/legacy checks every request.
2. Auth session ≠ billing authorization (`GET /api/billing/auth/session` may show `authenticated: true`, `tenant_id: null`).
3. Legacy path disabled when `BILLING_LEGACY_CUSTOMER_TOKEN=false` (fail closed for legacy).
4. Offboarding never trusts client-supplied tenant without server resolution from membership/device rows.
