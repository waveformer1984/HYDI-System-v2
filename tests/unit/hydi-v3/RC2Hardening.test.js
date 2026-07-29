const SoakHarness = require('../../../src/hydi-v3/SoakHarness');
const ResourceAuditor = require('../../../src/hydi-v3/ResourceAuditor');
const PerformanceBaseline = require('../../../src/hydi-v3/PerformanceBaseline');
const DeterminismGuard = require('../../../src/hydi-v3/DeterminismGuard');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const tempBase = path.join(__dirname, '..', '..', '..', 'data', 'test-baseline.json');

describe('Soak harness', () => {
  test('runs federation join/leave cycles', async () => {
    const h = new SoakHarness({ durationMs: 50, cooldownMs: 1 });
    const report = await h.run(['federationJoinLeave']);
    expect(report.scenarios.length).toBe(1);
    expect(report.scenarios[0].iterations).toBeGreaterThan(0);
    expect(report.scenarios[0].failures).toBe(0);
  });

  test('tracks failures and completes', async () => {
    const h = new SoakHarness({ durationMs: 200, cooldownMs: 1 });
    const report = await h.run(['crashRecover']);
    expect(report.scenarios[0].failures).toBeGreaterThan(0);
    expect(report.finishedAt).toBeGreaterThan(report.startedAt);
  });
});

describe('Resource auditor', () => {
  test('detects listener leaks', () => {
    const bus = new EventEmitter();
    const a = new ResourceAuditor({ eventBus: bus });
    const before = a.snapshot('before');
    const listeners = [];
    for (let i = 0; i < 5; i++) { const fn = () => {}; bus.on('test', fn); listeners.push(fn); }
    const after = a.snapshot('after');
    for (const fn of listeners) bus.off('test', fn);
    const { ok, leaks } = a.checkLeak(before, after, { listenersGrowth: 2 });
    expect(ok).toBe(false);
    expect(leaks.some((l) => l.kind === 'listeners')).toBe(true);
  });

  test('reports clean after listener cleanup', () => {
    const bus = new EventEmitter();
    const a = new ResourceAuditor({ eventBus: bus });
    const before = a.snapshot('before');
    const listeners = [];
    for (let i = 0; i < 3; i++) { const fn = () => {}; bus.on('test', fn); listeners.push(fn); }
    for (const fn of listeners) bus.off('test', fn);
    const after = a.snapshot('after');
    const { ok } = a.checkLeak(before, after, { listenersGrowth: 2 });
    expect(ok).toBe(true);
  });
});

describe('Performance baseline', () => {
  afterEach(() => { if (fs.existsSync(tempBase)) fs.unlinkSync(tempBase); });

  test('captures and saves a baseline', async () => {
    const pb = new PerformanceBaseline({ storagePath: tempBase, operations: { a: async () => ({ n: 1 }) } });
    const report = await pb.capture(3);
    expect(report.operations.a.mean).toBeGreaterThan(0);
    const saved = pb.save(report);
    expect(fs.existsSync(saved)).toBe(true);
  });

  test('compares current to baseline', async () => {
    const pb = new PerformanceBaseline({ storagePath: tempBase, operations: { a: async () => ({ n: 1 }) } });
    const baseline = await pb.capture(2);
    pb.save(baseline);
    const current = await pb.capture(2);
    const comp = pb.compare(current, baseline);
    expect(comp.comparison.a.baseline).not.toBeNull();
  });
});

describe('Determinism guard', () => {
  test('reports stable output as deterministic', async () => {
    let n = 0;
    const g = new DeterminismGuard();
    const report = await g.run(() => { n += 1; return { x: 1 }; });
    expect(report.success).toBe(true);
    expect(report.stable).toBe(true);
  });

  test('reports unstable output', async () => {
    const g = new DeterminismGuard({ iterations: 5 });
    const report = await g.run(() => ({ x: Math.random() }));
    expect(report.stable).toBe(false);
    expect(report.uniqueResults).toBeGreaterThan(1);
  });
});
