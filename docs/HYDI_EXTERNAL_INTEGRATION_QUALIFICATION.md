# HYDI External Integration Qualification

## Overview

External integration qualification proves that HYDI's integrations with external providers (Stripe, Supabase, etc.) actually work — not just that the code compiles or that credentials exist.

## Evidence Verification Levels

| Level | Meaning | Satisfies E2E Gate? |
|-------|---------|---------------------|
| `VERIFIED_EXTERNAL` | Proven against real external provider API | Yes |
| `VERIFIED_INTERNAL` | Proven against internal state (DB, files, logs) | No |
| `SIMULATED` | Produced by test fixture, mock, or simulation | No |
| `BLOCKED` | Could not be performed; blocker recorded | No |
| `UNAVAILABLE` | External dependency unavailable | No |
| `UNKNOWN` | Verification not yet performed | No |

**CRITICAL:** A SIMULATED result NEVER satisfies a release gate requiring EXTERNAL_VERIFIED. This is enforced at the data-model level.

## Stripe E2E Qualification Orchestrator

The `StripeE2EOrchestrator` orchestrates a real Stripe test-mode end-to-end flow:

1. Verify Stripe configuration (credential discovery)
2. Verify test mode (Level 3 probe — real API call)
3. Verify webhook secret present
4. Verify endpoint reachability
5. Verify Stripe CLI forwarding
6. Create a real test-mode Checkout Session
7. Complete the test transaction (Stripe test payment details)
8. Receive the real webhook
9. Verify signature acceptance
10. Verify event idempotency
11. Verify exactly-one job activation
12. Verify exactly-one ledger entry
13. Verify artifact pipeline progression
14. Verify awaiting_review state
15. Verify human approval gate
16. Verify delivery
17. Verify evidence persistence
18. Verify restart/recovery behavior
19. Verify cleanup
20. Certify external provider evidence separately

### Idempotency and Resume

The orchestrator is idempotent. If it crashes halfway through, it inspects existing state and resumes rather than creating duplicate checkout sessions. Each step records a checkpoint.

### No-False-Green Enforcement

If valid credentials are unavailable → `BLOCKED` (never PASS)
If Stripe CLI is unavailable → `BLOCKED`
If webhook forwarding fails → `BLOCKED`
If the webhook never arrives → `BLOCKED`
If the ledger write fails → `FAIL`
If job activation fails → `FAIL`

### Automatic Unblock Detection

When valid Stripe test credentials become available, the orchestrator automatically detects that the previous blocker has changed and transitions from `BLOCKED` to `READY_TO_EXECUTE` without requiring code modification.

```typescript
const orchestrator = getStripeE2EOrchestrator();
const unblocked = await orchestrator.checkIfUnblocked();
if (unblocked) {
  // Can now run the full E2E test
  await orchestrator.run({ mode: 'human_authorized', actor: 'owner', role: 'owner' });
}
```

## Current Status

**Stripe Real E2E: BLOCKED**

Reason: Valid Stripe test-mode credential required. The available credential in `.env.local` is a placeholder returning HTTP 401.

This is an operational state, not a code path. When a valid credential is provided, the orchestrator will automatically transition to `READY_TO_EXECUTE`.

## Webhook Security Qualification

The webhook security tests verify:

| Test | Expected Result |
|------|----------------|
| Valid signature | 200 (accepted) |
| Invalid signature | 400 (rejected) |
| Missing signature | 400 (rejected) |
| Modified payload | 400 (rejected) |
| Expired timestamp | 400 (rejected) |
| Duplicate event | Idempotent (no duplicate financial state) |
| Same event through multiple paths | Exactly one business effect |

Stripe signature verification uses:
- `getRawBody(req)` — raw body integrity
- `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` — cryptographic verification
- Default 5-minute replay tolerance

## Release Gate Integration

| Gate | Name | Description |
|------|------|-------------|
| G16 | Credential health | All release-required credentials must be VALIDATED |
| G17 | External integration | Required external integrations must be EXTERNALLY_VERIFIED |
| G18 | Secret exposure | No unresolved high-severity active credential exposure |
| G19 | Authorization integrity | All sensitive actions must use canonical RBAC |
| G20 | Evidence integrity | Every PASS must have verifiable evidence (no false greens) |

G17 reports `ENVIRONMENTAL` (not FAIL) when credentials are unavailable — this is an operational blocker, not a code defect. However, it never reports PASS without real external verification.
