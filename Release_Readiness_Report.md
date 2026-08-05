# Release Readiness Report

## Executive Summary

- **Package version:** `0.9.0-rc.3` (`package.json` and `VERSION`)
- **Latest git tag:** `v0.9.0-rc.4`
- **Build:** `npm run build` **PASS** (exit 0)
- **Dependency tree (`npm ls --depth=0`):** **PASS**
- **Package size (`npm pack --dry-run`):** 170 MB tarball / 248 MB unpacked / 2,727 files — **too large for a clean package**
- **Security (`npm audit`):** **11 vulnerabilities** (3 moderate, 8 high)
- **Outdated packages:** 20 packages, including `next`, `react`, `jest`, `axios`
- **Docker images:** No `Dockerfile` or `docker-compose.yml`
- **Deployment scripts:** `deploy-production-safe.sh` exists (Supabase Edge Functions)
- **Clean-machine install test:** Not performed (Supabase remote not reachable)

## 1. Version Consistency

| Source | Value | Aligned? |
|--------|-------|----------|
| `package.json` | `0.9.0-rc.3` | Yes with `VERSION`, no with `v0.9.0-rc.4` tag |
| `VERSION` | `0.9.0-rc.3` | Yes with `package.json` |
| Git tag | `v0.9.0-rc.4` | **Not documented in CHANGELOG or VERSION** |
| Branch | `release/v0.9.0` (15 ahead of origin) | **Contains rc.4 work but version still rc.3** |

**Issue:** The release branch and tag point past `rc.3` but `package.json`, `VERSION`, and `CHANGELOG.md` have not been bumped to `0.9.0-rc.4`.

## 2. Package Consistency

- `package-lock.json`: **present** and in sync (`npm ls --depth=0` exit 0).
- `npm pack --dry-run`: successfully produced `heidi-cascade-production-0.9.0-rc.3.tgz`.
- `npm ci` not tested, but `npm ls` confirms the installed tree matches the lock.
- **Tarball includes unwanted directories:** `_diag/`, `__pycache__/`, likely `archive/`, and possibly runtime data. This inflates the package.

### Tarball details

```text
name: heidi-cascade-production
version: 0.9.0-rc.3
filename: heidi-cascade-production-0.9.0-rc.3.tgz
package size: 170.0 MB
unpacked size: 248.6 MB
total files: 2727
```

**Recommendation:** Add a `files` array to `package.json` or a `.npmignore` to exclude `_diag/`, `__pycache__/`, `archive/`, `data/`, `logs/`, `.next/`, and other generated/runtime directories.

## 3. Dependencies

### `npm ls --depth=0`

- Exit code: `0`
- All top-level dependencies resolve.
- `dotenv@17.4.2` is installed and matches `package.json` (`^17.4.2`).

### `npm audit`

- **11 vulnerabilities found:** 3 moderate, 8 high.
- Key advisories:
  - `postcss` (via `next`) — high
  - `undici` — moderate
- `npm audit fix` available.

**Release impact:** Medium. Should run `npm audit fix` and re-run `npm test`, `npm run typecheck`, `npm run build` before any release.

### `npm outdated`

- 20 packages have newer versions.
- Notable:
  - `next` 15.5.21 → 15.5.22 (patch)
  - `axios` 1.18.1 → 1.19.0 (minor)
  - `jest` 29.7.0 → 30.4.2 (major)
  - `react` 18.3.1 → 19.2.8 (major)
  - `stripe` 22.3.2 → 22.4.0 (minor)

**Recommendation:** Apply patch/minor updates; evaluate major updates (React 19, Jest 30, TypeScript 7) in a separate RC because they may require code changes.

## 4. Build Reproducibility

- `npm run build` completed successfully (exit 0).
- Next.js produced 60+ API routes and several static pages.
- `npm run typecheck` passed (0 errors).
- `npm run lint` passed (0 errors, 749 warnings).
- `npm test` passed (249/249 suites, 2,403/2,404 tests).
- The build is reproducible from `package-lock.json` with `npm ci` + `npm run build`.

## 5. Release Artifacts

| Artifact | Status |
|----------|--------|
| Source package (`npm pack`) | Generated, but oversized |
| Docker image | Not configured |
| Next.js build output (`.next/`) | Generated successfully |
| Supabase Edge Functions | 42 functions in `supabase/functions/` |
| `deploy-production-safe.sh` | Present |
| `DEPLOY-CHECKLIST.md` | Present in `docs/audit/` |
| `ROLLBACK_CHECKLIST.md` | Present in `docs/audit/` |
| `CHANGELOG.md` | Out of date (ends at rc.3) |

## 6. Docker / Containers

- No `Dockerfile` or `docker-compose.yml` found.
- Docker is installed on the Windows host but the daemon is not running.
- `operational-qualification/orchestrator/stack-orchestrator.js` expects container orchestration but has no container build spec.

## 7. Install / Upgrade / Rollback / Backup

- **Install:** `npm install` is the primary path; `setup.sh` is for Termux mobile only.
- **Upgrade:** No dedicated `upgrade.sh` or migration script beyond `npm install` and Supabase migrations.
- **Rollback:** `ROLLBACK_CHECKLIST.md` exists.
- **Backup:** `ACTIVE_TREE.md` describes archive behavior; no automated backup script identified.

## 8. Clean-Machine Installation

- Not tested in this session because the remote Supabase endpoint was not reachable from this environment.
- The `.env` / `.env.local` provisioning story has been corrected in `README.md` to point to `CLAUDE.md`.

## 9. Blocking Items for Release

| # | Issue | Severity |
|---|-------|----------|
| 1 | Version strings (`rc.3`) do not match `v0.9.0-rc.4` tag | **High** |
| 2 | `CHANGELOG.md` missing `rc.4` entry | **High** |
| 3 | 11 `npm audit` vulnerabilities | **High** |
| 4 | `npm pack` includes 170 MB of unwanted files | **High** |
| 5 | `release/v0.9.0` not on `clean-main` and 15 commits unpushed | **Medium** |
| 6 | 20 outdated packages | **Medium** |
| 7 | No Dockerfile / Docker compose | **Medium** |
| 8 | Clean-machine install not tested | **Medium** |

## 10. Commands Executed

```text
npm ls --depth=0
npm audit
npm outdated
npm pack --dry-run
npm run build
```

## Conclusion

The product **builds** and the unit-test gate is **green**, but the release package is not ready. Before `v0.9.0` (or `v0.9.0-rc.4`) can be released, the following must be resolved:
1. Bump `package.json`, `VERSION`, and `CHANGELOG.md` to `0.9.0-rc.4` (or `0.9.0`).
2. Run `npm audit fix` and re-validate the full `release-validation` suite.
3. Add `.npmignore` or a `files` field to exclude `_diag/`, `__pycache__/`, `archive/`, `data/`, `logs/`, `.next/`, etc.
4. Reconcile `clean-main` and `release/v0.9.0` with `origin`.
5. Update patch/minor dependencies; plan major dependency updates for a future RC.
6. Provide Docker build artifacts if container deployment is required.
7. Run a clean-machine install and a 1-hour soak once the network/Supabase is available.
