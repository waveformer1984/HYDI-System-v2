/**
 * Unit tests for HybridModelStack
 * All external API calls and model adapters are mocked.
 */

jest.mock('axios');
jest.mock('../../src/models/local-model-adapter', () =>
  jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ result: 'local-result', confidence: 0.8 }),
    getStatus: jest.fn().mockReturnValue({ available: true, models: {} }),
    getModelStatus: jest.fn().mockReturnValue({}),
  }))
);
jest.mock('../../heidi-core/brain/ollama-client', () =>
  jest.fn().mockImplementation(() => ({
    generate: jest.fn().mockResolvedValue({ response: 'ollama-result' }),
    isAvailable: jest.fn().mockResolvedValue(true),
    getModels: jest.fn().mockResolvedValue([]),
  }))
);

const HybridModelStack = require('../../src/models/HybridModelStack');

// ── Helpers ──────────────────────────────────────────────────────────────────

let _instances = [];

function makeStack(cfg = {}) {
  const stack = new HybridModelStack({
    maxCostPerRequest: 0.50,
    dailyBudget: 10.0,
    externalThreshold: 0.8,
    localFirst: true,
    enableFailover: true,
    ...cfg,
  });
  _instances.push(stack);
  return stack;
}

afterEach(() => {
  _instances.forEach(s => s.destroy());
  _instances = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HybridModelStack', () => {

  // ── Constructor ───────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('applies default config values', () => {
      const stack = new HybridModelStack();
      expect(stack.config.maxCostPerRequest).toBe(0.50);
      expect(stack.config.dailyBudget).toBe(10.0);
      expect(stack.config.localFirst).toBe(true);
      expect(stack.config.enableFailover).toBe(true);
      stack.destroy();
    });

    it('overrides defaults with provided config', () => {
      const stack = new HybridModelStack({ dailyBudget: 5.0, localFirst: false });
      expect(stack.config.dailyBudget).toBe(5.0);
      expect(stack.config.localFirst).toBe(false);
      stack.destroy();
    });

    it('starts with zero cost tracker', () => {
      const stack = makeStack();
      expect(stack.costTracker.daily).toBe(0);
      expect(stack.costTracker.total).toBe(0);
    });
  });

  // ── determineStrategy ─────────────────────────────────────────────────────

  describe('determineStrategy', () => {
    it('forces strategy when forceStrategy option is set', () => {
      const stack = makeStack();
      const strategy = stack.determineStrategy({}, { forceStrategy: 'external', forceModel: 'gpt-4' });
      expect(strategy.type).toBe('external');
      expect(strategy.model).toBe('gpt-4');
      expect(strategy.reason).toBe('forced_by_user');
    });

    it('forces local when daily budget is exhausted', () => {
      const stack = makeStack({ dailyBudget: 0 });
      stack.costTracker.daily = 99; // far above budget
      const strategy = stack.determineStrategy({ type: 'analysis' }, {});
      expect(strategy.type).toBe('local');
      expect(strategy.reason).toBe('budget_limit');
    });

    it('uses external for revenue tasks (high-stakes)', () => {
      const stack = makeStack({ localFirst: false });
      // Disable budget so it doesn't short-circuit
      const strategy = stack.determineStrategy({ type: 'revenue' }, {});
      expect(strategy.type).toBe('external');
      expect(strategy.reason).toBe('high_stakes_revenue_content');
    });

    it('uses local first strategy by default', () => {
      const stack = makeStack({ localFirst: true });
      const strategy = stack.determineStrategy({ type: 'analysis' }, {});
      expect(strategy.type).toBe('local');
      expect(strategy.reason).toBe('local_first_strategy');
    });
  });

  // ── checkExternalRequirement ──────────────────────────────────────────────

  describe('checkExternalRequirement', () => {
    it('requires external for revenue tasks', () => {
      const req = makeStack().checkExternalRequirement({ type: 'revenue' });
      expect(req.required).toBe(true);
      expect(req.provider).toBe('openai');
    });

    it('requires external for sales tasks', () => {
      const req = makeStack().checkExternalRequirement({ type: 'sales' });
      expect(req.required).toBe(true);
    });

    it('requires external for high-complexity tasks', () => {
      const req = makeStack().checkExternalRequirement({ type: 'analysis', complexity: 4 });
      expect(req.required).toBe(true);
      expect(req.model).toBe('gpt-4-turbo');
    });

    it('requires external for polish/refine tasks', () => {
      const req = makeStack().checkExternalRequirement({ type: 'polish' });
      expect(req.required).toBe(true);
      expect(req.provider).toBe('anthropic');
    });

    it('does not require external for simple analysis', () => {
      const req = makeStack().checkExternalRequirement({ type: 'analysis', complexity: 1 });
      expect(req.required).toBe(false);
    });
  });

  // ── mapTaskType ───────────────────────────────────────────────────────────

  describe('mapTaskType', () => {
    it('maps task types to model capability categories', () => {
      const stack = makeStack();
      // Should return a string without throwing
      const result = stack.mapTaskType('analysis');
      expect(typeof result).toBe('string');
    });

    it('handles unknown task types gracefully', () => {
      expect(() => makeStack().mapTaskType('unknown_xyz')).not.toThrow();
    });
  });

  // ── estimateTokens ────────────────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('estimates tokens for string input', () => {
      const tokens = makeStack().estimateTokens({ prompt: 'hello world test' });
      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe('number');
    });

    it('estimates more tokens for longer input', () => {
      const short = makeStack().estimateTokens({ prompt: 'hi' });
      const long = makeStack().estimateTokens({ prompt: 'x'.repeat(1000) });
      expect(long).toBeGreaterThan(short);
    });
  });

  // ── calculateCost ─────────────────────────────────────────────────────────

  describe('calculateCost', () => {
    it('returns a non-negative number', () => {
      const cost = makeStack().calculateCost('openai', 'gpt-4', { prompt: 'test' });
      expect(cost).toBeGreaterThanOrEqual(0);
      expect(typeof cost).toBe('number');
    });

    it('returns zero for local provider', () => {
      const cost = makeStack().calculateCost('local', 'llama3', { prompt: 'test' });
      expect(cost).toBe(0);
    });
  });

  // ── trackCost ─────────────────────────────────────────────────────────────

  describe('trackCost', () => {
    it('accumulates daily and total cost', () => {
      const stack = makeStack();
      stack.trackCost(0.05, 'openai', 'gpt-4');
      stack.trackCost(0.03, 'anthropic', 'claude-3');
      expect(stack.costTracker.daily).toBeCloseTo(0.08);
      expect(stack.costTracker.total).toBeCloseTo(0.08);
    });

    it('emits cost_tracked event', () => {
      const stack = makeStack();
      const onCost = jest.fn();
      stack.on('cost_tracked', onCost);
      stack.trackCost(0.02, 'openai', 'gpt-4');
      expect(onCost).toHaveBeenCalledWith(expect.objectContaining({ cost: 0.02 }));
    });

    it('emits budget_warning when approaching daily limit', () => {
      const stack = makeStack({ dailyBudget: 1.0 });
      const onWarn = jest.fn();
      stack.on('budget_warning', onWarn);
      stack.trackCost(0.95, 'openai', 'gpt-4'); // 95% of budget
      expect(onWarn).toHaveBeenCalled();
    });
  });

  // ── getStatus ─────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns object with expected shape', () => {
      const status = makeStack().getStatus();
      expect(status).toHaveProperty('config');
      expect(status).toHaveProperty('cost');
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears cost tracker on reset', async () => {
      const stack = makeStack();
      stack.trackCost(1.0, 'openai', 'gpt-4');
      expect(stack.costTracker.total).toBeGreaterThan(0);
      await stack.reset();
      expect(stack.costTracker.total).toBe(0);
      expect(stack.costTracker.daily).toBe(0);
    });
  });
});
