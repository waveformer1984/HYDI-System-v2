# HYDI V2 to V3 Migration Guide

This guide explains how to migrate an existing HYDI V2 deployment to HYDI V3 (Mission Omega).

## Compatibility Statement

HYDI V3 is a **non-invasive wrapper** around V2. No V2 APIs, database tables, or core pipelines are removed or changed. If you do not start `HYDIAutonomyManager`, the system behaves exactly as V2.

## Pre-Migration Checklist

- [ ] Current V2 deployment is stable.
- [ ] Node.js >= 20 is installed.
- [ ] `data/` directory (or configured `dataPath`) is writable.
- [ ] All required environment variables are set.
- [ ] A backup of `data/` and `.env` exists.

## Migration Steps

1. **Pull the V3 codebase**
   ```bash
   git pull origin clean-main
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run validation suite**
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run test:integration
   npm run benchmark:performance
   npm run security-audit
   ```

4. **Review configuration**
   - `HYDISystem` automatically constructs `HYDIAutonomyManager` with V3 defaults.
   - Optional: override V3 flags in `HYDISystem` constructor:
     ```js
     const system = new HYDISystem({
       enableAutoActions: true,
       // V3 flags are passed via autonomyManager config internally
     });
     ```

5. **Back up `data/`**
   ```bash
   cp -r data data-backup-$(date +%Y%m%d)
   ```

6. **Start the system**
   ```bash
   node boot-agent.js
   ```
   or
   ```bash
   npm run dev
   ```

7. **Verify V3 is active**
   ```js
   console.log(system.autonomyManager.getStatus());
   ```

8. **Run a smoke mission**
   ```js
   const missionId = await system.autonomyManager.createMission('migration-smoke', 'Verify V3');
   system.autonomyManager.missionPlanner.addTask(missionId, { type: 'automation', description: 'smoke test' });
   await system.autonomyManager.executeMission(missionId);
   ```

9. **Run production readiness score**
   ```bash
   npm run production-readiness-score
   ```

## Data Migration

No data migration is required. V3 creates new subdirectories under `data/`:

- `data/missions/missions.json`
- `data/decisions/decision_history.json`
- `data/reflections/reflections.json`
- `data/checkpoints/latest.json`

Existing V2 data is untouched.

## Rollback

1. Stop the V3 process.
2. If needed, restore `data/` from the pre-migration backup.
3. Checkout the previous V2 commit.
4. Start the V2 process.

## Post-Migration Validation

- [ ] `manager.getStatus()` reports `started: true`.
- [ ] `manager.getDashboard()` returns current metrics.
- [ ] Unit tests pass (`npm test`).
- [ ] Integration tests pass (`npm run test:integration`).
- [ ] Benchmarks meet targets (`npm run benchmark:performance`).
- [ ] Security audit passes (`npm run security-audit`).
- [ ] Production readiness score >= 90.

## Getting Help

- See `OPERATOR_GUIDE.md` for daily operations.
- See `TROUBLESHOOTING_MANUAL.md` for common issues.
- See `RUNBOOKS.md` in `src/hydi-v3` for quick command references.
