/**
 * Phase II regression tests — watchdog false-green elimination.
 *
 * The defect these lock down: scripts/watchdog.js decided endpoint health with
 *
 *     ok: res.statusCode >= 200 && res.statusCode < 500
 *
 * so HTTP 200 + {"status":"degraded"} and HTTP 404 both counted as healthy, and
 * the watchdog logged "OK all 6 endpoints healthy" while heidi-web was degraded
 * and the revenue job executor was failing on every poll.
 *
 * Every test here asserts on the SEMANTIC verdict, not the status code.
 */

import fs from 'fs';
import path from 'path';
import {
  evaluateEndpointHealth,
  ENDPOINT_HEALTH_CONTRACTS,
} from '../../lib/operational/EndpointHealthContract';

const json = (o: unknown) => JSON.stringify(o);

describe('EndpointHealthContract — semantic health, not status codes', () => {
  describe('1. healthy semantic response → HEALTHY', () => {
    it('heidi-web with status:healthy is HEALTHY', () => {
      const v = evaluateEndpointHealth('heidi-web', {
        statusCode: 200,
        bodyText: json({ status: 'healthy', hydi_status: 'OK' }),
      });
      expect(v.state).toBe('HEALTHY');
      expect(v.ok).toBe(true);
      expect(v.observerFailure).toBe(false);
    });

    it('protoforge-core with ok + observed events + observed modules is HEALTHY', () => {
      const v = evaluateEndpointHealth('protoforge-core', {
        statusCode: 200,
        bodyText: json({ status: 'ok', modules: 13, modules_state: 'HEALTHY', events: 2958 }),
      });
      expect(v.state).toBe('HEALTHY');
      expect(v.ok).toBe(true);
    });

    it('ollama with a non-empty model list is HEALTHY', () => {
      const v = evaluateEndpointHealth('ollama', {
        statusCode: 200,
        bodyText: json({ models: [{ name: 'llama3.2:3b' }] }),
      });
      expect(v.state).toBe('HEALTHY');
      expect(v.ok).toBe(true);
    });

    it('ollama reachable with zero models is DEGRADED, not HEALTHY', () => {
      const v = evaluateEndpointHealth('ollama', { statusCode: 200, bodyText: json({ models: [] }) });
      expect(v.state).toBe('DEGRADED');
      expect(v.ok).toBe(false);
      expect(v.reason).toContain('0 models');
    });

    it('heidi-mobile-chat with server:ok is HEALTHY', () => {
      const v = evaluateEndpointHealth('heidi-mobile-chat', {
        statusCode: 200,
        bodyText: json({ server: 'ok', ollama: true, lmstudio: false, heidiCore: true, models: [] }),
      });
      expect(v.state).toBe('HEALTHY');
      expect(v.ok).toBe(true);
    });
  });

  describe('2. HTTP 200 + degraded payload → NOT HEALTHY', () => {
    // This is the exact live payload that was being scored healthy.
    const liveDegradedBody = json({
      status: 'degraded',
      hydi_status: null,
      trend_status: 'unknown',
      escalation_level: 'OK',
      version: '2.0.0-hydi',
      trend_reason: 'No health runs found',
    });

    it('heidi-web degraded is DEGRADED and not ok', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 200, bodyText: liveDegradedBody });
      expect(v.state).toBe('DEGRADED');
      expect(v.ok).toBe(false);
    });

    it('the reason names why, so the log is actionable', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 200, bodyText: liveDegradedBody });
      expect(v.reason).toContain('degraded');
      expect(v.reason).toContain('No health runs found');
    });

    it('a degraded body is never an observer failure — the target answered clearly', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 200, bodyText: liveDegradedBody });
      expect(v.observerFailure).toBe(false);
    });

    it('heidi-web status:error is UNAVAILABLE', () => {
      const v = evaluateEndpointHealth('heidi-web', {
        statusCode: 200,
        bodyText: json({ status: 'error', message: 'boom' }),
      });
      expect(v.state).toBe('UNAVAILABLE');
      expect(v.ok).toBe(false);
    });

    it('protoforge-core status:degraded is DEGRADED', () => {
      const v = evaluateEndpointHealth('protoforge-core', {
        statusCode: 200,
        bodyText: json({ status: 'degraded', modules: null, modules_state: 'UNVERIFIED', events: null }),
      });
      expect(v.state).toBe('DEGRADED');
      expect(v.ok).toBe(false);
    });
  });

  describe('3. HTTP 200 + missing required health data → NOT HEALTHY', () => {
    it('no status field at all is UNKNOWN, not HEALTHY', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 200, bodyText: json({ uptime: 5 }) });
      expect(v.state).toBe('UNKNOWN');
      expect(v.ok).toBe(false);
      expect(v.observerFailure).toBe(true);
    });

    it("protoforge-core status:'ok' without a numeric events count is DEGRADED", () => {
      // The old handler emitted `count || 0`, turning "no count" into a
      // confident zero. A null here must not read as healthy.
      const v = evaluateEndpointHealth('protoforge-core', {
        statusCode: 200,
        bodyText: json({ status: 'ok', modules: 13, modules_state: 'HEALTHY', events: null }),
      });
      expect(v.state).toBe('DEGRADED');
      expect(v.ok).toBe(false);
      expect(v.reason).toContain('database probe');
    });

    it("protoforge-core status:'ok' with modules_state UNVERIFIED is DEGRADED", () => {
      const v = evaluateEndpointHealth('protoforge-core', {
        statusCode: 200,
        bodyText: json({ status: 'ok', modules: null, modules_state: 'UNVERIFIED', events: 10 }),
      });
      expect(v.state).toBe('DEGRADED');
      expect(v.ok).toBe(false);
      expect(v.reason).toContain('UNVERIFIED');
    });

    it('a non-JSON 200 body is UNKNOWN, not HEALTHY', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 200, bodyText: '<html>ok</html>' });
      expect(v.state).toBe('UNKNOWN');
      expect(v.ok).toBe(false);
      expect(v.observerFailure).toBe(true);
    });

    it('a JSON array body is UNKNOWN, not HEALTHY', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 200, bodyText: '[1,2,3]' });
      expect(v.state).toBe('UNKNOWN');
      expect(v.ok).toBe(false);
    });

    it('HTTP 404 is UNAVAILABLE — the old predicate called this healthy', () => {
      const v = evaluateEndpointHealth('heidi-mobile-chat', { statusCode: 404, bodyText: 'Cannot GET /health' });
      expect(v.state).toBe('UNAVAILABLE');
      expect(v.ok).toBe(false);
      // 200..499 was the old range; assert the regression directly.
      expect(404 >= 200 && 404 < 500).toBe(true);
    });
  });

  describe('4. target unreachable → UNAVAILABLE, attributed to the target', () => {
    it('ECONNREFUSED is UNAVAILABLE and not an observer failure', () => {
      const v = evaluateEndpointHealth('heidi-web', {
        statusCode: 0,
        bodyText: '',
        transportError: 'connect ECONNREFUSED 127.0.0.1:3000',
      });
      expect(v.state).toBe('UNAVAILABLE');
      expect(v.ok).toBe(false);
      expect(v.observerFailure).toBe(false);
      expect(v.reason).toContain('ECONNREFUSED');
    });

    it('timeout is UNAVAILABLE', () => {
      const v = evaluateEndpointHealth('protoforge-core', {
        statusCode: 0,
        bodyText: '',
        transportError: 'timeout',
      });
      expect(v.state).toBe('UNAVAILABLE');
      expect(v.ok).toBe(false);
    });

    it('HTTP 500 is UNAVAILABLE', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 500, bodyText: 'boom' });
      expect(v.state).toBe('UNAVAILABLE');
      expect(v.ok).toBe(false);
      expect(v.observerFailure).toBe(false);
    });
  });

  describe('5. protected endpoints are classified, never blanket-healthy', () => {
    it('401 on an endpoint that does not declare auth-protection is UNKNOWN, not HEALTHY', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 401, bodyText: json({ error: 'Unauthorized' }) });
      expect(v.state).toBe('UNKNOWN');
      expect(v.ok).toBe(false);
      expect(v.observerFailure).toBe(true);
    });

    it('403 is likewise UNKNOWN by default', () => {
      const v = evaluateEndpointHealth('heidi-web', { statusCode: 403, bodyText: json({ error: 'forbidden' }) });
      expect(v.state).toBe('UNKNOWN');
      expect(v.ok).toBe(false);
    });

    it('an endpoint whose contract declares auth-protection treats 401 as proof it is up and enforcing', () => {
      const original = ENDPOINT_HEALTH_CONTRACTS['heidi-web'];
      try {
        ENDPOINT_HEALTH_CONTRACTS['heidi-web'] = { ...original, authRejectionIsHealthy: true };
        const v = evaluateEndpointHealth('heidi-web', { statusCode: 401, bodyText: '' });
        expect(v.state).toBe('HEALTHY');
        expect(v.ok).toBe(true);
        expect(v.observerFailure).toBe(false);
      } finally {
        ENDPOINT_HEALTH_CONTRACTS['heidi-web'] = original;
      }
    });
  });

  describe('6. observer-vs-target discrimination is preserved', () => {
    it('an endpoint with no declared contract is UNKNOWN + observerFailure, never HEALTHY', () => {
      const v = evaluateEndpointHealth('some-future-module', { statusCode: 200, bodyText: json({ status: 'ok' }) });
      expect(v.state).toBe('UNKNOWN');
      expect(v.ok).toBe(false);
      expect(v.observerFailure).toBe(true);
      expect(v.reason).toContain('no health contract declared');
    });

    it('observerFailure is true exactly when we failed to obtain evidence', () => {
      const cases: Array<[string, { statusCode: number; bodyText: string; transportError?: string }, boolean]> = [
        ['unparseable body', { statusCode: 200, bodyText: 'nope' }, true],
        ['auth rejection', { statusCode: 401, bodyText: '' }, true],
        ['missing status field', { statusCode: 200, bodyText: json({}) }, true],
        ['degraded target', { statusCode: 200, bodyText: json({ status: 'degraded' }) }, false],
        ['server error', { statusCode: 503, bodyText: '' }, false],
        ['no response', { statusCode: 0, bodyText: '', transportError: 'timeout' }, false],
      ];
      for (const [label, obs, expected] of cases) {
        expect(`${label}:${evaluateEndpointHealth('heidi-web', obs).observerFailure}`).toBe(`${label}:${expected}`);
      }
    });

    it('watchdog.js refuses to dispatch recovery on an endpoint observer failure', () => {
      // The watchdog must not "recover" a component when the thing that failed
      // was our ability to observe it. Guard the wiring, since the recovery
      // dispatch itself is not unit-reachable from here.
      const code = fs.readFileSync(path.resolve(__dirname, '../../scripts/watchdog.js'), 'utf8');
      expect(code).toContain('f.observerFailure');
      expect(code).toContain('recovery NOT authorized');
    });
  });

  describe('7. the old status-code predicate is gone from watchdog.js', () => {
    const code = () => fs.readFileSync(path.resolve(__dirname, '../../scripts/watchdog.js'), 'utf8');

    it('no longer derives ok from a status-code range anywhere in the file', () => {
      // Both checkEndpoint() and checkOllama() carried this predicate.
      expect(code()).not.toContain('ok: res.statusCode >= 200 && res.statusCode < 500');
      expect(code()).not.toMatch(/ok:\s*res\.statusCode\s*>=/);
    });

    it('uses the contract evaluator instead', () => {
      const c = code();
      expect(c).toContain("require('../lib/operational/EndpointHealthContract')");
      expect(c).toContain('evaluateEndpointHealth(ep.name');
    });

    it('every endpoint boot.config.json asks the watchdog to monitor has a declared contract', () => {
      const cfg = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../../boot.config.json'), 'utf8')
      ) as { modules: Array<{ id: string; enabled: boolean; type: string; health?: { url?: string } }> };

      const monitored = cfg.modules
        .filter((m) => m.enabled && m.type === 'process' && m.health && m.health.url)
        .map((m) => m.id);

      expect(monitored.length).toBeGreaterThan(0);
      for (const id of monitored) {
        // A missing contract is not a crash — it degrades to UNKNOWN — but it
        // is a monitoring gap, so fail loudly here rather than silently
        // shipping an unjudgeable endpoint.
        expect(Object.keys(ENDPOINT_HEALTH_CONTRACTS)).toContain(id);
      }
    });
  });
});
