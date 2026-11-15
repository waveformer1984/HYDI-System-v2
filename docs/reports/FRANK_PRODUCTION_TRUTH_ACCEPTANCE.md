# Frank production truth acceptance

**Machine-readable:** `FRANK_PRODUCTION_TRUTH_ACCEPTANCE.json` (generated when collector file present)

## Components

| Component | Role | Test tier |
|-----------|------|-----------|
| `scripts/frank-production-truth-collect.ps1` | Frank-side read-only collector (schema v2) | **BLOCKED** live |
| `lib/observation/frank-truth-loader.js` | LIVE / CACHED / UNAVAILABLE + redaction | **Unit PASS** |
| `operations-evidence-snapshot.js` | Never labels CACHED as LIVE; `not_live` flag | **Unit PASS** |
| `.runtime/production-truth/` | Artifact directory on Frank | **EMPTY** on cloud VM |

## Validation rules implemented

1. Schema 1 or 2 only  
2. File age → CACHED after 15 min (configurable)  
3. `collected_at` vs mtime skew warning  
4. Probe summary tagged with same mode as bundle (LIVE/CACHED)  
5. PM2 `env_keys_sample` redacted in loader output  

## Frank operator instructions

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank-production-truth-collect.ps1
# Copy path printed; optionally scp to cloud agent — do not commit.
```

After file lands in `.runtime/production-truth/`:

```bash
node -e "const {loadLatestFrankProductionTruth}=require('./lib/observation/frank-truth-loader'); console.log(loadLatestFrankProductionTruth());"
```

## Acceptance result (this environment)

| Check | Result |
|-------|--------|
| LIVE Frank JSON ingested | **BLOCKED** |
| CACHED vs LIVE distinction | **SIMULATED** (unit tests) |
| Secret redaction | **SIMULATED** (unit test) |
| Heidi ops snapshot integration | **CODE** |