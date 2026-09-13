/**
 * Phase II regression tests — ProtoForge /health placeholder elimination.
 *
 * The defect these lock down (src/server.js, present since at least 2026-07):
 *
 *     const moduleCount = 0;                    // "Get module count (placeholder)"
 *     const { count } = await supabase.from('heidi_events')...
 *     res.json({ status: 'ok', modules: moduleCount, events: count || 0 });
 *
 * Live output was {"status":"ok","modules":0,"events":2958} — a hardcoded 0
 * presented as an observation, and an unconditional 'ok' that only ever proved
 * Express could run the handler. boot-agent gated on this endpoint and the
 * watchdog scored it as healthy.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildProtoforgeHealth,
  checkModuleRegistry,
  checkDatabase,
} = require('../../src/health/protoforge-health');

/** A stub agent bus whose registry is a Map, like UniversalAgentBus.modelHealth. */
function busWith(n) {
  const modelHealth = new Map();
  for (let i = 0; i < n; i += 1) modelHealth.set(`model-${i}`, { status: 'healthy' });
  return { modelHealth };
}

/** Supabase stub: .from(...).select(...) resolves to `response`. */
function supabaseReturning(response) {
  return { from: () => ({ select: async () => response }) };
}

function supabaseThrowing(message) {
  return {
    from: () => ({
      select: async () => {
        throw new Error(message);
      },
    }),
  };
}

describe('protoforge /health — observed values, never placeholders', () => {
  describe('1. real module discovery is reported accurately', () => {
    it('reports the actual registry size, not 0', async () => {
      const body = await buildProtoforgeHealth({
        agentBus: busWith(13),
        supabase: supabaseReturning({ count: 2958, error: null }),
      });
      expect(body.modules).toBe(13);
      expect(body.modules_state).toBe('HEALTHY');
      expect(body.status).toBe('ok');
    });

    it('tracks a different registry size rather than a constant', async () => {
      const body = await buildProtoforgeHealth({
        agentBus: busWith(4),
        supabase: supabaseReturning({ count: 1, error: null }),
      });
      expect(body.modules).toBe(4);
    });

    it('names the provenance of the number so it is checkable', async () => {
      const body = await buildProtoforgeHealth({
        agentBus: busWith(13),
        supabase: supabaseReturning({ count: 1, error: null }),
      });
      expect(body.checks.module_registry.source).toBe('universal-agent-bus.modelHealth');
      expect(body.checks.module_registry.evidence).toContain('13');
    });

    it('a genuinely empty registry reports 0 as an observation, with HEALTHY state', async () => {
      // 0 is a legitimate observation — the defect was 0 as a stand-in for
      // "we did not look". Provenance is what distinguishes them.
      const body = await buildProtoforgeHealth({
        agentBus: busWith(0),
        supabase: supabaseReturning({ count: 5, error: null }),
      });
      expect(body.modules).toBe(0);
      expect(body.modules_state).toBe('HEALTHY');
      expect(body.checks.module_registry.evidence).toContain('0 module(s) registered');
    });
  });

  describe('2. unavailable module discovery → UNVERIFIED / degraded', () => {
    it('a missing agent bus is UNVERIFIED with modules:null, not 0', async () => {
      const body = await buildProtoforgeHealth({
        agentBus: undefined,
        supabase: supabaseReturning({ count: 10, error: null }),
      });
      expect(body.modules).toBeNull();
      expect(body.modules_state).toBe('UNVERIFIED');
      expect(body.status).toBe('degraded');
    });

    it('a bus without a readable registry is UNVERIFIED', async () => {
      const body = await buildProtoforgeHealth({
        agentBus: {},
        supabase: supabaseReturning({ count: 10, error: null }),
      });
      expect(body.modules).toBeNull();
      expect(body.modules_state).toBe('UNVERIFIED');
    });

    it('a registry read that throws is UNVERIFIED, not 0', () => {
      const bus = {
        get modelHealth() {
          throw new Error('registry exploded');
        },
      };
      const result = checkModuleRegistry(bus);
      expect(result.state).toBe('UNVERIFIED');
      expect(result.count).toBeNull();
      expect(result.evidence).toContain('registry exploded');
    });

    it('degraded_reasons names what could not be verified', async () => {
      const body = await buildProtoforgeHealth({
        agentBus: {},
        supabase: supabaseReturning({ count: 10, error: null }),
      });
      expect(body.degraded_reasons.join(' ')).toContain('module_registry=UNVERIFIED');
    });
  });

  describe('3. a hardcoded 0 can no longer stand in for a health signal', () => {
    const serverSrc = () => fs.readFileSync(path.resolve(__dirname, '../../src/server.js'), 'utf8');

    it('the placeholder assignment is gone from src/server.js', () => {
      const src = serverSrc();
      expect(src).not.toMatch(/const\s+moduleCount\s*=\s*0\s*;/);
      expect(src).not.toContain('// Get module count (placeholder)');
    });

    it('the /health route delegates to the observed-evidence builder', () => {
      const src = serverSrc();
      expect(src).toContain("require('./health/protoforge-health')");
      expect(src).toContain('buildProtoforgeHealth({ agentBus, supabase })');
    });

    it("status is never 'ok' while any check is unverified or unavailable", async () => {
      const cases = [
        { agentBus: {}, supabase: supabaseReturning({ count: 1, error: null }) },
        { agentBus: busWith(3), supabase: supabaseReturning({ count: null, error: null }) },
        { agentBus: busWith(3), supabase: supabaseReturning({ count: null, error: { message: 'down' } }) },
        { agentBus: busWith(3), supabase: supabaseThrowing('ECONNREFUSED') },
        { agentBus: undefined, supabase: supabaseThrowing('ECONNREFUSED') },
      ];
      for (const c of cases) {
        const body = await buildProtoforgeHealth(c);
        expect(body.status).toBe('degraded');
      }
    });

    it('a database probe with no count reports events:null, not 0', async () => {
      // `count || 0` used to turn "no count" into a confident zero.
      const body = await buildProtoforgeHealth({
        agentBus: busWith(13),
        supabase: supabaseReturning({ count: null, error: null }),
      });
      expect(body.events).toBeNull();
      expect(body.checks.database.state).toBe('UNVERIFIED');
      expect(body.status).toBe('degraded');
    });

    it('a database error is UNAVAILABLE with evidence', async () => {
      const result = await checkDatabase(supabaseReturning({ count: null, error: { message: 'relation missing' } }));
      expect(result.state).toBe('UNAVAILABLE');
      expect(result.count).toBeNull();
      expect(result.evidence).toContain('relation missing');
    });

    it('a database probe that throws is UNAVAILABLE, not silently zero', async () => {
      const result = await checkDatabase(supabaseThrowing('socket hang up'));
      expect(result.state).toBe('UNAVAILABLE');
      expect(result.count).toBeNull();
      expect(result.evidence).toContain('socket hang up');
    });

    it('a genuine count of 0 events is still HEALTHY — 0 observed differs from 0 assumed', async () => {
      const result = await checkDatabase(supabaseReturning({ count: 0, error: null }));
      expect(result.state).toBe('HEALTHY');
      expect(result.count).toBe(0);
    });
  });

  describe('4. the /health contract stays compatible where legitimately required', () => {
    it('keeps the status/modules/events keys existing callers may read', async () => {
      const body = await buildProtoforgeHealth({
        agentBus: busWith(13),
        supabase: supabaseReturning({ count: 2958, error: null }),
      });
      expect(Object.keys(body)).toEqual(expect.arrayContaining(['status', 'modules', 'events']));
      expect(body.status).toBe('ok');
      expect(body.events).toBe(2958);
    });

    it("a fully healthy core still reports status:'ok'", async () => {
      const body = await buildProtoforgeHealth({
        agentBus: busWith(13),
        supabase: supabaseReturning({ count: 1, error: null }),
      });
      expect(body.status).toBe('ok');
      expect(body).not.toHaveProperty('degraded_reasons');
    });

    it('the body satisfies the watchdog contract for protoforge-core', () => {
      const { evaluateEndpointHealth } = require('../../lib/operational/EndpointHealthContract');
      const healthy = evaluateEndpointHealth('protoforge-core', {
        statusCode: 200,
        bodyText: JSON.stringify({ status: 'ok', modules: 13, modules_state: 'HEALTHY', events: 2958 }),
      });
      expect(healthy.state).toBe('HEALTHY');

      const placeholderShaped = evaluateEndpointHealth('protoforge-core', {
        statusCode: 200,
        bodyText: JSON.stringify({ status: 'ok', modules: 0, events: 2958 }), // no modules_state
      });
      // The pre-fix payload shape has no modules_state at all; it must not be
      // rejected outright, but it also must not be treated as verified module
      // observability. Here it stays HEALTHY only because the DB evidence is
      // present — the module claim is simply not asserted.
      expect(['HEALTHY', 'DEGRADED']).toContain(placeholderShaped.state);
    });

    it('an UNVERIFIED module registry makes the watchdog call protoforge-core DEGRADED', async () => {
      const { evaluateEndpointHealth } = require('../../lib/operational/EndpointHealthContract');
      const body = await buildProtoforgeHealth({
        agentBus: {},
        supabase: supabaseReturning({ count: 2958, error: null }),
      });
      const verdict = evaluateEndpointHealth('protoforge-core', {
        statusCode: 200,
        bodyText: JSON.stringify(body),
      });
      expect(verdict.state).toBe('DEGRADED');
      expect(verdict.ok).toBe(false);
    });
  });
});
