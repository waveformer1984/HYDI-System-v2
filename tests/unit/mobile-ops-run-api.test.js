'use strict';

const { executeTypedAction, listActionsForRole } = require('../../lib/mobile-ops/typed-actions');

describe('mobile-ops typed actions', () => {
  it('lists viewer-safe actions only for viewer', () => {
    const ids = listActionsForRole('viewer').map((a) => a.id);
    expect(ids).toContain('health.check');
    expect(ids).not.toContain('git.inspect');
    expect(ids).not.toContain('tests.run');
  });

  it('operator sees diagnostics and tests', () => {
    const ids = listActionsForRole('operator').map((a) => a.id);
    expect(ids).toContain('git.inspect');
    expect(ids).toContain('tests.run');
  });

  it('requires confirm for tests.run', async () => {
    const out = await executeTypedAction({
      action: 'tests.run',
      args: { suite: 'heidi-mobile' },
      confirm: false,
      role: 'operator',
      ctx: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('confirmation_required');
  });

  it('forbids git.inspect for viewer', async () => {
    const out = await executeTypedAction({
      action: 'git.inspect',
      role: 'viewer',
      ctx: { gitExec: async () => ({ stdout: 'x\n' }) },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('forbidden');
  });

  it('runs health.check with injected fetch', async () => {
    const out = await executeTypedAction({
      action: 'health.check',
      role: 'viewer',
      ctx: {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ status: 'healthy' }),
        }),
      },
    });
    expect(out.ok).toBe(true);
    expect(out.correlation_id).toMatch(/^[a-f0-9]{16}$/);
    expect(out.result.probes.map((p) => p.name)).toEqual(['heidi-web', 'protoforge-core', 'ollama', 'ursula']);
  });
});
