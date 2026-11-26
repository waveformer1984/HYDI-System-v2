'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'phone', 'heidi-check.sh');

function runAgainstPort(port) {
  const env = { ...process.env, HEIDI_TAILNET_URL: `http://127.0.0.1:${port}` };
  return new Promise((resolve, reject) => {
    const child = spawn('sh', [SCRIPT], {
      cwd: ROOT,
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('heidi-check.sh timed out after 60s'));
    }, 60000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function startStub(handlers) {
  const server = http.createServer((req, res) => {
    const fn = handlers[req.url] || handlers['*'];
    if (fn) {
      fn(res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) reject(err);
      else resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('scripts/phone/heidi-check.sh', () => {
  test('all endpoints 200 → ALL OK, exit 0', async () => {
    const ok = (_res) => {
      _res.writeHead(200, { 'content-type': 'text/plain' });
      _res.end('ok');
    };
    const { server, port } = await startStub({
      '/api/health': ok,
      '/heidi': ok,
      '/api/heidi-mobile/state': ok,
    });
    try {
      const r = await runAgainstPort(port);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/health 200 .* OK/);
      expect(r.stdout).toMatch(/heidi 200 .* OK/);
      expect(r.stdout).toMatch(/state 200 .* OK/);
      expect(r.stdout.trim().split('\n').pop()).toBe('ALL OK');
    } finally {
      await closeServer(server);
    }
  });

  test('state 503 → BFF verdict, DEGRADED, exit 1', async () => {
    const ok = (res) => {
      res.writeHead(200);
      res.end();
    };
    const { server, port } = await startStub({
      '/api/health': ok,
      '/heidi': ok,
      '/api/heidi-mobile/state': (res) => {
        res.writeHead(503);
        res.end();
      },
    });
    try {
      const r = await runAgainstPort(port);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/state 503 .* BFF up, upstream down/);
      expect(r.stdout).toMatch(/^DEGRADED: state$/m);
    } finally {
      await closeServer(server);
    }
  });

  test('health 500 → unexpected, exit 1', async () => {
    const { server, port } = await startStub({
      '/api/health': (res) => {
        res.writeHead(500);
        res.end();
      },
      '/heidi': (res) => {
        res.writeHead(200);
        res.end();
      },
      '/api/heidi-mobile/state': (res) => {
        res.writeHead(200);
        res.end();
      },
    });
    try {
      const r = await runAgainstPort(port);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/health 500 .* unexpected/);
      expect(r.stdout).toMatch(/DEGRADED: health/);
    } finally {
      await closeServer(server);
    }
  });

  test('server down → unreachable, exit 1', async () => {
    const { server, port } = await startStub({
      '/api/health': (res) => {
        res.writeHead(200);
        res.end();
      },
    });
    await closeServer(server);
    const r = await runAgainstPort(port);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/unreachable/);
    expect(r.stdout).toMatch(/DEGRADED:/);
  });
});