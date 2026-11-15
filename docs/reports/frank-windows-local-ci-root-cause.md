# Frank Windows local-CI root cause (DESKTOP-I719OIN)

**Status:** ROOT CAUSE IDENTIFIED — FIX VERIFIED (Linux orchestrator replay); **Frank re-run pending**

**Dates:** 2026-11-15  
**Affected commits:** `c881f0c` (`clean-main`), `ff21b57f` (PR #599 NCM)  
**Failed contexts:** `local-ci/unit-tests`, `local-ci/integration-tests`  
**Passed context:** `local-ci/typecheck`

---

## 1. Symptom summary

GitHub commit statuses from Frank (`DESKTOP-I719OIN`) report:

| Context | Description |
|---------|-------------|
| `local-ci/unit-tests` | `Failed: npm run lint` |
| `local-ci/integration-tests` | `Failed: npm run lint:hydi-v3` |
| `local-ci/typecheck` | Passed |

Hosted Actions on the same SHAs pass lint, Jest, integration, and Codecov. Cloud VM (Linux) reproduction on `ff21b57f`:

```text
node scripts/local-ci.js --no-post ff21b57f  → all three checks passed (lint included)
```

**Conclusion:** Failure is **environment-specific to the Frank local-CI parent process**, not application lint regressions on those commits.

Frank log paths (operator — not available on cloud VM):

- `%TEMP%\hydi-local-ci\ff21b57\local-ci-unit-tests.log`
- `%TEMP%\hydi-local-ci\ff21b57\local-ci-integration-tests.log`
- `%TEMP%\hydi-local-ci\c881f0c\` (same filenames for clean-main)

---

## 2. Reproduction matrix

| Execution context | `npm run lint` | `npm run lint:hydi-v3` | `npm run typecheck` | Notes |
|-------------------|----------------|-------------------------|---------------------|-------|
| Cloud VM, main checkout, `ff21b57f` | exit 0 | exit 0 | exit 0 | 1482 warnings, 0 errors |
| Cloud VM, `CI=true` | exit 0 | — | — | Same as direct |
| Cloud VM, `ESLINT_USE_FLAT_CONFIG=true` (parent) | **exit 2** | **exit 2** | exit 0 | Matches Frank failure pattern |
| Cloud VM, `ESLINT_USE_FLAT_CONFIG=true` + `ciChildEnv()` child | exit 0 | — | — | After infrastructure fix |
| Cloud VM, `node scripts/local-ci.js --no-post ff21b57f` | pass | pass | pass | Full orchestrator |
| Frank `local-ci` status | fail | fail | pass | Reported 2026-11-15 |
| GitHub Actions ubuntu | pass | pass | pass | No inherited PM2 env |

**Node/npm (cloud verification):** Node v22.23.4, npm 10.9.9, ESLint 8.57.1 (legacy `.eslintrc.json` + `--ext`).

---

## 3. Root cause (proven on cloud VM)

### 3.1 Mechanism

`scripts/local-ci.js` `run()` previously passed child processes:

```javascript
env: { ...process.env, ...extraEnv, CI: 'true' }
```

On heidi-pc, `hydi-local-ci` runs under **PM2**, which copies the **machine / user environment** into every child. If the parent has:

```text
ESLINT_USE_FLAT_CONFIG=true
```

then every throwaway worktree lint step inherits flat-config mode. This repository’s root lint scripts use **ESLint 8** with **`.eslintrc.json`** and **`--ext`**. In flat-config mode ESLint rejects `--ext` or cannot find a root flat config for `lint:hydi-v3`, and **`npm run` exits 2**.

`npm run typecheck` does **not** use ESLint → `local-ci/typecheck` stays green while both lint-gated checks fail. That triad matches Frank’s statuses on **both** NCM and clean-main (ruling out NCM application changes).

### 3.2 Representative failing output (cloud replay)

With `ESLINT_USE_FLAT_CONFIG=true`:

```text
> eslint api pages ... --ext .js,.jsx,.ts,.tsx
Invalid option '--ext' ...
You're using eslint.config.js, some command line flags are no longer available.
```

`lint:hydi-v3`:

```text
Error: Could not find config file.
```

### 3.3 Why interactive Frank lint may appear green

An operator shell started manually often **does not** include `ESLINT_USE_FLAT_CONFIG`, while PM2’s `hydi-local-ci` **does** → “passes in terminal, fails under orchestrator.”

No `ESLINT_USE_FLAT_CONFIG` is set in-repo (`grep` clean); source is likely **Windows user env**, **PM2 dump**, or a **tooling install default** on Frank.

---

## 4. Infrastructure fix (minimal)

**Branch:** `Cusor_agent01frank-local-ci-eslint-env-7718`  
**Files:**

| File | Change |
|------|--------|
| `scripts/local-ci.js` | `ciChildEnv()` deletes `ESLINT_USE_FLAT_CONFIG`; log line when parent had it |
| `tests/unit/local-ci.test.js` | Unit tests for `ciChildEnv` |
| `LOCAL_CI.md` | Operator note: do not set flat-config env on heidi-pc |

No ESLint rule changes. No NCM / application code changes.

**Verification run (cloud):**

- `npx jest tests/unit/local-ci.test.js` — 23 passed
- `ESLINT_USE_FLAT_CONFIG=true` + child `npm run lint` via `ciChildEnv` — exit 0

---

## 5. Frank operator verification (required to close)

On DESKTOP-I719OIN:

```powershell
# 1) Confirm hypothesis
[Environment]::GetEnvironmentVariable('ESLINT_USE_FLAT_CONFIG', 'User')
[Environment]::GetEnvironmentVariable('ESLINT_USE_FLAT_CONFIG', 'Machine')
pm2 env hydi-local-ci 2>$null | Select-String ESLINT

# 2) After pulling the fix branch
git fetch origin Cusor_agent01frank-local-ci-eslint-env-7718
git worktree add ..\hydi-lci-test origin/Cusor_agent01frank-local-ci-eslint-env-7718
cd ..\hydi-lci-test
npm ci
node scripts/local-ci.js --pr 599
node scripts/local-ci.js c881f0c10b5b0f657a236e97dccba67dfc54a096

# 3) If still red, attach full log tails:
Get-Content "$env:TEMP\hydi-local-ci\*\local-ci-unit-tests.log" -Tail 80
```

If variable is set at user/machine level, **remove it** (preferred) in addition to the code guard.

```powershell
pm2 restart hydi-local-ci --update-env
```

---

## 6. Before / after (expected on Frank)

| Check | Before fix | After fix (expected) |
|-------|------------|----------------------|
| `local-ci/unit-tests` | fail at lint | lint + Jest pass (Supabase required for DB suites) |
| `local-ci/integration-tests` | fail at lint:hydi-v3 | typecheck + lint + integration pass |
| `local-ci/typecheck` | pass | pass |

---

## 7. Remaining blockers

| Blocker | Owner |
|---------|--------|
| Frank log attachment confirming `ESLINT_USE_FLAT_CONFIG` in parent env | Operator |
| `pm2 restart hydi-local-ci` after deploy | Operator |
| PR merge / deploy of infrastructure branch | Maintainer |

---

## 8. Recommended PR scope

Single PR: **local-CI child env sanitization** only (`scripts/local-ci.js`, test, `LOCAL_CI.md`). Do not bundle NCM (#599) or autonomy refactors.

**Final status when Frank re-run is green:** ROOT CAUSE IDENTIFIED — FIX VERIFIED.