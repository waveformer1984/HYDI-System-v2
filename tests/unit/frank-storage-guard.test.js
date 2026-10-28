'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const disk = require('../../lib/storage/disk');
const guard = require('../../scripts/frank-storage-guard');

const GIB = disk.GIB;
const HOUR = 60 * 60 * 1000;

function tmpDir(prefix = 'storage-guard-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function age(dir, ms, now) {
  const t = (now - ms) / 1000;
  fs.utimesSync(dir, t, t);
}

function harness({ freeGb = 50, freeAfterGb, env = {} } = {}) {
  const root = tmpDir();
  const tmp = tmpDir('storage-guard-tmp-');
  const posts = [];
  const commands = [];
  let measured = 0;
  const opts = {
    root,
    tmpdir: tmp,
    env,
    platform: 'win32',
    storageDir: path.join(root, '.runtime', 'storage'),
    run: async (file, args) => { commands.push(`${file} ${args.join(' ')}`); return { code: 0, stdout: '', stderr: '' }; },
    post: async (channel, body) => { posts.push({ channel, body }); return { ok: true }; },
    measure: () => {
      measured += 1;
      const gb = measured > 1 && freeAfterGb !== undefined ? freeAfterGb : freeGb;
      return gb === null ? null : { freeBytes: gb * GIB, totalBytes: 500 * GIB };
    },
  };
  return { root, tmp, posts, commands, opts };
}

describe('disk levels', () => {
  it('maps free space to levels and fails closed when unreadable', () => {
    expect(disk.levelFor(50 * GIB, {})).toBe('OK');
    expect(disk.levelFor(15 * GIB, {})).toBe('WATCH');
    expect(disk.levelFor(7 * GIB, {})).toBe('LOW');
    expect(disk.levelFor(1 * GIB, {})).toBe('CRITICAL');
    expect(disk.levelFor(null, {})).toBe('UNKNOWN');
    expect(disk.severity('UNKNOWN')).toBe(disk.severity('LOW'));
    expect(disk.levelFor(15 * GIB, { HYDI_DISK_WATCH_GB: '12' })).toBe('OK');
  });

  it('preflight refuses below the floor and when statfs fails', () => {
    const statfs = (free) => () => ({ bavail: free * 1024, bsize: GIB / 1024, blocks: 500 * 1024 });
    expect(disk.preflight({ minFreeGb: 5, volume: '/', statfs: statfs(3) })).toMatchObject({ ok: false, freeGb: 3 });
    expect(disk.preflight({ minFreeGb: 5, volume: '/', statfs: statfs(9) })).toMatchObject({ ok: true, freeGb: 9 });
    expect(disk.preflight({ minFreeGb: 5, volume: '/', statfs: () => { throw new Error('EIO'); } }))
      .toMatchObject({ ok: false, reason: 'free space unreadable' });
  });
});

describe('frank storage guard cleanup', () => {
  it('only ever removes stale local-ci worktrees and logs, never other temp dirs', async () => {
    const h = harness();
    const now = Date.now();
    const stale = path.join(h.tmp, 'hydi-ci-abcdef1-Xy12Zq');
    const fresh = path.join(h.tmp, 'hydi-ci-abcdef2-Ab34Cd');
    const other = path.join(h.tmp, 'my-project-files');
    const lookalike = path.join(h.tmp, 'hydi-ci-notasha-Ab34Cd');
    for (const d of [stale, fresh, other, lookalike]) fs.mkdirSync(path.join(d, 'node_modules'), { recursive: true });
    for (const d of [stale, other, lookalike]) age(d, 7 * HOUR, now);
    const oldLog = path.join(h.tmp, 'hydi-local-ci', '1234abc');
    const newLog = path.join(h.tmp, 'hydi-local-ci', '5678def');
    fs.mkdirSync(oldLog, { recursive: true });
    fs.mkdirSync(newLog, { recursive: true });
    age(oldLog, 15 * 24 * HOUR, now);

    const status = await guard.runStoragePass({ ...h.opts, now: () => now });

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
    expect(fs.existsSync(lookalike)).toBe(true);
    expect(fs.existsSync(oldLog)).toBe(false);
    expect(fs.existsSync(newLog)).toBe(true);
    expect(status.level).toBe('OK');
    // Healthy disk: no cache clearing, no docker, no pm2 flush.
    expect(h.commands).toEqual(['git worktree prune']);
  });

  it('widens cleanup at LOW and again at CRITICAL', async () => {
    const low = harness({ freeGb: 7 });
    fs.mkdirSync(path.join(low.root, '.next', 'cache', 'webpack'), { recursive: true });
    await guard.runStoragePass(low.opts);
    expect(low.commands).toEqual(['git worktree prune', 'npm.cmd cache clean --force', 'docker builder prune --force']);
    expect(fs.existsSync(path.join(low.root, '.next', 'cache'))).toBe(false);

    const crit = harness({ freeGb: 2 });
    await guard.runStoragePass(crit.opts);
    expect(crit.commands).toContain('docker image prune --force');
    expect(crit.commands).toContain('pm2.cmd flush');
    expect(crit.commands.join('\n')).not.toMatch(/volume|system prune|--all/);
  });

  it('clears %TEMP% entries untouched for 2+ days from WATCH up, and nothing else there', async () => {
    const h = harness({ freeGb: 15 });
    const now = Date.now();
    const old = 3 * 24 * HOUR;
    const put = (rel, ageMs) => {
      const full = path.join(h.tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, 'x');
      if (ageMs) age(full, ageMs, now);
      return full;
    };
    const oldFile = put('old-installer.exe', old);
    put('old-folder/a/b.bin', old);
    age(path.join(h.tmp, 'old-folder', 'a'), old, now);
    age(path.join(h.tmp, 'old-folder'), old, now);
    const recentFile = put('today.log', 0);
    // an old-looking folder with fresh content deep inside is in use
    put('busy-folder/deep/fresh.tmp', 0);
    age(path.join(h.tmp, 'busy-folder', 'deep'), old, now);
    age(path.join(h.tmp, 'busy-folder'), old, now);
    const swap = put('wsl-swap.vhdx', old);
    const ciLike = put('hydi-ci-notasha-Ab34Cd/x', old);
    age(path.dirname(ciLike), old, now);
    // a link to a folder elsewhere: neither followed nor removed
    const outside = tmpDir('storage-guard-outside-');
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'mine');
    // a junction on Windows (no admin needed), a symlink elsewhere
    fs.symlinkSync(outside, path.join(h.tmp, 'link-out'), process.platform === 'win32' ? 'junction' : 'dir');

    const status = await guard.runStoragePass({ ...h.opts, now: () => now });

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(path.join(h.tmp, 'old-folder'))).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
    expect(fs.existsSync(path.join(h.tmp, 'busy-folder', 'deep', 'fresh.tmp'))).toBe(true);
    expect(fs.existsSync(swap)).toBe(true);
    expect(fs.existsSync(ciLike)).toBe(true);
    expect(fs.lstatSync(path.join(h.tmp, 'link-out')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('mine');
    expect(status.level).toBe('WATCH');
    expect(status.actions.find((a) => a.id === 'stale-temp').detail).toBe('2 removed');
  });

  it('leaves %TEMP% alone at OK and off Windows', async () => {
    const now = Date.now();
    for (const [freeGb, platform, detail] of [[50, 'win32', undefined], [15, 'linux', 'skipped: Windows only']]) {
      const h = harness({ freeGb });
      const f = path.join(h.tmp, 'old-installer.exe');
      fs.writeFileSync(f, 'x');
      age(f, 3 * 24 * HOUR, now);
      const status = await guard.runStoragePass({ ...h.opts, platform, now: () => now });
      expect(fs.existsSync(f)).toBe(true);
      const action = status.actions.find((a) => a.id === 'stale-temp');
      expect(action && action.detail).toBe(detail);
    }
  });

  it('treats a folder too big to walk as in use', () => {
    const dir = tmpDir();
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(dir, `f${i}`), 'x');
    age(dir, 3 * 24 * HOUR, now);
    expect(guard.newestMtime(dir, 3)).toBe(Infinity);
    expect(guard.newestMtime(dir)).toBeLessThanOrEqual(now);
  });

  it('leaves .next/cache alone while a deploy holds its lock', async () => {
    const h = harness({ freeGb: 7 });
    fs.mkdirSync(path.join(h.root, '.next', 'cache'), { recursive: true });
    fs.mkdirSync(path.join(h.root, '.runtime'), { recursive: true });
    fs.writeFileSync(path.join(h.root, '.runtime', 'frank-auto-deploy.lock'), '123');
    const status = await guard.runStoragePass(h.opts);
    expect(fs.existsSync(path.join(h.root, '.next', 'cache'))).toBe(true);
    expect(status.actions.find((a) => a.id === 'next-build-cache').detail).toContain('deploy in progress');
  });

  it('HYDI_STORAGE_AUTOCLEAN=off measures and alerts but removes nothing', async () => {
    const h = harness({ freeGb: 2, env: { HYDI_STORAGE_AUTOCLEAN: 'off' } });
    const stale = path.join(h.tmp, 'hydi-ci-abcdef1-Xy12Zq');
    fs.mkdirSync(stale);
    age(stale, 7 * HOUR, Date.now());
    const status = await guard.runStoragePass(h.opts);
    expect(h.commands).toEqual([]);
    expect(fs.existsSync(stale)).toBe(true);
    expect(status.level).toBe('CRITICAL');
    expect(h.posts.some((p) => p.channel === 'alerts' && p.body.includes('CRITICAL'))).toBe(true);
  });
});

describe('frank storage guard status, alerts and reports', () => {
  it('writes status, alerts once per level, and posts a recovery once', async () => {
    const h = harness({ freeGb: 7 });
    let t = Date.now();
    const pass = (freeGb) => guard.runStoragePass({ ...h.opts, now: () => t, measure: () => ({ freeBytes: freeGb * GIB, totalBytes: 500 * GIB }) });

    await pass(7);
    const status = JSON.parse(fs.readFileSync(path.join(h.opts.storageDir, 'status.json'), 'utf8'));
    expect(status).toMatchObject({ level: 'LOW', freeGb: 7, totalGb: 500, autoclean: true });
    expect(status.gateFloors).toEqual({ deployGb: 5, localCiGb: 8 });
    const alerts = () => h.posts.filter((p) => p.channel === 'alerts').map((p) => p.body);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain('LOW: 7 GB free');
    expect(alerts()[0]).toContain('local CI (needs 8 GB)');

    t += 15 * 60 * 1000;
    await pass(7);
    expect(alerts()).toHaveLength(1); // same level, no repeat

    t += 15 * 60 * 1000;
    await pass(3);
    expect(alerts()).toHaveLength(2);
    expect(alerts()[1]).toContain('CRITICAL');
    expect(alerts()[1]).toContain('auto-deploy (needs 5 GB)');

    t += 15 * 60 * 1000;
    await pass(40);
    expect(alerts()).toHaveLength(3);
    expect(alerts()[2]).toContain('recovered');

    t += 15 * 60 * 1000;
    await pass(40);
    expect(alerts()).toHaveLength(3);
  });

  it('retries an alert the board did not accept', async () => {
    const h = harness({ freeGb: 3 });
    let accept = false;
    const opts = { ...h.opts, post: async (channel, body) => { h.posts.push({ channel, body }); return accept ? { ok: true } : { ok: false, skipped: true }; } };
    await guard.runStoragePass(opts);
    accept = true;
    await guard.runStoragePass(opts);
    expect(h.posts.filter((p) => p.channel === 'alerts')).toHaveLength(2);
  });

  it('posts the weekly report once per 7 days', async () => {
    const h = harness({ freeGb: 60 });
    let t = Date.now();
    await guard.runStoragePass({ ...h.opts, now: () => t });
    t += 24 * HOUR;
    await guard.runStoragePass({ ...h.opts, now: () => t });
    t += 7 * 24 * HOUR;
    await guard.runStoragePass({ ...h.opts, now: () => t });
    const reports = h.posts.filter((p) => p.channel === 'ops');
    expect(reports).toHaveLength(2);
    expect(reports[0].body).toContain('Weekly storage report');
  });

  it('computes the burn rate net of what the guard freed, and warns before CRITICAL', () => {
    const now = 10 * 24 * HOUR;
    const points = [
      { at: now - 20 * HOUR, freeBytes: 18 * GIB, freedBytes: 0 },
      { at: now - 10 * HOUR, freeBytes: 15 * GIB, freedBytes: 2 * GIB },
      { at: now, freeBytes: 14 * GIB, freedBytes: 0 },
    ];
    // 18 -> 14 GB in 20h, plus 2 GB the guard freed in between: -6 GB / 20h.
    expect(guard.trendGbPerDay(points, now)).toBe(-7.2);
    expect(guard.daysUntilCritical(14 * GIB, -7.2, {})).toBe(1.3);
    expect(guard.trendGbPerDay(points.slice(2), now)).toBeNull();
  });

  it('raises a TREND alert at WATCH when CRITICAL is under 3 days away', async () => {
    const h = harness();
    const now = Date.now();
    const storageDir = h.opts.storageDir;
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(path.join(storageDir, 'history.jsonl'), `${JSON.stringify({ at: now - 12 * HOUR, freeBytes: 18 * GIB, freedBytes: 0 })}\n`);
    const status = await guard.runStoragePass({ ...h.opts, now: () => now, measure: () => ({ freeBytes: 12 * GIB, totalBytes: 500 * GIB }) });
    expect(status.level).toBe('WATCH');
    expect(status.daysToCritical).toBeLessThan(3);
    expect(h.posts.find((p) => p.channel === 'alerts').body).toContain('days until CRITICAL');
  });
});

describe('disk gates in other long-running jobs', () => {
  it('local-ci skips a watch pass on low disk without touching GitHub', async () => {
    const { watchOnce } = require('../../scripts/local-ci');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = { includeMain: true, repoRoot: '/nonexistent', token: 'x' };
    await expect(watchOnce(ctx, () => ({ ok: false, reason: 'only 3 GB free, needs 8 GB' }))).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(' ')).toContain('skipping this pass: only 3 GB free');
    log.mockRestore();
  });

  it('the guard is declared in ecosystem.config.js as a long-lived loop', () => {
    const ecosystem = require('../../ecosystem.config.js');
    const entry = ecosystem.apps.find((a) => a.name === guard.APP_NAME);
    expect(entry).toBeDefined();
    expect(entry.script).toBe('scripts/frank-storage-guard.js');
    expect(entry.autorestart).toBe(true);
    expect(entry.cron_restart).toBeUndefined();
  });
});
