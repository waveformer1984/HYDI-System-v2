'use strict';

const { runHealthCheck, runGitInspect, runTests, trimOutput } = require('../../lib/mobile-ops/action-runners');

describe('mobile-ops action runners', () => {
  it('trimOutput caps long text', () => {
    expect(trimOutput('a'.repeat(9000)).length).toBeLessThan(8100);
    expect(trimOutput('a'.repeat(9000))).toContain('[truncated]');
  });

  it('health.check aggregates probe results', async () => {
    const fetchImpl = jest.fn(async (url) => ({
      ok: url.includes('health'),
      status: url.includes('health') ? 200 : 503,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'healthy' }),
    }));
    const out = await runHealthCheck({ fetchImpl });
    expect(out.probes.map((p) => p.name)).toEqual(['heidi-web', 'protoforge-core', 'ollama', 'ursula']);
    expect(out.ok).toBe(false);
  });

  it('git.inspect uses injected git exec', async () => {
    const gitExec = jest.fn(async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'clean-main\n' };
      if (args[0] === 'rev-parse') return { stdout: 'abc1234\n' };
      return { stdout: '## clean-main\n' };
    });
    const out = await runGitInspect({ gitExec, repoRoot: '/tmp/repo' });
    expect(out.branch).toBe('clean-main');
    expect(out.head).toBe('abc1234');
    expect(gitExec).toHaveBeenCalled();
  });

  it('tests.run rejects unknown suite without spawning', async () => {
    const testExec = jest.fn();
    const out = await runTests({ suite: 'nope' }, { testExec });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('unknown_suite');
    expect(testExec).not.toHaveBeenCalled();
  });
});
