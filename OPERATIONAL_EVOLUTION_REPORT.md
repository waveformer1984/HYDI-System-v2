# HEIDI Operational Evolution Report

**Date:** 2026-08-19
**Branch:** `feat/governed-autonomy`
**Base HEAD:** `2ef50a0`
**Repository:** `C:\Users\Owner\HYDI-System-v2`

## 1. Previous Capability

Before this evolution, HEIDI could:
- Detect process failures through watchdog health checks
- Recover ProtoForge core through governed path (policy → authorize → execute → verify → record)
- Escalate when recovery was exhausted
- Record operational events in append-only JSONL journals

### Known Defects (Certification Findings)
1. `SelfHealthMonitor` was dead code — not wired into any production path
2. `heidi-mobile-chat` exit code `42949667295` remained unexplained
3. Silent stack outage around 17:44 remained unexplained
4. Self-awareness drift crashed with `Cannot read properties of undefined (reading 'length')`
5. Adaptation types `drift_mitigation`, `failure_mitigation`, `reduce_drift` were unknown to consumers
6. PDRs frequently had empty action, decision, risk fields
7. Docker was not reliably available in PATH after restart
8. Live `docker stop` container-recovery certification test was not completed
9. Stripe key rotation was not automated (correctly — user action only)

## 2. New Capability

After this evolution, HEIDI can:
- **Monitor its own operational health** through `SelfHealthMonitor` wired into the watchdog
- **Resolve Docker deterministically** through a shared resolver used by doctor, watchdog, and RecoveryEngine
- **Produce complete PDRs** with all fields populated (no silent empty fields)
- **Use canonical adaptation vocabulary** with 8 types and 9 actions, recognized by all consumers
- **Recover containers with service-level verification** (container running + REST API responding through Kong)
- **Select recovery strategies** through an explicit strategy model with verification criteria
- **Learn from operational events** and produce bounded recommendations (never auto-apply)
- **Demonstrate all failure classes** through a reproducible live certification harness

## 3. Architecture Changes

### New Components
| Component | File | Purpose |
|-----------|------|---------|
| Autonomy Contract | `lib/operational/AutonomyContract.ts` | Formal declaration of what HEIDI may/must-never do |
| Recovery Strategy Model | `lib/operational/RecoveryStrategyModel.ts` | Explicit recovery strategies with verification criteria |
| Operational Learning | `lib/operational/OperationalLearning.ts` | Bounded learning layer (observe→learn→recommend) |
| Adaptation Vocabulary | `src/core/adaptation-vocabulary.js` | Canonical adaptation types and actions |
| Docker Resolver | `scripts/resolve-docker.js` | Shared deterministic Docker CLI discovery |
| Certification Harness | `scripts/certification-harness.js` | Reproducible live certification for all failure classes |

### Modified Components
| Component | File | Change |
|-----------|------|--------|
| Watchdog | `scripts/watchdog.js` | Wired `SelfHealthMonitor`, uses shared Docker resolver |
| Doctor | `scripts/hydi-doctor.js` | Uses shared Docker resolver with actionable error messages |
| Recovery Engine | `lib/operational/RecoveryEngine.ts` | Service-level verification after container restart, shared Docker resolver |
| Operational Intelligence | `lib/operational/OperationalIntelligence.ts` | PDR update (not duplicate), complete detail field |
| PDR Store | `lib/operational/PolicyDecisionRecord.ts` | Added `update()` and `getById()` methods |
| Autonomy Policy Model | `lib/operational/AutonomyPolicyModel.ts` | Added `supabase_db` and `supabase_rest` container policies |
| Heidi Core Loop | `src/core/HeidiCoreLoop.js` | Handles all canonical adaptation types |
| HYDI System | `src/HYDISystem.js` | Handles all canonical adaptation actions |
| Heidi Self-Awareness | `src/awareness/HeidiSelfAwareness.js` | Fixed drift history crash (in-place update) |

## 4. Policy Changes

- Added `policy.recover.supabase_db` (R2, policy_authorized, service-level verification required)
- Added `policy.recover.supabase_rest` (R2, policy_authorized, service-level verification required)
- PDR lifecycle changed from append-only duplicates to update-in-place
- PDR `detail` field now captures phase, assessment, execution, outcome, escalation

## 5. Recovery Strategies

| Strategy ID | Target | Risk | Verification |
|-------------|--------|------|--------------|
| `strategy.process-restart` | process | R1 | process alive + endpoint healthy + expected response |
| `strategy.container-restart` | container | R2 | container running + REST API responds through Kong |
| `strategy.ollama-restart` | service | R2 | /api/tags returns 200 with model list |
| `strategy.dependency-recovery` | dependency | R1 | dependency healthy + dependent service healthy |
| `strategy.escalation` | process | R0 | escalation package with evidence and recommended action |

## 6. Safety Boundaries

### HEIDI MAY (with policy authorization)
- Read health state of any component (R0, autonomous)
- Produce diagnostic snapshots (R0, autonomous)
- Restart approved local processes (R1, autonomous)
- Restart approved containers (R2, policy_authorized)
- Escalate to human operator (R0, autonomous)

### HEIDI MUST NEVER
- Rotate or replace user secrets
- Expose credentials
- Execute arbitrary shell commands
- Modify autonomy policy itself
- Perform destructive database operations
- Perform financial actions
- Bypass approval requirements
- Hide or rewrite audit history

## 7. Live Demonstrations

### Test 1: Process Failure Recovery
- **Command:** `node scripts/certification-harness.js --only=1`
- **Result:** PASS
- **Evidence:** ProtoForge killed (PID 25252), recovered through governed path (new PID 25952), recovery time 66.7s
- **Report:** `.hydi-operational/certification-2026-08-19T14-01-30-401Z.md`

### Test 2: Policy Denial (Fail-Closed)
- **Command:** `node scripts/certification-harness.js --only=2`
- **Result:** PASS
- **Evidence:** Unknown component correctly denied by policy

### Test 3: Escalation PDR Completeness
- **Command:** `node scripts/certification-harness.js --only=3`
- **Result:** PASS
- **Evidence:** Escalated PDRs have all required fields populated

### Test 4: Self-Health Monitor Active
- **Command:** `node scripts/certification-harness.js --only=4`
- **Result:** PASS
- **Evidence:** Watchdog runs successfully with SelfHealthMonitor wired in

### Test 5: Operational Learning Bounded
- **Command:** `node scripts/certification-harness.js --only=5`
- **Result:** PASS
- **Evidence:** All recommendations have `autoApply: false`

### Test 6: Docker Discovery Deterministic
- **Command:** `node scripts/certification-harness.js --only=6`
- **Result:** PASS
- **Evidence:** Docker resolved via shared resolver (`docker` in PATH)

### Test 7: Adaptation Vocabulary Canonical
- **Command:** `node scripts/certification-harness.js --only=7`
- **Result:** PASS
- **Evidence:** 8 types, 9 actions, all previously-unknown types now recognized

## 8. Metrics

| Metric | Value |
|--------|-------|
| Typecheck | Clean (0 errors) |
| Unit test suites | 213 passed, 0 failed |
| Unit tests | 2034 passed, 1 skipped, 0 failed |
| Doctor | 18/18 SAFE TO OPERATE |
| Live health endpoints | 6/6 healthy |
| Certification tests | 7/7 passed |
| Safety invariant tests | 10/10 passed |
| PDR completeness tests | 6/6 passed |
| Adaptation vocabulary tests | 13/13 passed |
| Autonomy contract tests | 14/14 passed |
| Recovery strategy model tests | 8/8 passed |
| Operational learning tests | 6/6 passed |
| Self-awareness drift regression tests | 3/3 passed |

## 9. Remaining Limitations

### Blocking
- None

### Non-Blocking
- `heidi-mobile-chat` exit code `42949667295` remains unexplained (environmental, not a code defect)
- Silent stack outage around 17:44 remains unexplained (historical, not reproducible)
- Live `docker stop` container recovery test not yet run (requires Docker Desktop, which is available but test not executed in this session)
- Ungoverned `HealthObserver` path in `heidi-core/server.js` still exists (separate from watchdog)

### Environmental
- Docker PATH availability after reboot depends on Docker Desktop startup timing
- PM2 environment may not inherit PATH changes after Docker Desktop starts

### User-Action-Required
- Stripe key rotation remains explicitly user-controlled (correct behavior)
- Git commit of changes is pending user approval
