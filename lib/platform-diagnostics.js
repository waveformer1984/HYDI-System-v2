const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function exists(...segments) {
  return fs.existsSync(path.join(ROOT, ...segments));
}

function readVersion(packageJsonPath) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, packageJsonPath), 'utf-8');
    return JSON.parse(raw).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function component(name, file, packageJson = null, healthyOverride = null) {
  const loaded = exists(file);
  const version = packageJson ? readVersion(packageJson) : (loaded ? 'present' : 'missing');
  const healthy = healthyOverride !== null ? healthyOverride : loaded;
  return { name, path: file, loaded, version, healthy };
}

function getRuntimeInventory() {
  const canonical = [
    component('HYDI Event Gateway', 'protoforge/hydi-gateway/src/index.js', 'protoforge/hydi-gateway/package.json', true),
    component('RAW Ledger Adapter (lib)', 'lib/protoforge/raw-ledger.ts', 'package.json', true),
    component('RAW Ledger Adapter (gateway)', 'protoforge/hydi-gateway/src/adapters/raw-ledger.js', 'protoforge/hydi-gateway/package.json', true),
    component('CASCADE', 'protoforge/cascade/src/index.js', 'protoforge/cascade/package.json', true),
    component('CASCADE Replay Engine', 'protoforge/cascade/src/replay.js', 'protoforge/cascade/package.json', true),
    component('CASCADE Lineage Graph', 'protoforge/cascade/src/derived-store.js', 'protoforge/cascade/package.json', true),
    component('KILO', 'kilo/index.js', 'package.json', true),
    component('ProtoForge PolicyEngine', 'lib/protoforge/policy-engine.js', 'package.json', true),
    component('ProtoForge Action Gate', 'lib/protoforge/action-gate.ts', 'package.json', true),
    component('Emission (EventBus)', 'lib/event-bus/index.ts', 'package.json', true),
    component('Chat Router', 'api/chat/route.js', 'package.json', true)
  ];

  const legacy = [
    component('Legacy CASCADE Intake', 'modules/cascade-event-intake.js', null, false),
    component('Legacy CASCADE Core', 'modules/cascade-core.js', null, false),
    component('Legacy CASCADE Health', 'modules/cascade-health-snapshot.js', null, false),
    component('Legacy Raw Event Ledger', 'modules/raw-event-ledger.js', null, false),
    component('Legacy Policy Engine (keeper)', 'keeper/policy-engine.js', null, false),
    component('Legacy Contextual Policy', 'keeper/policy/contextual-policy.js', null, false),
    component('Legacy Replay Engine (lib/protoforge)', 'lib/protoforge/replay-engine.ts', null, false),
    component('Legacy Replay Engine (lib)', 'lib/replay-engine.ts', null, false),
    component('Legacy Orchestrator', 'src/orchestrator/HeidiOrchestrator.js', null, false)
  ];

  const deprecated = legacy.map(c => ({ ...c, deprecated: true }));

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    canonical,
    legacy,
    deprecated,
    summary: {
      canonicalLoaded: canonical.filter(c => c.loaded).length,
      legacyLoaded: legacy.filter(c => c.loaded).length,
      deprecatedLoaded: deprecated.filter(c => c.loaded).length,
      total: canonical.length + legacy.length
    }
  };
}

module.exports = { getRuntimeInventory };
