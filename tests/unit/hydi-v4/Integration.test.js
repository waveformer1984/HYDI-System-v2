'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const {
  Kernel,
  UnifiedRuntime,
  SystemIntelligence,
  AutonomousEngineering,
  Scorecard,
  Dashboard,
  RepositoryAuditor,
  DoctorCLI,
  HModule,
} = require('../../../src/hydi-v4');

function tmpDir() {
  return path.join(os.tmpdir(), `hydi-v4-integration-${Date.now()}-${randomUUID().slice(0, 8)}`);
}

class DummyModule extends HModule {
  constructor(kernel, id) {
    super(kernel, { id, name: id, version: '1.0.0', capabilities: ['compute'] });
  }

  async initialize() {
    this._initialized = true;
  }

  async start() {
    this._started = true;
  }

  async health() {
    return { healthy: this._started };
  }
}

describe('HYDI V4 Integration & OS', () => {
  let kernel;
  let dataPath;

  beforeEach(async () => {
    dataPath = tmpDir();
    process.env.HYDI_VAULT_KEY = `test-key-${randomUUID()}`;
    kernel = new Kernel({ dataPath, autoStartModules: false });
    await kernel.start();
  });

  afterEach(async () => {
    await kernel.stop().catch(() => {});
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
    delete process.env.HYDI_VAULT_KEY;
  });

  describe('UnifiedRuntime', () => {
    test('boots and shuts down cleanly without V3', async () => {
      const runtime = new UnifiedRuntime({ dataPath: tmpDir(), enableV3: false, enableAutonomousOperator: false });
      await runtime.boot();
      expect(runtime._booted).toBe(true);
      const status = runtime.getStatus();
      expect(status.booted).toBe(true);
      await runtime.shutdown();
      expect(runtime._booted).toBe(false);
    });
  });

  describe('RepositoryAuditor', () => {
    test('discovers V4 modules and builds a graph', async () => {
      const auditor = new RepositoryAuditor(kernel, { sourceDirs: ['src/hydi-v4'] });
      const scan = await auditor.scan();
      expect(scan.summary.filesAnalyzed).toBeGreaterThan(0);
      expect(scan.modules.length).toBeGreaterThan(0);
      const graph = auditor.graph;
      expect(graph.nodes.length).toBeGreaterThan(0);
      const report = auditor.generateReport();
      expect(report.summary).toBeDefined();
      expect(report.resources).toEqual([]);
    });
  });

  describe('SystemIntelligence', () => {
    test('samples metrics without blocking on hardware discovery', async () => {
      const si = new SystemIntelligence(kernel, { id: 'si-test', intervalMs: 1000 });
      si.hardware.getInventory = jest.fn().mockResolvedValue({ gpus: [{ isHealthy: true, vramFreeBytes: 1e9 }] });
      kernel.registerModule(si);
      await kernel.startModule('si-test');
      const snapshot = await si.sample();
      expect(snapshot.modules.total).toBeDefined();
      expect(snapshot.gpus.total).toBe(1);
      await kernel.stopModule('si-test');
    });
  });

  describe('AutonomousEngineering', () => {
    test('audits repository and produces recommendations', async () => {
      kernel.registerModule(new DummyModule(kernel, 'dummy'));
      const engineering = new AutonomousEngineering(kernel, { auditor: { sourceDirs: ['src/hydi-v4'] } });
      const audit = await engineering.auditRepository();
      expect(audit.recommendations).toBeDefined();
      expect(audit.issueCounts).toBeDefined();
      const skeleton = engineering.generateTestSkeleton('dummy');
      expect(skeleton.tests.length).toBeGreaterThan(0);
    });
  });

  describe('Scorecard', () => {
    test('evaluates repository and runtime scores', async () => {
      kernel.registerModule(new DummyModule(kernel, 'dummy'));
      await kernel.startModule('dummy');
      const scanPath = tmpDir();
      await fs.mkdir(scanPath, { recursive: true });
      await fs.writeFile(path.join(scanPath, 'safe.js'), "'use strict';\nmodule.exports = {};\n");
      const scorecard = new Scorecard(kernel, { scanPaths: [scanPath] });
      const engineering = new AutonomousEngineering(kernel, { auditor: { sourceDirs: ['src/hydi-v4'] } });
      const audit = await engineering.auditRepository();
      const result = await scorecard.evaluate({ auditor: { auditRepository: () => Promise.resolve(audit) }, health: kernel.healthMonitor.getLast() });
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);
      expect(Object.keys(result.scores).length).toBe(8);
    });
  });

  describe('Dashboard', () => {
    test('produces live snapshot', async () => {
      const dashboard = new Dashboard(kernel, { id: 'dash-test' });
      kernel.registerModule(dashboard);
      await kernel.startModule('dash-test');
      const snapshot = await dashboard._tick();
      expect(snapshot.kernel).toBeDefined();
      expect(snapshot.modules).toBeDefined();
      expect(snapshot.generatedAt).toBeDefined();
      await kernel.stopModule('dash-test');
    });
  });

  describe('DoctorCLI 2.0', () => {
    test('new commands return structured data', async () => {
      kernel.registerModule(new DummyModule(kernel, 'dummy'));
      await kernel.startModule('dummy');
      const cli = new DoctorCLI(kernel);
      const memory = await cli.run(['memory']);
      expect(memory.ok).toBe(true);
      expect(memory.process).toBeDefined();
      const intelligence = await cli.run(['intelligence']);
      expect(intelligence.ok).toBe(true);
      const services = await cli.run(['services']);
      expect(services.ok).toBe(true);
    });

    test('human-readable report is generated', async () => {
      const cli = new DoctorCLI(kernel);
      const result = await cli.run(['doctor'], { human: true });
      expect(result.report).toContain('HYDI Doctor');
    });
  });
});
