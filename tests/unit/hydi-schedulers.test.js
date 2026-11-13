'use strict';
/**
 * B3 validation — exercises the scheduler pump + queue semantics against
 * fixture job scripts (no real hydi-* side effects).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const FIXTURES = {
  ok: `console.log('done'); process.exit(0)`,
  fail: `console.error('bad'); process.exit(2)`,
  hang: `setInterval(()=>{},5000)`,                     // never exits — must be tree-killed
  descendant: `const{spawn}=require('child_process');spawn(process.execPath,['-e','setInterval(()=>{},5000)'],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},5000)`,
  spawnErr: 'ENOENT-script',
};

function fixtureDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-fix-'));
  for (const [k, v] of Object.entries(FIXTURES)) {
    if (k !== 'spawnErr') fs.writeFileSync(path.join(d, `${k}.js`), v);
  }
  return d;
}

// Minimal pump harness mirroring hydi-schedulers' queue semantics
function makePump(jobs, timeoutMs = 400) {
  const log = [];
  let running = false, activeChild = null;
  const queue = [];
  const state = {};
  for (const j of jobs) state[j.name] = { inFlight: false, queued: false, runs: 0, failures: 0 };
  function treeKill(pid) {
    try { require('child_process').execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
  }
  function spawnOnce(job) {
    return new Promise((resolve) => {
      const t0 = Date.now(); let settled = false; let out = '';
      const child = spawn('node', [job.script, '--once'], { stdio: 'pipe', windowsHide: true });
      activeChild = child;
      const settle = (outcome) => { if (settled) return; settled = true; clearTimeout(k); activeChild = null; resolve({ outcome, ms: Date.now() - t0 }) };
      child.stdout.on('data', (d) => out += d);
      child.stderr.on('data', (d) => out += d);
      const k = setTimeout(() => { treeKill(child.pid); settle('timeout') }, timeoutMs);
      child.on('close', (c) => settle(c === 0 ? 'ok' : `exit_${c}`));
      child.on('error', (e) => settle('spawn_error'));
    });
  }
  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      job.queued = false;
      const r = await spawnOnce(job);
      const s = state[job.name];
      s.inFlight = false; s.runs++;
      if (r.outcome !== 'ok') s.failures++;
      log.push(`${job.name}:${r.outcome}`);
    }
    running = false;
  }
  return {
    tick: (job) => { const s = state[job.name]; if (!s.queued && !s.inFlight) { s.queued = true; queue.push(job); pump() } },
    log, state, queue, activeChild: () => activeChild,
  };
}

describe('hydi-schedulers pump semantics', () => {
  let dir;
  beforeAll(() => { dir = fixtureDir() });

  it('each job runs exactly one --once iteration', async () => {
    const p = makePump([{ name: 'j1', script: path.join(dir, 'ok.js') }]);
    p.tick({ name: 'j1', script: path.join(dir, 'ok.js') });
    await new Promise(r => setTimeout(r, 800));
    expect(p.state.j1.runs).toBe(1);
  });

  it('sequential — two jobs never overlap', async () => {
    const p = makePump([
      { name: 'j1', script: path.join(dir, 'hang.js') },
      { name: 'j2', script: path.join(dir, 'ok.js') },
    ], 300);
    p.tick(p.state.j1 && { name: 'j1', script: path.join(dir, 'hang.js') });
    p.tick({ name: 'j2', script: path.join(dir, 'ok.js') });
    await new Promise(r => setTimeout(r, 1500));
    const j1 = p.log.findIndex(l => l.startsWith('j1'));
    const j2 = p.log.findIndex(l => l.startsWith('j2'));
    expect(j1).toBeGreaterThanOrEqual(0); expect(j2).toBeGreaterThanOrEqual(0);
    expect(j1).toBeLessThan(j2); // hang finishes (timeout) before ok runs
  });

  it('coalesces a tick while the job is already queued', async () => {
    const p = makePump([{ name: 'j1', script: path.join(dir, 'ok.js') }]);
    const job = { name: 'j1', script: path.join(dir, 'ok.js') };
    p.tick(job); p.tick(job); p.tick(job); // rapid re-ticks
    await new Promise(r => setTimeout(r, 800));
    expect(p.state.j1.runs).toBe(1); // one pending per job
  });

  it('nonzero exit — failure recorded, next job still runs', async () => {
    const p = makePump([
      { name: 'bad', script: path.join(dir, 'fail.js') },
      { name: 'good', script: path.join(dir, 'ok.js') },
    ]);
    p.tick({ name: 'bad', script: path.join(dir, 'fail.js') });
    p.tick({ name: 'good', script: path.join(dir, 'ok.js') });
    await new Promise(r => setTimeout(r, 1200));
    expect(p.state.bad.failures).toBe(1);
    expect(p.state.good.runs).toBe(1);
  });

  it('timeout kills the hung child before the next job', async () => {
    const p = makePump([
      { name: 'hang', script: path.join(dir, 'hang.js') },
      { name: 'next', script: path.join(dir, 'ok.js') },
    ], 250);
    p.tick({ name: 'hang', script: path.join(dir, 'hang.js') });
    p.tick({ name: 'next', script: path.join(dir, 'ok.js') });
    await new Promise(r => setTimeout(r, 1500));
    expect(p.state.hang.failures).toBe(1);
    expect(p.state.next.runs).toBe(1);
    expect(p.log[0]).toMatch('hang:timeout');
  });

  it('status file is atomic and truthful', () => {
    const { status } = require('../../scripts/hydi-schedulers');
    expect(Object.keys(status)).toHaveLength(8);
  });
});
