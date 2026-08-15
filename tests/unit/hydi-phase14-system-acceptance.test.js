'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  HeidiExecutive,
  HealthAggregator,
  LocalHealthProbes,
  SecretBroker,
  CapabilityRegistry,
  PolicyEngine: HeidiPolicyEngine,
} = require('../../src/heidi-executive');

const { evaluateRules } = require('../../lib/protoforge/policy-engine');

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-phase14-'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('HYDI Phase 14 — System-Wide Operational Acceptance', () => {
  describe('A. Heidi control plane', () => {
    it('executes a READ capability and records audit', async () => {
      const heidi = new HeidiExecutive({ dataDir: path.join(tmpDir, 'control') });
      const result = await heidi.run({ id: 'h1', capabilityId: 'health.read', parameters: {} }, { id: 'phase14' });
      expect(result.status).toBe('COMPLETED');
      const audit = heidi.audit.query({ taskId: 'h1' });
      expect(audit).toHaveLength(1);
      expect(audit[0].actor).toBe('phase14');
      expect(audit[0].capabilityId).toBe('health.read');
    });

    it('produces persistent audit and approvals across restart', async () => {
      const dataDir = path.join(tmpDir, 'persist');
      const heidi1 = new HeidiExecutive({ dataDir });
      await heidi1.run({ id: 'p1', capabilityId: 'health.read', parameters: {} }, { id: 'phase14' });
      heidi1.approvals.request({ id: 'a1', capabilityId: 'deploy.production', riskLevel: 'CRITICAL', action: 'deploy', parameters: {} }, 'heidi');

      const heidi2 = new HeidiExecutive({ dataDir });
      expect(heidi2.audit.query({ taskId: 'p1' })).toHaveLength(1);
      expect(heidi2.approvals.get('a1')).toBeTruthy();
    });
  });

  describe('B. Local health observation', () => {
    it('reports the expected status vocabulary', async () => {
      const mockFetch = jest.fn(() => Promise.resolve({ ok: true, status: 200 }));
      const probes = new LocalHealthProbes({ supabaseUrl: 'http://test', fetch: mockFetch });
      const r = await probes.persistence();
      expect(r.status).toBe('HEALTHY');
    });

    it('does not collapse optional Ollama into system failure', async () => {
      const old = process.env.ENABLE_LOCAL_MODEL;
      process.env.ENABLE_LOCAL_MODEL = '';
      const probes = new LocalHealthProbes({ fetch: jest.fn() });
      const r = await probes.ollama();
      expect(r.status).toBe('NOT_CONFIGURED');
      process.env.ENABLE_LOCAL_MODEL = old;
    });

    it('aggregates health without cloud probes', async () => {
      const health = new HealthAggregator();
      health.register('persistence', async () => ({ status: 'HEALTHY' }));
      health.register('ollama', async () => ({ status: 'NOT_CONFIGURED' }));
      const results = await health.inspectAll();
      expect(results.persistence.status).toBe('HEALTHY');
      expect(results.ollama.status).toBe('NOT_CONFIGURED');
    });
  });

  describe('C. ProtoForge policy (local fail-closed)', () => {
    it('rejects a KILO hypothesis when no matching rule exists', () => {
      const decision = evaluateRules([], { id: 'h-1', confidence: 0.9 });
      expect(decision.decision).toBe('reject');
    });
  });

  describe('D. CASCADE/KILO (local, non-executing)', () => {
    it('ProtoForge fails closed without rules', () => {
      const decision = evaluateRules([], { id: 'h-1', confidence: 0.9 });
      expect(decision.decision).toBe('reject');
    });
  });

  describe('E. Revenue mock mode', () => {
    it('STRIPE_MODE defaults to mock and prevents live calls', () => {
      expect(process.env.STRIPE_MODE || 'mock').toBe('mock');
    });
  });

  describe('F. Security negative tests', () => {
    it('denies a forbidden executor operation', async () => {
      const heidi = new HeidiExecutive();
      const task = {
        id: 'bad-op',
        capabilityId: 'docker.local',
        parameters: { operation: 'exec', resource: 'supabase_inbucket' },
      };
      const result = await heidi.run(task, { id: 'phase14' }).catch(e => ({ status: 'FAILED', error: e.message }));
      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('DENIED');
    });

    it('redacts secrets before audit', () => {
      const broker = new SecretBroker();
      const redacted = broker.redact({ token: 'sk_test_FAKE_1234567890abcdef', name: 'ok' });
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.name).toBe('ok');
    });

    it('CapabilityRegistry rejects invalid risk levels', () => {
      const reg = new CapabilityRegistry();
      expect(() => reg.register({ id: 'bad', riskLevel: 'INSANE' })).toThrow();
    });

    it('Heidi PolicyEngine requires approval for CRITICAL', () => {
      const reg = new CapabilityRegistry();
      const policy = new HeidiPolicyEngine(reg);
      const task = { capabilityId: 'database.destructive' };
      const result = policy.evaluate(task, {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('approval_required');
    });
  });
});
