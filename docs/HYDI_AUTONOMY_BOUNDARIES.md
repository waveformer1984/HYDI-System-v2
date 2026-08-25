# HYDI Autonomy Boundaries

## Overview

HYDI's governed-autonomy architecture defines explicit boundaries for what the system can do autonomously, what requires authorization, and what is prohibited. The credential governance capability operates within these boundaries.

## Autonomy Levels

| Level | Name | Description | Authorization |
|-------|------|-------------|---------------|
| R0 | Observe only | Read-only health checks, diagnostics | Autonomous |
| R1 | Read-only diagnosis | Probe credentials, check configuration | Autonomous |
| R2 | Reversible local actions | Restart service, retry probe, restart Stripe CLI | Autonomous (policy-governed) |
| R3 | Authorized external/test actions | Create Stripe test Checkout Session, manipulate test-mode resources | Policy authorized |
| R4 | Production credential/security changes | Rotate production credentials, revoke live credentials | Owner authorization |
| R5 | Prohibited by default | Autonomous live financial transactions, destructive Git history rewrite, irreversible production security changes without authorization | Always prohibited |

## Credential Governance Action Boundaries

### Autonomous (R0-R2)

- Discover credential references in environment
- Classify credential type and environment (test/live)
- Detect placeholders and malformed values
- Run Level 0-2 probes (presence, format, local config)
- Run Level 3 probe for TEST-mode credentials
- Detect webhook secret configuration
- Scan Git history for exposed secrets
- Track remediation status
- Generate rotation plans
- Restart expired Stripe CLI process
- Restart webhook listener
- Retry provider health probe
- Rerun failed qualification

### Policy Authorized (R3)

- Run Level 3 probe for LIVE-mode credentials
- Run Level 4 probe (controlled test operation)
- Create Stripe test Checkout Session
- Manipulate test-mode Stripe resources
- Run full Stripe E2E qualification (test mode)

### Owner Authorized (R4)

- Rotate production credentials
- Revoke live credentials
- Modify production Stripe settings
- Execute credential rotation (live mode)
- Approve remediation of critical historical secrets

### Prohibited (R5)

- Autonomous live financial transactions
- Autonomous destructive Git history rewrite
- Autonomous irreversible production security changes without authorization
- Fabricating external test results
- Bypassing RBAC
- Storing raw credential values

## Authorization Model

Authorization uses the existing canonical RBAC system (`requireAuth` + `lib/auth/rbac.js`):

| Permission | owner | operator | agent | viewer |
|------------|-------|----------|-------|--------|
| `credentials:view` | ✓ | ✓ | ✗ | ✓ |
| `credentials:probe` | ✓ | ✓ | ✗ | ✗ |
| `credentials:rotate` | ✓ | ✓ (test only) | ✗ | ✗ |
| `credentials:remediate` | ✓ | ✓ | ✗ | ✗ |
| `credentials:e2e:qualify` | ✓ | ✓ | ✗ | ✗ |

No shared-secret mechanism is created. All authorization flows through the existing RBAC.

## State Machine Authorization

The credential state machine enforces authorization at the transition level:

- `ROTATING` transition requires `policy_authorized` or `human_authorized`
- `ROTATED` transition requires `policy_authorized` or `human_authorized`
- `ISOLATED` transition requires `policy_authorized` or `human_authorized`
- `REVOKED` transition requires `policy_authorized` or `human_authorized`

Autonomous mode is rejected for these transitions with: `Unauthorized: transition to X requires policy_authorized or human_authorized, got autonomous`

## No-False-Green Enforcement

The system cannot claim success when:
- Credentials are missing → BLOCKED
- Credentials are placeholders → BLOCKED
- Credentials are invalid (401) → FAIL
- Provider API is unreachable → BLOCKED
- External verification was never performed → cannot report VERIFIED_EXTERNAL
- Evidence is SIMULATED → cannot satisfy EXTERNAL_VERIFIED gate

## Confidence vs Authorization

Confidence is distinct from authorization. A system may have high confidence that a rotation is safe, but still require human authorization because the action is irreversible or has external side effects.

## Escalation

When HYDI cannot resolve a blocker autonomously, it escalates:
1. Records the blocker with full evidence
2. Records all autonomous actions attempted
3. Records the required human action
4. Transitions the credential to ESCALATED state
5. Makes the blocker visible through the status API

The escalation is durable — it survives restarts via the PolicyDecisionRecordStore.
