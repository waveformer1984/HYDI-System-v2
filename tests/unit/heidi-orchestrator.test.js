'use strict';

// OllamaClient is redirected to a stub via moduleNameMapper in jest.config.js
// — no jest.mock() needed for it here.

// LocalModelAdapter starts setInterval timers — replace with a lightweight stub
jest.mock('../../src/models/local-model-adapter', () => {
  return class LocalModelAdapter {
    constructor() {}
    getModelStatus() { return { 'gpt-4-local': { loaded: true, type: 'llama' } }; }
    execute(_id, _input) { return Promise.resolve({ text: 'result', confidence: 0.9, success: true }); }
    on() { return this; }
    emit() {}
  };
});

// Prevent real Supabase calls
jest.mock('../../src/database', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ data: [], error: null }),
      upsert: jest.fn(() => ({ select: jest.fn().mockResolvedValue({ data: [], error: null }) })),
      select: jest.fn(() => ({
        order: jest.fn(() => ({ limit: jest.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
      update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) })),
    })),
  },
}));

const HeidiOrchestrator = require('../../src/orchestrator/HeidiOrchestrator');

describe('HeidiOrchestrator', () => {
  let orchestrator;

  beforeEach(() => {
    orchestrator = new HeidiOrchestrator({ confidenceThreshold: 0.7, costThreshold: 0.10 });
  });

  afterEach(async () => {
    if (orchestrator) await orchestrator.reset();
  });

  describe('constructor', () => {
    test('initializes with provided config', () => {
      expect(orchestrator.config.confidenceThreshold).toBe(0.7);
      expect(orchestrator.config.revenuePriority).toBe(true);
      expect(orchestrator.config.maxRetries).toBe(2);
    });

    test('starts with zero drift score', () => {
      expect(orchestrator.driftScore).toBe(0);
    });

    test('starts with empty metrics', () => {
      expect(orchestrator.metrics.tasksProcessed).toBe(0);
      expect(orchestrator.metrics.tasksFailed).toBe(0);
      expect(orchestrator.metrics.tasksSuccessful).toBe(0);
    });
  });

  describe('calculatePriority', () => {
    test('revenue → critical (revenuePriority=true)', () => {
      expect(orchestrator.calculatePriority({ type: 'revenue' })).toBe('critical');
    });
    test('critical → critical', () => {
      expect(orchestrator.calculatePriority({ type: 'critical' })).toBe('critical');
    });
    test('reflection → low', () => {
      expect(orchestrator.calculatePriority({ type: 'reflection' })).toBe('low');
    });
    test('unknown → normal', () => {
      expect(orchestrator.calculatePriority({ type: 'chat' })).toBe('normal');
    });
  });

  describe('determineRouting', () => {
    test.each([
      ['revenue', 'revenue'],
      ['payment', 'revenue'],
      ['critical', 'critical'],
      ['security', 'critical'],
      ['reflection', 'reflection'],
      ['code', 'technical'],
      ['debug', 'technical'],
      ['unknown_xyz', 'standard'],
    ])('type=%s → %s', (type, expected) => {
      expect(orchestrator.determineRouting({ type })).toBe(expected);
    });
  });

  describe('estimateCost', () => {
    test('returns non-negative number', () => {
      expect(orchestrator.estimateCost({ type: 'chat', input: 'hi' })).toBeGreaterThanOrEqual(0);
    });
    test('longer input costs more', () => {
      const cheap = orchestrator.estimateCost({ input: 'hi' });
      const expensive = orchestrator.estimateCost({ input: 'x'.repeat(6000) });
      expect(expensive).toBeGreaterThan(cheap);
    });
  });

  describe('getStatus', () => {
    test('returns object with metrics, drift, models, config', () => {
      const status = orchestrator.getStatus();
      expect(status).toHaveProperty('metrics');
      expect(status).toHaveProperty('drift');
      expect(status.drift.score).toBe(0);
      expect(['low', 'medium', 'high']).toContain(status.drift.status);
    });
  });

  describe('reset', () => {
    test('zeroes metrics and drift score', async () => {
      orchestrator.metrics.tasksProcessed = 7;
      orchestrator.driftScore = 0.5;
      await orchestrator.reset();
      expect(orchestrator.metrics.tasksProcessed).toBe(0);
      expect(orchestrator.driftScore).toBe(0);
    });
  });

  // Regression coverage: HeidiCoreLoop.applyAdaptation() pushes model IDs
  // into config.avoidStrategies / config.preferStrategies (via
  // 'failure_mitigation' / 'success_amplification' adaptations), but until
  // now nothing in this class ever read those arrays back when choosing a
  // model -- every task handler returned the same hardcoded model
  // regardless, so the adaptation logged as if routing changed but had no
  // real effect.
  describe('selectModel (adaptation-aware routing)', () => {
    test('returns the first candidate when nothing is avoided or preferred', () => {
      expect(orchestrator.selectModel(['gpt-4-local', 'gpt-35-turbo'])).toBe('gpt-4-local');
    });

    test('skips a candidate flagged in config.avoidStrategies', () => {
      orchestrator.config.avoidStrategies = ['gpt-4-local'];
      expect(orchestrator.selectModel(['gpt-4-local', 'gpt-35-turbo'])).toBe('gpt-35-turbo');
    });

    test('prefers a candidate flagged in config.preferStrategies', () => {
      orchestrator.config.preferStrategies = ['local-llama'];
      expect(orchestrator.selectModel(['gpt-4-local', 'local-llama'])).toBe('local-llama');
    });

    test('avoidance takes precedence over a conflicting preference', () => {
      orchestrator.config.avoidStrategies = ['local-llama'];
      orchestrator.config.preferStrategies = ['local-llama'];
      expect(orchestrator.selectModel(['gpt-4-local', 'local-llama'])).toBe('gpt-4-local');
    });

    test('falls back to using an avoided candidate if every option is avoided', () => {
      orchestrator.config.avoidStrategies = ['gpt-4-local', 'gpt-35-turbo'];
      expect(orchestrator.selectModel(['gpt-4-local', 'gpt-35-turbo'])).toBe('gpt-4-local');
    });
  });

  describe('task handlers respect avoidStrategies', () => {
    test('handleRevenueTask uses defaults when nothing is avoided', async () => {
      const decision = await orchestrator.handleRevenueTask({});
      expect(decision.model).toBe('gpt-4-local');
      expect(decision.fallback).toBe('gpt-35-turbo');
    });

    test('handleRevenueTask routes around an avoided primary model', async () => {
      orchestrator.config.avoidStrategies = ['gpt-4-local'];
      const decision = await orchestrator.handleRevenueTask({});
      expect(decision.model).toBe('gpt-35-turbo');
      expect(decision.fallback).not.toBe('gpt-35-turbo'); // fallback must differ from the chosen model
    });

    test('handleCriticalTask, handleStandardTask, handleTechnicalTask use their documented defaults', async () => {
      expect((await orchestrator.handleCriticalTask({})).model).toBe('gpt-4-local');
      expect((await orchestrator.handleStandardTask({})).model).toBe('gpt-35-turbo');
      expect((await orchestrator.handleTechnicalTask({})).model).toBe('code-specialist');
    });

    test('handleReflectionTask ignores avoidStrategies (privacy invariant: local-only, no fallback)', async () => {
      orchestrator.config.avoidStrategies = ['local-llama'];
      const decision = await orchestrator.handleReflectionTask({});
      expect(decision.model).toBe('local-llama');
      expect(decision.fallback).toBeNull();
    });
  });
});
