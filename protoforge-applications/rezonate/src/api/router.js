const express = require('express');
const crypto = require('crypto');
const { collectDiagnostics } = require('../diagnostics');
const { SampleLibraryAdapter } = require('../adapters/sample-library');
const { packageStems } = require('../export/packaging');

function createApi(repository, config = {}) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  const h = fn => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

  function send(res, data, code = 200) {
    res.status(code).json({ ok: true, ...data });
  }

  const sampleLibrary = new SampleLibraryAdapter({ logger: repository ? repository.logger : undefined });

  app.get('/health', h(async (req, res) => {
    const diag = await collectDiagnostics(repository);
    send(res, { ...diag, requestId: req.requestId });
  }));

  app.post('/projects', h(async (req, res) => {
    send(res, { project: repository.createProject(req.body) }, 201);
  }));

  app.get('/projects', h(async (req, res) => {
    send(res, { projects: repository.listProjects() });
  }));

  app.get('/projects/:id', h(async (req, res) => {
    send(res, { project: repository.getProject(req.params.id) });
  }));

  app.post('/projects/:id/tracks', h(async (req, res) => {
    send(res, { track: repository.createTrack(req.params.id, req.body) }, 201);
  }));

  app.get('/projects/:id/tracks', h(async (req, res) => {
    send(res, { tracks: repository.listTracks(req.params.id) });
  }));

  app.post('/assets', h(async (req, res) => {
    const projectId = req.body.project_id;
    send(res, { asset: repository.registerAsset(projectId, req.body) }, 201);
  }));

  app.get('/assets/:id', h(async (req, res) => {
    send(res, { asset: repository.getAsset(req.params.id) });
  }));

  app.get('/projects/:id/assets', h(async (req, res) => {
    send(res, { assets: repository.listAssets(req.params.id) });
  }));

  app.post('/projects/:id/export', h(async (req, res) => {
    const project = repository.getProject(req.params.id);
    const assets = repository.listAssets(req.params.id);
    const { outputRoot } = req.body || {};
    const result = packageStems({
      projectId: project.id,
      projectName: project.name,
      assets,
      bpm: req.body.bpm || project.tempo,
      key: req.body.key || project.key_signature,
      outputRoot
    });
    send(res, result, 201);
  }));

  app.post('/processing/jobs', h(async (req, res) => {
    const job = repository.createProcessingJob(req.body);
    send(res, { job }, 201);
  }));

  app.get('/processing/jobs/:id', h(async (req, res) => {
    send(res, { job: repository.getProcessingJob(req.params.id) });
  }));

  app.post('/processing/jobs/:id/start', h(async (req, res) => {
    send(res, { job: repository.startProcessingJob(req.params.id) });
  }));

  app.post('/processing/jobs/:id/complete', h(async (req, res) => {
    send(res, { job: repository.completeProcessingJob(req.params.id, req.body || {}) });
  }));

  app.get('/samples', h(async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const all = sampleLibrary.all();
    send(res, { samples: all.slice(0, limit), total: all.length });
  }));

  app.get('/samples/search', h(async (req, res) => {
    const q = req.query.q || '';
    const results = sampleLibrary.searchSamples(q);
    send(res, { query: q, count: results.length, samples: results.slice(0, 100) });
  }));

  app.get('/samples/instrument/:instrument', h(async (req, res) => {
    const results = sampleLibrary.filterByInstrument(req.params.instrument);
    send(res, { instrument: req.params.instrument, count: results.length, samples: results.slice(0, 100) });
  }));

  app.get('/samples/bpm', h(async (req, res) => {
    const min = parseInt(req.query.min, 10) || 0;
    const max = parseInt(req.query.max, 10) || 300;
    const results = sampleLibrary.filterByBPM(min, max);
    send(res, { min, max, count: results.length, samples: results.slice(0, 100) });
  }));

  app.get('/samples/key/:key', h(async (req, res) => {
    const results = sampleLibrary.filterByKey(req.params.key);
    send(res, { key: req.params.key, count: results.length, samples: results.slice(0, 100) });
  }));

  app.get('/engine/status', h(async (req, res) => {
    const { ResonateEngineAdapter } = require('../adapters/resonate-engine');
    const engine = new ResonateEngineAdapter({});
    const available = await engine.isAvailable();
    send(res, { available, path: engine.enginePath });
  }));

  app.use((err, req, res, next) => {
    const status = err.name === 'ValidationError' ? 400 : err.name === 'NotFoundError' ? 404 : err.name === 'ConflictError' ? 409 : 500;
    res.status(status).json({ ok: false, error: err.message, requestId: req.requestId });
  });

  return app;
}

module.exports = { createApi };
