# HYDI V3 Developer Guide

This guide is for engineers adding features, modules, or tests to the `src/hydi-v3` reliability and autonomy layer.

## Repo Layout

```
src/hydi-v3/           # V3 modules
src/HYDISystem.js      # V2 system that wires the autonomy manager
tests/unit/hydi-v3/    # V3 unit tests
tests/integration/hydi-v3-integration.test.js
docs/hydi-v3/          # This documentation
scripts/               # Operational scripts
```

## Module Conventions

Every V3 module should follow these patterns:

1. **CommonJS and `'use strict'`**:
   ```js
   'use strict';
   const { EventEmitter } = require('events');
   ```

2. **Constructor takes a `config` object and spreads defaults**:
   ```js
   class MyModule extends EventEmitter {
     constructor(config = {}) {
       super();
       this.config = {
         defaultOption: config.defaultOption || true,
         ...config,
       };
     }
   }
   ```

3. **`initialize()`/`destroy()` lifecycle**:
   - `initialize()` should be safe to call multiple times.
   - `destroy()` must clear timers, Maps, listeners, and stop background work.

4. **Persistence**:
   - If state must survive restarts, write to `data/` under a subfolder.
   - Use `JSON.stringify` with a Map replacer if you store `Map` objects.
   - Call `persist()` on state changes or at shutdown.

5. **Events**:
   - Emit semantic events (`eventName`, payload) so `AutonomyManager` can listen.
   - Common events: `started`, `stopped`, `error`, `completed`, `failed`.

6. **`getStatus()`**:
   - Every module must expose `getStatus()` returning a stable, serializable object.

## Adding a New V3 Module

1. Create `src/hydi-v3/MyModule.js` following the conventions above.
2. Export it from `src/hydi-v3/index.js`:
   ```js
   module.exports.MyModule = require('./MyModule');
   ```
3. Construct and wire it in `src/hydi-v3/AutonomyManager.js`:
   - Add `this.myModule = new MyModule({ ... })` in the constructor.
   - Start/stop it in `start()`/`stop()` if it has background work.
   - Add a public accessor method if operators need it.
   - Add `this.myModule.destroy()` in `destroy()`.
4. Add unit tests in `tests/unit/hydi-v3/MyModule.test.js`.
5. Update `tsconfig.typecheck.json` if the new script is outside `src/hydi-v3`.
6. Update `package.json` `lint` if you add a script in `scripts/`.
7. Update this documentation.

## Running Tests

```bash
# Unit tests (Jest)
npm test

# V3 integration tests
npm run test:integration

# Long-running stability simulation
npm run test:soak

# Performance benchmarks
npm run benchmark:performance

# Security audit
npm run security-audit
```

## Lint and Typecheck

```bash
npm run lint
npm run typecheck
```

- TypeScript is configured with `allowJs` and `checkJs: false`. The build ignores type errors, but the project still runs `tsc --noEmit` to surface issues.
- ESLint targets `src/hydi-v3`, `tests/unit/hydi-v3`, and the operational scripts.

## Using the V3 API

### Basic Manager Lifecycle

```js
const HYDIAutonomyManager = require('./src/hydi-v3');

const manager = new HYDIAutonomyManager({
  coreLoop,
  config: {
    dataPath: './data',
    enableWatchdog: true,
    enableHeartbeat: true,
    enableMissionPlanning: true,
    enableDecisionIntelligence: true,
    enableReflection: true,
    enableSelfHealing: true,
    enableDistributedCompute: true,
    enableMemoryIntegrity: true,
    enableObservability: true,
    enableSecurity: true,
  },
});

await manager.start();
const status = manager.getStatus();
await manager.stop();
```

### Missions

```js
const missionId = await manager.createMission('revenue-push', 'Launch outreach campaign');
manager.missionPlanner.addObjective(missionId, { description: 'Build contact list' });
const taskA = manager.missionPlanner.addTask(missionId, { type: 'automation', description: 'Find leads' });
const taskB = manager.missionPlanner.addTask(missionId, {
  type: 'outreach',
  description: 'Send email',
  dependencies: [taskA],
});
await manager.executeMission(missionId);
```

### Decisions

```js
const decision = await manager.decisionIntelligence.makeDecision(
  {
    action: 'send_offer',
    confidence: 0.85,
    reason: 'high_intent_signal',
    expectedValue: 50,
    riskScore: 0.1,
  },
  { task: { type: 'revenue' } }
);
```

### Self-Healing

```js
const result = await manager.selfHealing.heal(
  { type: 'api_failure', target: 'stripe' },
  { retry_with_backoff: async () => ({ success: true }) }
);
```

### Reflection

```js
const mission = manager.missionPlanner.getMission(missionId);
const reflection = await manager.reflectionEngine.reflectOnMission(mission);
const best = manager.reflectionEngine.getBestStrategy('revenue');
```

## Testing Checklist for New Modules

- [ ] Constructor accepts `config` and applies defaults.
- [ ] `initialize()` and `destroy()` are idempotent.
- [ ] `getStatus()` returns a stable object.
- [ ] All `EventEmitter` listeners are removed in `destroy()`.
- [ ] Unit tests pass and do not leak timers.
- [ ] Module is exported from `src/hydi-v3/index.js`.
- [ ] `AutonomyManager` wires start/stop/destroy correctly.
