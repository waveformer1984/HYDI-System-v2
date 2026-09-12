/**
 * /api/health transport contract.
 *
 * The endpoint answers two different questions and must not conflate them:
 *
 *   HTTP status  — did this handler run and produce a report?
 *   JSON body    — is the system well?
 *
 * api/health.js used to map current_status === 'CRITICAL' to HTTP 503. That
 * branch was unreachable while system_health_runs was empty (current_status was
 * always NULL, so every response was 200). The moment a real health run landed
 * and reported CRITICAL, /api/health began returning 503 — and
 * scripts/boot-agent.js:189 accepts only `statusCode >= 200 && statusCode < 500`
 * as a passing health gate. heidi-web is required:true, so a semantically
 * CRITICAL but perfectly alive web layer would have failed its gate and aborted
 * the whole boot.
 *
 * These tests pin down: transport 200 whenever the handler ran, semantics
 * preserved in full, and the boot gate protected.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const localStore = require('../../lib/health/local-dashboard-store');

/** The exact acceptance predicate scripts/boot-agent.js uses for a health gate. */
function bootAgentAcceptsStatus(statusCode) {
  return statusCode >= 200 && statusCode < 500;
}

function makeRes() {
  return {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(body) { this._json = body; },
    setHeader() {},
    end() {},
  };
}

async function callHandler() {
  const handler = (await import('../../api/health.js')).default;
  const res = makeRes();
  await handler({ method: 'GET' }, res);
  return res;
}

describe('/api/health transport contract', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-health-transport-'));
    process.env.HYDI_HEALTH_DATA_DIR = tmpDir;
    // Drive the local branch so the dashboard is fully controllable without a
    // database. The transport rule under test is branch-independent.
    process.env.HYDI_HEALTH_SOURCE = 'local';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    delete process.env.HYDI_HEALTH_DATA_DIR;
    delete process.env.HYDI_HEALTH_SOURCE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('1. no health evidence recorded', () => {
    it('returns HTTP 200 and reports "unmeasured", not a fabricated OK', async () => {
      const res = await callHandler();

      expect(res._status).toBe(200);
      expect(res._json.status).toBe('degraded');
      expect(res._json.hydi_status).toBeNull();
      expect(res._json.trend_status).toBe('unknown');
      expect(res._json.last_check).toBeNull();
    });

    it('the boot gate accepts it — an unmeasured system is not a dead web server', async () => {
      const res = await callHandler();
      expect(bootAgentAcceptsStatus(res._status)).toBe(true);
    });
  });

  describe('2. healthy evidence recorded', () => {
    beforeEach(() => {
      localStore.setDashboard({ current_status: 'OK', escalation_level: 'OK', trend_status: 'stable' });
    });

    it('returns HTTP 200 and reports healthy', async () => {
      const res = await callHandler();

      expect(res._status).toBe(200);
      expect(res._json.status).toBe('healthy');
      expect(res._json.hydi_status).toBe('OK');
      expect(res._json.trend_status).toBe('stable');
    });

    it('records a last_check once a real value has been written', async () => {
      const res = await callHandler();
      expect(res._json.last_check).not.toBeNull();
    });
  });

  describe('3. CRITICAL evidence recorded', () => {
    beforeEach(() => {
      localStore.setDashboard({
        current_status: 'CRITICAL',
        escalation_level: 'CRITICAL',
        trend_status: 'critical_trend',
        trend_reason: 'No events for 34309 minutes',
        escalation_action: 'page_operator',
        escalation_reason: 'Event flow stopped',
      });
    });

    it('returns HTTP 200 — the handler ran, so transport succeeded', async () => {
      const res = await callHandler();
      expect(res._status).toBe(200);
      expect(res._status).not.toBe(503);
    });

    it('keeps the CRITICAL verdict fully visible in the body', async () => {
      const res = await callHandler();

      expect(res._json.hydi_status).toBe('CRITICAL');
      expect(res._json.status).toBe('degraded');   // not healthy — the semantics are intact
      expect(res._json.trend_status).toBe('critical_trend');
      expect(res._json.escalation_level).toBe('CRITICAL');
    });

    it('preserves the reported reasons rather than flattening them away', async () => {
      const res = await callHandler();
      expect(res._json.trend_reason).toBe('No events for 34309 minutes');
      expect(res._json.escalation_reason).toBe('Event flow stopped');
      expect(res._json.escalation_action).toBe('page_operator');
      expect(res._json.timestamp).toBeDefined();
    });

    it('is never reported as healthy just because HTTP is 200', async () => {
      const res = await callHandler();
      expect(res._json.status).not.toBe('healthy');
    });
  });

  describe('4. boot contract protection', () => {
    it('a semantic CRITICAL does not fail the required heidi-web health gate', async () => {
      localStore.setDashboard({ current_status: 'CRITICAL', escalation_level: 'CRITICAL' });
      const res = await callHandler();

      // The regression this exists for: 503 would have failed the gate for a
      // required module and aborted the entire boot.
      expect(bootAgentAcceptsStatus(res._status)).toBe(true);
      expect(res._json.hydi_status).toBe('CRITICAL');
    });

    it('every semantic verdict yields a boot-acceptable transport status', async () => {
      for (const current_status of ['OK', 'WARNING', 'CRITICAL', null]) {
        localStore.setDashboard({ current_status, escalation_level: 'OK' });
        const res = await callHandler();
        expect(`${current_status}:${bootAgentAcceptsStatus(res._status)}`).toBe(`${current_status}:true`);
        expect(`${current_status}:${res._status}`).toBe(`${current_status}:200`);
      }
    });

    it('heidi-web is required, which is why the gate must not be tripped by semantics', () => {
      const bootConfig = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../../boot.config.json'), 'utf8')
      );
      const web = bootConfig.modules.find((m) => m.id === 'heidi-web');
      expect(web).toBeDefined();
      expect(web.required).not.toBe(false);
      expect(web.health.url).toContain('/api/health');
    });

    it('boot-agent still gates on the 200..499 range this test models', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/boot-agent.js'), 'utf8');
      expect(src).toContain('res.statusCode >= 200 && res.statusCode < 500');
    });

    it('the 503 mapping is gone from api/health.js', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../../api/health.js'), 'utf8');
      expect(src).not.toMatch(/current_status === 'CRITICAL' \? 503/);
    });
  });

  describe('5. the watchdog still sees the truth', () => {
    it('a CRITICAL body is not HEALTHY under the endpoint health contract', async () => {
      localStore.setDashboard({ current_status: 'CRITICAL', escalation_level: 'CRITICAL' });
      const res = await callHandler();

      const { evaluateEndpointHealth } = require('../../lib/operational/EndpointHealthContract');
      const verdict = evaluateEndpointHealth('heidi-web', {
        statusCode: res._status,
        bodyText: JSON.stringify(res._json),
      });

      // Transport is fine, semantics are not — exactly the split we want.
      expect(res._status).toBe(200);
      expect(verdict.state).toBe('DEGRADED');
      expect(verdict.ok).toBe(false);
      expect(verdict.observerFailure).toBe(false);
    });

    it('a healthy body is HEALTHY under the same contract', async () => {
      localStore.setDashboard({ current_status: 'OK', escalation_level: 'OK' });
      const res = await callHandler();

      const { evaluateEndpointHealth } = require('../../lib/operational/EndpointHealthContract');
      const verdict = evaluateEndpointHealth('heidi-web', {
        statusCode: res._status,
        bodyText: JSON.stringify(res._json),
      });
      expect(verdict.state).toBe('HEALTHY');
      expect(verdict.ok).toBe(true);
    });
  });
});
