'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => ({ execFile: jest.fn() }));

const { execFile } = require('child_process');
const {
  AuditLog,
  ApprovalManager,
  HeidiExecutive,
  ControlledExecutor,
  CapabilityRegistry,
  HealthAggregator,
  LocalHealthProbes,
  LocalRecoveryWorkflow,
} = require('../../../src/heidi-executive');

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-phase12-'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  if (execFile) execFile.mockReset();
});

describe('Persistent audit and approvals', () => {
  it('AuditLog records are written and survive a new process instance', () => {
    const dataDir = path.join(tmpDir, 'audit');
    const log = new AuditLog({ dataDir });
    log.record({ taskId: 't-persist', capabilityId: 'health.read', actor: 'heidi', resultingState: 'COMPLETED' });
    const fresh = new AuditLog({ dataDir });
    expect(fresh.getAll()).toHaveLength(1);
    expect(fresh.getAll()[0].taskId).toBe('t-persist');
    expect(fresh.getAll()[0].actor).toBe('heidi');
  });

  it('ApprovalManager state is written and survives a new process instance', () => {
    const dataDir = path.join(tmpDir, 'approvals');
    const mgr = new ApprovalManager({ dataDir });
    const task = { id: 't-approve', capabilityId: 'deploy.production', riskLevel: 'CRITICAL', action: 'deploy', parameters: {} };
    mgr.request(task, 'heidi');
    mgr.approve('t-approve', 'owner');
    const fresh = new ApprovalManager({ dataDir });
    expect(fresh.isApproved('t-approve')).toBe(true);
  });

  it('AuditLog does not include secret-shaped strings', () => {
    const { SecretBroker } = require('../../../src/heidi-executive');
    const log = new AuditLog({ redactor: new SecretBroker() });
    const entry = log.record({ taskId: 't1', actor: 'heidi', resultingState: 'COMPLETED', inputs: { token: 'sk_test_FAKE_1234567890' } });
    expect(entry.inputs.token).toBe('[REDACTED]');
  });
});

describe('Local health probes', () => {
  it('persistence is HEALTHY when Supabase REST responds', async () => {
    const mockFetch = jest.fn(() => Promise.resolve({ ok: true, status: 200 }));
    const probes = new LocalHealthProbes({ supabaseUrl: 'http://test', fetch: mockFetch });
    const r = await probes.persistence();
    expect(r.status).toBe('HEALTHY');
  });

  it('persistence is UNAVAILABLE when fetch fails', async () => {
    const mockFetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const probes = new LocalHealthProbes({ supabaseUrl: 'http://test', fetch: mockFetch });
    const r = await probes.persistence();
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.detail).toContain('ECONNREFUSED');
  });

  it('persistence is DEGRADED when Supabase returns an unexpected status', async () => {
    const mockFetch = jest.fn(() => Promise.resolve({ ok: false, status: 503 }));
    const probes = new LocalHealthProbes({ supabaseUrl: 'http://test', fetch: mockFetch });
    const r = await probes.persistence();
    expect(r.status).toBe('DEGRADED');
  });

  it('ollama is NOT_CONFIGURED when local model is disabled', async () => {
    const old = process.env.ENABLE_LOCAL_MODEL;
    process.env.ENABLE_LOCAL_MODEL = '';
    const probes = new LocalHealthProbes({ fetch: jest.fn() });
    const r = await probes.ollama();
    expect(r.status).toBe('NOT_CONFIGURED');
    process.env.ENABLE_LOCAL_MODEL = old;
  });

  it('docker is NOT_CONFIGURED when docker is not installed', async () => {
    const mockExec = jest.fn().mockRejectedValue(new Error('docker not installed'));
    const probes = new LocalHealthProbes({ execFile: mockExec });
    const r = await probes.docker();
    expect(r.status).toBe('NOT_CONFIGURED');
  });
});

describe('ControlledExecutor allowlist', () => {
  const reg = new CapabilityRegistry();
  const exec = new ControlledExecutor(reg);

  it('allows docker.local status for an allowlisted resource', async () => {
    execFile.mockImplementation((_file, _args, _opts, cb) => cb(null, 'supabase_inbucket:Up 2 hours', ''));
    const result = await exec.execute({ capabilityId: 'docker.local', parameters: { operation: 'status', resource: 'supabase_inbucket' } });
    expect(result.success).toBe(true);
    expect(result.result.stdout).toContain('Up');
  });

  it('denies an unknown capability target', async () => {
    const result = await exec.execute({ capabilityId: 'shell.local', parameters: { operation: 'exec', resource: 'any' } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unregistered');
  });

  it('denies an unknown operation on docker.local', async () => {
    const result = await exec.execute({ capabilityId: 'docker.local', parameters: { operation: 'exec', resource: 'supabase_inbucket' } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('DENIED');
  });

  it('denies an unknown resource on docker.local', async () => {
    const result = await exec.execute({ capabilityId: 'docker.local', parameters: { operation: 'restart_service', resource: 'malicious_container' } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('DENIED');
  });

  it('denies health.recover for a non-allowlisted service', async () => {
    const result = await exec.execute({ capabilityId: 'health.recover', parameters: { service: 'some_service' } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('DENIED');
  });
});

describe('Local recovery workflow', () => {
  it('records an end-to-end recovery sequence', async () => {
    const dataDir = path.join(tmpDir, 'recovery');
    const heidi = new HeidiExecutive({ dataDir });
    const health = new HealthAggregator();
    let serviceStatus = 'UNAVAILABLE';
    health.register('docker:supabase_inbucket', async () => ({ status: serviceStatus }));

    const workflow = new LocalRecoveryWorkflow(heidi, health, 'supabase_inbucket');
    workflow.setHealthName('docker:supabase_inbucket');

    execFile.mockImplementation((_file, _args, _opts, cb) => {
      // simulating docker restart succeeds
      serviceStatus = 'HEALTHY';
      cb(null, 'supabase_inbucket', '');
    });

    const r = await workflow.recover({ id: 'heidi' });
    expect(r.status).toBe('RECOVERED');
    expect(r.before.status).toBe('UNAVAILABLE');
    expect(r.after.status).toBe('HEALTHY');

    const freshAudit = new AuditLog({ dataDir });
    const recoverEvents = freshAudit.query({ capabilityId: 'health.recover' });
    expect(recoverEvents.length).toBeGreaterThan(0);
    expect(recoverEvents[0].resultingState).toBe('COMPLETED');
  });
});
