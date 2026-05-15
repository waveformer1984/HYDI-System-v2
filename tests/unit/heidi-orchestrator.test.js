/**
 * Unit tests for HeidiOrchestrator
 * All external dependencies are mocked — no network or DB required.
 */

jest.mock('../../src/models/local-model-adapter', () =>
  jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ result: 'local-ok', confidence: 0.85 }),
    getStatus: jest.fn().mockReturnValue({ available: true }),
    getModelStatus: jest.fn().mockReturnValue({}),
  }))
);

jest.mock('../../heidi-core/brain/ollama-client', () =>
  jest.fn().mockImplementation(() => ({
    generate: jest.fn().mockResolvedValue({ response: 'ollama-ok' }),
    isAvailable: jest.fn().mockResolvedValue(true),
  }))
);

jest.mock('../../src/database', () => ({
  supabase: { from: jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: null }) }) },
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

const HeidiOrchestrator = require('../../src/orchestrator/HeidiOrchestrator');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrchestrator(cfg = {}) {
  return new HeidiOrchestrator({
    confidenceThreshold: 0.7,
    costThreshold: 0.10,
    maxRetries: 2,
    timeoutMs: 8000,
    revenuePriority: true,
    ...cfg,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('HeidiOrchestrator', () => {

  // ── Constructor ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('applies default config values', () => {
      const orc = new HeidiOrchestrator();
      expect(orc.config.confidenceThreshold).toBe(0.7);
      expect(orc.config.costThreshold).toBe(0.10);
      expect(orc.config.maxRetries).toBe(2);
      expect(orc.config.timeoutMs).toBe(8000);
      expect(orc.config.revenuePriority).toBe(true);
    });

    it('overrides defaults with provided config', () => {
      const orc = new HeidiOrchestrator({ confidenceThreshold: 0.9, maxRetries: 5 });
      expect(orc.config.confidenceThreshold).toBe(0.9);
      expect(orc.config.maxRetries).toBe(5);
    });

    it('starts with zero metrics', () => {
      const orc = makeOrchestrator();
      expect(orc.metrics.tasksProcessed).toBe(0);
      expect(orc.metrics.tasksSuccessful).toBeDefined();
    });
  });

  // ── calculatePriority ────────────────────────────────────────────────────

  describe('calculatePriority', () => {
    it('returns critical for revenue tasks when revenuePriority is true', () => {
      const orc = makeOrchestrator({ revenuePriority: true });
      expect(orc.calculatePriority({ type: 'revenue' })).toBe('critical');
    });

    it('returns normal for revenue tasks when revenuePriority is false', () => {
      const orc = makeOrchestrator({ revenuePriority: false });
      expect(orc.calculatePriority({ type: 'revenue' })).toBe('normal');
    });

    it('returns critical for critical type', () => {
      const orc = makeOrchestrator();
      expect(orc.calculatePriority({ type: 'critical' })).toBe('critical');
    });

    it('returns low for reflection type', () => {
      const orc = makeOrchestrator();
      expect(orc.calculatePriority({ type: 'reflection' })).toBe('low');
    });

    it('returns normal for unknown types', () => {
      const orc = makeOrchestrator();
      expect(orc.calculatePriority({ type: 'anything_else' })).toBe('normal');
    });
  });

  // ── assessComplexity ─────────────────────────────────────────────────────

  describe('assessComplexity', () => {
    it('returns 1 for tasks with no input', () => {
      expect(makeOrchestrator().assessComplexity({ type: 'analysis' })).toBe(1);
    });

    it('returns 1 for short input (< 1000 chars)', () => {
      expect(makeOrchestrator().assessComplexity({ type: 'analysis', input: 'short' })).toBe(1);
    });

    it('returns 2 for medium input (1000–5000 chars)', () => {
      const input = 'x'.repeat(2000);
      expect(makeOrchestrator().assessComplexity({ type: 'analysis', input })).toBe(2);
    });

    it('returns 3 for long input (> 5000 chars)', () => {
      const input = 'x'.repeat(6000);
      expect(makeOrchestrator().assessComplexity({ type: 'analysis', input })).toBe(3);
    });
  });

  // ── estimateCost ─────────────────────────────────────────────────────────

  describe('estimateCost', () => {
    it('returns base cost * 1 for simple task', () => {
      const cost = makeOrchestrator().estimateCost({ type: 'analysis' });
      expect(cost).toBeCloseTo(0.01);
    });

    it('cost scales with complexity', () => {
      const longInput = 'x'.repeat(6000);
      const cost = makeOrchestrator().estimateCost({ type: 'analysis', input: longInput });
      expect(cost).toBeCloseTo(0.03); // 0.01 * 3
    });
  });

  // ── assessRevenueImpact ──────────────────────────────────────────────────

  describe('assessRevenueImpact', () => {
    it('returns high for revenue tasks', () => {
      expect(makeOrchestrator().assessRevenueImpact({ type: 'revenue' })).toBe('high');
    });

    it('returns medium for marketing tasks', () => {
      expect(makeOrchestrator().assessRevenueImpact({ type: 'marketing' })).toBe('medium');
    });

    it('returns low for other task types', () => {
      expect(makeOrchestrator().assessRevenueImpact({ type: 'analysis' })).toBe('low');
    });
  });

  // ── determineRouting ─────────────────────────────────────────────────────

  describe('determineRouting', () => {
    const cases = [
      ['revenue', 'revenue'], ['payment', 'revenue'],
      ['critical', 'critical'], ['security', 'critical'],
      ['reflection', 'reflection'], ['planning', 'reflection'],
      ['code', 'technical'], ['database', 'technical'], ['debug', 'technical'],
      ['unknown_type', 'standard'],
    ];

    test.each(cases)('task type %s → routing %s', (type, expected) => {
      expect(makeOrchestrator().determineRouting({ type })).toBe(expected);
    });
  });

  // ── calculateConfidence ──────────────────────────────────────────────────

  describe('calculateConfidence', () => {
    const goodObservation = {
      systemState: { currentLoad: 0.3, recentFailures: 0 },
      taskContext: { complexity: 1 },
    };

    it('starts at 0.8 for healthy system', () => {
      expect(makeOrchestrator().calculateConfidence({}, goodObservation)).toBeCloseTo(0.8);
    });

    it('decreases when system load is high', () => {
      const obs = { systemState: { currentLoad: 0.9, recentFailures: 0 }, taskContext: { complexity: 1 } };
      expect(makeOrchestrator().calculateConfidence({}, obs)).toBeCloseTo(0.7);
    });

    it('decreases when there are recent failures', () => {
      const obs = { systemState: { currentLoad: 0.3, recentFailures: 4 }, taskContext: { complexity: 1 } };
      expect(makeOrchestrator().calculateConfidence({}, obs)).toBeCloseTo(0.6);
    });

    it('decreases for complex tasks', () => {
      const obs = { systemState: { currentLoad: 0.3, recentFailures: 0 }, taskContext: { complexity: 3 } };
      expect(makeOrchestrator().calculateConfidence({}, obs)).toBeCloseTo(0.7);
    });

    it('clamps confidence to [0.1, 0.99]', () => {
      const worstObs = { systemState: { currentLoad: 0.99, recentFailures: 10 }, taskContext: { complexity: 3 } };
      expect(makeOrchestrator().calculateConfidence({}, worstObs)).toBeGreaterThanOrEqual(0.1);
    });
  });

  // ── calculateRisk ────────────────────────────────────────────────────────

  describe('calculateRisk', () => {
    const baseObs = { systemState: { currentLoad: 0.3 } };

    it('base risk is 0.1 for standard tasks', () => {
      expect(makeOrchestrator().calculateRisk({ type: 'analysis' }, baseObs)).toBeCloseTo(0.1);
    });

    it('adds 0.1 for revenue tasks', () => {
      expect(makeOrchestrator().calculateRisk({ type: 'revenue' }, baseObs)).toBeCloseTo(0.2);
    });

    it('adds 0.2 for critical tasks', () => {
      expect(makeOrchestrator().calculateRisk({ type: 'critical' }, baseObs)).toBeCloseTo(0.3);
    });

    it('adds risk when system load > 0.9', () => {
      const highLoadObs = { systemState: { currentLoad: 0.95 } };
      expect(makeOrchestrator().calculateRisk({ type: 'analysis' }, highLoadObs)).toBeCloseTo(0.3);
    });

    it('clamps risk to [0, 1]', () => {
      const maxObs = { systemState: { currentLoad: 0.95 } };
      const risk = makeOrchestrator().calculateRisk({ type: 'critical' }, maxObs);
      expect(risk).toBeLessThanOrEqual(1.0);
    });
  });

  // ── generateRecommendation ───────────────────────────────────────────────

  describe('generateRecommendation', () => {
    it('rejects when confidence is below threshold', () => {
      const rec = makeOrchestrator({ confidenceThreshold: 0.7 }).generateRecommendation(0.5, 0.1, 0.01);
      expect(rec).toBe('reject_low_confidence');
    });

    it('rejects when cost exceeds threshold', () => {
      const rec = makeOrchestrator({ costThreshold: 0.10 }).generateRecommendation(0.9, 0.1, 0.50);
      expect(rec).toBe('reject_high_cost');
    });

    it('proceeds with caution when risk > 0.5', () => {
      const rec = makeOrchestrator().generateRecommendation(0.9, 0.6, 0.01);
      expect(rec).toBe('proceed_with_caution');
    });

    it('proceeds normally for confident, low-risk, low-cost tasks', () => {
      const rec = makeOrchestrator().generateRecommendation(0.9, 0.2, 0.01);
      expect(rec).toBe('proceed');
    });
  });

  // ── updateMetrics ────────────────────────────────────────────────────────

  describe('updateMetrics', () => {
    it('increments tasksProcessed on each call', () => {
      const orc = makeOrchestrator();
      orc.updateMetrics({ action: { success: true }, measurement: { cost: 0 } }, 100);
      orc.updateMetrics({ action: { success: true }, measurement: { cost: 0 } }, 200);
      expect(orc.metrics.tasksProcessed).toBe(2);
    });
  });

  // ── updateDriftScore ─────────────────────────────────────────────────────

  describe('updateDriftScore', () => {
    it('adjusts drift based on confidence vs reality', () => {
      const orc = makeOrchestrator();
      orc.updateDriftScore(0.2); // confidence was 0.2 off
      expect(orc.driftScore).toBeDefined();
    });
  });

  // ── getStatus ────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns object with expected shape', () => {
      const status = makeOrchestrator().getStatus();
      expect(status).toHaveProperty('metrics');
      expect(status).toHaveProperty('config');
    });
  });

  // ── reset ────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('resets metrics to zero after processing', async () => {
      const orc = makeOrchestrator();
      orc.updateMetrics({ action: { success: true }, measurement: { cost: 0 } }, 100);
      expect(orc.metrics.tasksProcessed).toBe(1);
      await orc.reset();
      expect(orc.metrics.tasksProcessed).toBe(0);
    });
  });

  // ── event emissions ──────────────────────────────────────────────────────

  describe('event emissions', () => {
    it('emits task_completed on successful processTask', async () => {
      const orc = makeOrchestrator();
      const onComplete = jest.fn();
      orc.on('task_completed', onComplete);

      jest.spyOn(orc, 'executeHeidiLoop').mockResolvedValue({ success: true, result: 'ok' });
      await orc.processTask({ type: 'analysis', input: 'test' });

      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ task: expect.any(Object) }));
    });

    it('emits task_failed on processTask error', async () => {
      const orc = makeOrchestrator();
      const onFail = jest.fn();
      orc.on('task_failed', onFail);

      jest.spyOn(orc, 'executeHeidiLoop').mockRejectedValue(new Error('model crash'));

      await expect(orc.processTask({ type: 'analysis', input: 'test' })).rejects.toThrow();
      expect(onFail).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }));
    });
  });

  // ── prepareModelInput ────────────────────────────────────────────────────

  describe('prepareModelInput', () => {
    it('builds model input from task fields', () => {
      const orc = makeOrchestrator();
      const input = orc.prepareModelInput({ type: 'analysis', instruction: 'do this', context: { key: 'val' } });
      expect(input.task).toBe('analysis');
      expect(input.instruction).toBe('do this');
      expect(input.context).toEqual({ key: 'val' });
    });

    it('falls back to task.input when instruction missing', () => {
      const orc = makeOrchestrator();
      const input = orc.prepareModelInput({ type: 'analysis', input: 'fallback instruction' });
      expect(input.instruction).toBe('fallback instruction');
    });
  });
});
