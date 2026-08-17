const fs = require('fs');
const path = require('path');

function loadManifest() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function collectDiagnostics(repository) {
  const manifest = loadManifest();
  const manifestLoaded = manifest && !manifest.error;
  const capabilities = manifestLoaded ? (manifest.capabilities || []) : [];
  const eventsProduced = manifestLoaded ? (manifest.eventsProduced || []) : [];
  const eventsConsumed = manifestLoaded ? (manifest.eventsConsumed || []) : [];

  const adapterConfigured = repository && !!repository.adapter;
  let engine = {
    configured: adapterConfigured,
    reachable: false,
    status: 'not checked',
    reason: adapterConfigured ? undefined : 'adapter not configured'
  };

  if (adapterConfigured) {
    const health = await repository.engineHealth();
    engine = {
      configured: true,
      reachable: health.ok,
      status: health.status,
      endpoint: health.endpoint,
      reason: health.ok ? undefined : (health.error || 'health check failed')
    };
  }

  return {
    ok: engine.reachable && manifestLoaded,
    status: engine.reachable && manifestLoaded ? 'ok' : 'degraded',
    application: manifest.name || 'Proto YI',
    version: manifest.version || 'unknown',
    manifest: {
      loaded: manifestLoaded,
      capabilities,
      eventsProduced,
      eventsConsumed
    },
    engine,
    timestamp: new Date().toISOString()
  };
}

module.exports = { collectDiagnostics };
