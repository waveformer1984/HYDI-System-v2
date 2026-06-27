import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decomposeGoal, type TaskDAG } from './task-decomposer';

const VALID_DAG: TaskDAG = {
  goal: 'Launch a new product page',
  reasoning: 'Decomposed into three sequential steps.',
  tasks: [
    { id: 't1', type: 'copy_generation', instruction: 'Write product description', priority: 'normal', strategy: 'external', depends_on: [] },
    { id: 't2', type: 'image_generation', instruction: 'Generate hero image', priority: 'normal', strategy: 'external', depends_on: [] },
    { id: 't3', type: 'page_deploy', instruction: 'Deploy product page with copy and image', priority: 'high', strategy: 'hybrid', depends_on: ['t1', 't2'] },
  ],
};

function makeClaudeFetch(text: string, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ content: [{ type: 'text', text }] }),
  });
}

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('decomposeGoal', () => {
  it('returns a validated TaskDAG when Claude responds with valid JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeClaudeFetch(JSON.stringify(VALID_DAG)) as any);
    const dag = await decomposeGoal('Launch a new product page');
    expect(dag.tasks).toHaveLength(3);
    expect(dag.tasks[2].depends_on).toContain('t1');
    expect(dag.tasks[2].depends_on).toContain('t2');
  });

  it('throws when Claude returns no JSON block', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeClaudeFetch('I cannot decompose this goal.') as any);
    await expect(decomposeGoal('impossible goal')).rejects.toThrow('valid JSON DAG');
  });

  it('throws on circular dependency', async () => {
    const circular: TaskDAG = {
      goal: 'cycle',
      reasoning: 'bad',
      tasks: [
        { id: 't1', type: 'a', instruction: 'a', priority: 'normal', strategy: 'local', depends_on: ['t2'] },
        { id: 't2', type: 'b', instruction: 'b', priority: 'normal', strategy: 'local', depends_on: ['t1'] },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeClaudeFetch(JSON.stringify(circular)) as any);
    await expect(decomposeGoal('cycle')).rejects.toThrow('Circular dependency');
  });

  it('throws when a task references an unknown dependency', async () => {
    const unknown: TaskDAG = {
      goal: 'missing dep',
      reasoning: 'bad ref',
      tasks: [
        { id: 't1', type: 'a', instruction: 'a', priority: 'normal', strategy: 'local', depends_on: ['t99'] },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeClaudeFetch(JSON.stringify(unknown)) as any);
    await expect(decomposeGoal('missing dep')).rejects.toThrow('unknown task t99');
  });

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) } as any);
    await expect(decomposeGoal('test')).rejects.toThrow();
  });

  it('passes context to Claude in the request body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeClaudeFetch(JSON.stringify(VALID_DAG)) as any);
    await decomposeGoal('goal', { environment: 'production' });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    const content = JSON.parse(body.messages[0].content);
    expect(content.context.environment).toBe('production');
  });
});
