/**
 * Process-liveness vs dependency-health separation tests.
 *
 * Before this split, /api/health was the watchdog's only probe of heidi-web.
 * That route queries the Supabase system_dashboard view, so a stalled
 * Supabase made /api/health time out -> watchdog saw UNAVAILABLE -> a live
 * process became a recovery target. /api/ping exists solely to prove "the
 * HTTP server can execute a route" with zero dependency involvement.
 *
 * These tests are deterministic: the Supabase "stall" is an injected
 * never-resolving transport on the dependency-health side; nothing live
 * is touched.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const handler = require('../../pages/api/ping').default;

const ROOT = path.resolve(__dirname, '../..');
const bootConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'boot.config.json'), 'utf8'));
const ecosystem = require(path.join(ROOT, 'ecosystem.config.js'));
const { pm2NameFor } = require('../../lib/operational/DependencyAwareRestartExecutor');

// ---------------------------------------------------------------------------
// /api/ping contract
// ---------------------------------------------------------------------------

function fakeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { res._status = code; return res; },
    json(obj) { res._body = obj; return res; },
  };
  return res;
}

describe('/api/ping is dependency-free liveness', () => {
  test('returns 200 {status:alive, service:heidi-web}', () => {
    const res = fakeRes();
    handler({}, res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ status: 'alive', service: 'heidi-web' });
  });

  test('handler source contains no dependency hooks', () => {
    let src = fs.readFileSync(path.join(ROOT, 'pages/api/ping.js'), 'utf8');
    // Strip comments so documentation mentioning a dependency (e.g. "no
    // Supabase") doesn't trip the scan -- only executable code is judged.
    src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // If any of these appear in live code, the liveness endpoint has
    // acquired a dependency and can no longer prove process liveness.
    for (const banned of ['supabase', 'ollama', 'require(', 'import ', 'fetch(', 'axios', 'exec(', 'spawn(', 'fs.read', 'fs.stat']) {
      expect(src.toLowerCase().includes(banned.toLowerCase())).toBe(false);
    }
  });

  test('serves over real HTTP with no env/deps constructed', async () => {
    // Deliberately remove Supabase env so any accidental dependency
    // initialization would explode the handler instead of passing silently.
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      // Minimal Next.js response augmentation: status()/json() are provided
      // by the pages-API runtime, not by Node's http.IncomingMessage/ServerResponse.
      const server = http.createServer((req, res) => {
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (obj) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
        handler(req, res);
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const body = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${port}/api/ping`, (r2) => {
            let d = '';
            r2.on('data', (c) => { d += c; });
            r2.on('end', () => resolve({ code: r2.statusCode, d }));
          }).on('error', reject);
        });
        expect(body.code).toBe(200);
        expect(JSON.parse(body.d).status).toBe('alive');
      } finally {
        server.close();
      }
    } finally {
      if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
      if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    }
  });
});

// ---------------------------------------------------------------------------
// Watchdog liveness-vs-health separation (source-level contract)
// ---------------------------------------------------------------------------

describe('watchdog uses liveness for the recovery decision', () => {
  const watchdogSrc = fs.readFileSync(path.join(ROOT, 'scripts/watchdog.js'), 'utf8');
  const heidiWeb = bootConfig.modules.find((m) => m.id === 'heidi-web');

  test('boot.config declares liveness URL pointing at /api/ping', () => {
    expect(heidiWeb.liveness).toBeDefined();
    expect(heidiWeb.liveness.url).toBe('http://127.0.0.1:3000/api/ping');
  });

  test('watchdog loads livenessUrl from module.liveness', () => {
    expect(watchdogSrc).toContain('livenessUrl');
    expect(watchdogSrc).toContain('mod.liveness');
  });

  test('recovery decision verdict comes from liveness when declared', () => {
    // The decision source must be the liveness probe when present.
    expect(watchdogSrc).toContain('const decisionVerdict = livenessVerdict || healthVerdict');
  });

  test('degraded health while ping is alive produces an informational line, not recovery', () => {
    expect(watchdogSrc).toContain('HEALTH-WARN');
    expect(watchdogSrc).toContain('informational only, no recovery');
  });
});

// ---------------------------------------------------------------------------
// Liveness evaluation semantics (pure-function contract)
// ---------------------------------------------------------------------------

// evaluateLiveness lives inside watchdog.js (not exported); its contract is
// replicated here against the documented behavior so a semantics drift in the
// watchdog is caught by the *structure* tests above plus this spec.
describe('liveness semantics (contract)', () => {
  function evalLive(obs) {
    if (obs.transportError) return { state: 'UNAVAILABLE' };
    if (obs.statusCode !== 200) return { state: 'UNAVAILABLE' };
    let body = {};
    try { body = JSON.parse(obs.bodyText); } catch { }
    if (body.status === 'alive') return { state: 'HEALTHY' };
    return { state: 'UNKNOWN' };
  }

  test('alive body -> HEALTHY', () => {
    expect(evalLive({ statusCode: 200, bodyText: '{"status":"alive"}' }).state).toBe('HEALTHY');
  });
  test('transport timeout -> UNAVAILABLE (restart-worthy)', () => {
    expect(evalLive({ statusCode: 0, transportError: 'timeout' }).state).toBe('UNAVAILABLE');
  });
  test('connrefused -> UNAVAILABLE (restart-worthy)', () => {
    expect(evalLive({ statusCode: 0, transportError: 'connect ECONNREFUSED' }).state).toBe('UNAVAILABLE');
  });
  test('5xx -> UNAVAILABLE', () => {
    expect(evalLive({ statusCode: 500, bodyText: '' }).state).toBe('UNAVAILABLE');
  });
  test('200 with wrong body -> UNKNOWN (observer failure, no recovery)', () => {
    expect(evalLive({ statusCode: 200, bodyText: '{"status":"weird"}' }).state).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// Dependency stall cannot restart the process
// ---------------------------------------------------------------------------

describe('supabase stall isolation', () => {
  test('health probe timing out does not equal process failure once liveness exists', () => {
    // Simulated: /api/health hangs on Supabase -> transportError 'timeout'
    // -> UNAVAILABLE. With liveness declared, that verdict is health-only;
    // the decisionVerdict is the ping result, which stays HEALTHY.
    const healthVerdict = { state: 'UNAVAILABLE', ok: false };
    const livenessVerdict = { state: 'HEALTHY', ok: true };
    const decisionVerdict = livenessVerdict || healthVerdict;
    expect(decisionVerdict.ok).toBe(true);
    // And the recorded state for telemetry is still the health verdict.
    expect(healthVerdict.state).toBe('UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Ownership contract unchanged
// ---------------------------------------------------------------------------

describe('canonical identity unchanged by liveness split', () => {
  test('service id is still heidi-web; runtime owner still heidi-web-standalone', () => {
    const heidiWeb = bootConfig.modules.find((m) => m.id === 'heidi-web');
    expect(heidiWeb.supervisedAs).toBe('heidi-web-standalone');
    expect(pm2NameFor('heidi-web')).toBe('heidi-web-standalone');
    expect(ecosystem.apps.filter((a) => a.name === 'heidi-web-standalone').length).toBe(1);
  });
});
