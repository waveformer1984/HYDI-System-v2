/**
 * Regression tests for the recovery-lease update in
 * scripts/boot-restart-handler.js.
 *
 * Found during live-state re-establishment (2026-09-18): a boot-control
 * respawn restored protoforge-core successfully, but
 * .recovery-leases/protoforge-core.json kept naming the dead pre-restart
 * pid — a stale ownership claim that fed repeated false recovery
 * evaluations. A completed ack must not be issued while the lease
 * disagrees with the process it reports.
 */

const { handleRestartRequest } = require('../../scripts/boot-restart-handler');

function makeDeps(overrides = {}) {
  const child = { pid: 43210, exitCode: null };
  const entry = {
    mod: {
      id: 'protoforge-core', command: 'node', args: ['src/server.js'], port: 3005,
      health: { url: 'http://127.0.0.1:3005/health' },
    },
    child,
  };
  const newChild = { pid: 55555, exitCode: null };
  return {
    entry,
    newChild,
    deps: {
      findEntry: () => entry,
      stopChild: jest.fn().mockResolvedValue(undefined),
      spawnProcess: jest.fn().mockReturnValue(newChild),
      waitForHealth: jest.fn().mockResolvedValue(true),
      recordLease: jest.fn(),
      log: jest.fn(),
      ...overrides,
    },
  };
}

const REQ = { id: 'req-lease-test', component: 'protoforge-core' };

describe('boot-restart-handler: recovery lease lifecycle', () => {
  it('completed restart writes the lease for the new child before acking', async () => {
    const { deps, newChild } = makeDeps();
    const ack = await handleRestartRequest(REQ, deps);

    expect(ack.status).toBe('completed');
    expect(ack.pid).toBe(newChild.pid);
    expect(deps.recordLease).toHaveBeenCalledTimes(1);
    expect(deps.recordLease).toHaveBeenCalledWith('protoforge-core', expect.objectContaining({
      pid: 55555,
      command: 'node',
      args: ['src/server.js'],
      recoveredBy: 'boot-agent.restart',
      cause: 'req-lease-test',
    }));
  });

  it('lease write failure => ack is failed (not completed), live pid still reported', async () => {
    const { deps, newChild } = makeDeps();
    deps.recordLease = jest.fn(() => { throw new Error('EACCES: lease file locked'); });

    const ack = await handleRestartRequest(REQ, deps);

    expect(ack.status).toBe('failed');
    expect(ack.pid).toBe(newChild.pid); // honest: the child IS alive
    expect(ack.error).toMatch(/lease update failed/);
  });

  it('no lease write attempted when restart itself fails', async () => {
    const { deps } = makeDeps();
    deps.waitForHealth = jest.fn().mockResolvedValue(false);

    const ack = await handleRestartRequest(REQ, deps);

    expect(ack.status).toBe('failed');
    expect(deps.recordLease).not.toHaveBeenCalled();
  });

  it('unowned/external module never reaches the lease write', async () => {
    const { deps, entry } = makeDeps();
    entry.external = true;

    const ack = await handleRestartRequest(REQ, deps);

    expect(ack.status).toBe('failed');
    expect(ack.error).toMatch(/not owned by this boot agent/);
    expect(deps.recordLease).not.toHaveBeenCalled();
  });
});
