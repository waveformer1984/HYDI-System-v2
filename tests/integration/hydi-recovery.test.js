'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const HYDIContinuousRuntime = require('../../src/hydi-v3/HYDIContinuousRuntime');

const silent = { log: () => {}, warn: () => {}, error: () => {} };

async function makeDataPath() {
  const dir = path.join(os.tmpdir(), `hydi-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('HYDI recovery', () => {
  let runtime;
  let dataPath;

  afterEach(async () => {
    if (runtime) {
      try { await runtime.stop(); } catch (e) { /* ignore */ }
    }
    if (dataPath) {
      try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
    runtime = null;
  });

  test('sensor failure continues degraded', async () => {
    dataPath = await makeDataPath();
    runtime = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    await runtime.start();

    const brokenSensor = {
      healthCheck: () => ({ ok: false, reason: 'probe failure' }),
    };
    runtime.session.sensors.push(brokenSensor);

    const health = runtime._evaluateHealth();
    expect(health.ok).toBe(false);
    runtime._healthLoop();
    expect(runtime.getStatus().state).toBe('DEGRADED');
  });

  test('malformed event is ignored safely and audited', async () => {
    dataPath = await makeDataPath();
    runtime = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    await runtime.start();

    runtime.session.eventBus.subscribe('Thrower', () => { throw new Error('bad event'); });
    runtime.processEvent('Thrower', {}, 'BadSensor');

    const audit = runtime.session.auditLedger.getEvents({ category: 'malformed-event-ignored' });
    expect(audit.length).toBeGreaterThan(0);
    expect(runtime.getStatus().state).toBe('DEGRADED');
  });

  test('corrupt learning record is archived and recovered', async () => {
    dataPath = await makeDataPath();
    await fs.writeFile(path.join(dataPath, 'decision-outcomes.json'), '{ not valid json', 'utf8');

    runtime = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    await runtime.start();

    const files = await fs.readdir(dataPath);
    expect(files.some((f) => f.startsWith('decision-outcomes.json.corrupt.'))).toBe(true);

    const id = runtime.session.recommendationTracker.track({
      action: 'Survive corrupt store', expectedValue: 100, confidence: 0.5,
    });
    await runtime.stop();
    runtime = null;

    const second = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    await second.start();
    expect(second.session.recommendationTracker.getRecommendation(id)).toBeTruthy();
    await second.stop();
    runtime = second;
  });

  test('restart during active session recovers cleanly', async () => {
    dataPath = await makeDataPath();
    runtime = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    await runtime.start();

    runtime.processEvent('CommitCreated', { project: 'ProtoForge', message: 'x' }, 'GitSensor');
    const id = runtime.session.recommendationTracker.track({
      action: 'Survive restart', expectedValue: 100, confidence: 0.5,
    });
    const auditCount = runtime.session.auditLedger.records.length;
    await runtime.stop();
    runtime = null;

    const second = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    await second.start();
    expect(second.session.auditLedger.records.length).toBeGreaterThanOrEqual(auditCount);
    expect(second.session.recommendationTracker.getRecommendation(id)).toBeTruthy();
    await second.stop();
    runtime = second;
  });

  test('audit chain failure refuses false health', async () => {
    dataPath = await makeDataPath();
    const audit = {
      version: 1,
      updatedAt: Date.now(),
      records: [{
        id: 'evt_1', at: Date.now(), category: 'test', actor: 'test', subjectId: null,
        payload: {}, previousHash: null, hash: 'invalid',
      }],
    };
    await fs.writeFile(path.join(dataPath, 'audit-ledger.json'), JSON.stringify(audit), 'utf8');

    runtime = new HYDIContinuousRuntime({ dataPath, logger: silent, healthIntervalMs: 60000 });
    const report = await runtime.start();

    expect(report.status).not.toBe('ready');
    expect(runtime.getStatus().state).not.toBe('READY');
  });
});
