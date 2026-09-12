# HYDI Mission Runner v1

Gives Heidi one concrete, end-to-end operational job instead of another
synthetic health check.

**Mission:** `protoforge.daily_opportunity_scan`

```
discover  →  analyze  →  prioritize  →  local queue  →  briefing  →  human approval  →  (execute)  →  verify  →  record
```

Every arrow above is real code, not a diagram. Concretely:

| Step | Module | What it actually does |
|---|---|---|
| discover | `lib/missions/scouts/*.js` | Real HTTPS GET against public, unauthenticated, read-only APIs (Hacker News Algolia search, Reddit's public JSON search). No scraping behind auth, no ToS-restricted endpoints. |
| analyze + prioritize | `lib/missions/opportunity-analyzer.js` | Deterministic scoring (keyword relevance + recency + engagement) — not an LLM guess. The formula is small enough to read in one sitting and is stored per-record in `scoring_detail` so every confidence number is traceable to its inputs. |
| local queue | `lib/missions/opportunity-store.js` | Postgres (local Supabase), tables `protoforge_opportunities` / `protoforge_mission_runs` (`supabase/migrations/20260916000000_protoforge_opportunities.sql`). Deduplicated by a hash of the normalized source URL. |
| briefing | `lib/missions/briefing.js` | Formats the day's queue into the `PROTOFORGE DAILY BRIEF` text format, read from the persisted table — never generated fresh from memory. |
| human approval | `lib/missions/approval.js` | `approveOpportunity` / `rejectOpportunity` — the only functions that can move a record out of `approval_status: 'pending'`. Nothing else in this codebase calls them. |
| execute | `lib/missions/approval.js` → `executeApprovedOpportunity` | **Deliberately unimplemented in v1.** It exists so the boundary is a loud, explicit `NOT_IMPLEMENTED` error rather than a silently-missing function — see "Autonomy boundary" below. |
| verify + record | `scripts/missions/protoforge-daily-opportunity-scan.js` | Every run writes a `protoforge_mission_runs` row (status, counts, errors, duration) whether it succeeds or fails — mirrors `scripts/system-health-scheduler.js`'s "prove the write happened, don't trust the exit code" pattern. |

## Autonomy boundary (R0/R1 only, in this version)

- **R0 (observe):** the scouts only ever perform GET requests against public, unauthenticated read endpoints.
- **R1 (research / classify / prepare):** scoring, deduplication, and briefing generation.
- **R2+ (external contact, spending, commitments): not implemented.** There is no code path in this mission that sends an email, posts anywhere, or spends money. `executeApprovedOpportunity()` throws `NOT_IMPLEMENTED` unconditionally — approving an opportunity marks it as authorized-to-pursue, it does not cause anything to happen.
- Every opportunity record starts `approval_status: 'pending'` and stays there until a human calls the approve/reject API. No code path in this mission sets it to `'approved'`.
- Every claimed fact carries evidence: `evidence` is a JSON array of `{source_url, snippet, fetched_at}` pulled directly from the scout's HTTP response — nothing here is fabricated or inferred without a source.

## Running it

```bash
node scripts/missions/protoforge-daily-opportunity-scan.js            # one run, prints the briefing, exits
node scripts/missions/protoforge-daily-opportunity-scan.js --json     # machine-readable output
node scripts/protoforge-opportunity-scheduler.js --once               # scheduler wrapper, single cycle
node scripts/protoforge-opportunity-scheduler.js                      # scheduler wrapper, continuous (24h default)
```

Or through Heidi's chat router (`system: "protoforge"`): `"brief"`, `"opportunities"`, or `"queue"` returns the
latest persisted briefing. Or via `GET /api/missions/protoforge-opportunities` (see that file's header for the
full request/response contract, including the approve/reject actions).

## What this is not (yet)

- Not Forge Finder, Switchboard, Proto.I.Y, Build a Mind, or Blame Games — Rezonate only, per the stated priority order. The scout/analyzer/store split is generic enough that a second product's mission can reuse `opportunity-store.js` and `briefing.js` unchanged; only the scouts and the relevance keyword list are Rezonate-specific right now (`lib/missions/config.js`).
- Not autonomous. Every opportunity is a recommendation with evidence, sitting in a queue, waiting for a human.
