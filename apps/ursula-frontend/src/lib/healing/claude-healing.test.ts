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

// URL-aware fetch mock: claude-healing routes through inference-router
// (Ollama :11434 → OpenVINO :11435 → Claude), so a plain sequential mock
// feeds Anthropic-shaped JSON to the local providers and misfires.
// Local providers are stubbed "down"; anthropic.com gets `claudeImpl`.
// Hostname-exact URL matching — substring matching would also hit
// lookalike hosts (CodeQL js/incomplete-url-substring-sanitization).
function hostOf(input: unknown): { host: string; path: string } {
  try {
    const u = new URL(String((input as { url?: string })?.url ?? input));
    return { host: u.hostname, path: u.pathname + u.search };
  } catch {
    return { host: '', path: '' };
  }
}

function hostMatches(host: string, part: string): boolean {
  return host === part || host.endsWith(`.${part}`) || host === part.split(':')[0];
}

function stubFetchByUrl(
  mockFetch: ReturnType<typeof vi.fn>,
  impls: Array<[urlPart: string, impl: () => Promise<unknown> | unknown]>
) {
  mockFetch.mockImplementation((input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    const { host, path } = hostOf(input);
    for (const [part, impl] of impls) {
      const hit = part.includes('/') ? path.includes(part) : hostMatches(host, part);
      if (hit || (!host && url.includes(part))) {
        return typeof impl === 'function' ? (impl as () => Promise<unknown>)() : Promise.resolve(impl);
      }
    }
    return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
  });
}

function anthropicCalls(mockFetch: ReturnType<typeof vi.fn>): string[] {
  return mockFetch.mock.calls
    .map((c) => String((c[0] as { url?: string })?.url ?? c[0]))
    .filter((u) => {
      const { host } = hostOf(u);
      return host === 'anthropic.com' || host.endsWith('.anthropic.com');
    });
}

beforeEach(() => {
  vi.stubEnv('HYDI_ALLOW_PAID_LLM', 'true');
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
    stubFetchByUrl(mockFetch, [
      ['/api/traces', () => makeTracesFetch()],
    ]);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't1', error: 'boom' });

    expect(result).toBeNull();
    // Traces + local providers may be consulted, but no paid host is contacted
    expect(anthropicCalls(mockFetch)).toHaveLength(0);
  });

  it('returns a parsed HealingResult when Claude returns valid JSON', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.mocked(fetch);
    stubFetchByUrl(mockFetch, [
      ['/api/traces', () => makeTracesFetch([{ event_id: 'e1', determinism_score: 0.7, drift_fields: ['model'] }])],
      ['anthropic.com', () => makeClaudeFetch(JSON.stringify(CORRECTION))],
    ]);

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
    stubFetchByUrl(mockFetch, [
      ['/api/traces', () => makeTracesFetch()],
      ['anthropic.com', () => makeClaudeFetch('I cannot determine the root cause.')],
    ]);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't3', error: 'unknown' });
    expect(result).toBeNull();
  });

  it('returns null when Claude API returns an error status', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.mocked(fetch);
    stubFetchByUrl(mockFetch, [
      ['/api/traces', () => makeTracesFetch()],
      ['anthropic.com', () => makeClaudeFetch('', false)],
    ]);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't4', error: 'crash' });
    expect(result).toBeNull();
  });

  it('still calls Claude when traces endpoint is unavailable', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.mocked(fetch);
    stubFetchByUrl(mockFetch, [
      ['/api/traces', () => Promise.reject(new Error('ECONNREFUSED'))],
      ['anthropic.com', () => makeClaudeFetch(JSON.stringify(CORRECTION))],
    ]);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't5', error: 'net error' });
    expect(result).not.toBeNull();
    expect(result!.root_cause).toBeDefined();
  });

  it('does not contact Claude when HYDI_ALLOW_PAID_LLM is off', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('HYDI_ALLOW_PAID_LLM', 'false');
    const mockFetch = vi.mocked(fetch);
    stubFetchByUrl(mockFetch, [
      ['/api/traces', () => makeTracesFetch()],
      ['anthropic.com', () => makeClaudeFetch(JSON.stringify(CORRECTION))],
    ]);

    const svc = new ClaudeHealingService();
    const result = await svc.diagnoseAndCorrect({ taskId: 't6', error: 'gated' });
    expect(result).toBeNull();
    expect(anthropicCalls(mockFetch)).toHaveLength(0);
  });
});
