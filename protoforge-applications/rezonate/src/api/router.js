const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { collectDiagnostics } = require('../diagnostics');
const { SampleLibraryAdapter } = require('../adapters/sample-library');
const { packageStems } = require('../export/packaging');
const { ResonateEngineAdapter, createDefaultStemRunner } = require('../adapters/resonate-engine');
const cors = require('cors');

function createApi(repository, config = {}) {
  const app = express();
  app.use(cors());
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

  const engine = config.engine || new ResonateEngineAdapter({
    eventBus: repository ? repository.eventBus : undefined,
    logger: repository ? repository.logger : undefined,
    stemRunner: config.stemRunner || createDefaultStemRunner()
  });

  const sampleLibrary = new SampleLibraryAdapter({ logger: repository ? repository.logger : undefined });

  // ── Static product UI ─────────────────────────────────────────────
  app.use(express.static(require('path').join(__dirname, '..', '..', 'public')));

  // ── Customer orders — the canonical product journey ───────────────
  // Payment truth lives ONLY in the main app's customer_jobs + webhook
  // path. Rezonate never marks itself paid; it reads the real job state.
  const MAIN_APP = process.env.MAIN_APP_URL || 'http://localhost:3000';

  app.post('/orders', h(async (req, res) => {
    const order = repository.createOrder(req.body || {});
    // Mint a real checkout through the qualified payment path.
    const jr = await fetch(`${MAIN_APP}/api/revenue/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerEmail: order.customer_email,
        customerName: order.customer_name || 'Rezonate customer',
        product: 'rezonate_song',
        requestText: order.prompt,
        requirements: { duration: order.duration, mood: order.mood, rezonate_order_id: order.id },
        successUrl: `http://localhost:${config.port || 3001}/?order=${order.id}`,
        cancelUrl: `http://localhost:${config.port || 3001}/?order=${order.id}`
      })
    }).then(r => r.json()).catch(() => null);
    if (!jr || !jr.checkoutUrl || !jr.jobId) {
      const failed = repository.updateOrder(order.id, { status: 'failed', error: jr?.error || 'checkout unavailable' });
      return res.status(502).json({ ok: false, error: failed.error, order: failed });
    }
    const updated = repository.updateOrder(order.id, { payment_job_id: jr.jobId, checkout_url: jr.checkoutUrl });
    send(res, { order: updated }, 201);
  }));

  app.get('/orders/:id', h(async (req, res) => {
    const order = repository.getOrder(req.params.id);
    // Payment sync: read the authoritative job state from the main app.
    if (order.status === 'awaiting_payment' && order.payment_job_id) {
      const jr = await fetch(`${MAIN_APP}/api/revenue/jobs/${order.payment_job_id}`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null);
      const pay = jr?.job?.paymentStatus ?? jr?.job?.payment_status ?? null;
      if (pay === 'paid') {
        repository.updateOrder(order.id, { status: 'paid', payment_status: 'paid' });
        // Generation begins only after the real webhook-confirmed payment.
        const pjob = repository.createProcessingJob({ task_type: 'generate', prompt: order.prompt, clip: order.duration < 60 });
        repository.updateOrder(order.id, { status: 'generating', processing_job_id: pjob.id });
        try {
          repository.startProcessingJob(pjob.id);
          const result = await engine.generateSong({ prompt: order.prompt, duration: order.duration, clip: order.duration < 60, projectId: null });
          if (!result.ok) {
            repository.failProcessingJob(pjob.id, result.error);
            repository.updateOrder(order.id, { status: 'failed', error: result.error });
          } else {
            const asset = repository.registerAsset(null, {
              type: 'generated_song', file_path: result.audioPath,
              metadata: { source: 'order', orderId: order.id, prompt: order.prompt, provider: result.provider, model: result.model }
            });
            repository.completeProcessingJob(pjob.id, { audioPath: result.audioPath, assetId: asset.id });
            repository.updateOrder(order.id, { status: 'ready', asset_id: asset.id });
          }
        } catch (e) {
          repository.failProcessingJob(pjob.id, e instanceof Error ? e.message : String(e));
          repository.updateOrder(order.id, { status: 'failed', error: 'generation failed' });
        }
      }
    }
    send(res, { order: repository.getOrder(req.params.id) });
  }));

  app.get('/orders/:id/download', h(async (req, res) => {
    const order = repository.getOrder(req.params.id);
    if (order.status !== 'ready' || !order.asset_id) {
      return res.status(409).json({ ok: false, error: `order is '${order.status}' — not ready for download`, order });
    }
    const asset = repository.getAsset(order.asset_id);
    if (!asset.file_path || !fs.existsSync(asset.file_path)) {
      return res.status(404).json({ ok: false, error: 'audio file missing' });
    }
    res.sendFile(require('path').resolve(asset.file_path));
  }));

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

  app.get('/assets/:id/file', h(async (req, res) => {
    const asset = repository.getAsset(req.params.id);
    const file = asset.file_path;
    if (!file || !fs.existsSync(file)) {
      return res.status(404).json({ ok: false, error: 'Audio file not found', requestId: req.requestId });
    }
    res.sendFile(path.resolve(file));
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
    if (!req.body || !req.body.task_type) {
      return res.status(400).json({ ok: false, error: 'task_type is required' });
    }
    const projectId = req.body.project_id;
    const job = repository.createProcessingJob({
      task_type: req.body.task_type,
      project_id: projectId,
      source_path: req.body.source_path,
      prompt: req.body.prompt,
      clip: req.body.clip
    });
    send(res, { job }, 201);
  }));

  app.get('/processing/jobs/:id', h(async (req, res) => {
    send(res, { job: repository.getProcessingJob(req.params.id) });
  }));

  app.post('/processing/jobs/:id/start', h(async (req, res) => {
    const raw = repository.getProcessingJob(req.params.id);
    const projectId = raw.project_id || repository.createProject({ name: 'Ursula Generated' }).id;

    if (raw.type === 'generate') {
      if (!raw.prompt) {
        repository.failProcessingJob(req.params.id, 'prompt is required for generate');
        return res.status(400).json({ ok: false, error: 'prompt is required for generate' });
      }
      repository.startProcessingJob(req.params.id);
      const result = await engine.generateSong({ prompt: raw.prompt, clip: raw.clip, projectId });
      if (!result.ok) {
        repository.failProcessingJob(req.params.id, result.error);
        return res.status(502).json({ ok: false, error: result.error, job: repository.getProcessingJob(req.params.id) });
      }
      const asset = repository.registerAsset(projectId, {
        type: 'generated_song',
        file_path: result.audioPath,
        metadata: {
          source: 'ai-generation',
          engine: 'rezonate',
          prompt: raw.prompt,
          clip: raw.clip,
          audioPath: result.audioPath
        }
      });
      repository.completeProcessingJob(req.params.id, { audioPath: result.audioPath, assetId: asset.id });
      return send(res, { job: repository.getProcessingJob(req.params.id), asset }, 200);
    }

    if (raw.type === 'stems') {
      if (!raw.source_path) {
        repository.failProcessingJob(req.params.id, 'source_path is required for stems');
        return res.status(400).json({ ok: false, error: 'source_path is required for stems' });
      }
      repository.startProcessingJob(req.params.id);
      const result = await engine.createStems({ sourcePath: raw.source_path, projectId });
      if (!result.ok) {
        repository.failProcessingJob(req.params.id, result.error);
        return res.status(502).json({ ok: false, error: result.error, job: repository.getProcessingJob(req.params.id) });
      }
      repository.completeProcessingJob(req.params.id, { folder: result.folder });
      return send(res, { job: repository.getProcessingJob(req.params.id) });
    }

    if (raw.type === 'analyze') {
      if (!raw.source_path) {
        repository.failProcessingJob(req.params.id, 'source_path is required for analyze');
        return res.status(400).json({ ok: false, error: 'source_path is required for analyze' });
      }
      repository.startProcessingJob(req.params.id);
      const result = await engine.analyzeAudio({ sourcePath: raw.source_path, projectId });
      if (!result.ok) {
        repository.failProcessingJob(req.params.id, result.error);
        return res.status(502).json({ ok: false, error: result.error, job: repository.getProcessingJob(req.params.id) });
      }
      const asset = repository.registerAsset(projectId, {
        type: 'stem',
        file_path: raw.source_path,
        bpm: result.bpm,
        key: result.key,
        metadata: { folder: result.folder }
      });
      repository.completeProcessingJob(req.params.id, { assetId: asset.id, bpm: result.bpm, key: result.key });
      return send(res, { job: repository.getProcessingJob(req.params.id), asset });
    }

    return res.status(400).json({ ok: false, error: 'unknown task_type' });
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

  app.post('/ownership/assets/:id', h(async (req, res) => {
    const record = repository.createOwnershipRecord(req.params.id, req.body);
    send(res, { record }, 201);
  }));

  app.get('/ownership/assets/:id', h(async (req, res) => {
    const records = repository.listOwnershipRecords(req.params.id);
    repository.validateSplits(req.params.id);
    send(res, { records });
  }));

  app.post('/ownership/assets/:id/verify', h(async (req, res) => {
    const records = repository.listOwnershipRecords(req.params.id);
    if (records.length === 0) throw new Error('No ownership records found');
    const verified = repository.verifyOwnershipRecord(records[0].id);
    send(res, { record: verified });
  }));

  app.post('/ownership/assets/:id/collaborators', h(async (req, res) => {
    const rights = repository.registerRights(req.params.id, { collaborators: [req.body] });
    send(res, { rights }, 201);
  }));

  app.get('/ownership/records/:id', h(async (req, res) => {
    send(res, { record: repository.getOwnershipRecord(req.params.id) });
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
