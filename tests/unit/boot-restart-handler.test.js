'use strict';

/**
 * scripts/boot-restart-handler.js — the boot-agent side of the restart control
 * channel (Phase 2A).
 *
 * This is the half that actually preserves ownership: when RecoveryEngine asks
 * for a restart, boot-agent stops its own child and spawns the replacement
 * itself, so the new process is still a child of the boot authority.
 *
 * Logic is injected rather than reaching into boot-agent's module state, so it
 * can be tested without spawning anything. No real process is touched here.
 */

const { handleRestartRequest } = require('../../scripts/boot-restart-handler');

function makeDeps(overrides = {}) {
  const calls = { stopped: [], spawned: [], health: [], logs: [] };
  const child = { pid: 5150, exitCode: null };
  const entry = {
    mod: { id: 'protoforge-core', type: 'process', port: 3005 },
    child: { pid: 1111, exitCode: null },
    type: 'process',
  };

  return {
    calls,
    entry,
    deps: {
      findEntry: jest.fn(() => entry),
      stopChild: jest.fn(async (e) => { calls.stopped.push(e.mod.id); return true; }),
      spawnProcess: jest.fn((mod) => { calls.spawned.push(mod.id); return child; }),
      waitForHealth: jest.fn(async (mod) => { calls.health.push(mod.id); return true; }),
      // Injected so tests control whether the spawned child "proves" itself.
      // The real default checks pid-liveness + port-listening; the mock just
      // asserts it was (or was not) consulted for a health-less module.
      verifyRestarted: jest.fn(async () => true),
      log: (id, msg) => calls.logs.push(`${id}: ${msg}`),
      ...overrides,
    },
  };
}

describe('boot-restart-handler', () => {
  test('H1: an unknown module is refused, not silently ignored', async () => {
    const { deps } = makeDeps({ findEntry: jest.fn(() => null) });
    const ack = await handleRestartRequest({ id: 'r1', component: 'not-a-module' }, deps);

    expect(ack.status).toBe('failed');
    expect(ack.error).toMatch(/not.*(supervis|found|owned)/i);
    expect(deps.spawnProcess).not.toHaveBeenCalled();
  });

  test('H2: a successful restart stops the old child, spawns a new one, and reports the new pid', async () => {
    const { deps, calls } = makeDeps();
    const ack = await handleRestartRequest({ id: 'r2', component: 'protoforge-core' }, deps);

    expect(calls.stopped).toEqual(['protoforge-core']);
    expect(calls.spawned).toEqual(['protoforge-core']);
    expect(calls.health).toEqual(['protoforge-core']);

    expect(ack.status).toBe('completed');
    expect(ack.pid).toBe(5150);
    expect(ack.ownedBy).toBe('boot-agent');
  });

  test('H3: the old child is marked as an intentional stop so its exit is not read as a crash', async () => {
    const { deps, entry } = makeDeps();
    // Hold the ORIGINAL child: a successful restart repoints entry.child at the
    // replacement, so asserting on entry.child afterwards would inspect the
    // wrong process.
    const oldChild = entry.child;

    await handleRestartRequest({ id: 'r3', component: 'protoforge-core' }, deps);

    // boot-agent's spawnProcess() exit handler treats any exit as a failure.
    // Without this flag an intentional restart would be logged as an
    // unexpected crash and, outside DELEGATE_RECOVERY mode, would trigger a
    // full system shutdown.
    expect(oldChild.intentionalStop).toBe(true);
    // And the replacement must NOT inherit the flag, or a later genuine crash
    // of the new process would be silently ignored.
    expect(entry.child.intentionalStop).toBeUndefined();
  });

  test('H4: the running entry is updated to the NEW child, so shutdown stops the right process', async () => {
    const { deps, entry } = makeDeps();
    await handleRestartRequest({ id: 'r4', component: 'protoforge-core' }, deps);

    // If this still pointed at the dead child, shutdown would leave the new
    // process running -- an orphan created by the very fix meant to stop them.
    expect(entry.child.pid).toBe(5150);
  });

  test('H5: a failed health check is reported as failed, not completed', async () => {
    const { deps } = makeDeps({ waitForHealth: jest.fn(async () => false) });
    const ack = await handleRestartRequest({ id: 'r5', component: 'protoforge-core' }, deps);

    expect(ack.status).toBe('failed');
    expect(ack.error).toMatch(/health/i);
    expect(ack.status).not.toBe('completed');
  });

  test('H6: if stopping the old child fails, no replacement is spawned', async () => {
    const { deps } = makeDeps({
      stopChild: jest.fn(async () => { throw new Error('taskkill denied'); }),
    });
    const ack = await handleRestartRequest({ id: 'r6', component: 'protoforge-core' }, deps);

    expect(ack.status).toBe('failed');
    expect(ack.error).toMatch(/taskkill denied/i);
    // Spawning on top of a process we failed to stop would duplicate the
    // service and collide on the port.
    expect(deps.spawnProcess).not.toHaveBeenCalled();
  });

  test('H7: a spawn that throws is reported as failed rather than escaping', async () => {
    const { deps } = makeDeps({
      spawnProcess: jest.fn(() => { throw new Error('ENOENT'); }),
    });
    const ack = await handleRestartRequest({ id: 'r7', component: 'protoforge-core' }, deps);

    expect(ack.status).toBe('failed');
    expect(ack.error).toMatch(/ENOENT/);
  });

  test('H9: a health-less module is verified by pid/port, not acked on a vacuous health pass', async () => {
    // The red-team finding: modules with no `health` block got a 'completed'
    // ack purely because waitForHealth resolved true vacuously. verifyRestarted
    // is the second gate for exactly that case.
    const verifyRestarted = jest.fn(async () => false); // child dead / port not listening
    const { deps } = makeDeps({ verifyRestarted });
    const ack = await handleRestartRequest({ id: 'r9', component: 'protoforge-core' }, deps);

    expect(verifyRestarted).toHaveBeenCalled();
    expect(ack.status).toBe('failed');
    expect(ack.status).not.toBe('completed');
  });

  test('H10: a module WITH a health endpoint is proven by it — verifyRestarted is not consulted', async () => {
    const verifyRestarted = jest.fn(async () => false);
    const { deps, entry } = makeDeps({ verifyRestarted });
    entry.mod.health = { path: '/health' }; // health check present -> it is the proof

    const ack = await handleRestartRequest({ id: 'r10', component: 'protoforge-core' }, deps);

    expect(verifyRestarted).not.toHaveBeenCalled();
    expect(ack.status).toBe('completed');
  });

  test('H8: an externally-owned entry is refused while its port is still bound — a live foreign occupant may own it', async () => {
    const { deps } = makeDeps({
      isPortFree: jest.fn(async () => false), // port still bound -> occupant may be alive
      findEntry: jest.fn(() => ({
        mod: { id: 'protoforge-core', type: 'process', port: 3005 },
        child: null,
        type: 'process',
        external: true,
        ownership: 'unsupervised',
      })),
    });
    const ack = await handleRestartRequest({ id: 'r8', component: 'protoforge-core' }, deps);

    expect(ack.status).toBe('failed');
    expect(ack.error).toMatch(/not owned|external|unsupervis/i);
    expect(deps.spawnProcess).not.toHaveBeenCalled();
  });

  test('H8b: without an isPortFree dep, an external entry is refused — absence of proof is not proof of absence', async () => {
    const { deps } = makeDeps({
      // no isPortFree injected -> handler cannot prove the port is free -> refuse
      findEntry: jest.fn(() => ({
        mod: { id: 'protoforge-core', type: 'process', port: 3005 },
        child: null,
        type: 'process',
        external: true,
        ownership: 'unsupervised',
      })),
    });
    const ack = await handleRestartRequest({ id: 'r8b', component: 'protoforge-core' }, deps);

    expect(ack.status).toBe('failed');
    expect(deps.spawnProcess).not.toHaveBeenCalled();
  });

  test('H11: an external entry whose occupant is GONE (port free) is adopted by supervised respawn', async () => {
    // Live incident 2026-09-21: PM2 restarted hydi-boot while its children ran;
    // they became 'unsupervised' occupants, later died, and unconditional
    // refusal made recovery impossible forever (escalation loop). With the
    // port free, respawning collides with nothing and converts the module to
    // owned supervision.
    const { deps, calls } = makeDeps({
      isPortFree: jest.fn(async () => true),
      findEntry: jest.fn(() => ({
        mod: { id: 'protoforge-core', type: 'process', port: 3005 },
        child: null,
        type: 'process',
        external: true,
        ownership: 'unsupervised',
        pid: 9999, // the dead foreign occupant
      })),
    });
    // findEntry returns a fresh object each call — capture it for post-assertions
    const entry = deps.findEntry('protoforge-core');
    deps.findEntry = jest.fn(() => entry);

    const ack = await handleRestartRequest({ id: 'r11', component: 'protoforge-core' }, deps);

    expect(deps.isPortFree).toHaveBeenCalled();
    // No stop attempt — nothing of ours to stop.
    expect(calls.stopped).toEqual([]);
    expect(calls.spawned).toEqual(['protoforge-core']);
    expect(ack.status).toBe('completed');
    // The entry is now owned: external flag cleared, child + pid point at the
    // new supervised process so subsequent restarts take the owned path.
    expect(entry.external).toBe(false);
    expect(entry.child.pid).toBe(5150);
    expect(entry.pid).toBe(5150);
    expect(calls.logs.join('\n')).toMatch(/port free|adopt/i);
  });
});
