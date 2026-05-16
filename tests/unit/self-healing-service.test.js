'use strict';

/**
 * Unit tests for SelfHealingService
 * All network I/O (fetch) is mocked — no API keys or live endpoints required.
 */

// Mock global fetch before the module is loaded
global.fetch = jest.fn();

const selfHealing = require('../../src/healing/SelfHealingService');

const GOOD_LOOP_RESULT = {
  loopId: 'loop-test-001',
  task: 'revenue_optimization',
  action: { status: 'completed', error: null },
  measurement: { success: false, error: 'Conversion rate below threshold', quality: 0.3, latency: 1200 },
  decision: { strategy: 'external', model: 'claude-opus-4-7' },
  reflection: { lessonsLearned: ['insufficient data window', 'wrong segment targeted'] },
};

const CLAUDE_CORRECTION = {
  root_cause: 'Insufficient data window caused premature decision',
  corrected_task: { type: 'revenue_optimization', strategy: 'hybrid', model: 'claude-opus-4-7', instruction: 'Expand data window to 7 days', priority: 'high' },
  reasoning: 'Widening the observation window should stabilize signal quality.',
};

function mockTracesOk(traces = []) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ traces }),
  });
}

function mockClaudeOk(text) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ content: [{ type: 'text', text }] }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
});

describe('SelfHealingService.diagnoseAndCorrect', () => {
  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    global.fetch.mockResolvedValueOnce(mockTracesOk([]));
    const result = await selfHealing.diagnoseAndCorrect(GOOD_LOOP_RESULT);
    expect(result).toBeNull();
    // Should still have called traces but not Claude
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toMatch(/traces/);
  });

  it('returns parsed correction when Claude returns valid JSON', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    global.fetch
      .mockResolvedValueOnce(mockTracesOk([{ event_id: 'e1', determinism_score: 0.8, drift_fields: ['model'] }]))
      .mockResolvedValueOnce(mockClaudeOk(JSON.stringify(CLAUDE_CORRECTION)));

    const result = await selfHealing.diagnoseAndCorrect(GOOD_LOOP_RESULT);
    expect(result).not.toBeNull();
    expect(result.root_cause).toBe(CLAUDE_CORRECTION.root_cause);
    expect(result.corrected_task.strategy).toBe('hybrid');
    expect(result.corrected_task.priority).toBe('high');
  });

  it('filters out drifting traces (score >= 0.95) from the correction prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const traces = [
      { event_id: 'good', determinism_score: 0.99 },
      { event_id: 'drift', determinism_score: 0.82, drift_fields: ['model'] },
    ];
    global.fetch
      .mockResolvedValueOnce(mockTracesOk(traces))
      .mockResolvedValueOnce(mockClaudeOk(JSON.stringify(CLAUDE_CORRECTION)));

    await selfHealing.diagnoseAndCorrect(GOOD_LOOP_RESULT);
    const claudeBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    const prompt = claudeBody.messages[0].content;
    // Only the drifting trace should appear in the prompt
    expect(prompt).toContain('drift');
    expect(prompt).not.toContain('"good"');
  });

  it('returns null when Claude API returns a non-200 status', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    global.fetch
      .mockResolvedValueOnce(mockTracesOk([]))
      .mockResolvedValueOnce(Promise.resolve({ ok: false, status: 529 }));

    const result = await selfHealing.diagnoseAndCorrect(GOOD_LOOP_RESULT);
    expect(result).toBeNull();
  });

  it('returns null when Claude returns malformed JSON', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    global.fetch
      .mockResolvedValueOnce(mockTracesOk([]))
      .mockResolvedValueOnce(mockClaudeOk('Here is my analysis: ... not json'));

    const result = await selfHealing.diagnoseAndCorrect(GOOD_LOOP_RESULT);
    expect(result).toBeNull();
  });

  it('still runs when traces endpoint is unavailable', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    global.fetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(mockClaudeOk(JSON.stringify(CLAUDE_CORRECTION)));

    const result = await selfHealing.diagnoseAndCorrect(GOOD_LOOP_RESULT);
    expect(result).not.toBeNull();
    expect(result.root_cause).toBeDefined();
  });
});

describe('SelfHealingService.healFromCrash', () => {
  const CRASH_RESPONSE = {
    should_retry: true,
    corrected_task: { type: 'revenue_optimization', strategy: 'local', instruction: 'Use local fallback model', priority: 'normal' },
    reasoning: 'External model unavailable — local fallback recommended.',
  };

  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    global.fetch.mockResolvedValueOnce(mockTracesOk([]));
    const result = await selfHealing.healFromCrash(
      { type: 'revenue_optimization' }, 'TypeError: fetch failed', 'loop-crash-001'
    );
    expect(result).toBeNull();
  });

  it('returns retry instruction when Claude responds correctly', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    global.fetch
      .mockResolvedValueOnce(mockTracesOk([]))
      .mockResolvedValueOnce(mockClaudeOk(JSON.stringify(CRASH_RESPONSE)));

    const result = await selfHealing.healFromCrash(
      { type: 'revenue_optimization' }, 'TypeError: fetch failed', 'loop-crash-001'
    );
    expect(result.should_retry).toBe(true);
    expect(result.corrected_task.strategy).toBe('local');
  });

  it('returns null when Claude response contains no JSON', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    global.fetch
      .mockResolvedValueOnce(mockTracesOk([]))
      .mockResolvedValueOnce(mockClaudeOk('No structured response available.'));

    const result = await selfHealing.healFromCrash({ type: 'test' }, 'boom', 'loop-x');
    expect(result).toBeNull();
  });
});
