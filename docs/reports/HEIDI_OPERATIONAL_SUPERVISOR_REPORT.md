# Heidi operational supervisor

**Module:** `lib/heidi/operational-supervisor.js`  
**Mode:** Read-only — no restarts, no execution

## Capabilities

- Composes `buildOperationsEvidenceSnapshot()`  
- Reads Frank truth availability via `frank-truth-loader`  
- Surfaces `failures` / `warnings` from evidence blocks  
- Emits `recommendations` (collector refresh, ESLint env, pending missions)  

## Not in scope (this slice)

- Automated PM2 restarts  
- Mission auto-approval  
- Revenue submission  

## Verification

`tests/unit/operational-supervisor.test.js` — **SIMULATED PASS** (missing Frank file → UNAVAILABLE + recommendations)

## Usage

```javascript
const { buildOperationalSupervisorReport } = require('./lib/heidi/operational-supervisor');
const report = await buildOperationalSupervisorReport({ root: repoRoot });
```