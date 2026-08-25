# HYDI G14 Worktree Ownership Inventory

**Generated:** 2026-08-25T06:30:00Z
**Branch:** feat/governed-autonomy
**HEAD:** dba6f0ac0f041dbc6944ca55e90a30e909ae542f

## Purpose

This document classifies every file responsible for the G14 git cleanliness
gate failure. Each file is classified by tracking status, type, ownership,
and safe-to-ignore status.

## Classification Scheme

| Class | Meaning |
|-------|---------|
| QUALIFICATION_OWNED | Created/modified by the qualification process |
| USER_OWNED | Pre-existing user/project work, not owned by qualification |
| GENERATED | Automatically generated output (runtime/transient) |
| TRANSIENT | Temporary artifact, safe to ignore |
| UNKNOWN | Cannot classify — must remain release-blocking |

## Complete Inventory (34 G14-counted files)

G14 counts files from `git status --porcelain` excluding:
- Files ending in `.json` (generated outputs)
- Untracked files starting with `?? hydi-phase` (qualification artifacts)

### Tracked Modified Files (1 file)

| # | File | Status | Type | Ownership | Classification | Safe-to-ignore? |
|---|------|--------|------|-----------|---------------|-----------------|
| 1 | HEIDI_REAL_COGNITIVE_CYCLE_REPORT.md | M | Report (markdown) | USER_OWNED | User-owned report updated by runtime | No — tracked file, requires owner decision |

### Untracked Files — Rezonate Source (5 files)

| # | File | Type | Ownership | Classification | Safe-to-ignore? |
|---|------|------|-----------|---------------|-----------------|
| 2 | protoforge-applications/rezonate/src/persistence/supabase-store.js | Source (JS) | USER_OWNED | Rezonate project work | No — source code, requires owner decision |
| 3 | protoforge-applications/rezonate/src/storage/ (3 files inside) | Source (JS) | USER_OWNED | Rezonate project work | No — source code, requires owner decision |
| 4 | protoforge-applications/rezonate/tests/helpers/ (1 file inside) | Test helper | USER_OWNED | Rezonate project work | No — test code, requires owner decision |
| 5 | protoforge-applications/rezonate/tests/storage-provider.test.js | Test (JS) | USER_OWNED | Rezonate project work | No — test code, requires owner decision |
| 6 | protoforge-applications/rezonate/tests/supabase-store.test.js | Test (JS) | USER_OWNED | Rezonate project work | No — test code, requires owner decision |

### Untracked Files — Rezonate/Project Docs (16 files)

| # | File | Type | Ownership | Classification | Safe-to-ignore? |
|---|------|------|-----------|---------------|-----------------|
| 7 | .github/workflows/rezonate-capability-contract.yml | CI config | USER_OWNED | Rezonate CI workflow | No — config, requires owner decision |
| 8 | docs/DEVIN_HEIDI_REZONATE_INTEGRATION_PROMPT.md | Doc | USER_OWNED | Rezonate integration doc | No — requires owner decision |
| 9 | docs/DEVIN_LIVE_SUPABASE_VALIDATION_PROMPT.md | Doc | USER_OWNED | Supabase validation doc | No — requires owner decision |
| 10 | docs/HEIDI_REZONATE_FINAL_REPORT.md | Doc | USER_OWNED | Rezonate report | No — requires owner decision |
| 11 | docs/HYDI_PHASE7C_CASCADE_LEDGER_AUDIT.md | Doc | USER_OWNED | Cascade ledger audit | No — requires owner decision |
| 12 | docs/HYDI_PHASE7C_CASCADE_LEDGER_LOCALIZATION.md | Doc | USER_OWNED | Cascade ledger localization | No — requires owner decision |
| 13 | docs/HYDI_PHASE7C_CASCADE_LEDGER_READINESS.md | Doc | USER_OWNED | Cascade ledger readiness | No — requires owner decision |
| 14 | docs/REZONATE_API_OWNERSHIP_BOUNDARIES.md | Doc | USER_OWNED | Rezonate API boundaries | No — requires owner decision |
| 15 | docs/REZONATE_CANONICAL_PATH.md | Doc | USER_OWNED | Rezonate canonical path | No — requires owner decision |
| 16 | docs/REZONATE_CANONICAL_STATE.md | Doc | USER_OWNED | Rezonate canonical state | No — requires owner decision |
| 17 | docs/REZONATE_CAPABILITY_CONTRACT.md | Doc | USER_OWNED | Rezonate capability contract | No — requires owner decision |
| 18 | docs/REZONATE_CONSOLIDATION_PLAN.md | Doc | USER_OWNED | Rezonate consolidation plan | No — requires owner decision |
| 19 | docs/REZONATE_DOCUMENTATION_DRIFT.md | Doc | USER_OWNED | Rezonate documentation drift | No — requires owner decision |
| 20 | docs/REZONATE_SUPABASE_SCHEMA_GAP.md | Doc | USER_OWNED | Rezonate schema gap | No — requires owner decision |
| 21 | docs/REZONATE_TARGET_ARCHITECTURE.md | Doc | USER_OWNED | Rezonate target architecture | No — requires owner decision |
| 22 | docs/SUPABASE_LIVE_CONTRACT_REPORT.md | Doc | USER_OWNED | Supabase contract report | No — requires owner decision |

### Untracked Files — Project Reports (5 files)

| # | File | Type | Ownership | Classification | Safe-to-ignore? |
|---|------|------|-----------|---------------|-----------------|
| 23 | HARD_ACCEPTANCE_AUDIT_REPORT.md | Report | USER_OWNED | User audit report | No — requires owner decision |
| 24 | HEIDI_STATE_OF_THE_SYSTEM.md | Report | USER_OWNED | User system status report | No — requires owner decision |
| 25 | HYDI_LIVE_DEMONSTRATION_LOG.txt | Log | USER_OWNED | User demonstration log | No — requires owner decision |
| 26 | HYDI_LIVE_STATUS_REPORT.md | Report | USER_OWNED | User live status report | No — requires owner decision |
| 27 | REVENUE_ENGINE_QUALIFICATION_REPORT.md | Report | USER_OWNED | User revenue report | No — requires owner decision |

### Untracked Files — User Scripts (7 files)

| # | File | Type | Ownership | Classification | Safe-to-ignore? |
|---|------|------|-----------|---------------|-----------------|
| 28 | scripts/audit-db.js | Script (JS) | USER_OWNED | User DB audit script | No — script, requires owner decision |
| 29 | scripts/check-daemon-state.ps1 | Script (PS1) | USER_OWNED | User daemon check script | No — script, requires owner decision |
| 30 | scripts/debug-csv-import.js | Script (JS) | USER_OWNED | User debug script | No — script, requires owner decision |
| 31 | scripts/fix-capabilities.js | Script (JS) | USER_OWNED | User fix script | No — script, requires owner decision |
| 32 | scripts/fix-csv-test.js | Script (JS) | USER_OWNED | User fix script | No — script, requires owner decision |
| 33 | scripts/fix-risklevels.js | Script (JS) | USER_OWNED | User fix script | No — script, requires owner decision |
| 34 | scripts/validate-rezonate-capability-contract.js | Script (JS) | USER_OWNED | User validation script | No — script, requires owner decision |

## Files Excluded by Current G14 (5 files, not counted)

These files appear in `git status` but are excluded by the current G14 filter
(ends with `.json` or starts with `?? hydi-phase`):

| File | Reason excluded |
|------|----------------|
| data/awareness/reflections.json | Ends with .json (runtime data) |
| data/memory/reflective_memory.json | Ends with .json (runtime data) |
| HYDI_LIVE_DEMONSTRATION_RESULTS.json | Ends with .json (untracked) |
| docs/REZONATE_CAPABILITY_MATRIX.json | Ends with .json (untracked) |
| docs/REZONATE_MODULE_REGISTRY.json | Ends with .json (untracked) |

## Summary

| Classification | Count | G14-counted |
|---------------|-------|-------------|
| USER_OWNED | 34 | 34 |
| QUALIFICATION_OWNED | 0 | 0 |
| GENERATED | 0 | 0 |
| TRANSIENT | 0 | 0 |
| UNKNOWN | 0 | 0 |

**All 34 G14-counted files are USER_OWNED.** None are qualification debris.
None touch HYDI safety, governance, API, or release-gate code.

## Protected Paths (never exempted by G14)

The following paths MUST always cause G14 failure if modified, regardless
of ownership classification:

- `lib/protoforge/` — PolicyEngine DSL
- `lib/heidi/` — CognitiveCore, HumanActionEngine
- `api/` — API routes
- `kilo/` — KILO hypothesis generator
- `cascade/` — CASCADE classifier
- `workers/` — Background workers
- `scripts/production-release-gate.ts` — Release gate logic
- `scripts/soak-24h-harness.ts` — Soak harness
- `tests/qualification/` — Qualification test scripts
- `supabase/migrations/` — Database migrations
- `.github/workflows/` — CI workflows (existing tracked ones)

## Owner Decision Required

All 34 files require the repository owner to decide:
1. Commit as legitimate project work, OR
2. Remove from the repository, OR
3. Add to `.gitignore` with narrow rules, OR
4. Declare as persistent user workspace via ownership policy

The qualification process does not make this decision. It preserves all
user work untouched.
