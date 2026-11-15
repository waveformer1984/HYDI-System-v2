# Frank local-CI verification procedure (post-merge)

Run on **DESKTOP-I719OIN** after merging PR #600 (or equivalent `ciChildEnv` fix).

```powershell
cd C:\Users\Owner\HYDI-System-v2
git pull origin clean-main

# Hypothesis check (booleans only — no secrets)
[Environment]::GetEnvironmentVariable('ESLINT_USE_FLAT_CONFIG','User')
[Environment]::GetEnvironmentVariable('ESLINT_USE_FLAT_CONFIG','Machine')
$env:ESLINT_USE_FLAT_CONFIG

pm2 restart hydi-local-ci --update-env

node scripts/local-ci.js c881f0c10b5b0f657a236e97dccba67dfc54a096
echo "exit=$LASTEXITCODE"

node scripts/local-ci.js --pr 599
echo "exit=$LASTEXITCODE"

Get-ChildItem "$env:TEMP\hydi-local-ci" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, LastWriteTime
Get-Content "$env:TEMP\hydi-local-ci\<short>\local-ci-unit-tests.log" -Tail 40
```

**Incident closed only when:** both `local-ci.js` runs exit 0 and GitHub statuses show green for all three `local-ci/*` contexts on the tested SHAs.