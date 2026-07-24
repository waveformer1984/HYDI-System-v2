'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { Kernel, EvolutionEngine, HModule } = require('../../../src/hydi-v4');

function tmpDir() {
  return path.join(os.tmpdir(), `hydi-evolution-${Date.now()}-${randomUUID()}`);
}

class ProductModule extends HModule {
  constructor(kernel) {
    super(kernel, { id: 'product-module', name: 'Product Module', version: '1.0.0', capabilities: ['agent'] });
  }
}

describe('EvolutionEngine', () => {
  let kernel;
  let dataPath;
  let engine;

  beforeEach(async () => {
    dataPath = tmpDir();
    process.env.HYDI_VAULT_KEY = `test-key-${randomUUID()}`;
    kernel = new Kernel({ dataPath, autoStartModules: false });
    await kernel.start();
    engine = new EvolutionEngine(kernel, {
      historyPath: path.join(dataPath, 'evolution-history.json'),
      engineering: {
        auditRepository: jest.fn().mockResolvedValue({
          issueCounts: { timerLeaks: 1, resourceLeaks: 0, circularImports: 0, duplicateLogic: 2, deadCode: 1 },
        }),
      },
      scorecard: {
        evaluate: jest.fn().mockResolvedValue({
          overall: 80,
          scores: { offlineReadiness: 60, commercialReadiness: 40 },
        }),
      },
    });
    kernel.registerModule(engine);
    await kernel.startModule(engine.id);
  });

  afterEach(async () => {
    await kernel.stop().catch(() => {});
    await fs.rm(dataPath, { recursive: true, force: true });
    delete process.env.HYDI_VAULT_KEY;
  });

  test('observes evidence and builds deterministic prioritized queues', async () => {
    const cycle = await engine.runCycle();
    expect(cycle.state.scorecard.overall).toBe(80);
    expect(cycle.queues.immediate[0].id).toBe('reliability.timer-leaks');
    expect(cycle.plan.status).toBe('proposed');
    expect(cycle.plan.rollbackStrategy).toBeDefined();
    await expect(kernel.recall('evolution:latest-state', { namespace: 'evolution' })).resolves.toBeDefined();
  });

  test('requires explicit approval before executing an improvement', async () => {
    const { plan } = await engine.runCycle();
    await expect(engine.executeApproved(plan.id, jest.fn())).rejects.toThrow('explicit approval');
    engine.approve(plan.id);
    const result = await engine.executeApproved(plan.id, jest.fn().mockResolvedValue({ improved: true }));
    expect(result.status).toBe('completed');
    expect(engine.history).toHaveLength(1);
  });

  test('records a rejected improvement when validation fails', async () => {
    engine.validator = jest.fn().mockResolvedValue({ passed: false, reason: 'regression' });
    const { plan } = await engine.runCycle();
    engine.approve(plan.id);
    const executor = jest.fn();
    const result = await engine.executeApproved(plan.id, executor);
    expect(result.status).toBe('rejected');
    expect(executor).not.toHaveBeenCalled();
  });

  test('generates ProtoForge commercialization artifacts only for registered modules', async () => {
    const product = new ProductModule(kernel);
    kernel.registerModule(product);
    const artifacts = await engine.productize(product.id);
    expect(artifacts.business).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'api', capability: 'agent' }),
      expect.objectContaining({ type: 'saas' }),
    ]));
  });
});
