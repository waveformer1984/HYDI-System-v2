# CI Production-Readiness Audit

Date: 2026-08-14
Branch: `release/v0.9.0`

## Workflows inventory

| Workflow | File | Trigger | What it does |
|---|---|---|---|
| Unit Tests | `.github/workflows/unit-tests.yml` | `push` to `clean-main`, `pull_request` | `npm ci`, `npm run lint`, `npm test -- --coverage` |
| Integration Tests | `.github/workflows/integration-tests.yml` | `push` to `clean-main`, `pull_request` | `npm ci`, `npm run typecheck:hydi-v3`, `npm run lint:hydi-v3`, `npm run test:integration:jest` |
| HYDI Governance Gate | `.github/workflows/hdi-governance-gate.yml` | `push`/`pull_request` touching `supabase/migrations/**` | 7-gate migration pipeline (adversarial, replay, SLO, blueprint sync) |
| CodeQL Security Scan | `.github/workflows/codeql.yml` | `push`/`pull_request` to `clean-main`, weekly | Autobuild + security/quality query suite |
| Health Monitor | `.github/workflows/health-monitor.yml` | schedule `*/5`, `workflow_dispatch` | GitHub API/Actions checks, Vercel env check, critical alert issue |
| Deploy Mobile Chat to GitHub Pages | `.github/workflows/deploy-pages.yml` | `push` to `clean-main` under `docs/**`, `workflow_dispatch` | Publishes `docs/` to Pages |
| Dependency updates | `.github/dependabot.yml` | N/A | Dependabot config |

## What is covered

| Gate | CI covered? | Evidence |
|---|---|---|
| Install | Yes | `npm ci` in unit/integration/governance workflows |
| Typecheck (HYDI V3) | Yes | `npm run typecheck:hydi-v3` in integration |
| Typecheck (full repo) | **No** | `npm run typecheck` is not run in CI |
| Unit tests | Yes | `npm test -- --coverage` in unit-tests |
| Lint | Yes | `npm run lint` in unit-tests; `npm run lint:hydi-v3` in integration |
| Build (production) | **No** | `npm run build` is not run in CI |
| Security checks | Partial | CodeQL scans; no explicit secret scan or `npm run security-audit` |
| Persistence guard | **No** | `npx jest tests/unit/persistence-guard.test.js` not in CI |
| Readiness | **No** | `npm run hydi:readiness` not in CI |
| Backup/restore | **No** | Not in CI |
| Adversarial/chaos | Partial | Only when migrations change (`hdi-governance-gate.yml`) |
| Local-first soak | **No** | No long-running qualification in CI |

## Gaps

1. **No full `npm run typecheck` in CI**. The repo-wide `typecheck` script (`tsc --noEmit`) is not run. Only `typecheck:hydi-v3` is.
2. **No production build gate**. `npm run build` (4m24s local, passed) is not verified. This is a P1 production readiness gap.
3. **No build artifact secret scan**. After build, no CI step searches `.next/` for `sk_live_` / `whsec_` / `sb_secret_` values.
4. **No persistence-guard test**. The canonical `tests/unit/persistence-guard.test.js` is not explicitly run.
5. **No readiness check**. `npm run hydi:readiness` is not run in CI.
6. **No secret leak prevention**. No `git-secrets`, `trufflehog`, or `npm run security-audit` step.
7. **Branch mismatch**. Workflows trigger on `clean-main`. Current work is on `release/v0.9.0`, which may never receive CI if not merged to `clean-main`.
8. **No deployment workflow**. Deployment is via Vercel CLI or dashboard, not an automated `deploy.yml`. This is acceptable if not authorized, but it means the deployment step is `UNVERIFIED`.

## Required minimal CI additions

Add or extend a workflow (smallest appropriate) to cover the missing P1 gates. The suggested workflow is a new `.github/workflows/production-gates.yml` or an extension of `unit-tests.yml`:

```yaml
- name: Full typecheck
  run: npm run typecheck
- name: Production build
  run: npm run build
- name: Persistence guard
  run: npx jest tests/unit/persistence-guard.test.js
- name: Readiness smoke
  run: npm run hydi:readiness
```

Do **not** add the local-first soak to CI; it is an interactive qualification artifact. Do **not** add `npm run test:integration:jest` to `unit-tests.yml` because it requires a live Supabase.

## Verdict

CI is **FUNCTIONAL** for unit tests and V3 integration, but it is **MISSING** the production build, full typecheck, persistence guard, and readiness gates. It is also **UNVERIFIED** whether CI passes on `release/v0.9.0` because the current branch is not `clean-main`.
