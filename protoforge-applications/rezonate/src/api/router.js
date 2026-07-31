const express = require('express');
const crypto = require('crypto');
const { collectDiagnostics } = require('../diagnostics');
const { ResonateEngineAdapter } = require('../adapters/resonate-engine');

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

  const engine = new ResonateEngineAdapter({
    eventBus: repository ? repository.eventBus : undefined,
    logger: repository ? repository.logger : undefined
  });

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

  app.post('/projects/:id/assets', h(async (req, res) => {
    send(res, { asset: repository.registerAsset(req.params.id, req.body) }, 201);
  }));

  app.get('/projects/:id/assets', h(async (req, res) => {
    send(res, { assets: repository.listAssets(req.params.id) });
  }));

  app.post('/processing/jobs', h(async (req, res) => {
    const { task_type, source_path, prompt, clip } = req.body;
    let result;
    if (task_type === 'generate') {
      result = await engine.generateSong({ prompt, clip });
    } else if (task_type === 'stems') {
      result = await engine.createStems({ sourcePath: source_path });
    } else if (task_type === 'analyze') {
      result = await engine.analyzeAudio({ sourcePath: source_path });
    } else {
      return res.status(400).json({ ok: false, error: 'unknown task_type' });
    }
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    repository.createProcessingJob({ task_type, source_path, prompt });
    send(res, result, 202);
  }));

  app.get('/processing/jobs/:id', h(async (req, res) => {
    send(res, { job: repository.getProcessingJob(req.params.id) });
  }));

  app.get('/engine/status', h(async (req, res) => {
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
