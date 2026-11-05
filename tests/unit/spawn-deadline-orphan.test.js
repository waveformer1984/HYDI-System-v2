'use strict';
// The real survivor shape: Node's spawn on Windows assigns children to a Job
// Object (KILL_ON_JOB_CLOSE) — non-detached descendants die automatically when
// the parent exits (proven: non-detached grandchild gone at t+0). A DETACHED
// grandchild escapes the job and survives — the sweep must catch that one.
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
const ORPHAN = `const fs=require('fs');const g=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'ignore',detached:true});fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));setTimeout(()=>process.exit(0),300);`;
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
      // sweep caught and killed the detached orphan — honest not-success
      expect(r.e).toMatch(/orphaned descendant\(s\) killed by PID|deadline exceeded/);
    }
    console.log(JSON.stringify({ gpid, orphanAlive, ms: Date.now() - t0, err: r.e.slice(0, 100) }));
  }, 60000);
});
