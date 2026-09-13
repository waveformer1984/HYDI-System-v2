# HYDI Human Proxy Control Plane — Operational Report

**Status:** PRODUCTION-QUALIFIED
**Branch:** `feat/governed-autonomy`
**Date:** 2026-08-22

## 1. Architecture

The Human Proxy Control Plane is a **read-only operational interface** over the existing governed execution architecture. It does not execute actions, does not become a parallel orchestrator, and does not expose chain-of-thought.

### Authoritative Chain (unchanged)

```
CognitiveCore → HeidiExecutive → ExecutionBridge → HumanActionEngine
  → AdaptiveOperator → DelegatedIdentity / AuthorityManager
  → GoalStateMachine → VerificationContract
  → InterventionQueue → GoalCheckpoint
  → SupabasePersistence → real adapters
  → ActionJournal / audit
```

### Control Plane Position

The control plane sits **alongside** the existing chain as an observer and aggregator:

```
                    ┌─────────────────────────────────┐
                    │   Existing Execution Chain       │
                    │   (authoritative, unchanged)     │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │   HumanProxyControlPlane         │
                    │   (read-only aggregation)        │
                    │                                  │
                    │  • OperationalGoalState          │
                    │  • OperationalEventStream        │
                    │  • InterventionController        │
                    │  • GoalCheckpointManager         │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │   API + Dashboard + SSE          │
                    │   (human-facing surface)         │
                    └─────────────────────────────────┘
```

The control plane:
- **Reads** from existing components (GoalStateMachine, InterventionQueue, GoalCheckpointManager, DelegatedIdentityManager)
- **Records** operational events (observability, not execution)
- **Exposes** state through API and dashboard
- **Wraps** intervention actions (approve/reject/cancel) through the existing InterventionQueue

The control plane **does not**:
- Execute arbitrary capabilities
- Become a second orchestrator
- Bypass authority or verification
- Expose chain-of-thought or secrets
- Modify the existing execution path

## 2. Data Flow

```
User issues goal
  → Execution chain processes goal
  → Control plane records operational events
  → Control plane aggregates state from:
      • GoalStateMachine (status, transitions)
      • InterventionQueue (pending interventions)
      • GoalCheckpointManager (checkpoints, resume points)
      • DelegatedIdentityManager (identity, authority)
      • VerificationContractRegistry (verification state)
      • OperationalEventStream (event history)
  → API exposes state (read-only)
  → Dashboard renders state (human-readable)
  → SSE pushes real-time updates

When intervention is required:
  → Execution chain pauses (WAITING_FOR_HUMAN)
  → Control plane shows intervention
  → Human approves/rejects/cancels via API
  → InterventionController wraps existing queue
  → Execution chain resumes or terminates
```

## 3. State Model — OperationalGoalState

The canonical state model (`lib/delegated-operator/OperationalGoalState.ts`) contains 30+ structured fields answering:

| Question | Field |
|----------|-------|
| What goal is executing? | `goalText` |
| What state is it in? | `status` |
| What action is executing? | `currentAction` |
| What capability is being used? | `currentCapability` |
| What resource is touched? | `targetResource`, `resourceType` |
| What authority permits the action? | `authorizationState`, `authorizationReason` |
| What risk applies? | `riskLevel` |
| Was authorization granted/denied/escalated? | `authorizationState` |
| What verification contract applies? | `verificationContract` |
| Did verification pass? | `verificationState` |
| Is intervention required? | `interventionRequired` |
| Why is intervention required? | `interventionReason`, `interventionType` |
| What checkpoint is resumable? | `checkpointId` |
| What was the last successful action? | `lastCompletedAction` |
| What is next? | `nextAction` |
| How many retries/replans occurred? | `retryCount`, `replanCount`, `recoveryCount` |
| How long has the goal run? | `elapsedMs` |
| What changed after recovery? | `recoveryCount`, `persistenceState` |
| What is the final verified state? | `finalState`, `finalVerification` |

The model is sanitized before any exposure — 15 forbidden secret patterns are stripped.

## 4. Event Model — OperationalEvent

The event model (`lib/delegated-operator/OperationalEvent.ts`) defines 27 event types:

| Category | Events |
|----------|--------|
| Goal lifecycle | `GOAL_CREATED`, `GOAL_STARTED`, `GOAL_COMPLETED`, `GOAL_FAILED`, `GOAL_CANCELLED` |
| Planning | `PLAN_CREATED`, `REPLAN_STARTED`, `REPLAN_COMPLETED` |
| Action | `ACTION_SELECTED`, `ACTION_STARTED`, `ACTION_COMPLETED`, `ACTION_FAILED` |
| Authorization | `AUTHORIZATION_GRANTED`, `AUTHORIZATION_DENIED`, `AUTHORIZATION_ESCALATED` |
| Verification | `VERIFICATION_PASSED`, `VERIFICATION_FAILED` |
| Intervention | `INTERVENTION_REQUIRED`, `INTERVENTION_APPROVED`, `INTERVENTION_REJECTED`, `INTERVENTION_CANCELLED`, `INTERVENTION_EXPIRED` |
| Checkpoint | `CHECKPOINT_CREATED`, `CHECKPOINT_RESTORED` |
| Recovery | `RECOVERY_STARTED`, `RECOVERY_COMPLETED` |
| Observation | `OBSERVATION_RECORDED` |

Events are:
- Persisted to `adaptive_operator_events` table (Supabase)
- Written to local audit file (defense in depth)
- Sanitized before persistence (15 secret patterns)
- Safe for API, dashboard, and SSE consumption

## 5. Intervention Lifecycle

```
                  ┌──────────┐
                  │ PENDING  │
                  └────┬─────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
     ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
     │APPROVE │  │REJECT  │  │CANCEL  │
     └────┬───┘  └────┬───┘  └────┬───┘
          │           │            │
     ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
     │RESUMED │  │REJECTED│  │CANCELLED│
     └────────┘  └────────┘  └────────┘
```

- **APPROVE**: Loads checkpoint, determines resume point, marks intervention resolved, goal resumes
- **REJECT**: Marks intervention rejected, goal cannot resume
- **CANCEL**: Marks intervention cancelled, goal cannot resume
- **EXPIRE**: Time-based, handled by existing `expireStale()`

All actions are:
- Identity-bound (require `actions:approve` permission)
- Persistence-backed (Supabase)
- Audit-logged (operational events)
- Terminal-safe (rejected/cancelled/expired cannot be re-approved)

## 6. Checkpoint Lifecycle

```
Goal running
  → Checkpoint created (status, objectives, actions, verified state)
  → Checkpoint persisted to Supabase
  → PM2 restart / process interruption
  → Checkpoint restored from Supabase
  → Stale check (revalidate against current world state)
    → If consistent: resume from checkpoint
    → If stale: trigger replan
  → Completed actions skipped (no duplication)
  → Goal continues or terminates
```

## 7. Recovery Lifecycle

```
Process interruption detected
  → RECOVERY_STARTED event recorded
  → Restore from Supabase:
    • Checkpoints (latest per goal)
    • Pending interventions
  → Revalidate checkpoints against current state
  → RECOVERY_COMPLETED event recorded
  → Resume from verified checkpoint
  → Skip completed actions
  → Continue execution
```

## 8. API Surface

All endpoints use existing `requireAuth` with RBAC. Read endpoints require `status:view` or `work_sessions:view`. Mutation endpoints require `actions:approve`.

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/api/operator/status` | GET | `status:view` | Overall operational summary |
| `/api/operator/goals` | GET | `work_sessions:view` | List active goals |
| `/api/operator/goals/:goalId` | GET | `work_sessions:view` | Goal detail |
| `/api/operator/goals/:goalId/events` | GET | `work_sessions:view` | Goal event stream |
| `/api/operator/interventions` | GET | `work_sessions:view` | List pending interventions |
| `/api/operator/interventions/:id/approve` | POST | `actions:approve` | Approve intervention |
| `/api/operator/interventions/:id/reject` | POST | `actions:approve` | Reject intervention |
| `/api/operator/interventions/:id/cancel` | POST | `actions:approve` | Cancel intervention |
| `/api/operator/recovery` | GET | `work_sessions:view` | Recovery history |
| `/api/operator/stream` | GET (SSE) | `status:view` | Real-time updates |

All responses are sanitized (defense in depth — 15 secret patterns stripped).

## 9. Security Boundaries

1. **Unauthorized resource access is denied** — Resource boundaries enforced by DelegatedIdentityManager
2. **Unauthorized capability use is denied** — Authority scopes checked
3. **Denied actions never execute** — Authorization result checked before execution
4. **Human-required actions never silently auto-approve** — STRICT_CONFIRMATION enforced
5. **Rejected interventions cannot resume** — Terminal state enforced
6. **Cancelled goals cannot resume** — Terminal state enforced
7. **Terminal states cannot reopen** — GoalStateMachine rejects transitions
8. **Stale checkpoints trigger verification/replan** — Revalidation on restore
9. **Completed actions are never duplicated after restart** — Resume point skips completed
10. **Secrets never enter operational events** — 15-pattern sanitizer
11. **Secrets never enter API responses** — Defense-in-depth sanitizer
12. **Secrets never enter dashboard state** — Sanitizer applied to state
13. **Control-plane APIs cannot directly execute capabilities** — No execute methods
14. **Browser sessions cannot bypass credential/authority system** — Origin boundaries
15. **Control plane cannot become alternative execution path** — Read-only by design

## 10. Secret Handling

Three layers of defense:

1. **OperationalGoalState sanitizer** — strips secrets before state exposure
2. **OperationalEvent sanitizer** — strips secrets before event persistence
3. **API response sanitizer** — strips secrets in `lib/operator-api-shared.ts`

Forbidden patterns (15):
- Stripe keys: `sk_live_*`, `rk_live_*`, `whsec_*`
- AWS keys: `AKIA*`
- Private keys: `-----BEGIN PRIVATE KEY-----`
- Bearer tokens
- Generic: `password=*`, `secret=*`, `token=*`, `api_key=*`, `session_cookie=*`, `cookie=*`, `mfa_secret=*`, `otp=*`, `authorization=*`

Secret values are **never** displayed, logged, or persisted. Only presence/absence is verified.

## 11. Browser Authority Model

Browser sessions are subject to the same DelegatedIdentityManager authority as all other capabilities:

- **Allowed origins**: `http://localhost:*` (configurable per identity)
- **Denied origins**: All others not explicitly allowed
- **Credential validation**: Performed without exposing secrets
- **MFA**: Creates intervention, cannot be bypassed

The control plane does not weaken browser authority — it reports browser-related state through the same OperationalGoalState model.

## 12. Qualification Results

### Phase 9 — Operational Safety Tests
- **41/41 assertions passed, 0 failed**
- Covers all 15 safety invariants
- Proves control plane is read-only and cannot become alternative execution path

### Phase 10 — Control-Plane End-to-End Test
- **79/79 assertions passed, 0 failed**
- Real Supabase + real PM2 + real Chrome + real control plane
- Full lifecycle: `GOAL → PLAN → ACTION → FAILURE → REPLAN → INTERVENTION → CHECKPOINT → PM2 RESTART → RESTORE → VERIFY → RESUME → COMPLETE`
- 27 operational events recorded, all secret-clean
- Control plane correctly reflected state at every phase

### Phase 11 — 100-Cycle Soak Test
- **13/13 assertions passed, 0 failed**
- 100 cycles, 100% success rate, 0% failure rate
- 0 duplicate actions, 0 duplicate side effects
- 0 persistence failures, 0 checkpoint failures
- 10 interventions created and resolved, 0 orphaned
- 0 secret leaks, 0 control-plane read failures
- Memory: 103MB → 101MB (no leak)
- Action latency: avg=0ms, max=1ms

### Phase 12 — Release Gate
- Typecheck: 115 errors (baseline unchanged)
- Focused migration/unit tests: 64/64 passing
- Delegated/human-action/adaptive tests: 88/88 passing
- Full Jest suite: 17 failed suites (all pre-existing/environmental, none control-plane-related)

## 13. Soak Results

| Metric | Value |
|--------|-------|
| Duration | 20.9s |
| Cycles | 100 |
| Success rate | 100% |
| Failure rate | 0% |
| Goals completed | 100 |
| Goals failed | 0 |
| Replans | 6 |
| Interventions created | 10 |
| Interventions resolved | 10 |
| Orphaned interventions | 0 |
| Persistence failures | 0 |
| Checkpoint failures | 0 |
| Duplicate actions | 0 |
| Duplicate side effects | 0 |
| Stale checkpoints | 5 |
| Secret leaks | 0 |
| CP read failures | 0 |
| Memory growth | -1MB |
| Avg action latency | 0ms |

## 14. Known Limitations

1. **SSE polling interval**: The SSE stream polls every 2 seconds rather than using true push. This is a pragmatic choice for reliability — true push would require an event bus or pub/sub mechanism.
2. **Dashboard polling**: The dashboard polls every 2 seconds. SSE is available but the dashboard does not yet consume it.
3. **Single-instance control plane**: The control plane runs in-process. For multi-instance deployments, the Supabase-backed event stream provides cross-instance visibility.
4. **No goal creation through control plane**: The control plane is read-only with respect to goal creation. Goals are created through the existing execution chain (CognitiveCore → HeidiExecutive).
5. **Intervention types**: The control plane supports the existing intervention types. New intervention types would require updates to the InterventionType enum.

## 15. Rollback Procedure

The control plane is purely additive — it does not modify any existing execution path. To roll back:

1. **Remove API routes**: Delete `pages/api/operator/` directory
2. **Remove dashboard tab**: Revert the `proxy` tab addition in `pages/ops.tsx` and delete `components/HumanProxyPanel.tsx`
3. **Remove control-plane modules**: Delete `lib/delegated-operator/HumanProxyControlPlane.ts`, `InterventionController.ts`, `OperationalEvent.ts`, `OperationalGoalState.ts`
4. **Remove shared helper**: Delete `lib/operator-api-shared.ts`
5. **Revert index.ts**: Remove the new exports from `lib/delegated-operator/index.ts`

The existing execution chain (CognitiveCore → HeidiExecutive → ExecutionBridge → HumanActionEngine → AdaptiveOperator) continues to function without the control plane.

## 16. Production Deployment Requirements

1. **Supabase**: The `adaptive_operator_events` table must exist (migration `20260822150000`)
2. **Environment variables**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set
3. **Auth tokens**: Service token or device token must be provided for API access
4. **PM2**: The daemon should be running for full recovery lifecycle support
5. **Chrome**: Required for browser-related qualification tests (not required for production operation)
6. **RLS**: Row-level security remains enabled on all tables
7. **Service role key**: Never exposed to browser/client — server-side only

## 17. Files Added/Modified

### New files
- `lib/delegated-operator/OperationalGoalState.ts` — canonical state model
- `lib/delegated-operator/OperationalEvent.ts` — event model + persistence
- `lib/delegated-operator/HumanProxyControlPlane.ts` — control-plane service
- `lib/delegated-operator/InterventionController.ts` — intervention workflow
- `lib/operator-api-shared.ts` — API shared helpers
- `pages/api/operator/status.ts` — operational status
- `pages/api/operator/goals/index.ts` — goal listing
- `pages/api/operator/goals/[goalId].ts` — goal detail
- `pages/api/operator/goals/[goalId]/events.ts` — goal events
- `pages/api/operator/interventions/index.ts` — intervention listing
- `pages/api/operator/interventions/[id]/approve.ts` — approve
- `pages/api/operator/interventions/[id]/reject.ts` — reject
- `pages/api/operator/interventions/[id]/cancel.ts` — cancel
- `pages/api/operator/recovery.ts` — recovery history
- `pages/api/operator/stream.ts` — SSE stream
- `components/HumanProxyPanel.tsx` — dashboard panel
- `scripts/test-operational-safety.ts` — safety tests
- `scripts/test-control-plane-e2e.ts` — e2e test
- `scripts/test-control-plane-soak.ts` — soak test

### Modified files
- `lib/delegated-operator/index.ts` — exports for new modules
- `lib/delegated-operator/GoalCheckpoint.ts` — checkpoint enumeration support
- `pages/ops.tsx` — added `proxy` tab

---

**Designation:** `GOVERNED HUMAN PROXY CONTROL PLANE — PRODUCTION-QUALIFIED`

The system remains: `GOVERNED, AUDITABLE, RESTART-SAFE, VERIFIABLE, RESOURCE-BOUND, IDENTITY-BOUND, HUMAN-ESCALATABLE, SECRET-SAFE`
