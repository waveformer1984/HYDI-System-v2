'use strict';
// The REAL #3942 shape: parent spawns a grandchild holding stdout, then the
// parent exits immediately. taskkill /T /PID <parent> only reaches a LIVE
// parent — an early-exited parent leaves the grandchild orphaned and
// unreachable by the tree kill. Proves whether cleanup catches the orphan.
jest.mock('child_process', () => {
  const real = jest.requireActual('child_process');
  return { ...real, spawn: jest.fn(real.spawn) };
});
const { spawn } = require('child_process');
const ActionExecutor = require('../../heidi-core/actions/action-executor.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WIN = process.platform === 'win32';
const pidFile = path.join(os.tmpdir(), `dl-orphan-${process.pid}.txt`);
// parent writes the grandchild's PID to pidFile, inherits stdio, then exits.
const ORPHAN = `const fs=require('fs');const g=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));setTimeout(()=>process.exit(0),300);`;
const settle = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e.message }));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('deadline — parent exits early, grandchild orphaned', () => {
  afterEach(() => { try { fs.unlinkSync(pidFile); } catch { /* gone */ } });

  (WIN ? it : it.skip)('orphaned grandchild must still be cleaned or honestly reported', async () => {
    const ex = new ActionExecutor({});
    const t0 = Date.now();
    const p = ex.spawnProcess(process.execPath, ['-e', ORPHAN], { timeout_ms: 4000 });
    const r = await settle(p);
    let gpid = null;
    try { gpid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10); } catch { /* not written */ }
    expect(gpid).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
    // Either: the tree kill reached the orphan (deadline outcome, grandchild dead)
    // Or: cleanup honestly reports a survivor — never claims it was stopped.
    const orphanAlive = alive(gpid);
    if (orphanAlive) {
      expect(r.e).toMatch(/NOT confirmed stopped|cleanup FAILED/);
      try { process.kill(gpid, 'SIGKILL'); } catch { /* cleanup fixture */ }
    } else {
      expect(r.e).toMatch(/deadline exceeded/);
    }
    console.log(JSON.stringify({ gpid, orphanAlive, ms: Date.now() - t0, err: r.e.slice(0, 100) }));
  }, 20000);
});
