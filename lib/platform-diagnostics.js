const fs = require('fs');
const path = require('path');
const { CapabilityRegistry } = require('../protoforge/packages/capability-registry/src/index');
const { discover } = require('../protoforge/packages/application-manifest/src/index');

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

function requireSafe(file) {
  try {
    return require(path.join(ROOT, file));
  } catch {
    return null;
  }
}

async function fetchHealth(url, timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function checkLedgerAdapter(file) {
  const mod = requireSafe(file);
  if (!mod || !mod.RawLedgerAdapter) {
    return { loaded: true, reachable: false, reason: 'RawLedgerAdapter not exportable' };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { loaded: true, reachable: false, reason: 'Supabase env vars missing' };
  }

  try {
    const adapter = new mod.RawLedgerAdapter({ supabaseUrl: url, supabaseKey: key });
    const h = await adapter.health();
    return { loaded: true, reachable: h.ok, reason: h.ok ? undefined : h.error };
  } catch (err) {
    return { loaded: true, reachable: false, reason: err instanceof Error ? err.message : 'Unknown' };
  }
}

async function checkDependencies(deps) {
  return Promise.all((deps || []).map(async dep => {
    const depLoaded = exists(dep.path);
    const depReachable = dep.require && depLoaded ? !!requireSafe(dep.path) : depLoaded;
    return {
      name: dep.name,
      path: dep.path,
      loaded: depLoaded,
      reachable: depReachable,
      last_checked: new Date().toISOString()
    };
  }));
}

async function checkComponent(def) {
  const registered = true;
  const loaded = exists(def.path);
  const version = def.versionFrom ? readVersion(def.versionFrom) : (loaded ? 'present' : 'missing');
  let reachable = false;
  let dependencies = [];
  let reason = undefined;

  if (loaded && def.checks) {
    for (const check of def.checks) {
      if (check.type === 'require') {
        const target = check.path || def.path;
        const mod = requireSafe(target);
        const ok = !!mod && (check.export ? !!mod[check.export] : true);
        reachable = ok;
        if (!ok) reason = reason || 'module not requireable';
      }

      if (check.type === 'instance') {
        const target = check.path || def.path;
        const mod = requireSafe(target);
        if (mod && mod[check.className]) {
          try {
            new mod[check.className](check.options || {});
            reachable = true;
          } catch (err) {
            reachable = false;
            reason = err instanceof Error ? err.message : 'construction failed';
          }
        } else {
          reachable = false;
          reason = `${check.className} not found`;
        }
      }

      if (check.type === 'fetch') {
        const url = check.env ? process.env[check.env] : (check.url || undefined);
        if (url) {
          reachable = await fetchHealth(url);
          if (!reachable) reason = reason || 'health fetch failed';
        }
      }

      if (check.type === 'ledger') {
        const ledger = await checkLedgerAdapter(check.ledgerFile);
        reachable = ledger.reachable;
        reason = ledger.reason;
      }

      if (check.type === 'dependencies') {
        dependencies = await checkDependencies(def.dependencies);
      }
    }
  } else if (!loaded) {
    reason = 'file not found';
  }

  return {
    name: def.name,
    path: def.path,
    registered,
    loaded,
    reachable,
    version,
    last_checked: new Date().toISOString(),
    dependencies,
    reason,
    deprecated: !!def.deprecated,
    capabilities: def.capabilities || [],
    produces: def.produces || [],
    consumes: def.consumes || [],
    requires: def.requires || []
  };
}

const RUNTIME = {
  'HYDI Event Gateway': {
    checks: [
      { type: 'fetch', env: 'HYDI_GATEWAY_ENDPOINT' },
      { type: 'ledger', ledgerFile: 'protoforge/hydi-gateway/src/adapters/raw-ledger.js' },
      { type: 'dependencies' }
    ],
    dependencies: [
      { name: 'RawLedgerAdapter', path: 'protoforge/hydi-gateway/src/adapters/raw-ledger.js', require: true },
      { name: 'Outbox', path: 'protoforge/hydi-gateway/src/outbox/outbox.js', require: true },
      { name: 'RetryWorker', path: 'protoforge/hydi-gateway/src/outbox/retry-worker.js', require: true }
    ]
  },
  'CASCADE': {
    checks: [
      { type: 'instance', path: 'protoforge/cascade/src/processor.js', className: 'EventProcessor', options: { processorVersion: '1.0' } },
      { type: 'dependencies' }
    ],
    dependencies: [
      { name: 'EventProcessor', path: 'protoforge/cascade/src/processor.js', require: true },
      { name: 'LedgerAdapter', path: 'protoforge/cascade/src/adapters/ledger-adapter.js', require: true },
      { name: 'ReplayEngine', path: 'protoforge/cascade/src/replay.js', require: true },
      { name: 'LineageGraph', path: 'protoforge/cascade/src/derived-store.js', require: true }
    ]
  },
  'CASCADE Replay Engine': {
    checks: [{ type: 'require', export: 'ReplayEngine' }],
    dependencies: []
  },
  'KILO': {
    checks: [
      { type: 'require' },
      { type: 'require', export: 'KiloEngine' }
    ],
    dependencies: []
  },
  'ProtoForge PolicyEngine': {
    checks: [
      { type: 'require' },
      { type: 'require', export: 'PolicyEngine' }
    ],
    dependencies: [
      { name: 'Raw Ledger (source)', path: 'lib/protoforge/raw-ledger.ts', require: false }
    ]
  },
  'Legacy CASCADE Intake': {
    checks: [{ type: 'require' }],
    dependencies: []
  },
  'Legacy CASCADE Core': {
    checks: [{ type: 'require' }],
    dependencies: []
  },
  'Legacy Policy Engine (keeper)': {
    checks: [{ type: 'require' }],
    dependencies: []
  }
};

async function getRuntimeInventory() {
  const registry = new CapabilityRegistry();
  const components = await Promise.all(registry.list().map(entry => {
    const runtime = RUNTIME[entry.name] || {};
    return checkComponent({ ...entry, ...runtime });
  }));

  const canonical = components.filter(c => !c.deprecated);
  const legacy = components.filter(c => c.deprecated);
  const applications = discover([
    path.join(ROOT, 'switchboard'),
    path.join(ROOT, 'protoforge-applications')
  ]);

  return {
    ok: true,
    last_checked: new Date().toISOString(),
    canonical,
    legacy,
    deprecated: legacy,
    applications,
    summary: {
      canonicalReachable: canonical.filter(c => c.reachable).length,
      legacyReachable: legacy.filter(c => c.reachable).length,
      canonicalLoaded: canonical.filter(c => c.loaded).length,
      legacyLoaded: legacy.filter(c => c.loaded).length,
      total: components.length,
      applications: applications.length
    }
  };
}

module.exports = { getRuntimeInventory };
