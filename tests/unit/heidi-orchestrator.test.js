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
});
