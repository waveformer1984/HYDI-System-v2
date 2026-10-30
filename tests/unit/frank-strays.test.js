'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findStrays, collectStrays, descendants, readLockPid } = require('../../lib/observation/strays');
const observer = require('../../scripts/frank-observer');

const GOD = 24168; // the PM2 daemon
const FORK = 'node C:\\Users\\Owner\\AppData\\Roaming\\npm\\node_modules\\pm2\\lib\\ProcessContainerFork.js';

// Shapes taken from Frank on 2026-10-24/25.
function frank({ extraProcs = [], pm2 = [], portOwner = null, lockPid = null, drop = [] } = {}) {
  const procs = [
    { pid: GOD, ppid: 1476, cmd: 'node pm2\\lib\\Daemon.js' },
    { pid: 15440, ppid: GOD, cmd: `${FORK}` },                              // heidi-web-standalone (next start)
    { pid: 15441, ppid: 15440, cmd: 'node next\\dist\\server\\lib\\start-server.js' },
    { pid: 52728, ppid: GOD, cmd: `${FORK} --no-stabilization` },           // hydi-daemon
    { pid: 1952, ppid: GOD, cmd: `${FORK}` },                               // hydi-watchdog
    ...extraProcs,
  ].filter((p) => !drop.includes(p.pid));
  const list = pm2.length ? pm2 : [
    { name: 'heidi-web-standalone', pid: 15440, status: 'online' },
    { name: 'hydi-daemon', pid: 52728, status: 'online' },
    { name: 'hydi-watchdog', pid: 1952, status: 'online' },
  ];
  return { procs, pm2: list, portOwner, lockPid };
}

describe('findStrays', () => {
  it('a healthy Frank has no strays (port owned by a child of the web app, lock by the daemon)', () => {
    expect(findStrays(frank({ portOwner: 15441, lockPid: 52728 }))).toEqual([]);
  });

  it('catches the Next server that held :3000 while PM2 crash-looped (pid 13636, 2026-10-25)', () => {
    const issues = findStrays(frank({
      extraProcs: [{ pid: 13636, ppid: 9999, cmd: 'node next\\dist\\server\\lib\\start-server.js' }],
      drop: [15440, 15441], // PM2's own web copy keeps dying on EADDRINUSE
      pm2: [
        { name: 'heidi-web-standalone', pid: 0, status: 'waiting restart' },
        { name: 'hydi-daemon', pid: 52728, status: 'online' },
        { name: 'hydi-watchdog', pid: 1952, status: 'online' },
      ],
      portOwner: 13636,
      lockPid: 52728,
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'crit', id: 'stray-port-3000', pid: 13636 });
    expect(issues[0].text).toContain('Stop-Process -Id 13636');
    expect(issues[0].text).toContain('waiting restart');
  });

  it('catches the daemon copy PM2 forgot while it held the lock (pid 22540, 2026-10-24)', () => {
    const issues = findStrays(frank({
      extraProcs: [{ pid: 22540, ppid: GOD, cmd: `${FORK} --no-stabilization` }],
      drop: [52728], // PM2's daemon copy exits: lock held
      pm2: [
        { name: 'heidi-web-standalone', pid: 15440, status: 'online' },
        { name: 'hydi-daemon', pid: 0, status: 'waiting restart' },
        { name: 'hydi-watchdog', pid: 1952, status: 'online' },
      ],
      lockPid: 22540,
    }));
    expect(issues.map((i) => i.id)).toEqual(['stray-daemon-lock']);
    expect(issues[0].pid).toBe(22540);
  });

  it('catches any PM2 child PM2 no longer lists, even when it holds nothing', () => {
    const issues = findStrays(frank({ extraProcs: [{ pid: 47196, ppid: GOD, cmd: `${FORK} --no-stabilization` }] }));
    expect(issues.map((i) => i.id)).toEqual(['stray-pm2-child-47196']);
  });

  it('does not flag non-PM2 node processes or a stale lock whose process is gone', () => {
    const issues = findStrays(frank({
      extraProcs: [{ pid: 777, ppid: 500, cmd: 'node C:\\tools\\something.js' }],
      lockPid: 99999,
    }));
    expect(issues).toEqual([]);
  });

  it('reports one issue per process even if it matches several rules', () => {
    const issues = findStrays(frank({
      extraProcs: [{ pid: 22540, ppid: GOD, cmd: `${FORK} --no-stabilization` }],
      lockPid: 22540,
    }));
    expect(issues.filter((i) => i.pid === 22540)).toHaveLength(1);
  });

  it('descendants walks the whole tree', () => {
    const procs = [{ pid: 2, ppid: 1 }, { pid: 3, ppid: 2 }, { pid: 4, ppid: 3 }, { pid: 5, ppid: 9 }];
    expect([...descendants(1, procs)].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('collectStrays', () => {
  it('is Windows-only and fails soft when the facts cannot be read', async () => {
    expect(await collectStrays('/repo', { platform: 'linux' })).toBeNull();
    expect(await collectStrays('/repo', { platform: 'win32', exec: async () => null })).toBeNull();
  });

  it('combines PowerShell, pm2 jlist and the lock file into findings', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strays-'));
    fs.writeFileSync(path.join(root, '.heidi-daemon.lock'), JSON.stringify({ pid: 22540 }));
    expect(readLockPid(root)).toBe(22540);
    const exec = async (file) => (file === 'powershell.exe'
      ? { procs: [
        { pid: GOD, ppid: 1, cmd: 'Daemon.js' },
        { pid: 52728, ppid: GOD, cmd: FORK },
        { pid: 1952, ppid: GOD, cmd: FORK },
        { pid: 22540, ppid: GOD, cmd: FORK },
      ], portOwner: null }
      : [
        { name: 'hydi-daemon', pid: 52728, pm2_env: { status: 'online' } },
        { name: 'hydi-watchdog', pid: 1952, pm2_env: { status: 'online' } },
      ]);
    const issues = await collectStrays(root, { platform: 'win32', exec });
    expect(issues.map((i) => i.id)).toEqual(['stray-daemon-lock']);
  });

  it('uses a PM2 list read elsewhere and starts no pm2 jlist of its own', async () => {
    const calls = [];
    const exec = async (file) => { calls.push(file); return { procs: [], portOwner: null }; };
    const issues = await collectStrays('/repo', { platform: 'win32', exec, pm2List: [] });
    expect(issues).toEqual([]);
    expect(calls).toEqual(['powershell.exe']);
    expect(await collectStrays('/repo', { platform: 'win32', exec, pm2List: null })).toBeNull();
    expect(calls).toEqual(['powershell.exe', 'powershell.exe']);
  });
});

describe('frank-observer + strays', () => {
  it('a stray becomes a CRIT issue and an #alerts post after two passes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strays-obs-'));
    fs.mkdirSync(path.join(root, '.observatory'), { recursive: true });
    const posts = [];
    let t = Date.parse('2026-10-25T20:00:00Z');
    const writeSample = () => fs.writeFileSync(path.join(root, '.observatory', 'current.json'), JSON.stringify({ ts: new Date(t - 10000).toISOString(), findings_active: [] }));
    const stray = [{ severity: 'crit', source: 'strays', id: 'stray-port-3000', pid: 13636, text: 'stray process 13636: holds port 3000. Stop it with: Stop-Process -Id 13636' }];
    const pass = () => observer.runObservationPass({
      root,
      platform: 'win32',
      now: () => t,
      collect: async () => ({ ok: true }),
      collectStrays: async () => stray,
      readPm2List: async () => ({ list: [], ageMs: 0 }),
      post: async (channel, body) => { posts.push({ channel, body }); return { ok: true }; },
    });
    writeSample();
    const first = await pass();
    expect(first.snapshot.level).toBe('CRIT');
    expect(first.snapshot.straysChecked).toBe(true);
    expect(posts).toHaveLength(0);
    t += 60000;
    writeSample();
    await pass();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toContain('Stop-Process -Id 13636');
  });
});
