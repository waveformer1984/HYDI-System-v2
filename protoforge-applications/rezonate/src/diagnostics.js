const { ResonateEngineAdapter } = require('./adapters/resonate-engine');

async function collectDiagnostics(repository) {
  const engine = new ResonateEngineAdapter();
  const health = await engine.audioProvider.health();
  const engineAvailable = health.available === true;
  const store = repository ? repository.store.load() : {};

  return {
    ok: true,
    status: 'ok',
    engine: {
      available: engineAvailable,
      path: engine.enginePath,
      audioProvider: health.provider || 'local',
      cloudDependency: health.cloudDependency || false,
      modelAvailable: health.modelAvailable || false,
      modelPath: health.modelPath || null,
      command: health.command || null,
      reason: health.reason || null
    },
    store: {
      projects: (store.projects || []).length,
      tracks: (store.tracks || []).length,
      assets: (store.assets || []).length,
      processing_jobs: (store.processing_jobs || []).length,
      ownership_records: (store.ownership_records || []).length,
      rights: (store.rights || []).length
    },
    adapters: {
      resonate_engine: 'loaded'
    },
    timestamp: new Date().toISOString()
  };
}

module.exports = { collectDiagnostics };
