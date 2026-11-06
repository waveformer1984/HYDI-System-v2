'use strict';
// Ops-agent acceptance fixture: a trivial HTTP health server on a high port.
// Started/stopped by hand in the acceptance run — the "service" the agent
// observes, repairs (via ops-fixture-restart.js) and verifies.
const http = require('http');
const port = Number(process.env.OPS_FIXTURE_PORT) || 34455;
const started = Date.now();
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, fixture: 'ops-fixture', pid: process.pid, uptimeMs: Date.now() - started }));
}).listen(port, '127.0.0.1', () => console.log(`ops-fixture listening on ${port} pid=${process.pid}`));
