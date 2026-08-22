# Adaptive Operator Production Integration

## Overview

The AdaptiveOperator (`lib/adaptive-operator/`) is now wired into the
running HYDI system through `HeidiOrchestrator.startWorkSession()`,
behind the `ADAPTIVE_OPERATOR_ENABLED` feature flag. When the flag is
off, the existing LLM-decompose-then-run-step-by-step path runs
unchanged. When on, multi-step goals are delegated to AdaptiveOperator,
which observes the real environment, generates a reality-driven plan,
executes through the governed HumanActionEngine, verifies outcomes, and
replans on deviations.

## Entry Points Rerouted

| Entry point | File | Rerouted? | When |
|-------------|------|-----------|------|
| `HeidiOrchestrator.startWorkSession()` | `lib/orchestrator.ts:1270` | **Yes** — delegates to AdaptiveOperator | `ADAPTIVE_OPERATOR_ENABLED=true` |
| `POST /api/goals` | `pages/api/goals/route.ts` | **New route** — calls `startWorkSession()` | Always available; uses AdaptiveOperator when flag is on |
| `POST /api/goals` (Express) | `api/goals/index.js` | **New route** — same as above | Same |
| `HeidiOrchestrator.executeActions()` | `lib/orchestrator.ts:834` | **No** — atomic actions, not goals | N/A |
| `runHeidiAgentStream()` | `lib/heidi-agent.ts:102` | **No** — LLM tool-use loop, atomic | N/A |
| `resolvePendingAction()` | `lib/action-approval.ts:86` | **No** — single escalated action | N/A |

**Rationale:** AdaptiveOperator sits above HumanActionEngine for
multi-step *goals*. Single atomic actions (chat-originated tool calls,
escalated action approvals) stay on the existing paths — they don't
need observation, planning, or replanning.

## Feature Flag

```
ADAPTIVE_OPERATOR_ENABLED=false   # default in production
ADAPTIVE_OPERATOR_ENABLED=true    # enable per-environment
```

- **Default:** `false` in production, `true` in test (`NODE_ENV=test`)
- **Per-environment:** Set the env var in `.env.local`, Vercel env vars,
  or PM2 ecosystem config
- **Roll forward:** Set `ADAPTIVE_OPERATOR_ENABLED=true` and restart
- **Roll back:** Set `ADAPTIVE_OPERATOR_ENABLED=false` (or unset) and
  restart. The orchestrator falls back to the legacy
  LLM-decompose path immediately. No data migration needed.

### Override limits (optional)

```
ADAPTIVE_OPERATOR_MAX_ACTIONS=20       # max actions per goal
ADAPTIVE_OPERATOR_MAX_REPLANS=3        # max replans before escalation
ADAPTIVE_OPERATOR_MAX_RETRIES=3        # max retries per objective
ADAPTIVE_OPERATOR_MAX_TIME_MS=600000   # max execution time (10 min)
ADAPTIVE_OPERATOR_MAX_RISK=R2          # max risk level (R2 = policy_authorized)
ADAPTIVE_OPERATOR_MAX_SIDE_EFFECTS=3   # max external side effects
ADAPTIVE_OPERATOR_MAX_AUTH_REQUESTS=3  # max authorization requests
```

**Not overridable:**
- `maxDestructiveActions` is always `0` (AutonomyContract prohibits
  destructive operations autonomously)
- `maxFinancialExposure` is always `0` (AutonomyContract prohibits
  financial actions autonomously)

## Production Autonomy Bounds

Limits are pulled from existing HYDI governance config, not invented:

| Bound | Value | Source |
|-------|-------|--------|
| `maxActionsPerPlan` | 20 | 4x orchestrator's `maxSteps=5` default |
| `maxReplans` | 3 | SelfRepairEngine flapping threshold (3 repairs / 10 cycles) |
| `maxRetries` | 3 | SelfRepairEngine flapping threshold |
| `maxExecutionTimeMs` | 600,000 (10 min) | Tighter than 30-min qualification default |
| `maxRisk` | R2 | AutonomyContract: autonomous ceiling is R1, R2 = policy_authorized, R3+ requires human |
| `maxExternalSideEffects` | 3 | Conservative — emails, API calls to third parties |
| `maxDestructiveActions` | 0 | AutonomyContract prohibits destructive DB ops autonomously |
| `maxAuthorizationRequests` | 3 | Escalate after 3 auth requests |
| `maxFinancialExposure` | 0 | AutonomyContract prohibits financial actions autonomously |

See `lib/adaptive-operator/ProductionBounds.ts` for the implementation.

## Observability

AdaptiveOperator events are logged through the existing
`lib/structured-logger.js` (with automatic secret redaction) and
`ActionJournal`:

| Event | Log level | Example |
|-------|-----------|---------|
| Goal received | INFO | `AdaptiveOperator goal received {goal, sessionId, bounds}` |
| Observation recorded | DEBUG | `Observation recorded {key, category, confidence}` |
| Replan triggered | WARN | `Replan triggered {goalId, reason, newPlanVersion, objectiveCount}` |
| Human intervention required | WARN | `Human intervention required {interventionType, actionId, reason}` |
| Goal completed | INFO | `Goal completed {goalId, status, summary}` |
| Goal execution finished | INFO | `Goal execution finished {goalId, status, actionsExecuted, replans, budget}` |

Enable debug logging:
```
DEBUG_ADAPTIVE_OPERATOR=true
```

The ActionJournal writes to
`.hydi-operational/adaptive-operator-journal.jsonl` with secrets
redacted.

## Integration Architecture

```
POST /api/goals
  → HeidiOrchestrator.startWorkSession(goal, sessionId, userId)
    → if ADAPTIVE_OPERATOR_ENABLED:
        → executeGoalViaAdaptiveOperator()
          → build HumanActionEngine with real adapters
          → build AdaptiveOperator with production bounds
          → wire observability callbacks
          → operator.executeGoal(goal)
            → OBSERVE → PLAN → EXECUTE → VERIFY → REPLAN → COMPLETE/ESCALATE
          → convert GoalExecutionResult → WorkSession
          → persist to Supabase work_sessions table
      else:
        → LLM decompose goal into steps
        → runWorkSession() — execute steps one-by-one
        → stop on first failure (no replanning)
```

## E2E Integration Test

```
npx tsx scripts/e2e-adaptive-operator-integration.ts
```

This test exercises the REAL integration path
(`HeidiOrchestrator.startWorkSession()` → AdaptiveOperator) against a
disposable staging target with an intentionally bad endpoint. It
verifies:

1. The plan reflects actually-observed state (not canned)
2. At least one deviation is handled via replanning
3. CompletionEvaluator's predicate gates "done"

**Latest result:** PASS — 7 actions, 3 replans, bounded escalation
after max replans reached. The plan changed versions (1→2→3→4) because
reality changed (endpoint not healthy).

## Files Changed

| File | Change |
|------|--------|
| `lib/adaptive-operator/ProductionBounds.ts` | **New** — production autonomy bounds from existing config |
| `lib/adaptive-operator/AdaptiveOperatorIntegration.ts` | **New** — integration bridge: orchestrator → AdaptiveOperator |
| `lib/adaptive-operator/index.ts` | Export ProductionBounds |
| `lib/adaptive-operator/FailureClassifier.ts` | Fix: `destructiveActions >= 0` false-positive budget exhaustion |
| `lib/orchestrator.ts` | Wire `startWorkSession()` to AdaptiveOperator behind flag |
| `pages/api/goals/route.ts` | **New** — API route for multi-step goals |
| `api/goals/index.js` | **New** — Express-compatible route |
| `scripts/e2e-adaptive-operator-integration.ts` | **New** — E2E integration test |

## Known Limitations

- The DynamicPlanner's goal-to-objective mapping uses keyword matching,
  not NLU. Complex goals may map to the wrong template.
- The `ENDPOINT_VERIFIED` template uses the goal's context (first URL
  found in the goal statement) as the health check target. Goals
  without a URL default to `http://localhost:3000/api/health`.
- The `CREDENTIALS_READY` objective generates a credential check intent,
  but the production integration does not register a `CredentialAdapter`
  (credentials are managed through the existing KeyManagementService).
  This objective will be blocked, which is correct — credential
  operations require human authorization per AutonomyContract.
- Supabase persistence of AdaptiveOperator work sessions requires
  `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to be configured. If
  absent, the work session is returned but not persisted (logged as a
  warning, not an error).
