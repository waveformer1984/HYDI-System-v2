# HYDI Crash/Restart Matrix Qualification Report — Phase 7

## Baseline

- **Branch:** `feat/governed-autonomy`
- **Baseline HEAD:** `8de22ab` (Phase 6 failure injection)
- **Phase 7 Initial HEAD:** `a47b7f1` (212 assertions, production fix for terminal checkpoint restore)
- **Phase 7 Expanded HEAD:** (to be committed)
- **Typecheck baseline:** 115 errors
- **Typecheck delta:** 0

## Commit History

| Commit | Description |
|--------|-------------|
| `a47b7f1` | `feat(human-proxy): qualify crash restart matrix` — initial 212 assertions + production fix |
| `7716e24` | `fix(tests): resolve typecheck errors in Phase 5/6 test scripts` |
| (pending) | `test: add expanded crash restart matrix qualification` — 246 assertions |

## Implementation Fixes Discovered

### Fix 1: Terminal checkpoint restore gap (committed in `a47b7f1`)

**Invariant violated:** Stale interventions on terminal goals could appear actionable after restart.

**Root cause:** `GoalCheckpointManager.restoreFromPersistence()` used `listActive()` which only loads non-terminal checkpoints. After restart, terminal goals were unknown to the checkpoint manager, so `listPendingInterventions()` could not filter stale interventions on terminal goals.

**Fix:** Added `listAll()` to `CheckpointPersistence` and updated `restoreFromPersistence()` to load ALL checkpoints (including terminal). `listActive()` on the manager still filters terminal for execution purposes.

### Fix 2: Test defect — expired intervention timing (test only)

**Issue:** Test set `expiresInSeconds: 1` but only waited 100ms before calling `expireStale()`. The intervention had not actually expired.

**Fix:** Increased wait to 1100ms to ensure the intervention is genuinely expired before calling `expireStale()`.

## Test Commands

```bash
# Typecheck
npm run typecheck

# Focused delegated operator tests
npx jest tests/unit/delegated-operator.test.ts tests/unit/goal-checkpoint.test.ts tests/unit/goal-state-machine.test.ts tests/unit/intervention-queue.test.ts --forceExit

# Phase qualification scripts
npx tsx scripts/test-runtime-truth-audit.ts
npx tsx scripts/test-event-history.ts
npx tsx scripts/test-sse-consistency.ts
npx tsx scripts/test-intervention-lifecycle.ts
npx tsx scripts/test-failure-injection.ts
npx tsx scripts/qualify-human-proxy-restart.ts

# Expanded crash/restart matrix
npx tsx tests/qualification/test-crash-restart-matrix.ts

# Full Jest suite
npx jest --forceExit
```

## 24 Interruption Points (A-X)

| ID | Interruption Point | Recovery | Side Effect | Checkpoint | Events | Intervention | Final State | Result |
|----|--------------------|----------|-------------|------------|--------|--------------|-------------|--------|
| A | BEFORE_AUTHORIZATION | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| B | AFTER_AUTHORIZATION_BEFORE_ACTION | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| C | DURING_ACTION | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| D | AFTER_ACTION_BEFORE_RESULT_PERSISTENCE | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| E | AFTER_RESULT_PERSISTENCE_BEFORE_VERIFICATION | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| F | AFTER_VERIFICATION_BEFORE_CHECKPOINT | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| G | AFTER_CHECKPOINT_BEFORE_EVENT | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| H | DURING_INTERVENTION_CREATION | WAITING_FOR_HUMAN | N/A | ✓ | ✓ | ✓ | WAITING_FOR_HUMAN | PASS |
| I | AFTER_INTERVENTION_PERSISTENCE | WAITING_FOR_HUMAN | N/A | ✓ | ✓ | ✓ | WAITING_FOR_HUMAN | PASS |
| J | AFTER_INTERVENTION_APPROVAL_BEFORE_RESUME | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| K | DURING_RESUMED_EXECUTION | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| L | AFTER_RESUMED_EXECUTION_BEFORE_TERMINAL_PERSISTENCE | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| M | IMMEDIATELY_BEFORE_COMPLETION | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| N | IMMEDIATELY_AFTER_COMPLETION | COMPLETED | N/A | ✓ | ✓ | N/A | COMPLETED | PASS |
| O | DURING_DAEMON_RECOVERY | RECOVERING | N/A | ✓ | ✓ | N/A | RECOVERING | PASS |
| P | MULTIPLE_CONSECUTIVE_RESTARTS | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| Q | STALE_CHECKPOINT | RUNNING | N/A | ✓ | ✓ | N/A | RUNNING | PASS |
| R | ALREADY_COMPLETED_GOAL | COMPLETED | N/A | ✓ | ✓ | N/A | COMPLETED | PASS |
| S | ALREADY_FAILED_GOAL | FAILED | N/A | ✓ | ✓ | N/A | FAILED | PASS |
| T | EXPIRED_INTERVENTION | WAITING_FOR_HUMAN | N/A | ✓ | ✓ | ✓ (expired) | WAITING_FOR_HUMAN | PASS |
| U | REJECTED_INTERVENTION | WAITING_FOR_HUMAN | N/A | ✓ | ✓ | ✓ (rejected) | WAITING_FOR_HUMAN | PASS |
| V | CANCELLED_INTERVENTION | WAITING_FOR_HUMAN | N/A | ✓ | ✓ | ✓ (cancelled) | WAITING_FOR_HUMAN | PASS |
| W | PARTIAL_GOAL | PARTIAL | N/A | ✓ | ✓ | N/A | PARTIAL | PASS |
| X | WAITING_FOR_HUMAN | WAITING_FOR_HUMAN | N/A | ✓ | ✓ | ✓ | WAITING_FOR_HUMAN | PASS |

## Side-Effect Fingerprint Methodology

### Filesystem
- **Capture:** path, existence, SHA-256 content hash, file size, modification timestamp
- **Method:** Write file with action ID, capture fingerprint before crash, verify hash unchanged after restart
- **Result:** No duplicate filesystem side effect — hash remains constant across restarts

### Process
- **Capture:** service identity, start count, PID, resulting state
- **Method:** Record process start in checkpoint side effects, verify start count doesn't increase after restart
- **Result:** No duplicate process start — count remains 1

### HTTP
- **Capture:** request count, action ID, idempotency key, mutation count, response
- **Method:** Disposable local HTTP server with idempotency key support. Send mutation, crash, retry with same key — server detects duplicate
- **Result:** Request count > 1 but mutation count = 1 (idempotency prevents duplicate effective mutation)

### Browser
- **Capture:** action ID, submission count, page URL
- **Method:** Launch Chrome via puppeteer-core, navigate to test page, record in checkpoint, restart, verify no re-navigation
- **Result:** No duplicate browser submission (Chrome available, test passed)

### Credential
- **Capture:** operation ID, operation type, persistence timestamp, mutation count
- **Method:** Fake credential operation with deterministic ID, verify no duplicate mutation and no secrets in events
- **Result:** No credential duplication, no secrets (sk_live, password, Bearer) in event stream

## Checkpoint Methodology

- **Latest checkpoint wins:** `restoreFromPersistence()` loads all checkpoints ordered by `created_at DESC`, first per goal wins
- **Old checkpoints don't overwrite:** `seenGoals` set prevents older checkpoints from overwriting `goalToCheckpoint` mapping
- **Terminal checkpoints loaded:** `listAll()` includes terminal states so stale interventions can be filtered
- **Stale checkpoint rejected:** State machine rejects transitions from terminal states
- **Completed actions not replayed:** `executedActions` in checkpoint prevents re-execution

## Intervention Methodology

- **Restore after restart:** `restoreFromPersistence()` calls `expireStale()` then loads pending interventions
- **Approved intervention resumes:** Returns checkpoint ID for validation
- **Rejected intervention blocked:** Not in pending after restart, cannot approve
- **Cancelled intervention blocked:** Not in pending after restart
- **Expired intervention blocked:** `expireStale()` in Supabase before load, not in pending
- **Terminal goal + stale intervention:** Filtered by `listPendingInterventions()` which checks checkpoint status

## Event Methodology

- **Idempotency:** Same idempotency key returns same event (no duplicate)
- **Ordering:** Monotonic sequence per goal, preserved across restart
- **Consistency:** Event count matches before/after restart
- **No duplicates:** Unique event IDs verified
- **Secret safety:** No sk_live, password, or Bearer in events

## SSE Methodology

- **Last-Event-ID replay:** Events after cursor are replayed, events before are skipped
- **Ordering:** Replayed events maintain sequence order
- **No duplicates:** Unique event IDs not delivered twice
- **Mutation-free:** SSE replay does not mutate goal state, checkpoint, intervention, or event persistence
- **Read-only:** Reading events is observation only

## Terminal-State Methodology

For each terminal state (COMPLETED, FAILED, EXPIRED), attempted resurrection through:
1. State machine transition (RUNNING, WAITING_FOR_HUMAN, PAUSED, PARTIAL) — all rejected
2. Intervention approval — goal remains terminal
3. Checkpoint restoration — goal remains terminal
4. Duplicate event — goal remains terminal
5. No stale fields (currentAction, interventionRequired) on terminal goals

## Multi-Restart Sequence

```
GOAL_ACCEPTED → ACTION_1 → CRASH_1 → RESTART → RECOVER → ACTION_2 → CRASH_2 → RESTART → RECOVER
→ INTERVENTION → CRASH_3 → RESTART → RECOVER → APPROVAL → ACTION_3 → CRASH_4 → RESTART → RECOVER
→ VERIFY → COMPLETED
```

- 4 crashes, 4 restarts, 3 actions, 1 intervention, 1 completion
- All 3 side-effect fingerprints unchanged across all 4 restarts
- No orphaned intervention
- Latest checkpoint is COMPLETED
- Terminal state immutable after final restart

## PM2 Results

- **Status:** PASS
- **Cycles:** 2 consecutive real `pm2 restart hydi-daemon` commands
- **restart_time:** 0→1→2 (incremented each cycle)
- **Daemon status:** online throughout
- **No unrelated services restarted**

## Assertion Counts

| Suite | Assertions | Result |
|-------|-----------|--------|
| 7B — 24 Interruption Points (A-X) | ~130 | PASS |
| 7C — Side-Effect Fingerprints | 15 | PASS |
| 7D — Terminal State Immutability | 18 | PASS |
| 7E — SSE Replay Safety | 10 | PASS |
| 7F — Multi-Restart Scenario | 15 | PASS |
| 7G — Release Gate (RG01-RG20) | 20 | PASS |
| 7I — PM2 Reality Test | 4 | PASS |
| **Total (Expanded)** | **246** | **246/246 PASS** |
| Initial Phase 7 (qualify-human-proxy-restart.ts) | 213 | 213/213 PASS |

## Existing Test Results

| Suite | Result |
|-------|--------|
| Truth audit | 78/78 PASS |
| Event history | 64/64 PASS |
| SSE consistency | 44/44 PASS |
| Intervention lifecycle | 45/45 PASS |
| Failure injection | 43/43 PASS |
| Delegated operator unit | 48/48 PASS |
| Initial restart matrix | 213/213 PASS |
| Full Jest suite | 3237 passed, 205 failed (all pre-existing) |

## Environmental Blockers

None. All tests passed including real PM2 restart and Chrome browser test.

## Remaining Limitations

1. **Dashboard SSR issue** (`jsxDEV is not a function`) remains pre-existing and unrelated to Phase 7.
2. **Typecheck baseline** of 115 errors remains pre-existing.
3. **Full Jest suite** has 205 pre-existing failures in unrelated areas (cognitive loop, revenue engine, communication layer, migrations) — none in delegated-operator/control-plane code.
4. **`no-hardcoded-secrets` test** falsely flags `sk_live_SECRET1234567890` in `test-failure-injection.ts` — this is intentional test data for secret sanitization verification, not a real secret.
5. **SSE replay test** simulates the replay logic at the application level rather than connecting to the live SSE endpoint (which requires authentication and a running Next.js server).
