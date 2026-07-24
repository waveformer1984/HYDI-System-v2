'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const {
  Kernel,
  HModule,
  EventBus,
  CapabilityGraph,
  ModuleRegistry,
  MemoryBus,
  EventLedger,
  IntelligenceBus,
  SecretVault,
  ManifestGenerator,
} = require('../../../src/hydi-v4');

function tmpDir(prefix = 'hydi-v4-test') {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`);
}

class TestModule extends HModule {
  static startOrder = [];

  constructor(kernel, id, extras = {}) {
    super(kernel, {
      id,
      name: id,
      version: '1.0.0',
      capabilities: extras.capabilities || [],
      consumes: extras.consumes || [],
      dependencies: extras.dependencies || [],
    });
    this.calls = [];
    this.handler = null;
  }

  async initialize() {
    this.calls.push('initialize');
    this._initialized = true;
  }

  async start() {
    this.calls.push('start');
    TestModule.startOrder.push(this.id);
    this._started = true;
  }

  async stop() {
    this.calls.push('stop');
    this._started = false;
  }

  async dispose() {
    this.calls.push('dispose');
    this._initialized = false;
  }

  async health() {
    return { healthy: this._started, initialized: this._initialized };
  }
}

describe('HYDI V4 Kernel', () => {
  let kernel;
  let dataPath;

  beforeEach(async () => {
    TestModule.startOrder = [];
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

  describe('Kernel lifecycle', () => {
    test('starts and stops cleanly', () => {
      expect(kernel._started).toBe(true);
    });

    test('getStatus reports kernel state', () => {
      const status = kernel.getStatus();
      expect(status.started).toBe(true);
      expect(Array.isArray(status.modules)).toBe(true);
    });
  });

  describe('EventBus', () => {
    test('publishes and subscribes', async () => {
      const received = [];
      kernel.subscribe('test.topic', (event) => {
        received.push(event.payload);
      });
      await kernel.publish('test.topic', { value: 42 }, { origin: 'test' });
      expect(received).toEqual([{ value: 42 }]);
    });

    test('isolates handler errors', async () => {
      const good = [];
      kernel.subscribe('test.fail', () => {
        throw new Error('boom');
      });
      kernel.subscribe('test.fail', (event) => {
        good.push(event.payload);
      });
      const { results } = await kernel.publish('test.fail', { ok: true });
      expect(good).toEqual([{ ok: true }]);
      expect(results.some((r) => r.status === 'rejected')).toBe(true);
    });

    test('request-response', async () => {
      kernel.subscribe('test.echo', (event) => {
        return kernel.eventBus.reply(event, { echoed: event.payload });
      });
      const result = await kernel.request('test.echo', { hello: 'world' }, { timeoutMs: 1000 });
      expect(result.echoed).toEqual({ hello: 'world' });
    });
  });

  describe('CapabilityGraph', () => {
    test('computes startup order with dependencies', () => {
      const graph = new CapabilityGraph(kernel);
      graph.register('a', { capabilities: ['A'] });
      graph.register('b', { dependencies: ['a'], capabilities: ['B'] });
      graph.register('c', { dependencies: ['b'] });
      expect(graph.getStartupOrder()).toEqual(['a', 'b', 'c']);
    });

    test('detects circular dependencies', () => {
      const graph = new CapabilityGraph(kernel);
      graph.register('a', { dependencies: ['b'] });
      graph.register('b', { dependencies: ['a'] });
      expect(() => graph.getStartupOrder()).toThrow(/circular/);
    });

    test('detects missing providers and conflicts', () => {
      const graph = new CapabilityGraph(kernel);
      graph.register('a', { capabilities: ['X'] });
      graph.register('b', { capabilities: ['X'] });
      graph.register('c', { consumes: ['Y'] });
      const conflicts = graph.detectConflicts();
      const missing = graph.detectMissingCapabilities();
      expect(conflicts.length).toBeGreaterThan(0);
      expect(missing.length).toBeGreaterThan(0);
    });
  });

  describe('ModuleRegistry', () => {
    test('registers and validates HModule instances', () => {
      const m = new TestModule(kernel, 'm1');
      kernel.registerModule(m);
      expect(kernel.moduleRegistry.get('m1')).toBe(m);
    });

    test('rejects invalid modules', () => {
      expect(() => kernel.moduleRegistry.register({ id: 'bad', health: () => {} })).toThrow(/validation failed/);
    });

    test('starts modules in dependency order', async () => {
      const a = new TestModule(kernel, 'a');
      const b = new TestModule(kernel, 'b', { dependencies: ['a'] });
      kernel.registerModule(a);
      kernel.registerModule(b);
      await kernel.moduleRegistry.initializeAll();
      await kernel.moduleRegistry.startAll();
      expect(a.calls).toEqual(expect.arrayContaining(['initialize', 'start']));
      expect(b.calls).toEqual(expect.arrayContaining(['initialize', 'start']));
      expect(TestModule.startOrder.indexOf('a')).toBeLessThan(TestModule.startOrder.indexOf('b'));
    });

    test('hot-disable does not stop other modules', async () => {
      const a = new TestModule(kernel, 'a');
      kernel.registerModule(a);
      await kernel.startModule('a');
      expect(a._started).toBe(true);
      kernel.moduleRegistry.disable('a');
      await kernel.moduleRegistry.startAll();
      expect(a._started).toBe(false);
    });
  });

  describe('MemoryBus', () => {
    test('stores and retrieves namespaced memory', async () => {
      const bus = new MemoryBus(kernel, { adapter: new MemoryBus.InMemoryAdapter() });
      await bus.set('k1', { data: 1 }, { namespace: 'semantic' });
      const v = await bus.get('k1', { namespace: 'semantic' });
      expect(v).toEqual({ data: 1 });
    });

    test('searches memory values', async () => {
      const bus = new MemoryBus(kernel, { adapter: new MemoryBus.InMemoryAdapter() });
      await bus.set('k1', { text: 'hello world' });
      await bus.set('k2', { text: 'goodbye' });
      const results = await bus.search('hello');
      expect(results.length).toBe(1);
    });
  });

  describe('EventLedger', () => {
    test('appends immutable entries and verifies chain', async () => {
      const ledger = new EventLedger(kernel, { ledgerPath: path.join(dataPath, 'ledger') });
      await ledger.initialize();
      await ledger.append({ topic: 't1', payload: {} });
      await ledger.append({ topic: 't2', payload: {} });
      const verify = ledger.verify();
      expect(verify.valid).toBe(true);
      expect(verify.count).toBe(2);
    });

    test('replays events', async () => {
      const ledger = new EventLedger(kernel, { ledgerPath: path.join(dataPath, 'ledger2') });
      await ledger.initialize();
      await ledger.append({ topic: 't', payload: { n: 1 } });
      await ledger.append({ topic: 't', payload: { n: 2 } });
      const seen = [];
      await ledger.replay((event) => seen.push(event.payload.n));
      expect(seen).toEqual([1, 2]);
    });
  });

  describe('IntelligenceBus', () => {
    test('routes to available adapter', async () => {
      const bus = new IntelligenceBus(kernel);
      const adapter = {
        name: 'fake',
        priority: 10,
        health: jest.fn().mockResolvedValue({ available: true }),
        getModels: jest.fn().mockResolvedValue([{ name: 'fake-model' }]),
        generate: jest.fn().mockResolvedValue('generated'),
      };
      bus.registerAdapter(adapter);
      const result = await bus.generate({ prompt: 'test' });
      expect(adapter.generate).toHaveBeenCalledWith('fake-model', 'test', {});
      expect(result).toBe('generated');
    });

    test('throws when no adapter is available', async () => {
      const bus = new IntelligenceBus(kernel);
      const adapter = {
        name: 'down',
        health: jest.fn().mockResolvedValue({ available: false }),
      };
      bus.registerAdapter(adapter);
      await expect(bus.generate({ prompt: 'x' })).rejects.toThrow(/no intelligence adapter/);
    });
  });

  describe('SecretVault', () => {
    test('encrypts and decrypts secrets', async () => {
      await kernel.secretVault.set('api-key', 'super-secret');
      const value = kernel.secretVault.get('api-key');
      expect(value).toBe('super-secret');
    });

    test('lists stored secrets', async () => {
      await kernel.secretVault.set('a', '1');
      await kernel.secretVault.set('b', '2');
      expect(kernel.secretVault.list().sort()).toEqual(['a', 'b']);
    });
  });

  describe('ManifestGenerator', () => {
    test('generates runtime registries', async () => {
      const gen = new ManifestGenerator(kernel, { outputDir: path.join(dataPath, 'manifests') });
      const manifest = await gen.generate();
      expect(manifest.generatedAt).toBeDefined();
      expect(manifest.modules).toBeDefined();
      const files = await fs.readdir(path.join(dataPath, 'manifests'));
      expect(files).toContain('system-manifest.json');
    });
  });
});
