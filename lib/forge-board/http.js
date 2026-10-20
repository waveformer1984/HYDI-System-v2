'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const ingress = require('../security/ingressGate');

const CLI = path.join(__dirname, 'cli.py');

function pythonBin() {
  if (process.env.HYDI_PYTHON) return process.env.HYDI_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function clientIp(req) {
  const raw = (req.socket && req.socket.remoteAddress)
    || (req.connection && req.connection.remoteAddress)
    || '';
  return String(raw).replace(/^::ffff:/, '');
}

function flattenQuery(query) {
  const out = {};
  for (const [key, value] of Object.entries(query || {})) {
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(payload);
}

function handleBoardRequest(req, res) {
  const decision = ingress.classify(req.headers || {});
  if (!decision.internal) {
    send(res, 404, { ok: false, error: 'not found' });
    return;
  }
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  const payload = {
    method,
    query: flattenQuery(req.query),
    body: method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {},
    authorization: (req.headers && (req.headers.authorization || req.headers.Authorization)) || '',
    client_ip: clientIp(req) || '127.0.0.1',
  };
  const result = spawnSync(pythonBin(), [CLI], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 8000,
    env: process.env,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    send(res, 503, { ok: false, error: 'board unavailable' });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '');
  } catch {
    send(res, 503, { ok: false, error: 'board unavailable' });
    return;
  }
  const status = Number(parsed.status) || (parsed.ok ? 200 : 500);
  delete parsed.status;
  send(res, status, parsed);
}

module.exports = { handleBoardRequest };
