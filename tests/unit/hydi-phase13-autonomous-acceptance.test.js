'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  HeidiExecutive,
  HealthAggregator,
  LocalHealthProbes,
  LocalRecoveryWorkflow,
} = require('../../src/heidi-executive');

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-phase13-'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function createTestHarness() {
  let inbucketUp = true;
  const dataDir = path.join(tmpDir, `h-${Date.now()}`);
  const heidi = new HeidiExecutive({ dataDir });

  // Simulate the docker restart by marking the probe target healthy
  heidi.executor.register('health.recover', async (task) => {
    const service = task.parameters?.service;
    if (service !== 'supabase_inbucket') throw new Error(`DENIED: service not in recovery allowlist: ${service}`);
    inbucketUp = true;
    return { status: 'recovered', service };
  });

  const health = new HealthAggregator();
  const probes = new LocalHealthProbes({
    supabaseUrl: 'http://test',
    fetch: jest.fn(),
    execFile: async (file, args) => {
      if (file !== 'docker') throw new Error('not docker');
      const argStr = args.join(' ');
      if (args[0] === 'ps' && argStr.includes('supabase_inbucket')) {
        return inbucketUp ? 'supabase_inbucket_HYDI-System-v2:Up 2 hours' : '';
      }
      if (args[0] === 'ps' && argStr.includes('supabase_db')) {
        return 'supabase_db_HYDI-System-v2:Up 2 hours';
      }
      throw new Error(`unexpected docker call: ${args.join(' ')}`);
    },
  });

  health.register('inbucket', async () => probes.inbucket());
  const workflow = new LocalRecoveryWorkflow(heidi, health, 'supabase_inbucket');
  workflow.setHealthName('inbucket');

  return { heidi, workflow, inbucket: { setDown: () => { inbucketUp = false; }, setUp: () => { inbucketUp = true; } } };
}

describe('HYDI Phase 13 — Autonomous Operational Acceptance', () => {
  it('completes the full HEALTHY_INBUCKET mission', async () => {
    const harness = createTestHarness();

    // 1. observe healthy
    let before = await harness.workflow.probe();
    expect(before.status).toBe('HEALTHY');

    // 2. stop the service
    harness.inbucket.setDown();

    // 3. observe unavailable
    before = await harness.workflow.probe();
    expect(before.status).toBe('UNAVAILABLE');

    // 4-7. recover and verify
    const result = await harness.workflow.recover({ id: 'phase13' });
    expect(result.status).toBe('RECOVERED');
    expect(result.before.status).toBe('UNAVAILABLE');
    expect(result.after.status).toBe('HEALTHY');

    // 8. audit persistence
    expect(harness.heidi.audit.query({ capabilityId: 'health.recover' })).toHaveLength(1);

    // verify with a fresh process instance
    const dataDir = harness.heidi.dataDir;
    const freshHeidi = new HeidiExecutive({ dataDir });
    const auditEvents = freshHeidi.audit.query({ capabilityId: 'health.recover' });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].actor).toBe('phase13');
    expect(auditEvents[0].resultingState).toBe('COMPLETED');
    expect(auditEvents[0].inputs.service).toBe('supabase_inbucket');
  });

  it('is idempotent within the dedup window', async () => {
    const harness = createTestHarness();
    harness.inbucket.setDown();

    const first = await harness.workflow.recover({ id: 'heidi' });
    expect(first.status).toBe('RECOVERED');

    // keep it down so the second call sees an unhealthy state
    harness.inbucket.setDown();

    const second = await harness.workflow.recover({ id: 'heidi' });
    expect(second.status).toBe('IDEMPOTENT');

    // only one completed health.recover execution should be in audit
    const completed = harness.heidi.audit.query({ capabilityId: 'health.recover', resultingState: 'COMPLETED' });
    expect(completed).toHaveLength(1);
  });

  it('fails for an unsupported recovery service', async () => {
    const heidi = new HeidiExecutive();
    const task = {
      id: 'bad-recovery',
      capabilityId: 'health.recover',
      target: 'local',
      parameters: { service: 'some_unsupported_container' },
    };
    await expect(heidi.run(task, { id: 'phase13' })).rejects.toThrow('DENIED');

    const failed = heidi.audit.query({ taskId: 'bad-recovery' });
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].resultingState).toBe('FAILED');
  });

  it('denies a forbidden executor operation', async () => {
    const heidi = new HeidiExecutive();
    const task = {
      id: 'forbidden',
      capabilityId: 'docker.local',
      target: 'local',
      parameters: { operation: 'stop_service', resource: 'supabase_inbucket' },
    };
    await expect(heidi.run(task, { id: 'phase13' })).rejects.toThrow('DENIED');

    const failed = heidi.audit.query({ taskId: 'forbidden' });
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].resultingState).toBe('FAILED');
  });
});
