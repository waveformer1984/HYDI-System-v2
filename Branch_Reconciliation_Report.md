# Branch Reconciliation Report

## Executive Summary

- **Requested target:** `protoforge-factory` vs `clean-main`
- **Finding:** `protoforge-factory` does **not** exist as a current `HEAD` or remote ref. No entry was found in `git branch -a`, `git for-each-ref`, or `git reflog --all` for a ref named `protoforge-factory`. The closest matches are archived remote branches (`origin/archive/origin-claude-*-protoforge-*`) from earlier Claude sessions.
- **Actual divergence found:**
  - `clean-main` ↔ `origin/clean-main`: **29 ahead, 23 behind** (merge base `d6e1e9e`)
  - `release/v0.9.0` ↔ `clean-main`: **81 ahead, 0 behind** (release is a direct descendant)
  - `release/v0.9.0` ↔ `origin/release/v0.9.0`: **15 ahead** (already covered in `Repository_Health_Report.md`)
  - `phase21-scratch` ↔ `origin/phase21-scratch`: **19 ahead**

## The `protoforge-factory` Investigation

| Search | Command | Result |
|--------|---------|--------|
| Local branches | `git branch -a \| Select-String protoforge-factory` | None |
| All refs | `git for-each-ref ... \| Select-String protoforge` | 3 archive branches only (see above) |
| Reflog | `git reflog --all \| Select-String protoforge-factory` | None |

**Conclusion:** `protoforge-factory` is not a current branch. It may have been an old working name, may have been archived or deleted, or may have never been pushed. No reconciliation is possible against a non-existent ref.

## `clean-main` vs `origin/clean-main` Divergence

- **Merge base:** `d6e1e9e0751d04f29dcfbcb1077d72fcaddab748`
- **Local `clean-main` ahead by 29** (commits present locally, not on `origin/clean-main`)
- **Local `clean-main` behind by 23** (commits on `origin/clean-main`, not in local `clean-main`)
- **Result:** Bidirectional drift — a straight merge would require conflict resolution.

### Commits on `clean-main` not in `origin/clean-main` (29)

Representative topics:

- `Phase 20` / `Phase 19` — Outcome Intelligence & Learning
- `Phase 18A/B/C` — Business Event Bus, Signal integration, Physical Operations
- `Phase 17` — Immutable audit ledger & trust
- `Phase 15` — Data integrity / operator surface
- `Phase 14A`–`Phase 11` — Strategy, execution, orchestration, BusinessMemory
- `fix(hydi-v3)` — persistence, debounced persist, shutdown/recovery tests
- `fix(local-model-adapter)` — import corrections

**Classification:** **MERGE** — these are the latest executive-OS and hydi-v3 hardening commits on the canonical primary branch. They should be pushed/reconciled with `origin/clean-main` and ultimately flow into `release/v0.9.0`.

### Commits on `origin/clean-main` not in local `clean-main` (23)

Representative topics:

- `feature/hydi-v2-infra-port` merge (#234)
- Lint/module-collision fixes after infra port
- Phase 1–6 — System observability, metrics, job queue, watchdog, customer/subscription, financial ledger, event bus
- Heidi Bridge / ProtoForge Core / Supabase Edge Functions integration
- Ollama timeout/provider fallback
- Core autonomy bug fixes
- `KEEPER_BREAK_GLASS_TOKEN` and `verify-supabase` fixes

**Classification:** **MERGE** — these are the infra-port, observability, and integration foundation commits. They must be pulled into the local canonical branch.

**Recommendation:** Rebase or merge `origin/clean-main` into local `clean-main`, run the full `release-validation` suite, then push. Alternatively, if the 29 local commits are to become `release/v0.9.0`, merge `clean-main` into `release/v0.9.0` and reconcile with `origin/release/v0.9.0`.

## `release/v0.9.0` vs `clean-main` Divergence

- **Direction:** `release/v0.9.0` is **81 commits ahead** of `clean-main`; `clean-main` is not ahead of `release/v0.9.0` at all.
- **Diff magnitude:** 584 files changed, **66,403 insertions(+), 21,766 deletions(-)**
- **Nature:** `release/v0.9.0` is a direct descendant of `clean-main` plus the v0.9 release-candidate work (Phases 37–44, RCs, qualification docs).

### Top file groups changed (`clean-main..release/v0.9.0`)

| Area | Content | Classification |
|------|---------|----------------|
| `docs/audit/*`, `RC*_GO_NO_GO_REPORT.md`, `RELEASE_*.md` | Qualification reports, Go/No-Go, audit evidence | **ARCHIVE** |
| `src/hydi-v3/*` | Executive OS, federation, marketplace, lifecycle, sensors, V3 runtime | **MERGE** |
| `tests/unit/hydi-v3/*`, `tests/integration/*` | V3 unit/integration tests | **MERGE** |
| `supabase/migrations/*` | DB migrations for governance, customer identity, financial ledger | **MERGE** |
| `operational-qualification/*` | Runtime qualification harness | **MERGE** / **ARCHIVE** depending on release policy |
| `apps/ursula-frontend/*` | Dashboard, UI components | **MERGE** |
| `api/*`, `supervisor.js` | API routes and supervisor fixes | **MERGE** |

## Classification Summary

| Branch / Ref | Classification | Rationale |
|--------------|----------------|-----------|
| `origin/clean-main` 23 missing commits | **MERGE** | Infra-port, observability, integrations — core platform |
| `clean-main` 29 unpushed commits | **MERGE** | Latest executive-OS/hydi-v3 development on canonical branch |
| `release/v0.9.0` source changes (Phases 37–44, src/hydi-v3, migrations, tests, api) | **MERGE** | Production-hardening and V3 executive runtime |
| `release/v0.9.0` qualification/audit documents | **ARCHIVE** | Evidence artifacts; keep on release branch but do not merge to `clean-main` as source code |
| `phase21-scratch` 19 unpushed commits | **REVIEW** | Scratch/hardening branch; likely superseded by `release/v0.9.0`. Inspect before keeping |
| `archive/*` branches | **ARCHIVE** | Historical Claude/archive branches. Do not delete unless explicit policy, but do not merge |
| `protoforge-factory` (missing) | **N/A** | No action possible — branch does not exist |

## Merge Recommendations

1. **Primary action:** Merge `origin/clean-main` → local `clean-main` to close the 23-commit gap.
2. **Secondary action:** Decide whether `release/v0.9.0` should fast-forward from `clean-main` or be merged into `clean-main`. Since `release/v0.9.0` is 81 commits ahead and contains the qualification payload, the clean path is:
   - Merge `origin/clean-main` into `clean-main`
   - Merge `clean-main` into `release/v0.9.0` (ff-possible because release already contains clean-main)
   - Run `release-validation` on `release/v0.9.0`
   - Push `release/v0.9.0` to `origin`
3. **Archive:** Keep `docs/audit/*` and `operational-qualification/reports/*` on the release branch; do not let documentation-only files drive `clean-main` source drift.
4. **Delete/review `phase21-scratch`** after confirming its commits are captured in `release/v0.9.0`.

## Commands Executed

```text
git branch -vv
git merge-base clean-main origin/clean-main
git rev-list --count clean-main..origin/clean-main
git rev-list --count origin/clean-main..clean-main
git rev-list --count clean-main..release/v0.9.0
git rev-list --count release/v0.9.0..clean-main
git log --oneline clean-main..origin/clean-main
git log --oneline origin/clean-main..clean-main
git log --oneline clean-main..release/v0.9.0
git diff --stat clean-main..release/v0.9.0
git for-each-ref ... | Select-String protoforge
git reflog --all | Select-String protoforge-factory
```

## Conclusion

There is no `protoforge-factory` divergence to reconcile because the ref does not exist. The real reconciliation work is between `clean-main`/`origin/clean-main` (bidirectional) and `release/v0.9.0`/`origin/release/v0.9.0` (unidirectional, unpushed). The `release/v0.9.0` branch is a valid release-candidate descendant, but its 15 unpushed commits (especially the large documentation payload) need an explicit merge and push plan. `clean-main` must be reconciled with its upstream before `release/v0.9.0` can be certified.
