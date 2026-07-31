const { ResonateEngineAdapter } = require('./adapters/resonate-engine');

async function collectDiagnostics(repository) {
  const adapter = new ResonateEngineAdapter();
  const engineAvailable = await adapter.isAvailable();
  const store = repository ? repository.store.load() : {};

  return {
    ok: true,
    status: 'ok',
    engine: {
      available: engineAvailable,
      path: adapter.enginePath
    },
    store: {
      projects: (store.projects || []).length,
      tracks: (store.tracks || []).length,
      assets: (store.assets || []).length,
      processing_jobs: (store.processing_jobs || []).length
    },
    adapters: {
      resonate_engine: 'loaded'
    },
    timestamp: new Date().toISOString()
  };
}

module.exports = { collectDiagnostics };
