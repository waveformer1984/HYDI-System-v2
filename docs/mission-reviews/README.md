# protoforge.daily_opportunity_scan -- Mission Review Baselines

Snapshots produced by `node scripts/missions/protoforge-opportunity-review.js --save-baseline`.
Read-only tooling: nothing here is written by the mission itself, and saving a baseline never
modifies `protoforge_opportunities` or `protoforge_mission_runs`.

## Why these files exist

A future tuning decision (e.g. narrowing the HN search terms for recency, or building a real
per-opportunity `required_action`) needs something concrete to compare against -- "did precision
actually improve" requires the pre-tuning numbers to still exist, not just today's spoken
conclusion. Each save captures three files, `<date>-*.json` (a same-day re-run adds a `-2`, `-3`,
... suffix rather than overwriting the first):

| File | Contents |
|---|---|
| `<date>-review.json` | The computed answers to the 10 effectiveness questions at that moment. |
| `<date>-raw-opportunities.json` | Every genuine (non-test-fixture) `protoforge_opportunities` row at that moment, in full -- title, evidence, scoring_detail, everything. |
| `<date>-raw-mission-runs.json` | Every genuine `protoforge_mission_runs` row -- lets you recompute a metric this script didn't originally capture, without needing the live database. |

## First baseline

`2026-09-11` -- 61 genuine opportunities, 4 mission runs (only 1 a real 24h-spaced PM2 cycle; the
other 3 were same-day manual test runs during the mission's build/qualification -- see that
review's own `meta.cyclesObserved` and the operator conversation for the caveat). Recorded
findings: clear signal/noise separation, weak recency (12.8/100 avg), actionability still
templated (2 distinct `required_action` strings), 0/61 high-confidence, 5/61 carry a revenue/
collaboration keyword signal.

## Running a comparison later

```bash
node scripts/missions/protoforge-opportunity-review.js --save-baseline
```

Then diff the new `<date>-review.json` against `2026-09-11-review.json` (or any later baseline)
for the specific metrics that changed: `q5_recency`, `q9_deduplication`, `q7_actionability`, etc.
Do not tune the mission based on a single day's numbers -- the operator's own standard is 3-7
genuine daily cycles before drawing a conclusion.
