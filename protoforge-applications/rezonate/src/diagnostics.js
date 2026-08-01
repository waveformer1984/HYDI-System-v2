const { ResonateEngineAdapter, createDefaultRunner } = require('./adapters/resonate-engine');

async function collectDiagnostics(repository) {
  const engine = new ResonateEngineAdapter({ runner: createDefaultRunner() });
  const engineAvailable = await engine.isAvailable();
  const store = repository ? repository.store.load() : {};

  return {
    ok: true,
    status: 'ok',
    engine: {
      available: engineAvailable,
      path: engine.enginePath
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
