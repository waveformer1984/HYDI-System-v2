'use strict';
// Deadline enforcement — real spawns (win32 + Linux/POSIX).
// The #3942 shape: parent spawns a grandchild inheriting stdio; `close`
// never fires without tree cleanup + pipe teardown.
jest.mock('child_process', () => {
  const real = jest.requireActual('child_process');
  return { ...real, spawn: jest.fn(real.spawn) };
});
const { spawn } = require('child_process');
const ActionExecutor = require('../../heidi-core/actions/action-executor.js');

const WIN = process.platform === 'win32';
const POSIX = process.platform !== 'win32';
// parent -> grandchild holding stdio open forever
const GRANDCHILD = `require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'inherit'});setInterval(()=>{},1e6);`;
// Root keeps running; spawns a grandchild holding stdout (pipe).
const POSIX_TREE = `const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:['pipe','ignore','ignore']});console.log('GRANDCHILD '+g.pid);setInterval(()=>{},1e6);`;
const settle = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message }));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('spawnProcess deadline enforcement', () => {
  (WIN ? it : it.skip)('deadline kills the owned tree and settles once — #3942 shape', async () => {
    const ex = new ActionExecutor({});
    const p = ex.spawnProcess(process.execPath, ['-e', GRANDCHILD], { timeout_ms: 3000 });
    const r = await settle(p);
    expect(r.ok).toBe(false);
    expect(r.e).toMatch(/deadline exceeded after 3000ms/); // deadline classification wins
    // exactly one settlement — the promise resolved a single outcome
  }, 60000); // sweep via powershell+CIM is genuinely slow on a loaded host

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
  }, 60000);

  it('natural exit resolves once with exitCode 0 and no deadline path', async () => {
    const ex = new ActionExecutor({});
    const p = ex.spawnProcess(process.execPath, ['-e', 'process.stdout.write("hi")'], { timeout_ms: 5000 });
    const r = await p;
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('hi');
    // no taskkill was launched for a clean run
    expect(spawn.mock.calls.filter((c) => c[0] === 'taskkill')).toHaveLength(0);
  }, 60000);

  it('nonzero exit rejects distinctly — not labeled as deadline', async () => {
    const ex = new ActionExecutor({});
    const p = ex.spawnProcess(process.execPath, ['-e', 'process.exit(3)'], { timeout_ms: 5000 });
    const r = await settle(p);
    expect(r.ok).toBe(false);
    expect(r.e).toMatch(/exited with code 3/);
    expect(r.e).not.toMatch(/deadline/);
  }, 60000);
});

(POSIX ? describe : describe.skip)('spawnProcess deadline enforcement (Linux/POSIX)', () => {
  it('spawns detached on POSIX so the child leads its own process group', async () => {
    const ex = new ActionExecutor({});
    const p = ex.spawnProcess(process.execPath, ['-e', 'setInterval(()=>{},1e6)'], { timeout_ms: 800 });
    await settle(p);
    const first = spawn.mock.calls.find((c) => c[0] === process.execPath && String(c[1][1] || '').includes('setInterval'));
    expect(first).toBeTruthy();
    expect(first[2].detached).toBe(true);
    expect(first[2].shell).toBe(false);
  }, 15000);

  it('deadline kills parent and grandchild — grandchild holds stdout', async () => {
    const ex = new ActionExecutor({});
    let rootPid = null;
    let grandPid = null;
    const origSpawn = spawn.getMockImplementation();
    spawn.mockImplementation((...args) => {
      const child = origSpawn(...args);
      if (args[0] === process.execPath && String(args[1][1] || '').includes('GRANDCHILD')) {
        rootPid = child.pid;
        const onData = (d) => {
          const m = String(d).match(/GRANDCHILD (\d+)/);
          if (m) grandPid = Number(m[1]);
        };
        child.stdout?.on('data', onData);
      }
      return child;
    });
    const p = ex.spawnProcess(process.execPath, ['-e', POSIX_TREE], { timeout_ms: 2500 });
    const r = await settle(p);
    spawn.mockImplementation(origSpawn);
    expect(r.ok).toBe(false);
    expect(r.e).toMatch(/deadline exceeded after 2500ms/);
    expect(r.e).not.toMatch(/exited with code/);
    expect(rootPid).toEqual(expect.any(Number));
    expect(grandPid).toEqual(expect.any(Number));
    expect(alive(rootPid)).toBe(false);
    expect(alive(grandPid)).toBe(false);
  }, 20000);

  it('cleanup failure reports surviving pid when group kill is blocked', async () => {
    const ex = new ActionExecutor({});
    const realKill = process.kill.bind(process);
    let rootPid = null;
    process.kill = function killStub(pid, sig) {
      if (sig === 'SIGKILL') {
        const err = new Error('stubbed kill failure');
        err.code = 'EPERM';
        throw err;
      }
      return realKill(pid, sig);
    };
    try {
      const origSpawn = spawn.getMockImplementation();
      spawn.mockImplementation((...args) => {
        const child = origSpawn(...args);
        if (args[0] === process.execPath && String(args[1][1] || '').includes('setInterval')) {
          rootPid = child.pid;
        }
        return child;
      });
      const p = ex.spawnProcess(process.execPath, ['-e', 'setInterval(()=>{},1e6)'], { timeout_ms: 1000 });
      const r = await settle(p);
      spawn.mockImplementation(origSpawn);
      expect(r.ok).toBe(false);
      expect(r.e).toMatch(/deadline exceeded after 1000ms/);
      expect(r.e).toMatch(/cleanup FAILED — NOT confirmed stopped/);
      expect(r.e).toMatch(new RegExp(`pid ${rootPid}`));
      expect(alive(rootPid)).toBe(true);
      try {
        realKill(-rootPid, 'SIGKILL');
      } catch {
        try {
          realKill(rootPid, 'SIGKILL');
        } catch {
          /* already dead */
        }
      }
    } finally {
      process.kill = realKill;
    }
  }, 15000);
});
