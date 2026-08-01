# Legacy Component Migration Guide

## Goal

Move every legacy component to its canonical replacement before Phase 5 removal. No new code should depend on the legacy paths after this phase.

## Legacy modules

### 1. `modules/cascade-event-intake.js`

- **Why it exists**: Normalized signals into an older CASCADE format and emitted `cascade_output` events.
- **Replacement**: `protoforge/cascade/src/processor.js` and `compatibility/cascade-legacy.js`
- **Migration example**:

```js
// Before
const CascadeEventIntake = require('./modules/cascade-event-intake');
const intake = new CascadeEventIntake();
await intake.receive(raw, 'vercel');

// After
const { LegacyCascade } = require('./compatibility/cascade-legacy');
const legacy = new LegacyCascade();
legacy.process(raw, 'vercel');
```

- **Planned removal**: Phase 5.

### 2. `modules/cascade-core.js`

- **Why it exists**: Detect, classify, and emit structured events.
- **Replacement**: `protoforge/cascade/src/processor.js`
- **Migration example**:

```js
// Before
const CascadeCore = require('./modules/cascade-core');
const core = new CascadeCore();

// After
const { EventProcessor } = require('./protoforge/cascade/src/processor');
const p = new EventProcessor({ versionAdapters: new Map() });
p.process(canonicalEvent);
```

- **Planned removal**: Phase 5.

### 3. `modules/cascade-health-snapshot.js`

- **Why it exists**: Real-time system state snapshots.
- **Replacement**: `lib/platform-diagnostics.js` and `api/platform/diagnostics.js`
- **Migration example**:

```bash
curl /api/platform/diagnostics
```

- **Planned removal**: Phase 5.

### 4. `modules/raw-event-ledger.js`

- **Why it exists**: File-based immutable raw-event store.
- **Replacement**: `protoforge/hydi-gateway/` or `compatibility/raw-ledger-legacy.js`
- **Migration example**:

```js
// Before
const RawEventLedger = require('./modules/raw-event-ledger');
const ledger = new RawEventLedger();
await ledger.appendRawEvent(raw, { source: 'vercel' });

// After
const { LegacyRawLedger } = require('./compatibility/raw-ledger-legacy');
const ledger = new LegacyRawLedger({ supabaseUrl, supabaseKey });
await ledger.appendRawEvent(raw, { source: 'vercel' });
```

- **Planned removal**: Phase 5.

### 5. `keeper/policy-engine.js`

- **Why it exists**: Whitelist-based agent permissions.
- **Replacement**: `lib/protoforge/policy-engine.js` or `compatibility/policy-legacy.js`
- **Migration example**:

```js
// Before
const { PolicyEngine } = require('./keeper/policy-engine');

// After
const { PolicyEngine } = require('./compatibility/policy-legacy');
```

- **Planned removal**: Phase 5.

### 6. `keeper/policy/contextual-policy.js`

- **Why it exists**: Context-aware policies with cron.
- **Replacement**: `lib/protoforge/policy-engine.js`
- **Migration example**: Load rules into the `policies` table and use `PolicyEngine.evaluate()`.
- **Planned removal**: Phase 5.

### 7. `lib/protoforge/replay-engine.ts`

- **Why it exists**: V2 determinism validator.
- **Replacement**: `protoforge/cascade/src/replay.js`
- **Migration example**:

```js
// After
const { ReplayEngine } = require('./protoforge/cascade/src/replay');
const replay = new ReplayEngine({ ledger, processor, store, metrics });
await replay.replay({ from: 'beginning' });
```

- **Planned removal**: Phase 5.

### 8. `lib/replay-engine.ts`

- **Why it exists**: Earlier replay engine variant.
- **Replacement**: `protoforge/cascade/src/replay.js`
- **Planned removal**: Phase 5.

### 9. `api/chat/route.js` `legacyHandleCascadeMessage`, `legacyHandleKiloMessage`, `legacyHandleProtoForgeMessage`

- **Why they exist**: Chatbot facade for named agents.
- **Replacement**: Direct integration with `protoforge/cascade/`, `kilo/index.js`, `lib/protoforge/policy-engine.js`
- **Migration example**: Replace chat handler bodies with real calls to the canonical modules.
- **Planned removal**: Phase 6 (UI migration).

## Timeline

| Phase | Action |
|---|---|
| Phase 4C (now) | Mark deprecated, create compatibility wrappers, document migrations |
| Phase 5 | Remove legacy modules; all callers must use canonical or compatibility paths |
| Phase 6 | Remove chat stubs and compatibility wrappers once UIs migrate |
