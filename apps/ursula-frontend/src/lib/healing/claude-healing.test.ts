import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeHealingService } from './claude-healing';
import * as inferenceRouter from '@/lib/inference-router';

const CORRECTION = {
  root_cause: 'Executor endpoint returned 503',
  corrected_task: { type: 'task_retry', strategy: 'hybrid' as const, instruction: 'Retry with exponential backoff', priority: 'high' as const, should_retry: true },
  reasoning: 'Transient upstream failure — retrying after a delay should succeed.',
};

function makeTracesFetch(traces: unknown[] = []) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ traces }),
  });
}

vi.mock('@/lib/inference-router', () => ({
  infer: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.mocked(inferenceRouter.infer).mockReset();
});

describe('ClaudeHealingService.diagnoseAndCorrect', () => {
  it('returns null when no inference provider is available', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeTracesFetch() as any);
    vi.mocked(inferenceRouter.infer).mockResolvedValueOnce({
      success: false, response: '', provider: 'none', model: 'none', duration_ms: 0, error: 'All inference providers unavailable',
    });

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't1', error: 'boom' });

    expect(result).toBeNull();
    // Should have fetched traces once and queried the inference router once
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(inferenceRouter.infer).toHaveBeenCalledTimes(1);
  });

  it('returns a parsed HealingResult when the inference router returns valid JSON', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeTracesFetch([{ event_id: 'e1', determinism_score: 0.7, drift_fields: ['model'] }]) as any);
    vi.mocked(inferenceRouter.infer).mockResolvedValueOnce({
      success: true, response: JSON.stringify(CORRECTION), provider: 'ollama', model: 'qwen2.5-coder:1.5b', duration_ms: 42,
    });

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't2', taskType: 'test_task', error: 'executor 503', resultStatus: 'failed_retryable' });

    expect(result).not.toBeNull();
    expect(result!.root_cause).toBe(CORRECTION.root_cause);
    expect(result!.corrected_task.should_retry).toBe(true);
    expect(result!.corrected_task.strategy).toBe('hybrid');
  });

  it('returns null when the inference response has no JSON block', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeTracesFetch() as any);
    vi.mocked(inferenceRouter.infer).mockResolvedValueOnce({
      success: true, response: 'I cannot determine the root cause.', provider: 'ollama', model: 'qwen2.5-coder:1.5b', duration_ms: 42,
    });

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't3', error: 'unknown' });
    expect(result).toBeNull();
  });

  it('returns null when the inference router reports failure', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeTracesFetch() as any);
    vi.mocked(inferenceRouter.infer).mockResolvedValueOnce({
      success: false, response: '', provider: 'none', model: 'none', duration_ms: 0, error: 'Claude not configured',
    });

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't4', error: 'crash' });
    expect(result).toBeNull();
  });

  it('still queries the inference router when the traces endpoint is unavailable', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.mocked(inferenceRouter.infer).mockResolvedValueOnce({
      success: true, response: JSON.stringify(CORRECTION), provider: 'openvino', model: 'openvino (GPU)', duration_ms: 42,
    });

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't5', error: 'net error' });
    expect(result).not.toBeNull();
    expect(result!.root_cause).toBeDefined();
  });
});
