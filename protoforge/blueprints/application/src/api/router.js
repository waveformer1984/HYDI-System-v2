const express = require('express');
const crypto = require('crypto');

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

  app.get('/health', h((req, res) => send(res, { status: 'ok', requestId: req.requestId })));

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
