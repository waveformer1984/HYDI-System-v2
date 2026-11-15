#!/usr/bin/env node
'use strict';

/**
 * Standalone control-plane HTTP surface for cloud VMs (outbound worker pull still preferred).
 * Binds loopback by default — do not expose Ollama/admin ports publicly.
 */

const http = require('http');
const { URL } = require('url');
const { DistributedCloudControlPlane } = require('../lib/distributed-cloud/control-plane');
const { verifyWorkerToken } = require('../lib/distributed-cloud/auth');
const { mobileSnapshot } = require('../lib/heidi-mobile/distributed-cloud-snapshot');

const cp = new DistributedCloudControlPlane();
const host = process.env.HYDI_DISTRIBUTED_BIND || '127.0.0.1';
const port = Number(process.env.HYDI_DISTRIBUTED_PORT || 3471);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${host}:${port}`);
  if (req.method === 'GET' && u.pathname === '/health') {
    return json(res, 200, { ok: true, ...cp.status() });
  }
  if (req.method === 'GET' && u.pathname === '/mobile/snapshot') {
    return json(res, 200, mobileSnapshot({ controlPlane: cp }));
  }
  if (req.method === 'POST' && u.pathname === '/worker/register') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.headers['x-hydi-worker-token'];
      const parsed = body ? JSON.parse(body) : {};
      const out = cp.registerWorkerAuth(token, parsed);
      json(res, out.ok ? 200 : 401, out);
    });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/worker/claim') {
    const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || '';
    const v = verifyWorkerToken(token);
    if (!v.ok) return json(res, 401, v);
  }
  json(res, 404, { error: 'not_found' });
});

server.listen(port, host, () => {
  console.log(`[distributed-cloud] control plane http://${host}:${port} (file-backed)`);
});