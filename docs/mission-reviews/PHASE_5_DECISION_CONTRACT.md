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
