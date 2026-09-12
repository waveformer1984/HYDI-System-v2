# Rezonate Capability Contract

**Status:** Draft specification + seed data (P0.5-adjacent, per `docs/REZONATE_CANONICAL_STATE.md`).
**Problem this solves:** `RezonetteModule.tsx` displayed "Complete"/"Built" for 15 features regardless of their real state (fixed 2026-08-13, see that file's inline comment). The root cause wasn't a lie — it was that no single place owned a capability's status, so a UI component was free to invent one. This contract is that single place.

---

## 1. The state enum

Seven states, strictly ordered, no others permitted:

```text
PLANNED       — on a roadmap, no code written
SCAFFOLD      — structure/UI/stub exists, does not perform the real function
PARTIAL       — performs the real function in a limited/narrow way
FUNCTIONAL    — performs the real function correctly, not independently re-verified this cycle
VERIFIED      — performs the real function correctly, confirmed this cycle by a test run,
                direct execution, or direct output inspection (cite the evidence)
PRODUCTION    — VERIFIED *and* confirmed deployed/reachable in a live environment serving
                real use, not just passing locally
DEPRECATED    — was FUNCTIONAL or better, superseded by a canonical replacement, frozen
                (not extended) but not necessarily removed
```

A capability may only claim `PRODUCTION` if there is a citable deployment check (a reachable URL, a live health endpoint response, a deploy log) — not a governance document's assertion. This is a direct response to `docs/CANONICAL_PLATFORM_COMPONENTS.md` currently calling the canonical app "Production" with no independently verifiable evidence (see `docs/REZONATE_DOCUMENTATION_DRIFT.md` §4). Under this contract, that entry would be capped at `VERIFIED` until someone attaches a deployment check.

## 2. Schema

One record per capability:

```json
{
  "id": "stem_separation",
  "name": "Stem Separation",
  "category": "Audio",
  "state": "VERIFIED",
  "module_path": "rezonate/make-stems.py",
  "evidence": "Real WAV stem output verified on disk: rezonate/stems/Bad Decision Club/*.wav + track.json (2026-08-13 audit)",
  "last_verified": "2026-08-13",
  "verified_by": "audit-session",
  "consumers": ["protoforge-applications/rezonate/src/adapters/resonate-engine.js", "rezonate/heidi-rezonate.js"],
  "notes": null
}
```

Field rules:

- `id` — stable, lowercase-snake-case, never reused for a different capability even after deprecation.
- `state` — one of the 7 values in §1. No free text.
- `evidence` — required for `VERIFIED` and `PRODUCTION`. Must cite a file path, test name, or command output, not "should work."
- `last_verified` — date the `state` was last confirmed. A capability whose `last_verified` is older than **90 days** should be treated as due for re-check, not trusted at face value — this is how the 72/91/96 three-way test-count drift found in `docs/REZONATE_DOCUMENTATION_DRIFT.md` happens: nobody re-checks a number once it's written down.
- `consumers` — what actually calls/renders this capability. Empty array is meaningful (nothing consumes it yet — a real, common state for `FUNCTIONAL` code in this codebase).

## 3. Where it lives (now vs. later)

**Now:** a checked-in JSON file, `protoforge-applications/rezonate/capability-contract.json`, seeded in this pass (see §5). Reasoning: the canonical app currently has no Supabase-backed persistence (that's P1 in the consolidation plan) — waiting for that infrastructure before starting the contract would just be another instance of blocking real work on an unbuilt dependency, the exact pattern this whole audit exists to stop.

**Later (P1, once canonical persistence lands):** migrate to a `rezonate_capability_contract` Supabase table, RLS-enabled like the existing `rezonate_*` tables, with the JSON file becoming a generated export/cache rather than the source of truth. The schema above maps directly to columns; no redesign needed at migration time.

## 4. How the UI should consume it

`RezonetteModule.tsx` (and any future dashboard) should import `capability-contract.json` and render `state` directly — never compute or override a display status locally. The fix applied this session removed the override; the next step (not done in this pass, listed below) is to point the component at this file instead of its own hardcoded `COMPONENTS` array, so the two can't drift apart from each other.

**Recommended CI guard (proposed, not implemented this pass):** a script (`scripts/validate-capability-contract.js`) that (a) validates the JSON against the schema in §2, (b) fails if any `VERIFIED`/`PRODUCTION` entry lacks an `evidence` string, (c) greps UI component source for string literals matching state-like words (`'complete'`, `'Built'`, `'active'`, `'planned'`) assigned outside of a read from this contract, and fails CI if found. This would have caught the original bug at commit time. Adding this to `.github/workflows/` is a P1 follow-up requiring a workflow-file change, intentionally not made in this pass since it wasn't part of the authorized safe-remediation scope.

## 5. Seed data

`protoforge-applications/rezonate/capability-contract.json` (written alongside this doc) populates all capabilities from `docs/REZONATE_CAPABILITY_MATRIX.json`, translated from that file's 8-value vocabulary to this contract's 7-value enum as follows:

| Old (capability matrix) | New (contract) | Rule applied |
|---|---|---|
| `IMPLEMENTED` + executed/output-verified this session | `VERIFIED` | Has a citable test run or on-disk artifact |
| `IMPLEMENTED` + code read but not executed this session | `FUNCTIONAL` | Correct-looking code, not re-proven this cycle |
| `PARTIAL` | `PARTIAL` | Direct carry-over |
| `STUB` | `SCAFFOLD` | Structure exists, doesn't perform the function |
| `MOCK` | `SCAFFOLD` | UI/data shape exists, doesn't perform the function |
| `DOCUMENTATION_ONLY` | `PLANNED` | Described, not built |
| `MISSING` (but named on a roadmap, e.g. `RezonetteModule.tsx` milestones) | `PLANNED` | On a roadmap, no code |
| `MISSING` (not on any roadmap found) | *omitted* | Not yet a contracted capability at all — absence from the file, not a `PLANNED` entry, to avoid implying commitment that doesn't exist |
| `UNKNOWN` | *omitted, tracked in `_unaudited` array* | Contract entries must have verified-enough evidence to assign a real state; items still `UNKNOWN` go in a separate backlog list instead of getting a guessed state |

This is a full translation of the capability matrix (56 entries), not a partial sample — see the JSON file for all of it.
