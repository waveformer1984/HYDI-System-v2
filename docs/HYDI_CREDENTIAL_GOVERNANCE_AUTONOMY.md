# HYDI Credential Governance Autonomy

## Overview

This document describes the autonomous credential governance capability that extends HYDI's existing governed-autonomy architecture. The system can now:

> "A credential or external integration becomes unhealthy. I detect it, determine the cause, identify what I am allowed to repair, repair it when authorized, request human authorization only when required, verify the external system, recover from interruption, prevent duplicate effects, record evidence, and update release readiness automatically."

## Architecture

The autonomy system extends — does not duplicate — the existing architecture:

| Component | Role |
|-----------|------|
| `CredentialSource` | Source abstraction (SECURE_LOCAL, PROVIDER_CLI, ENVIRONMENT, EXPLICIT) |
| `LocalSecureCredentialSource` | Windows DPAPI encrypted local credential store |
| `StripeCliSessionManager` | CLI state diagnosis, listener management, human action requests |
| `CredentialGovernanceOrchestrator` | Main autonomy loop: OBSERVE → DIAGNOSE → PLAN → AUTHORIZE → EXECUTE → VERIFY → CERTIFY → RECORD |
| `WebhookSecurityQualificationSuite` | 5 webhook attack tests (valid, modified, invalid, expired, duplicate) |
| `ProviderRotationAdapter` | Stripe rotation adapter with transaction safety |
| `RotationTransactionManager` | Durable rotation transactions with rollback and recovery |
| `CredentialGovernanceDashboard` | Status dashboard (never displays secrets) |
| `CredentialGovernanceChatRouter` | HEIDI chat intent router for operational requests |
| `ReleaseCertificationGenerator` | Evidence-derived release certification |

## Autonomy Loop

```
OBSERVE → DIAGNOSE → PLAN → AUTHORIZE IF REQUIRED → EXECUTE → VERIFY → RECOVER IF NECESSARY → CERTIFY → RECORD
```

1. **OBSERVE**: Discover current credential and integration state
2. **DIAGNOSE**: Identify blockers and classify them
3. **PLAN**: Determine what can be done autonomously vs. what requires authorization
4. **AUTHORIZE**: Check RBAC permissions for sensitive actions
5. **EXECUTE**: Perform autonomous actions (restart CLI, retry probes, etc.)
6. **VERIFY**: Confirm the action succeeded with real evidence
7. **RECOVER**: If execution failed, attempt self-healing or rollback
8. **CERTIFY**: Generate evidence-derived certification
9. **RECORD**: All evidence recorded through EvidenceModel

## Credential Source Priority

```
1. SECURE_LOCAL — encrypted local credential store (Windows DPAPI)
2. PROVIDER_CLI — provider CLI/session credential (e.g., Stripe CLI)
3. ENVIRONMENT — environment variable / .env.local (bootstrap)
4. EXPLICIT — explicitly supplied bootstrap credential
5. UNAVAILABLE — no credential found
```

The system reports which SOURCE was selected without reporting the value.

## Authorization Boundaries

### Autonomous (R0-R2)
- Credential discovery and health checks
- Local diagnostics
- Restart Stripe CLI listener
- Restart webhook listener
- Retry provider probes
- Rerun tests
- Inspect Git history
- Create remediation plans
- Validate test credentials
- Execute reversible local actions

### Requires Authorization (R3-R4)
- Production credential rotation
- Revocation of active live credentials
- Changes to production Stripe configuration
- Destructive Git history rewriting
- Live financial operations

### Prohibited (R5)
- Autonomous live Stripe financial testing
- Autonomous destructive Git history rewrite
- Fabricating external test results
- Bypassing RBAC
- Storing raw credential values

## Self-Healing

| Blocker | Autonomous Action |
|---------|-------------------|
| Stripe CLI not running | Restart listener |
| Webhook listener died | Restart listener |
| Provider unavailable | Retry with bounded backoff |
| Stripe CLI expired | Diagnose → create human action request |
| Test process crashed | Recover durable state → resume |

## Event-Driven Blocker Reevaluation

When any of these changes:
- Credential added/rotated/becomes valid
- Stripe CLI authenticated
- Webhook secret acquired
- Service starts
- Provider becomes reachable

HYDI automatically reevaluates dependent blockers. No manual restart required.

## Rotation Transaction Safety

```
PREPARE → ACQUIRE_NEW → VERIFY_NEW → STAGE → SWITCH → HEALTH_CHECK
→ VERIFY_PROVIDER → REVOKE_OLD → VERIFY_OLD_INVALID → CERTIFY
```

If anything fails before old-key revocation: **ROLLBACK**
If old key has been revoked and verification fails: **ESCALATE**

Every rotation has a unique `operationId` and durable state. If HYDI restarts during rotation, it recovers the transaction rather than starting over.

## Chat Operations

HEIDI understands:
- "Run Stripe qualification."
- "Check Stripe credentials."
- "Why is Stripe blocked?"
- "Fix the Stripe blocker."
- "Rotate the exposed Stripe credential."
- "Verify the old credential is dead."
- "Run the full release qualification."
- "What still requires me?"
- "Continue the interrupted credential rotation."
- "Show dashboard."

Responses reflect real state — not keyword-only fake responses.

## No-False-Green Enforcement

| Condition | Result |
|-----------|--------|
| No credential | BLOCKED |
| Placeholder credential | BLOCKED |
| 401 credential | BLOCKED/INVALID |
| Expired CLI | BLOCKED |
| Unauthenticated CLI | HUMAN_REQUIRED |
| No webhook listener | BLOCKED |
| Webhook signature failure | FAIL |
| No Stripe event received | FAIL |
| Mock event only | SIMULATED |
| Internal test only | INTERNAL_VERIFIED |
| Real Stripe event | EXTERNAL_VERIFIED |
| Duplicate real event | IDENTITY VERIFIED |
| Credential rotation interrupted | RECOVERABLE |
| Credential rotation unauthorized | DENIED |

## Production Safety

- `STRIPE_MODE=LIVE` → autonomous E2E financial operations refused → `PROHIBITED_BY_POLICY`
- Production credential health checks: read-only
- Production credential rotation: requires explicit owner authorization
- Historical live-secret exposure: immediate high-priority remediation

## Release Certification

The certification is derived from evidence — not manually editable.

```
Credential Governance: PASS
Credential Sources: PASS
Stripe Test Credential: PROVIDER_VERIFIED
Stripe CLI: VERIFIED
Webhook Signature: EXTERNAL_VERIFIED
Real Stripe E2E: EXTERNAL_VERIFIED
Duplicate Delivery: VERIFIED
Job Activation: EXACTLY_ONCE
Revenue Ledger: EXACTLY_ONCE
RBAC: VERIFIED
Historical Secrets: REMEDIATED / REMAINING
Self-Repair: VERIFIED
Crash Recovery: VERIFIED
No-False-Green: VERIFIED
Release Gates: X/X
Remaining Blockers: NONE
Recommendation: READY
```

A human cannot manually edit a certification from BLOCKED to PASS.
