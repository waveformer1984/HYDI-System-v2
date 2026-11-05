'use strict';
// Deadline enforcement — real spawns on win32 where applicable.
// The #3942 shape: parent spawns a grandchild inheriting stdio; `close`
// never fires without tree cleanup + pipe teardown.
jest.mock('child_process', () => {
  const real = jest.requireActual('child_process');
  return { ...real, spawn: jest.fn(real.spawn) };
});
const { spawn } = require('child_process');
const ActionExecutor = require('../../heidi-core/actions/action-executor.js');

const WIN = process.platform === 'win32';
// parent -> grandchild holding stdio open forever
const GRANDCHILD = `require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'inherit'});setInterval(()=>{},1e6);`;
const settle = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message }));

describe('spawnProcess deadline enforcement', () => {
  (WIN ? it : it.skip)('deadline kills the owned tree and settles once — #3942 shape', async () => {
    const ex = new ActionExecutor({});
    const p = ex.spawnProcess(process.execPath, ['-e', GRANDCHILD], { timeout_ms: 3000 });
    const r = await settle(p);
    expect(r.ok).toBe(false);
    expect(r.e).toMatch(/deadline exceeded after 3000ms/); // deadline classification wins
    // exactly one settlement — the promise resolved a single outcome
  }, 15000);

  (WIN ? it : it.skip)('taskkill targets the spawned pid, never an image name', async () => {
    const ex = new ActionExecutor({});
    const p = ex.spawnProcess(process.execPath, ['-e', GRANDCHILD], { timeout_ms: 2500 });
    const calls = () => spawn.mock.calls.map((c) => ({ cmd: c[0], args: c[1] }));
    await settle(p);
    const kills = calls().filter((c) => c.cmd === 'taskkill');
    expect(kills.length).toBeGreaterThan(0);
    for (const k of kills) {
      expect(k.args).toContain('/T');
      expect(k.args).toContain('/PID');
      expect(k.args.every((a) => a !== 'node.exe' && a !== 'node')).toBe(true); // pid-scoped only
    }
  }, 15000);

  it('natural exit resolves once with exitCode 0 and no deadline path', async () => {
    const ex = new ActionExecutor({});
    const p = ex.spawnProcess(process.execPath, ['-e', 'process.stdout.write("hi")'], { timeout_ms: 5000 });
    const r = await p;
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('hi');
    // no taskkill was launched for a clean run
    expect(spawn.mock.calls.filter((c) => c[0] === 'taskkill')).toHaveLength(0);
  });

  it('nonzero exit rejects distinctly — not labeled as deadline', async () => {
    const ex = new ActionExecutor({});
    const p = ex.spawnProcess(process.execPath, ['-e', 'process.exit(3)'], { timeout_ms: 5000 });
    const r = await settle(p);
    expect(r.ok).toBe(false);
    expect(r.e).toMatch(/exited with code 3/);
    expect(r.e).not.toMatch(/deadline/);
  });
});
