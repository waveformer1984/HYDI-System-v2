const express = require('express');
const crypto = require('crypto');

function createApi(repository, adapter, config = {}) {
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

  function sendError(res, code, message, requestId) {
    res.status(code).json({ ok: false, error: message, requestId });
  }

  function requireAdapter(req, res) {
    if (!adapter) {
      sendError(res, 503, 'Proto.I.Y engine adapter not configured', req.requestId);
      return false;
    }
    return true;
  }

  app.get('/health', h((req, res) => send(res, { status: 'ok', requestId: req.requestId })));

  app.get('/engine/health', h(async (req, res) => {
    if (!requireAdapter(req, res)) return;
    const result = await adapter.health();
    send(res, result);
  }));

  app.post('/projects', h(async (req, res) => {
    if (!requireAdapter(req, res)) return;
    const result = await adapter.createProject(req.body);
    send(res, result, 201);
  }));

  app.post('/projects/:id/timelines', h(async (req, res) => {
    if (!requireAdapter(req, res)) return;
    const payload = { ...req.body, project_id: req.params.id };
    const result = await adapter.createTimeline(payload);
    send(res, result, 201);
  }));

  app.post('/records', h((req, res) => {
    send(res, { record: repository.createRecord(req.body) }, 201);
  }));

  app.get('/records', h((req, res) => {
    send(res, { records: repository.listRecords() });
  }));

  app.get('/records/:id', h((req, res) => {
    send(res, { record: repository.getRecord(req.params.id) });
  }));

  app.put('/records/:id', h((req, res) => {
    send(res, { record: repository.updateRecord(req.params.id, req.body) });
  }));

  app.delete('/records/:id', h((req, res) => {
    send(res, { record: repository.deleteRecord(req.params.id) });
  }));

  app.use((err, req, res, next) => {
    const status = err.name === 'ValidationError' ? 400 : err.name === 'NotFoundError' ? 404 : err.name === 'ConflictError' ? 409 : 500;
    res.status(status).json({ ok: false, error: err.message, requestId: req.requestId });
  });

  return app;
}

module.exports = { createApi };
