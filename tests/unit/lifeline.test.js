'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const {
  parseAllowedLogins,
  pm2JlistCommand,
  pm2RestartCommand,
  isAllowedApp,
  loadState,
  saveState,
  rateLimitCheck,
  recordRestart,
  auditAppend,
  buildHtmlPage,
  createLifelineServer,
  ALLOWED_APPS,
} = require('../../services/lifeline/server');

const LOGIN = 'waveformer1984@gmail.com';

function request(port, reqLine, headers = {}, body = null) {
  const [methodPath] = reqLine.split(/\s+/);
  const parts = reqLine.trim().split(/\s+/);
  const method = parts[0];
  const pathname = parts[1];
  return new Promise((resolve, reject) => {
    const opts = {
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        'tailscale-user-login': LOGIN,
        accept: 'application/json',
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('lifeline helpers', () => {
  test('parseAllowedLogins defaults and splits env', () => {
    expect(parseAllowedLogins(undefined)).toEqual([LOGIN]);
    expect(parseAllowedLogins('a@x.com, b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  test('pm2 commands use fixed argv (win32 uses cmd.exe)', () => {
    expect(pm2JlistCommand('win32')).toEqual({ file: 'cmd.exe', args: ['/c', 'pm2', 'jlist'] });
    expect(pm2JlistCommand('linux')).toEqual({ file: 'pm2', args: ['jlist'] });
    expect(pm2RestartCommand('win32', 'heidi-web-standalone')).toEqual({
      file: 'cmd.exe',
      args: ['/c', 'pm2', 'restart', 'heidi-web-standalone', '--update-env'],
    });
    expect(pm2RestartCommand('linux', 'heidi-core')).toEqual({
      file: 'pm2',
      args: ['restart', 'heidi-core', '--update-env'],
    });
  });

  test('isAllowedApp rejects traversal and injection names', () => {
    expect(isAllowedApp('heidi-web-standalone')).toBe(true);
    for (const bad of ['hydi-daemon', '../x', 'a;b', 'heidi-web-standalone;rm']) {
      expect(isAllowedApp(bad)).toBe(false);
    }
    expect(ALLOWED_APPS).toHaveLength(3);
  });

  test('rate limit per app and hourly cap', () => {
    const now = 1_700_000_000_000;
    let state = { restarts: {}, hourly: [] };
    expect(rateLimitCheck(state, 'heidi-core', now).allowed).toBe(true);
    state = recordRestart(state, 'heidi-core', now);
    const blocked = rateLimitCheck(state, 'heidi-core', now + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('app_cooldown');
    expect(blocked.wait_s).toBeGreaterThan(0);

    state = { restarts: {}, hourly: Array.from({ length: 6 }, (_, i) => now - i * 1000) };
    const hourBlock = rateLimitCheck(state, 'ursula-local', now);
    expect(hourBlock.allowed).toBe(false);
    expect(hourBlock.reason).toBe('hourly_cap');
  });

  test('state persists across save/load', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeline-state-'));
    const statePath = path.join(dir, 'state.json');
    const state = recordRestart({ restarts: {}, hourly: [] }, 'heidi-web-standalone', Date.now());
    saveState(statePath, state);
    const loaded = loadState(statePath);
    expect(loaded.restarts['heidi-web-standalone']).toHaveLength(1);
    expect(loaded.hourly).toHaveLength(1);
  });

  test('audit line format', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeline-audit-'));
    const auditPath = path.join(dir, 'audit.log');
    auditAppend(auditPath, {
      ts: '2026-01-01T00:00:00.000Z',
      login: LOGIN,
      method: 'GET',
      path: '/health',
      result: 'ok',
    });
    const line = fs.readFileSync(auditPath, 'utf8').trim();
    expect(line).toBe(['2026-01-01T00:00:00.000Z', LOGIN, 'GET', '/health', 'ok'].join('\t'));
    expect(line).not.toMatch(/Tailscale|secret|password/i);
  });

  test('HTML page has no external asset URLs', () => {
    const html = buildHtmlPage();
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toMatch(/Heidi Lifeline/);
    expect(html).toMatch(/setInterval\(refresh, 15000\)/);
  });
});

describe('lifeline HTTP', () => {
  let server;
  let port;
  let execCalls;
  let tmp;
  let statePath;
  let auditPath;
  let nowMs;

  const pm2List = JSON.stringify([
    {
      name: 'heidi-web-standalone',
      monit: { memory: 128 * 1024 * 1024 },
      pm2_env: { status: 'stopped', restart_time: 3, pm_uptime: 0 },
    },
    {
      name: 'heidi-core',
      monit: { memory: 64 * 1024 * 1024 },
      pm2_env: { status: 'online', restart_time: 0, pm_uptime: nowMs - 60_000 },
    },
  ]);

  beforeEach(async () => {
    nowMs = Date.now();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeline-http-'));
    statePath = path.join(tmp, 'state.json');
    auditPath = path.join(tmp, 'audit.log');
    execCalls = [];
    const execFile = (file, args, opts, cb) => {
      execCalls.push({ file, args, opts });
      const joined = args.join(' ');
      if (joined.includes('jlist')) {
        cb(null, pm2List, '');
        return;
      }
      if (joined.includes('restart')) {
        cb(null, 'ok', '');
        return;
      }
      cb(new Error('unexpected'));
    };
    server = createLifelineServer({
      execFile,
      platform: 'win32',
      now: () => nowMs,
      statePath,
      auditPath,
      allowedLogins: [LOGIN],
      tcpConnect: () => {
        const handlers = {};
        const socket = {
          on(ev, fn) {
            handlers[ev] = fn;
            if (ev === 'error') process.nextTick(() => fn(new Error('ECONNREFUSED')));
            return socket;
          },
          setTimeout(_ms, fn) {
            if (typeof fn === 'function') process.nextTick(fn);
          },
          destroy() {},
        };
        return socket;
      },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /health is open; /lifeline/status without login is 403', async () => {
    const health = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body).service).toBe('lifeline');

    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/lifeline/status`, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).message).toMatch(/Tailscale/i);
  });

  test('GET /health contract and pm2 mocked', async () => {
    const res = await request(port, 'GET /health');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      service: 'lifeline',
      ok: true,
      version: expect.any(String),
      deps: { pm2: true },
    });
    expect(execCalls[0].file).toBe('cmd.exe');
    expect(execCalls[0].args).toEqual(['/c', 'pm2', 'jlist']);
  });

  test('GET /lifeline/status returns apps and ports', async () => {
    const res = await request(port, 'GET /lifeline/status');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.apps.some((a) => a.name === 'heidi-core' && a.status === 'online')).toBe(true);
    expect(body.ports['3000']).toBe('down');
  });

  test('POST restart requires X-Lifeline', async () => {
    const res = await request(port, 'POST /lifeline/restart/heidi-web-standalone');
    expect(res.status).toBe(403);
    const audit = fs.readFileSync(auditPath, 'utf8');
    expect(audit).toMatch(/missing_x_lifeline/);
  });

  test('POST rejects non-allowlisted app with fixed argv never called', async () => {
    const before = execCalls.length;
    const res = await request(port, 'POST /lifeline/restart/hydi-daemon', { 'x-lifeline': '1' });
    expect(res.status).toBe(400);
    expect(execCalls.length).toBe(before);
  });

  test('POST restart uses fixed argv and records rate limit state', async () => {
    const res = await request(port, 'POST /lifeline/restart/heidi-web-standalone', { 'x-lifeline': '1' });
    expect(res.status).toBe(200);
    const restartCall = execCalls.find((c) => c.args.includes('restart'));
    expect(restartCall.file).toBe('cmd.exe');
    expect(restartCall.args).toEqual(['/c', 'pm2', 'restart', 'heidi-web-standalone', '--update-env']);
    const loaded = loadState(statePath);
    expect(loaded.restarts['heidi-web-standalone']).toHaveLength(1);

    const again = await request(port, 'POST /lifeline/restart/heidi-web-standalone', { 'x-lifeline': '1' });
    expect(again.status).toBe(429);
    const againBody = JSON.parse(again.body);
    expect(againBody.wait_s).toBeGreaterThan(0);
  });

  test('wrong login rejected', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get({
        host: '127.0.0.1',
        port,
        path: '/lifeline/status',
        headers: { 'tailscale-user-login': 'not-allowed@example.com' },
      }, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });
    expect(res.status).toBe(403);
  });

  test('GET /lifeline/ serves HTML', async () => {
    const res = await request(port, 'GET /lifeline/', { accept: 'text/html' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toMatch(/Heidi Lifeline/);
  });

  test('two concurrent restarts -> one pm2 call, other 429', async () => {
    let blocked = null;
  let resolveBlocked;
    const blockedGate = new Promise((r) => { resolveBlocked = r; blocked = r; });
    const execFileSlow = (file, args, opts, cb) => {
      execCalls.push({ file, args, opts });
      const joined = args.join(' ');
      if (joined.includes('jlist')) {
        cb(null, pm2List, '');
        return;
      }
      if (joined.includes('restart')) {
        blockedGate.then(() => cb(null, 'ok', ''));
        return;
      }
      cb(new Error('unexpected'));
    };
    await new Promise((resolve) => server.close(resolve));
    server = createLifelineServer({
      execFile: execFileSlow,
      platform: 'win32',
      now: () => nowMs,
      statePath,
      auditPath,
      allowedLogins: [LOGIN],
      tcpConnect: () => {
        const socket = {
          on(ev, fn) {
            if (ev === 'error') process.nextTick(() => fn(new Error('ECONNREFUSED')));
            return socket;
          },
          setTimeout(_ms, fn) { if (typeof fn === 'function') process.nextTick(fn); },
          destroy() {},
        };
        return socket;
      },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    execCalls = [];

    const headers = { 'x-lifeline': '1' };
    const p1 = request(port, 'POST /lifeline/restart/heidi-web-standalone', headers);
    const p2 = request(port, 'POST /lifeline/restart/heidi-web-standalone', headers);
    await new Promise((r) => setTimeout(r, 30));
    resolveBlocked();
    const [r1, r2] = await Promise.all([p1, p2]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 429]);
    expect(execCalls.filter((c) => c.args.includes('restart'))).toHaveLength(1);
  });

  test('failed pm2 restart still consumes cooldown', async () => {
    const execFileFail = (file, args, opts, cb) => {
      if (args.join(' ').includes('jlist')) cb(null, pm2List, '');
      else if (args.join(' ').includes('restart')) cb(new Error('pm2 down'));
      else cb(new Error('unexpected'));
    };
    await new Promise((resolve) => server.close(resolve));
    server = createLifelineServer({
      execFile: execFileFail,
      platform: 'win32',
      now: () => nowMs,
      statePath,
      auditPath,
      allowedLogins: [LOGIN],
      tcpConnect: () => ({
        on(ev, fn) {
          if (ev === 'error') process.nextTick(() => fn(new Error('ECONNREFUSED')));
          return this;
        },
        setTimeout(_ms, fn) { if (typeof fn === 'function') process.nextTick(fn); },
        destroy() {},
      }),
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;

    const headers = { 'x-lifeline': '1' };
    const first = await request(port, 'POST /lifeline/restart/heidi-core', headers);
    expect(first.status).toBe(502);
    const audit = fs.readFileSync(auditPath, 'utf8');
    expect(audit).toMatch(/pm2_failed/);

    const retry = await request(port, 'POST /lifeline/restart/heidi-core', headers);
    expect(retry.status).toBe(429);
  });
});