'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const {
  Kernel,
  HModule,
  MemoryBus,
  AutonomousOperator,
  ProtoForgeFactory,
  OllamaIntelligenceAdapter,
  V3AutonomyAdapter,
} = require('../../../src/hydi-v4');

function tmpDir() {
  return path.join(os.tmpdir(), `hydi-v4-sub-${Date.now()}-${randomUUID().slice(0, 8)}`);
}

class DemoModule extends HModule {
  constructor(kernel, id, manifest = {}) {
    super(kernel, { id, name: id, version: '1.0.0', capabilities: ['compute'], ...manifest });
  }

  async initialize() {
    this._initialized = true;
  }

  async start() {
    this._started = true;
  }

  async health() {
    return { healthy: true };
  }
}

describe('HYDI V4 Subsystems', () => {
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

  describe('SqliteMemoryAdapter', () => {
    test('persists and searches data', async () => {
      const adapter = new MemoryBus.SqliteMemoryAdapter({ filePath: path.join(dataPath, 'memory.sqlite') });
      await adapter.initialize();
      await adapter.set('semantic:greeting', { text: 'hello world' });
      const value = await adapter.get('semantic:greeting');
      expect(value).toEqual({ text: 'hello world' });
      const results = await adapter.search('hello');
      expect(results.length).toBe(1);
      await adapter.close();
    });
  });

  describe('AutonomousOperator', () => {
    test('runs a diagnostic cycle', async () => {
      kernel.registerModule(new DemoModule(kernel, 'demo'));
      await kernel.startModule('demo');
      const op = new AutonomousOperator(kernel, { schedule: { intervalMs: 60000, operations: ['modules'] } });
      await op.initialize();
      const results = await op.runCycle(['modules']);
      expect(results.modules.ok).toBe(true);
      await op.dispose();
    });

    test('tracks history', async () => {
      const op = new AutonomousOperator(kernel, { schedule: { intervalMs: 60000, operations: ['validate'] } });
      await op.initialize();
      await op.runCycle(['validate']);
      expect(op.getHistory().length).toBe(1);
      await op.dispose();
    });
  });

  describe('ProtoForgeFactory', () => {
    test('generates complete artifact set', async () => {
      const mod = new DemoModule(kernel, 'demo-product', {
        description: 'A demonstration module',
        author: 'ProtoForge',
        capabilities: ['compute', 'agent'],
      });
      const factory = new ProtoForgeFactory(kernel, { outputDir: path.join(dataPath, 'protoforge') });
      const artifacts = await factory.generateForModule(mod);
      expect(artifacts.documentation.title).toBe('demo-product');
      expect(Array.isArray(artifacts.business)).toBe(true);
      expect(artifacts.api.capabilities.length).toBe(2);
      expect(artifacts.business.some((b) => b.type === 'saas')).toBe(true);
    });

    test('publishes artifacts to disk', async () => {
      const mod = new DemoModule(kernel, 'demo-product');
      const factory = new ProtoForgeFactory(kernel, { outputDir: path.join(dataPath, 'protoforge') });
      const { file } = await factory.publishArtifacts(mod);
      const stats = await fs.stat(file);
      expect(stats.isFile()).toBe(true);
    });
  });

  describe('OllamaIntelligenceAdapter', () => {
    test('registers and reports health', async () => {
      const adapter = new OllamaIntelligenceAdapter({ name: 'local-ollama' });
      kernel.intelligenceBus.registerAdapter(adapter);
      const status = await kernel.intelligenceBus.getStatus();
      expect(status['local-ollama']).toBeDefined();
    });
  });

  describe('V3AutonomyAdapter', () => {
    test('initializes without errors and exposes capabilities', async () => {
      const adapter = new V3AutonomyAdapter(kernel, { id: 'v3-test' }, { config: { dataPath } });
      kernel.registerModule(adapter);
      await kernel.startModule('v3-test');
      const health = await adapter.health();
      expect(health.healthy).toBe(true);
      expect(health.v3Status).toBeDefined();
      await kernel.stopModule('v3-test');
    });
  });
});
