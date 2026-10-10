# POST-REESTABLISHMENT CONTROL-PLANE REPORT

Date: 2026-09-19
Repository: `C:\Users\Owner\HYDI-System-v2`, branch `clean-main`, baseline `593ece9`
Scope: remediation of the four anomalies found during live-state re-establishment.
Code track only — no live-runtime mutation was used as a substitute for fixes.

---

## 1. Current runtime baseline

Canonical supervision unchanged and consistent at report time:

| Evidence | Value |
|---|---|
| Boot lease `.hydi-boot.lock` | `pid 29484`, ppid 17776 (PM2 daemon), bootId `e57834af…` |
| Port 3005 (protoforge-core) | PID 15716 `node src/server.js` — matches `.recovery-leases/protoforge-core.json` (15716) |
| Port 3000 (heidi-web) | PID 34012 (`next start-server` descendant of wrapper 20568) — matches `.recovery-leases/heidi-web.json` (20568) |
| Port 3006 (heidi-mobile-chat) | PID 12552 listening |
| Health evidence | carried forward from `LIVE_STATE_REESTABLISHMENT_REPORT.md`; no live mutation performed in this task |

The live runtime remains `LIVE_STATE_REESTABLISHED`. No production services were restarted during this remediation; the code fixes take effect on the next canonical restart, which is an authorized-operation decision (see §12).

## 2. Phantom restart requester — root cause

### Producer graph

```
watchdog (PM2, HYDI_DELEGATE_RECOVERY=true, 30s)
  └─ FAILURE_CONFIRMED hysteresis → exec node scripts/hydi-recover.js --governed --component=X   [VERIFIED — logged DELEGATE lines only]
hydi-daemon (CognitiveCore, ~60s cognitive/ssf cycles)
  └─ recovery.governed_recover / recovery.auto_recover capability executors
       → OperationalIntelligence.governedRecover()  (IN-PROCESS)                                [PHANTOM PRODUCER]
operator / scripts
  └─ hydi-recover CLI, hydi-qualify, hydi-doctor, certification-harness                          [manual/test only]
```

Evidence:

- `lib/heidi/CognitiveCore.ts:664` wires `recovery.governed_recover` → `oi.governedRecover(component, cause)` and `:708` wires `recovery.auto_recover` → `oi.autoRecover()`. `heidi-daemon.ts` is the only running process that builds a CognitiveCore (`CognitiveCoreBuilder` scan: only daemon + test scripts).
- `governedRecover` (`OperationalIntelligence.ts:349`) runs its own `healthChecker.checkAll()` then `actionSelector.selectAction()` — **it has no hysteresis and no observer-failure classification**, unlike the watchdog path.
- `.hydi-operational/policy-decisions.jsonl` contains `manual-*` decision records at ~30–60s cadence in every failure window — the daemon's in-process evaluations (the watchdog delegates only on `FAILURE_CONFIRMED` and was logging `all 6 endpoints healthy` at the same instants).
- Daemon audit rows at `19:37:40`, `19:40:50`, `19:42:08`, `19:43:02` (cycleIds `ssf-…-7365..7370`) bracket the four phantom requests at `19:37:42` / `19:40:24` / `19:41:49` / `19:44:17`, with `capabilityHealth` degrading across the window.

### Earliest incorrect decision boundary

`HealthProvenanceChecker.checkModule` judged identity from the **port owner's cmdline only**:

- **Deterministic false-negative (heidi-web)**: configured `npm run dev` never appears in the cmdline of the port-owning grandchild (`next start-server`). Decision records show `heidi-web UNAVAILABLE` — `port-listening: PASS`, `process-identity: FAIL "wrong process: node (PID …)"` — on a live, listening, canonical service. Its retry budget was exhausted `3/3` by the loop.
- **Flaky false-negative (protoforge-core)**: when the powershell/CIM probe in `getProcessInfo` fails it returns `{name:'unknown', cmdline:'unknown'}` → scored `wrong process` → `UNAVAILABLE`. An **observer failure was classified as a target failure** — that is the boundary that restarted a healthy protoforge-core four times and exhausted `4/3`.

The loop stopped at `19:44` only because the **retry budget tripped to escalation** — a circuit breaker, not a resolution. The daemon kept evaluating (escalation records at `19:52+`, `00:58–01:01` during the genuine outage).

### Fix

Identity is now **ancestry-aware** (see §4) and observer failures return `UNKNOWN` instead of `UNAVAILABLE`. `ActionSelector` grants no autonomous action for `UNKNOWN` (`ActionSelector.ts:101`) — an unproven observation can no longer authorize a restart.

## 3. PM2 double-fork / bookkeeping race — root cause

### Deterministic timeline

1. `pm2 restart hydi-boot` → PM2 spawns replacement fork **B** while outgoing fork **A** is still shutting down children (~20s shutdown window on Windows).
2. A's late exit event is attributed to the app's tracked slot → PM2 autorestarts a **second** fork **C**.
3. HYDI lease arbitration (`newest claim wins`) correctly stands down one sibling (exit 75, swallowed by `stop_exit_codes: [75]`).
4. PM2's process table records the **dead** fork: `hydi-boot` shows `waiting restart` / `pid: 0` while the surviving, PM2-spawned-but-untracked fork supervises all services. Reproduced 3/3 restarts on 2026-09-18; `pm2 delete` + fresh `pm2 start` converged cleanly.

### Verdict: proven PM2-internal limitation + HYDI mitigation

HYDI cannot repair PM2's fork attribution (the bug is inside PM2's `ProcessContainerFork` bookkeeping). What code can do is avoid creating the second fork:

- `scripts/pm2-restart.js` now routes `hydi-boot` **directly to `pm2 delete` + `pm2 start`** — the `pm2 restart` attempt that provably produced the race is removed for the lease-bearing supervisor. Other apps keep restart-then-fallback (single-process apps do not hit the lease race).
- After a hydi-boot start the script **verifies supervisor consistency**: `pm2 jlist` pid must equal `.hydi-boot.lock` pid; a divergence is reported `MISMATCH` with both pids — never silently ignored.
- `checkSupervisorConsistency()` is exported and unit-tested (`tests/unit/pm2-restart-consistency.test.js`).

Operational rule: **never `pm2 restart hydi-boot` on Windows — use `node scripts/pm2-restart.js hydi-boot`.** If `pm2 jlist` shows `waiting restart`/`pid 0` while a boot-agent is alive and holding the lease, PM2 bookkeeping is stale; run the helper to converge. The exactly-one-supervisor invariant itself is guaranteed by the lease and is not compromised by the race.

## 4. heidi-web identity — root cause and fix

### Root cause

`checkModule` required `mod.command` + `mod.args` to substring-match **the port owner's own cmdline**. For wrapper-launched modules (`npm run dev` → `cmd` → `npm` → `next dev` → `next start-server`) the leaf can never contain the configured command → deterministic `wrong process` → `UNAVAILABLE` → permanent recovery target on a healthy service.

### Fix (`lib/operational/HealthProvenanceChecker.ts`)

New `verifyProcessIdentity(mod, pids)` walks the port owner's ancestor chain (depth ≤ 8, cycle-guarded) via `getParentPid`/`getProcessInfo` and accepts identity on any of four proofs:

1. **Direct** — leaf cmdline matches configured command + args (protoforge-core, mobile-chat).
2. **Command-family ancestor** — an ancestor's cmdline matches (`cmd /c "npm run dev"`, `next dev`).
3. **Canonical owner** — the chain reaches the live boot-lease PID (`.hydi-boot.lock`, `HYDI_BOOT_LEASE_PATH` seam). Descent from the canonical supervisor is stronger than any cmdline match.
4. **Recovered** — the chain reaches the component's recovery-lease PID (mirrors `classifyOccupant`'s `'recovered'` case).

Verdicts: `pass` → continue; `fail` (fully-resolved chain, nothing matched) → `UNAVAILABLE`; **`unknown` (unreadable node anywhere in the chain) → `UNKNOWN`** — observer failure, not target failure. Required semantics covered and tested: expected executable, expected command, expected process name, expected ancestor, stale PID, dead parent, PID reuse (mismatch + dead ancestry → `UNKNOWN`, never false `HEALTHY`), duplicate services (multiple port PIDs recorded in evidence detail). Target failure / observer failure / unknown remain distinct: `UNKNOWN` and `fail` short-circuit before the endpoint check, and `UNKNOWN` carries no autonomous action.

## 5. Recovery lease lifecycle — root cause and fix

### Root cause

`boot-restart-handler.js` acked `completed` after stop → respawn → health → verify **without updating `.recovery-leases/<component>.json`**. The lease kept naming the dead pre-restart PID — measured live: protoforge-core respawned to PID 15716 while the lease still named dead 26840; heidi-web's lease named dead 4242. Stale leases feed wrong occupant classification and repeated false-recovery evaluation.

### Fix

After verification and **before** the `completed` ack, the handler now records the new lease (`recoveredBy: 'boot-agent.restart'`, `cause: req.id`, `pid: child.pid` — the spawn-wrapper PID, matching lease convention). If the lease write fails the ack is `failed` with the live `pid` still reported — an acknowledgement cannot claim success while the durable ownership record disagrees, and the honest outcome (child alive, lease unwritten) is visible to the requester. Lifecycle now: old lease invalidated → new child PID identified → ancestry provable → new lease written → ack. The `RecoveryEngine.restartProcess` ack-verification path (pid alive + `ownedBy` + port listening) is unchanged and now lands on a lease that agrees.

## 6. Code changes

| File | Change |
|---|---|
| `lib/operational/HealthProvenanceChecker.ts` | Ancestry-aware `verifyProcessIdentity()`; `getParentPid`, `getBootLeasePid`, `getRecoveryLeasePid` helpers; `UNKNOWN` verdict for observer failures; updated identity-step comment. |
| `scripts/boot-restart-handler.js` | Recovery lease written post-verification, pre-ack; lease-write failure → `failed` ack with live pid; `recordLease` dep-injection seam + `defaultRecordLease`. *(File itself was created in the live-state track and is still uncommitted — must ship with these changes.)* |
| `scripts/pm2-restart.js` | `hydi-boot` → deterministic `delete`+`start` (never `pm2 restart`); post-start supervisor consistency verification; `checkSupervisorConsistency`/`readBootLeasePid`/`readPm2Pid` exported for tests. |

## 7. Tests added

| File | Coverage |
|---|---|
| `tests/unit/health-provenance-ancestry.test.ts` | 10 tests: direct owner, legitimate child/grandchild (npm→next→start-server), canonical boot-lease ancestry, recovery-lease ancestry, unrelated process → UNAVAILABLE, spoofed name, wrong executable, **dead parent → UNKNOWN**, **flaky probe → UNKNOWN (phantom regression)**, cyclic ancestry terminates. |
| `tests/unit/boot-restart-handler-lease.test.js` | 4 tests: lease written before ack with correct pid/command/cause; lease-write failure → failed ack + live pid; no write on failed restart; unowned/external never reaches write. |
| `tests/unit/pm2-restart-consistency.test.js` | 5 tests: consistent/mismatch/incomplete verdicts; `HYDI_BOOT_LEASE_PATH` seam — missing, valid, malformed lease. |

## 8. Full regression

```
npm run typecheck   → clean (tsc --noEmit, exit 0)
npm test            → Suites: 364 passed / 2 failed (366 total)
                      Tests:  4348 passed / 1 failed / 1 skipped (4350 total)
                      Time:   553.0s
```

Failure classification:

| Failure | Class | Basis |
|---|---|---|
| `tests/unit/platform-diagnostics.test.js` — 15s timeout | **TIMING / ENVIRONMENTAL** | Shares zero code with the diff; standalone re-run passes 7/7 (each test ~7s of real inventory probes — machine-load bound during the 553s parallel run). |
| `tests/unit/hydi-v3/MeasuredLearning.test.js` — `EBUSY: resource busy, unlink temp\revenue.json` | **ENVIRONMENTAL** | Windows temp-file lock during parallel suite cleanup; unrelated to the diff. |

Targeted suites re-run clean (81 tests): `health-provenance-process-identity`, `operational-no-false-greens`, `recovery-ownership`, `supervision-model`, `boot-control-channel`, `boot-agent-ownership`, `recovery-bridge`. Integration tests were not run (no live env vars requested for this track).

## 9. Independent verification

Diff-level review, not implementation-assertion:

- **Phantom**: `verifyProcessIdentity` only emits `UNAVAILABLE` when the chain fully resolves with no match; every unreadable node sets `unresolved` → `UNKNOWN` → `ActionSelector` no-action. Confirmed `selectAction` gates UNKNOWN/STARTING (line 101). The daemon/watchdog/manual producer graph is closed: `governedRecover` callers = `hydi-recover` CLI (watchdog DELEGATE, manual) + `CognitiveCore` executors only.
- **PM2**: `pm2 restart` is unreachable for `hydi-boot` in the helper; consistency verdict is pure and tested; residual PM2 bookkeeping risk documented, not claimed fixed.
- **Identity spoofing**: a foreign process cannot forge ancestry (PPID is kernel-recorded); the canonical-owner proof requires descending from the live lease pid. A same-user process naming its cmdline `npm run dev` could pass proof 2 — accepted residual: the control channel already assumes the same-user trust boundary (documented in boot-agent's rate-limit comment).
- **Lease**: write precedes ack; failure path returns `failed` with the live pid — no fabricated success path exists. Forged/stale acks remain covered by boot-control signature checks and `waitForAck` request-id matching (existing `boot-control-channel` tests green).
- **Duplicate children**: handler still refuses non-owned/external entries; restart cooldown unchanged.
- Stale-comment audit: the leaf-matching comment above the identity step was rewritten to describe ancestry semantics.

## 10. Remaining residuals

1. **PM2 bookkeeping race is mitigated, not eliminated** — it is PM2-internal. Detection (`checkSupervisorConsistency`) and deterministic recovery (`pm2-restart.js`) are in place; `pm2 jlist` output remains authoritative only after verification.
2. **`governedRecover` has no multi-source corroboration** — unlike the watchdog (hysteresis + observer-failure classification), a single `checkAll` verdict selects the action. The identity fix removes the two known false-verdict producers, but a genuinely transient endpoint timeout can still produce a one-shot `UNAVAILABLE`. Next hardening candidate: require corroborating evidence before `restart_process` on the OI path.
3. **`scripts/boot-restart-handler.js` is uncommitted** — created in the live-state track; must be included in the promotion commit or runtime delegation silently loses the channel.
4. **`no-pid` identity case remains `warn`→continue** — a listening port with no attributable PID can still reach `HEALTHY` if endpoint+deps pass (preserves docker/portproxy behavior). Bounded risk: a bound local port is virtually always attributable via netstat.
5. **Recovery-lease staleness bound remains 24h** — leases are `recoveredAt`-bounded by design (`getValidLease`); a coincidental PID reuse inside the window can still misclassify as `recovered` (pre-existing documented limitation in `recovery-ownership.test.ts`).

## 11. Runtime impact

The live runtime is **unchanged** by this task — all fixes are code-track and take effect on the next canonical restart. Expected post-restart behavior:

- heidi-web will evaluate `HEALTHY` (ancestry proof via `cmd /c "npm run dev"` → boot-agent 29484) instead of permanent `UNAVAILABLE` — the phantom fuel is gone.
- A flaky identity probe yields `UNKNOWN` → no recovery action, visible evidence — no restart of a healthy service.
- Any boot-control respawn updates the recovery lease atomically before acknowledging.
- `node scripts/pm2-restart.js hydi-boot` is the only safe supervisor restart path.

## 12. Required next authorization

1. Commit the code-track changes (including the uncommitted `boot-restart-handler.js`) on `clean-main` when promotion is authorized.
2. Perform one canonical restart via `node scripts/pm2-restart.js hydi-boot` (delete+start) to load the fixed control plane, then re-verify: lease pid == PM2 pid, heidi-web identity `pass` (ancestry), protoforge/mobile-chat `HEALTHY`.
3. After promotion, the ProtoForge qualification track (three consecutive governed cycles, controlled failure/recovery, useful artifact) may be scheduled — it is not started by this report.

---

**Final code-track verdict: `CODE_PROMOTION_READY`**

**Live runtime state: `LIVE_STATE_REESTABLISHED`**

## 13. Post-recovery live-verification addendum (2026-09-19)

During the authorized PM2 daemon recovery, the F3 implementation was verified against the live runtime and one real defect was found and fixed before promotion:

1. **Probe-failure was indistinguishable from "no parent"** — `getParentPid` returned `null` both when a process had no readable parent AND when the powershell/CIM probe itself timed out under load. A timed-out lookup truncated the chain at the leaf and produced `wrong process` → UNAVAILABLE on a canonical service (observed live on heidi-web pid 31696, real parent 25588). Fixed: `getParentPid` is now tri-state (`'error'` = observer failure → UNKNOWN).

2. **Per-node probing was the flake source** — 3 powershell spawns per ancestor node (name, cmdline, ppid) intermittently exceeded the 5s timeout under load. Fixed: `getProcessTable()` loads the entire process table in ONE bulk CIM query (15s TTL cache across a checkAll sweep), and ancestry walks run in memory over the snapshot. Per-node probing remains only as fallback when the table itself cannot be loaded.

3. **Semantics reconciled**: observer failure (unreadable leaf, errored probe, table load failure with failed fallback) → `UNKNOWN`; a genuinely dead/absent ancestor in a resolved snapshot → clean chain end → a fully-explored non-matching chain is `fail` (proven foreign) → `UNAVAILABLE`. Live re-verification after the fix: heidi-web `HEALTHY` (ancestor `npm run dev` match at pid 19268), protoforge-core `HEALTHY` (direct match).

4. **`boot-agent.js classifyOccupant` had the same leaf-only defect on the adoption path** — a wrapper-launched orphan holding a module port would classify `wrong-process` → required-module refusal → `shutdown(1)` → PM2 restart loop. Fixed: identity now matches on the leaf OR any ancestor via `process-identity.js getAncestorChain()`; a chain truncated by an unreadable ancestor is `unsupervised`, never `wrong-process`. Regression tests: `tests/unit/boot-agent-occupant-identity.test.js` (7 cases).

The PM2 daemon (pid 17776) was found wedged — its RPC was unresponsive while children remained healthy. Recovery was performed by terminating the daemon and running `pm2 resurrect`: a new daemon (pid 6380) spawned the canonical 7-app set, hydi-boot claimed the lease as pid 10756, and the services were respawned/adopted under the new supervisor. Post-recovery: `pm2 ping`/`pm2 pid` responsive, PM2 pid == boot-lease pid == 10756, watchdog cycles all-healthy, zero recovery attempts, exactly one heidi-daemon (single-instance lock held by pid 2988).

Residuals acknowledged: one orphaned `job-executor-poller` (pid 33852) survived the daemon kill — it is safe by `FOR UPDATE SKIP LOCKED` atomic claiming but unowned and requires authorized cleanup; the running heidi-daemon still carries the pre-addendum F3 code in memory until its next restart.
