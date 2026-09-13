# Phase 5 Decision Contract — protoforge.daily_opportunity_scan

**Status: FROZEN 2026-09-11. Not authorized for execution until the evidence gate opens.**

This is the decision contract for the first post-baseline tuning review, gated on the scheduled
follow-up (cron job `489ee58f`, target 2026-09-15 20:07 local; calendar backup event on the same
day, same purpose). It exists so that review session — whichever session runs it — separates
**evidence → diagnosis → candidate → authorization → implementation → verification** into distinct,
non-skippable steps. A "review and tune" task that blurs those steps is how scope creep sneaks in
wearing a little engineer hat.

Immutable reference: `docs/mission-reviews/2026-09-11-review.json` and its companion raw dumps.
**Never overwrite this file.** `--save-baseline`'s existing suffix behavior (`-2`, `-3`, ...)
already prevents same-day collisions; this file specifically must never be treated as "the
baseline to update" — it is the fixed point everything else is compared against.

## Phase 5.0 — Evidence gate (deterministic, not interpretive)

Do not proceed past this section without all three:

1. **Continuity is evidenced, not inferred from a single current reading.** `pm2 jlist`
   showing `restarts=0` right now is *insufficient proof* of continuous operation since
   2026-09-11 — a `pm2 delete` + `pm2 start` (as opposed to `pm2 restart`) creates a fresh
   process entry with its restart counter reset to 0, silently erasing that history. Check
   instead:
   - `logs/pm2-protoforge-scout.out.log` for exactly **one** `"protoforge-opportunity-scheduler
     starting"` line since 2026-09-11 00:22:44Z. More than one means it was restarted or
     recreated at least once — find out why before trusting anything else.
   - `pm2 describe hydi-protoforge-scout`'s `created at` timestamp still reads
     `2026-09-11T00:22:43.822Z`. If it doesn't, the process was recreated.
2. **Daily cycle spacing is numerically defined: 20h–28h between consecutive genuine
   `protoforge_mission_runs.run_at` values** (genuine = `briefing_text` is not the
   `'PROTOFORGE DAILY BRIEF\n...'` test-fixture literal — see the review script's own
   `TEST_RUN_BRIEFING_MARKER`). "Roughly 24h" is not a gate; two cycles 18h apart must fail
   this check, not be waved through as "close enough."
3. **≥3 genuine cycles satisfy that spacing requirement**, not merely ≥3 genuine cycles existing.
   A cycle that landed only 6h after its predecessor (e.g. a manual re-run) does not count toward
   this total.

**If any of the three fails:** STOP. Report the exact gap (e.g. "2 starts found in the PM2 log,
second one at 2026-09-13T02:14Z — investigate the first stop before reviewing anything") or ("only
2 of 4 genuine cycles fall inside the 20-28h window") and recommend continuing to observe. Do not
force a conclusion on a thin, gapped, or restart-contaminated sample.

## Phase 5.1 — Evidence

```bash
node scripts/missions/protoforge-opportunity-review.js --save-baseline
```

Diff the new dated report against **`2026-09-11-review.json` specifically** (not against
whatever the previous review happened to be, if this contract is reused for a later cycle) on:
`q5_recency`, `q9_deduplication`, `q2_q3_scoreSeparation`, `q7_actionability`, `q10_revenueSignal`.
Present as a before/after table.

## Phase 5.2 — Frozen decision tree

```
                Sept 15 review
                      |
                      v
          +------------------------+
          | Gate 5.0 passed?       |
          | (continuity evidenced, |
          |  spacing 20-28h,       |
          |  >=3 qualifying cycles)|
          +-----------+------------+
                      | NO
                      v
                   STOP
               keep observing
                      |
                      | YES
                      v
          +------------------------+
          | Q2/Q3 separation       |
          | degraded vs 09-11?     |
          +-----------+------------+
                      | YES
                      v
              STOP + INVESTIGATE
              (a weakening classifier
               is a regression, not
               a tuning opportunity)
                      |
                      NO
                      v
          +------------------------+
          | Recency <20 AND        |
          | dedup rate stabilized  |
          | (not still 6%-100%)?   |
          +-----+--------------+---+
             YES|              |NO
                v              v
          CANDIDATE A     evaluate B
                                |
          +------------------------+
          | Generic actionability  |
          | AND >=1 high_confidence|
          | item now exists?       |
          +-----------+------------+
                      | YES
                      v
                CANDIDATE B
                      |
                 (neither matched)
                      v
                    WAIT
```

Pick **at most one** candidate per pass. Not both in the same review.

## Phase 5.3 — Candidate → authorization → implementation → verification

```
Candidate identified
        |
        v
      STOP
        |
        v
operator authorization  <-- explicit, not inferred. Present the candidate and its exact
        |                    scope, wait for a real go-ahead, same as every other change
        v                    in this project's history.
one bounded change      <-- exactly one of 5.3a / 5.3b below. No bundling.
        |
        v
      tests            <-- written and passing BEFORE the scheduler is touched
        |
        v
   PM2 restart          <-- only after tests pass; never "just to try it live"
        |
        v
   verification         <-- prove the change did what it claimed, same rigor as
                             the original scheduler qualification (before/after,
                             no collateral drift, R0/R1 boundary re-confirmed)
```

### 5.3a — Recency (if selected)
Narrow the HN Algolia query to a bounded lookback (e.g. `numericFilters=created_at_i>...`)
instead of unbounded `search_by_date`. One line in `lib/missions/scouts/hn-algolia-scout.js`.
No new dependency, no schema change. Test asserts the query parameter is present via a mocked
`fetch` — never assert real-world "freshness" in a hermetic test.

### 5.3b — Actionability (if selected)
**Not** the full "cost/risk/evidence/approval" COO-style handoff described in the original
conversation — that stays explicitly out of scope until multiple high-confidence items exist to
design it against. The bounded version: make `required_action` cite the specific matched
evidence, e.g. `"review -- matches 'sync licensing' and 'AI music'"` instead of the current
generic sentence. Fully templated/deterministic, zero LLM dependency, zero new autonomy — it
makes the existing classifier explain itself, nothing more.

## Incident — 2026-09-12: continuity broken, scout recreated

An out-of-band bulk process cleanup (run in response to a status-review's "clean up orphaned
Node processes" recommendation, which used process age alone as its orphan heuristic) killed the
PM2 daemon itself along with everything it supervised, including the original
`hydi-protoforge-scout` instance (PID 14888, `created_at: 2026-09-11T00:22:43.822Z`). This is
exactly the **"scout disappears"** stop condition this contract's continuity check
(Phase 5.0, item 1) exists to catch — recorded here rather than silently overwritten, per this
project's evidence-over-assertion standard.

At the time of the kill, `protoforge_mission_runs` held exactly 2 genuine PM2-scheduled cycles
(2026-09-11T00:23:21Z and 2026-09-12T00:23:24Z, 24.00h apart — 1 qualifying interval toward the
required ≥3). That continuity is now broken; those two cycles remain true historical fact but
no longer chain to a live, unbroken process history.

**Recovery sequence** (same session, same day):
1. Ad hoc/raw processes (a squatting `node launch-heidi-mobile.js`, a scoped
   `boot-agent.js --only=protoforge-core` instance and its child, a scoped
   `boot-agent.js --only=heidi-mobile-chat` instance) were stopped to clear conflicting port
   ownership.
2. `pm2 start ecosystem.config.js` + `pm2 save` brought all 8 apps back under a single coherent
   `hydi-boot`-rooted supervision tree (verified via `Win32_Process` parent-chain ancestry, not
   just command-line similarity — a raw process listing alone had briefly looked like a second
   uncoordinated actor, but tracing ancestry confirmed everything traced back to legitimate
   `hydi-boot`/`hydi-watchdog` children).
3. During boot, `protoforge-core` came up delegated rather than boot-agent-spawned directly:
   boot-agent's log shows `required module down -> DELEGATE_RECOVERY mode: not shutting down
   (watchdog + RecoveryEngine will handle)`, and `hydi-watchdog` (HYDI_DELEGATE_RECOVERY=true)
   correctly invoked the governed `RecoveryEngine.restartProcess()` path, which recorded a fresh
   `.recovery-leases/protoforge-core.json` (`pid: 31068`, `recoveredAt:
   2026-09-12T23:55:06.037Z`, superseding the earlier retroactive entry for the original
   2026-09-12 outage). Boot completed cleanly with no duplicate-spawn conflict — this is the
   recovery-lease/DELEGATE_RECOVERY mechanism built earlier this session working correctly,
   unprompted, under real conditions.
4. Post-recovery health check: `protoforge-core` HEALTHY (13 modules, 6409+ events).
   `heidi-web`/`heidi-mobile-chat` up and serving `200` on `/api/health` since 23:54:13Z.
   `/api/health`'s `hydi_status: CRITICAL` field is a rolling 20-run trend indicator reflecting
   the outage/chaos window, not current live health — expected to clear as healthy runs
   accumulate; not itself a stop condition for this contract.

**New continuity baseline (post-incident):**
```
hydi-protoforge-scout   pid=28336   created_at=2026-09-12T23:53:37.100Z   restarts=0
```

**Qualifying interval count resets to 0/3.** The two pre-incident genuine cycles do not carry
forward — this contract's own Phase 5.0 rule (continuity must be evidenced via an unbroken
`created_at`, not inferred) applies to itself here. Do not backdate or splice the pre-incident
cycles into the new instance's history in any future review. The earliest possible new qualifying
interval is the first `protoforge_mission_runs` cycle produced by PID 28336 landing 20-28h after
its next cycle, and ≥3 such intervals are required from this baseline forward before Phase 5.0
can pass.

## Incident — 2026-09-13: second restart within an hour, PM2 metadata proven unreliable post-crash

Roughly 36 minutes after the 2026-09-12 incident's recovery restart (PID 28336, `created_at:
2026-09-12T23:53:37.100Z`), the whole host hit a resource-exhaustion event (Git-Bash reported
`fork()` failures, `0xC000026B`/`errno 11`, "Resource temporarily unavailable" — a Windows-level
process/handle exhaustion, not a HYDI code defect). This appears to have crashed the scout's own
Node process (and briefly `hydi-boot`, whose first post-crash restart attempt failed preflight
because Docker Desktop wasn't responding: `logs/pm2-hydi-boot.err.log` at 2026-09-13T00:31:18Z-
00:31:49Z, `"Docker Desktop did not start within 90s"` / `"preflight found blocking issues — boot
aborted"`; a second restart attempt at 00:32:04Z succeeded).

**Evidence the scout actually restarted again**, found via `logs/pm2-protoforge-scout.out.log`
(the same file this contract's own Phase 5.0 rule says to check) rather than trusting `pm2
jlist` alone:
```
2026-09-12T23:53:38.630Z protoforge-opportunity-scheduler starting ...   <- the 2026-09-12 baseline
2026-09-13T00:29:28.951Z protoforge-opportunity-scheduler starting ...   <- a SECOND start, 36 min later
2026-09-13T00:30:41.211Z   CYCLE FAILED: mission exceeded 60000ms and was killed
2026-09-13T00:30:41.356Z Next cycle in 86400s
```
No further "starting" lines appear after 00:29:28, and `pm_uptime` for the live process
(`2026-09-13T00:29:26.445Z`) independently corroborates that timestamp — the current process has
been up continuously since then with no further crashes as of this note.

**Important methodological finding:** `pm2 jlist` for this same live process still reports
`created_at: 2026-09-12T23:53:37.100Z` and `restart_time: 0` — both stale, both contradicted by
the log and by `pm_uptime`. The most likely explanation is that the whole PM2 daemon died in the
same resource-exhaustion event and was resurrected from the `dump.pm2` snapshot saved right after
the prior incident's `pm2 save`, which restores each app's saved metadata rather than tracking
what actually happened to the live OS process across the daemon's own outage. **Conclusion for
this contract and any future one: after any host-level crash or PM2-daemon interruption, treat
`pm2 jlist`'s `created_at`/`restart_time` as unverified until cross-checked against the app's own
log file's "starting" line count and `pm_uptime`. Do not trust PM2 metadata alone as continuity
proof going forward** — this incident is the concrete case that motivates tightening Phase 5.0's
existing log-check rule from "sufficient" to "necessary, and cross-check pm_uptime against it."

The immediate-on-start mission cycle from the 00:29:28 restart timed out and was killed
(60s budget) rather than persisting a row — likely the same resource contention, not a mission
logic defect. No `protoforge_mission_runs` row was written by it, so no data corruption resulted;
it simply produced no evidence either way.

**Corrected continuity baseline (supersedes the 2026-09-12 note above):**
```
hydi-protoforge-scout   pid=23124   live since (log+pm_uptime)=2026-09-13T00:29:28.951Z   restarts=0 (unverifiable via PM2 metadata, see above)
```

**Qualifying interval count remains 0/3**, now counted from this corrected baseline. The
2026-09-12T23:53:38Z start does not count as the baseline — it was itself superseded within the
hour. Any future checkpoint must re-grep the log for "starting" lines since this timestamp before
trusting continuity, per the methodological finding above.

## Constraints (carried forward unchanged, apply to any Phase 5 execution)

No R2 execution. No Reddit enablement without first re-testing that this network is still
403-blocked (conditions may have changed, but re-enabling is still a separate decision, not a
side effect of this review). No autonomous external contact. No financial action. No credential
changes. No changes to boot ownership, watchdog, or revenue logic. Tests before code touches the
running scheduler.

## Stop rules
Stop and report rather than proceeding if: Phase 5.0's gate fails in any of its three parts,
signal separation has degraded, or the decision tree doesn't cleanly resolve to exactly one
candidate (ambiguous → WAIT, not a forced pick).

## Status snapshot at freeze time (2026-09-11)

```
HYDI:            ONLINE
Scout:           QUALIFIED
Scheduler:       PERSISTED (PM2, hydi-protoforge-scout)
Baseline:        IMMUTABLE (docs/mission-reviews/2026-09-11-review.json)
Phase 5:         FROZEN, WAITING FOR DATA
R2+:             BLOCKED (no execution path exists in code)
```
