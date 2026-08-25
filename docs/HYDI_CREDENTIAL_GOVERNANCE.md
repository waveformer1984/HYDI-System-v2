# HYDI Credential Governance

## Overview

HYDI's credential governance capability provides autonomous, governed management of external credential lifecycles. It integrates with HYDI's existing governed-autonomy architecture — it does not create a parallel system.

## Architecture

The credential governance system extends these existing components:

| Component | Role |
|-----------|------|
| `CredentialStateMachine` | Explicit lifecycle: DISCOVERED → CLASSIFIED → VALIDATED → HEALTHY (or INVALID/EXPIRED/REVOKED/EXPOSED/ESCALATED/BLOCKED) |
| `EvidenceModel` | Evidence records with verification levels: VERIFIED_EXTERNAL, VERIFIED_INTERNAL, SIMULATED, BLOCKED, UNAVAILABLE, UNKNOWN |
| `StripeCredentialProviderAdapter` | Provider-specific Stripe credential classification, probing, and rotation planning |
| `HistoricalSecretRemediationTracker` | Git history scanning and durable remediation tracking |
| `CredentialGovernanceStatusReporter` | Self-diagnostic status and natural language question answering |
| `StripeE2EOrchestrator` | Real Stripe test-mode E2E qualification with no-false-green enforcement |
| `requireAuth` + RBAC | Authorization using existing `credentials:rotate`, `credentials:view`, `credentials:probe`, `credentials:remediate`, `credentials:e2e:qualify` permissions |
| `BlockerResolutionEngine` | Existing blocker classification (MISSING_EXTERNAL_CREDENTIAL) |
| `SelfRepairEngine` | Existing governed self-repair loop |
| `SecretScanner` | Existing working-tree secret scanning |
| `StructuredLogger` | Existing redaction (sk_live_, sk_test_, rk_live_, whsec_, JWT, PEM, Bearer) |

## Credential State Machine

```
DISCOVERED → CLASSIFIED → VALIDATED → HEALTHY
                ↓
            INVALID (placeholder, malformed, API rejected)
            EXPIRED
            REVOKED
            EXPOSED (found in logs/history/git)
            BLOCKED (external dependency missing)

ROTATION_REQUIRED → ROTATION_PENDING_AUTHORIZATION → ROTATING → ROTATED → HEALTHY
                                                                    ↓
                                                            VERIFICATION_FAILED

EXPOSED → ISOLATED → ROTATION_REQUIRED → ...
ESCALATED (human action required)
```

### Legal Transitions

The state machine rejects illegal transitions. A credential cannot silently move from INVALID to HEALTHY — it must go through the full rotation path.

### Sensitive Transitions

These transitions require `policy_authorized` or `human_authorized` authorization:
- `ROTATING`
- `ROTATED`
- `ISOLATED`
- `REVOKED`

Autonomous mode is rejected for these transitions.

## Placeholder Detection

A credential value is classified as a placeholder if it matches any of:
- Keys ending in `0000` (e.g., `sk_test_...0000`)
- Literal `placeholder`, `example`, `your_key`, `change_me`, `replace_me`
- Malformed lengths
- Known fixture values
- `<...>` patterns

**Presence is not validity.** A placeholder credential is immediately transitioned to INVALID.

## Layered Credential Probes

| Level | Name | Description | Authorization |
|-------|------|-------------|---------------|
| 0 | presence | Check if credential exists in environment | autonomous |
| 1 | format | Check prefix, placeholder patterns, malformed values | autonomous |
| 2 | local_config | Verify credential is in expected configuration location | autonomous |
| 3 | provider_api | Call provider API (e.g., Stripe /v1/balance) | autonomous for test, authorized for live |
| 4 | controlled_test | Create/delete a test resource | policy_authorized |
| 5 | external_e2e | Full external E2E qualification | human_authorized (owner) |

A capability may not be marked READY merely because an environment variable is present.

## RBAC Permissions

| Permission | owner | operator | agent | viewer |
|------------|-------|----------|-------|--------|
| `credentials:view` | ✓ | ✓ | ✗ | ✓ |
| `credentials:probe` | ✓ | ✓ | ✗ | ✗ |
| `credentials:rotate` | ✓ | ✓ (test only) | ✗ | ✗ |
| `credentials:rotate:test` | ✓ | ✓ | ✗ | ✗ |
| `credentials:remediate` | ✓ | ✓ | ✗ | ✗ |
| `credentials:e2e:qualify` | ✓ | ✓ | ✗ | ✗ |

Production/live credential rotation requires owner authorization.

## No Raw Secrets

The system NEVER stores raw credential values in:
- Logs
- Database audit records
- Qualification reports
- Git
- Telemetry
- Error messages
- Incident descriptions
- Chat transcripts

Only safe metadata is stored:
- Credential type, provider, fingerprint (SHA-256, first 16 chars), prefix
- Expiration, lifecycle state, source/configuration location
- Dependent capability, rotation status, verification status
- Timestamps, correlation IDs

## Integration Points

The credential governance capability integrates with:
- `CapabilityHealthManager` — capability health aggregation
- `BlockerResolutionEngine` — blocker classification (MISSING_EXTERNAL_CREDENTIAL)
- `SelfRepairEngine` — governed self-repair
- `ActionRegistry` — bounded recovery actions
- `AutonomyPolicyModel` — deterministic policy evaluation
- `PolicyDecisionRecordStore` — durable decision records
- `requireAuth` + RBAC — authorization
- `auth_audit_log` — audit trail
- `SecretScanner` — working-tree scanning
- `StructuredLogger` — redacted logging
- Release gate (G16-G20) — qualification gates
