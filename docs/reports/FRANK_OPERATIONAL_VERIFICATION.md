# Frank operational verification (operator procedure)

**Status:** NOT EXECUTED by cloud agent — run on `DESKTOP-I719OIN` (Frank).

## Preconditions

- Repo: `C:\Users\Owner\HYDI-System-v2` (canonical tree per `ACTIVE_TREE.md`)
- Branch: `clean-main` after **#601** merge (or test branch checkout)
- Node ≥ 22, `npm ci` or `npm install` complete
- PM2: `hydi-local-ci` present in `ecosystem.config.js`

## Step 0 — Record baseline

```powershell
$ts = (Get-Date).ToUniversalTime().ToString("o")
cd C:\Users\Owner\HYDI-System-v2
git fetch origin clean-main
git rev-parse HEAD
git status -sb | Tee-Object -FilePath ".runtime\acceptance\frank-git-$ts.txt"
```

## Step 1 — Reproduce parent ESLint pollution

```powershell
$env:ESLINT_USE_FLAT_CONFIG = "true"
npm run lint  # expect exit 2 BEFORE fix if ciChildEnv not used
```

## Step 2 — Run local-CI orchestrator (authoritative)

```powershell
$env:ESLINT_USE_FLAT_CONFIG = "true"
node scripts/local-ci.js HEAD 2>&1 | Tee-Object -FilePath ".runtime\acceptance\frank-local-ci-$ts.log"
if ($LASTEXITCODE -ne 0) { throw "local-ci failed" }
```

Expected log line when parent had flat-config: `[local-ci] ciChildEnv: removed inherited ESLINT_USE_FLAT_CONFIG from child environment`

## Step 3 — Verify GitHub status publication

If `local-ci` posts to GitHub (default when token present):

- Commit status contexts: `local-ci/unit-tests`, `local-ci/integration-tests`, `local-ci/typecheck` → **success**
- Capture screenshot or `gh api repos/waveformer1984/HYDI-System-v2/commits/<sha>/status`

## Step 4 — PM2 hydi-local-ci

```powershell
pm2 describe hydi-local-ci
pm2 restart hydi-local-ci --update-env
Start-Sleep -Seconds 120
pm2 logs hydi-local-ci --lines 80 --nostream
```

Success: next scheduled pass reports lint **passed** on `clean-main` HEAD.

## Step 5 — Optional persistent env cleanup

```powershell
# User or system env — only if still set
[Environment]::GetEnvironmentVariable("ESLINT_USE_FLAT_CONFIG","User")
[Environment]::GetEnvironmentVariable("ESLINT_USE_FLAT_CONFIG","Machine")
```

## Evidence to attach

| Artifact | Path |
|----------|------|
| local-ci log | `.runtime/acceptance/frank-local-ci-*.log` |
| git state | `.runtime/acceptance/frank-git-*.txt` |
| pm2 logs | paste or file |

Cloud agent **must not** mark Frank verification complete without these artifacts from Frank.