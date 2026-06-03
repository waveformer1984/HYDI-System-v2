import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeHealingService } from './claude-healing';

const CORRECTION = {
  root_cause: 'Executor endpoint returned 503',
  corrected_task: { type: 'task_retry', strategy: 'hybrid' as const, instruction: 'Retry with exponential backoff', priority: 'high' as const, should_retry: true },
  reasoning: 'Transient upstream failure — retrying after a delay should succeed.',
};

function makeClaudeFetch(text: string, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 529,
    json: () => Promise.resolve({ content: [{ type: 'text', text }] }),
  });
}

function makeTracesFetch(traces: unknown[] = []) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ traces }),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('ClaudeHealingService.diagnoseAndCorrect', () => {
  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeTracesFetch() as any);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't1', error: 'boom' });

    expect(result).toBeNull();
    // Should have called traces but not Claude
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns a parsed HealingResult when Claude returns valid JSON', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTracesFetch([{ event_id: 'e1', determinism_score: 0.7, drift_fields: ['model'] }]) as any)
      .mockResolvedValueOnce(makeClaudeFetch(JSON.stringify(CORRECTION)) as any);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't2', taskType: 'test_task', error: 'executor 503', resultStatus: 'failed_retryable' });

    expect(result).not.toBeNull();
    expect(result!.root_cause).toBe(CORRECTION.root_cause);
    expect(result!.corrected_task.should_retry).toBe(true);
    expect(result!.corrected_task.strategy).toBe('hybrid');
  });

  it('returns null when Claude response has no JSON block', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTracesFetch() as any)
      .mockResolvedValueOnce(makeClaudeFetch('I cannot determine the root cause.') as any);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't3', error: 'unknown' });
    expect(result).toBeNull();
  });

  it('returns null when Claude API returns an error status', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTracesFetch() as any)
      .mockResolvedValueOnce(makeClaudeFetch('', false) as any);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't4', error: 'crash' });
    expect(result).toBeNull();
  });

  it('still calls Claude when traces endpoint is unavailable', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(makeClaudeFetch(JSON.stringify(CORRECTION)) as any);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't5', error: 'net error' });
    expect(result).not.toBeNull();
    expect(result!.root_cause).toBeDefined();
  });
});
