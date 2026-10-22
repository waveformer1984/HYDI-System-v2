'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const board = require('../../lib/forge-board/sdk');
const {
  APP_NAME,
  LOCK_STALE_MS,
  acquireLock,
  lockIsStale,
  parseMergedPrTitles,
  readAlertState,
  runAutoDeploy,
  startDeployLoop,
} = require('../../scripts/frank-auto-deploy');

const OLD = '1111111111111111111111111111111111111111';
const NEW = '2222222222222222222222222222222222222222';

function ok(stdout = '') {
  return { code: 0, stdout, stderr: '' };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frank-deploy-'));
}

function baseGitRun(overrides = {}) {
  return jest.fn(async (file, args) => {
    const key = `${file} ${args.join(' ')}`;
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      const value = overrides[key];
      return typeof value === 'function' ? value() : value;
    }
    if (key === 'git fetch origin clean-main') return ok();
    if (key === 'git branch --show-current') return ok('clean-main\n');
    if (key === 'git checkout -- next-env.d.ts') return ok();
    if (key === 'git status --porcelain --untracked-files=no') return ok();
    if (key === 'git rev-parse HEAD') return ok(`${OLD}\n`);
    if (key === 'git rev-parse origin/clean-main') return ok(`${NEW}\n`);
    throw new Error(`unexpected command: ${key}`);
  });
}

describe('Frank auto-deploy', () => {
  it('exits quietly when origin/clean-main has not changed', async () => {
    const run = baseGitRun({ 'git rev-parse origin/clean-main': ok(`${OLD}\n`) });
    const post = jest.fn();
    const release = jest.fn();
    await expect(runAutoDeploy({
      root: '/repo',
      run,
      post,
      acquireLock: () => release,
    })).resolves.toEqual({ status: 'noop' });
    expect(post).not.toHaveBeenCalled();
    expect(run.mock.calls.some(([, args]) => args[0] === 'merge')).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('alerts and stops on a dirty tree, using an explicit hydi-daemon sender', async () => {
    const runtime = tmpDir();
    const run = baseGitRun({
      'git status --porcelain --untracked-files=no': ok(' M lib/file.js\n'),
    });
    const post = jest.spyOn(board, 'post').mockResolvedValue({ ok: true });
    try {
      const result = await runAutoDeploy({
        root: '/repo',
        run,
        acquireLock: () => jest.fn(),
        alertStatePath: path.join(runtime, 'alert.json'),
      });
      expect(result).toEqual({ status: 'blocked', reason: 'working tree is dirty' });
      expect(post).toHaveBeenCalledWith(
        'alerts',
        'Frank auto-deploy stopped: working tree is dirty. Nothing changed.',
        null,
        { sender: 'hydi-daemon' },
      );
      expect(run.mock.calls.some(([, args]) => args[0] === 'merge')).toBe(false);
      // The dirty check runs only after regenerating build files is undone.
      const calls = run.mock.calls.map(([, args]) => args.join(' '));
      expect(calls.indexOf('checkout -- next-env.d.ts')).toBeLessThan(
        calls.indexOf('status --porcelain --untracked-files=no'),
      );
    } finally {
      post.mockRestore();
    }
  });

  it('does not treat untracked files as dirty', async () => {
    const runtime = tmpDir();
    const run = jest.fn(async (file, args) => {
      const key = `${file} ${args.join(' ')}`;
      if (key === 'git fetch origin clean-main') return ok();
      if (key === 'git branch --show-current') return ok('clean-main\n');
      if (key === 'git checkout -- next-env.d.ts') return ok();
      // --untracked-files=no is what hides scratch dirs from the dirty check.
      if (key === 'git status --porcelain --untracked-files=no') return ok();
      if (key === 'git status --porcelain') return ok('?? .next.pre-x-backup/\n?? .codex/\n');
      if (key === 'git rev-parse HEAD') return ok(`${OLD}\n`);
      if (key === 'git rev-parse origin/clean-main') return ok(`${OLD}\n`);
      throw new Error(`unexpected command: ${key}`);
    });
    const result = await runAutoDeploy({
      root: '/repo',
      run,
      post: jest.fn(),
      acquireLock: () => jest.fn(),
      alertStatePath: path.join(runtime, 'alert.json'),
    });
    expect(result).toEqual({ status: 'noop' });
    expect(run.mock.calls.some(([, args]) => args.join(' ') === 'status --porcelain')).toBe(false);
  });

  it('rolls back after failed health and restarts only online PM2 apps', async () => {
    let rolledBack = false;
    const calls = [];
    const run = jest.fn(async (file, args) => {
      calls.push([file, ...args]);
      const key = `${file} ${args.join(' ')}`;
      if (key === 'git fetch origin clean-main') return ok();
      if (key === 'git branch --show-current') return ok('clean-main\n');
      if (key === 'git checkout -- next-env.d.ts') return ok();
      if (key === 'git status --porcelain --untracked-files=no') return ok();
      if (key === 'git rev-parse HEAD') return ok(`${OLD}\n`);
      if (key === 'git rev-parse origin/clean-main') return ok(`${NEW}\n`);
      if (key === `git merge-base --is-ancestor ${OLD} ${NEW}`) return ok();
      if (key === `git log --format=%B%x1e ${OLD}..${NEW}`) {
        return ok('Merge pull request #390 from branch\n\nIsolate board senders\n\x1e');
      }
      if (key === `git diff --name-only ${OLD} ${NEW} -- package-lock.json`) return ok();
      if (key === 'git merge --ff-only origin/clean-main') return ok();
      if (key === `git reset --hard ${OLD}`) {
        rolledBack = true;
        return ok();
      }
      if (key === 'npm.cmd run build') return ok();
      if (key === 'pm2.cmd jlist') {
        return ok(JSON.stringify([
          { name: 'heidi-web', pm2_env: { status: 'online' } },
          { name: 'heidi-mobile-chat', pm2_env: { status: 'online' } },
          { name: 'heidi-core', pm2_env: { status: 'online' } },
          { name: 'heidi-assessment-crew', pm2_env: { status: 'stopped' } },
          { name: 'heidi-errored', pm2_env: { status: 'errored' } },
          { name: APP_NAME, pm2_env: { status: 'online' } },
        ]));
      }
      if (key === 'pm2.cmd restart heidi-web heidi-mobile-chat heidi-core --update-env') return ok();
      throw new Error(`unexpected command: ${key}`);
    });
    const posts = [];
    let clock = 0;
    const result = await runAutoDeploy({
      root: 'C:\\HYDI-System-v2',
      platform: 'win32',
      run,
      post: async (channel, body) => { posts.push({ channel, body }); return { ok: true }; },
      acquireLock: () => jest.fn(),
      alertStatePath: path.join(tmpDir(), 'alert.json'),
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      healthTimeoutMs: 100,
      healthIntervalMs: 25,
      probe: async (check) => ({
        name: check.name,
        ok: rolledBack || check.name !== 'heidi-mobile',
        status: rolledBack || check.name !== 'heidi-mobile' ? 200 : 0,
      }),
    });

    expect(result.status).toBe('rolled_back');
    expect(calls).toContainEqual(['git', 'reset', '--hard', OLD]);
    expect(calls.filter((call) => call.join(' ') === 'npm.cmd run build')).toHaveLength(2);
    // Build-regenerated files are restored after the deploy build, the
    // rollback build, and before the dirty check.
    expect(calls.filter((call) => call.join(' ') === 'git checkout -- next-env.d.ts')).toHaveLength(3);
    const restarts = calls.filter((call) => call[0] === 'pm2.cmd' && call[1] === 'restart');
    expect(restarts).toHaveLength(2);
    expect(restarts.every((call) => !call.includes(APP_NAME))).toBe(true);
    expect(restarts.every((call) => !call.includes('heidi-assessment-crew'))).toBe(true);
    expect(restarts.every((call) => !call.includes('heidi-errored'))).toBe(true);
    expect(posts.find((item) => item.channel === 'alerts').body).toContain('rolled back');
    expect(posts.find((item) => item.channel === 'alerts').body).toContain('failing check: heidi-mobile');
    expect(posts.find((item) => item.channel === 'ops').body).toContain(`${OLD.slice(0, 8)}→${NEW.slice(0, 8)}→${OLD.slice(0, 8)}`);
    expect(posts.find((item) => item.channel === 'ops').body).toContain('#390 Isolate board senders');
  });

  it('does nothing when the lock is already held', async () => {
    const run = jest.fn();
    const post = jest.fn();
    await expect(runAutoDeploy({
      root: '/repo',
      run,
      post,
      acquireLock: () => null,
    })).resolves.toEqual({ status: 'lock_held' });
    expect(run).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('alerts once per blocked reason, re-alerts on change, and reports unblocked', async () => {
    const runtime = tmpDir();
    const alertStatePath = path.join(runtime, 'alert.json');
    const posts = [];
    const post = async (channel, body) => { posts.push({ channel, body }); return { ok: true }; };
    const dirtyRun = baseGitRun({
      'git status --porcelain --untracked-files=no': ok(' M lib/file.js\n'),
    });
    const deploy = (run) => runAutoDeploy({
      root: '/repo',
      run,
      post,
      acquireLock: () => jest.fn(),
      alertStatePath,
    });

    await expect(deploy(dirtyRun)).resolves.toEqual({ status: 'blocked', reason: 'working tree is dirty' });
    // Same reason on the next loop pass — no second alert.
    await expect(deploy(dirtyRun)).resolves.toEqual({ status: 'blocked', reason: 'working tree is dirty' });
    expect(posts.filter((p) => p.channel === 'alerts')).toHaveLength(1);

    // A different blocked reason alerts again.
    const wrongBranch = baseGitRun({ 'git branch --show-current': ok('side-branch\n') });
    await expect(deploy(wrongBranch)).resolves.toMatchObject({ status: 'blocked' });
    expect(posts.filter((p) => p.channel === 'alerts')).toHaveLength(2);

    // A clean pass posts a single "unblocked" and clears the persisted state.
    const noopRun = baseGitRun({ 'git rev-parse origin/clean-main': ok(`${OLD}\n`) });
    await expect(deploy(noopRun)).resolves.toEqual({ status: 'noop' });
    expect(posts.filter((p) => p.channel === 'alerts')).toHaveLength(3);
    expect(posts[2].body).toContain('unblocked');
    expect(readAlertState(alertStatePath)).toBeNull();

    // No repeat unblocked message on later clean passes.
    await expect(deploy(noopRun)).resolves.toEqual({ status: 'noop' });
    expect(posts.filter((p) => p.channel === 'alerts')).toHaveLength(3);
  });

  it('retries blocked and unblocked alerts until the board accepts them', async () => {
    const alertStatePath = path.join(tmpDir(), 'alert.json');
    const dirtyRun = baseGitRun({
      'git status --porcelain --untracked-files=no': ok(' M lib/file.js\n'),
    });
    const responses = [{ ok: false, error: 'offline' }, { ok: true }];
    const post = jest.fn(async () => responses.shift() || { ok: true });
    const options = {
      root: '/repo',
      post,
      acquireLock: () => jest.fn(),
      alertStatePath,
    };

    await runAutoDeploy({ ...options, run: dirtyRun });
    expect(readAlertState(alertStatePath)).toBeNull();
    await runAutoDeploy({ ...options, run: dirtyRun });
    expect(readAlertState(alertStatePath)).toBe('working tree is dirty');
    expect(post).toHaveBeenCalledTimes(2);

    post.mockResolvedValueOnce({ ok: false, error: 'offline' });
    const noopRun = baseGitRun({ 'git rev-parse origin/clean-main': ok(`${OLD}\n`) });
    await runAutoDeploy({ ...options, run: noopRun });
    expect(readAlertState(alertStatePath)).toBe('working tree is dirty');
    await runAutoDeploy({ ...options, run: noopRun });
    expect(readAlertState(alertStatePath)).toBeNull();
  });

  it('runs an immediate internal loop and never overlaps passes', async () => {
    let release;
    const first = new Promise((resolve) => { release = resolve; });
    const deploy = jest.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ status: 'noop' });
    let scheduled;
    const setIntervalFn = jest.fn((fn, ms) => {
      scheduled = fn;
      expect(ms).toBe(5 * 60 * 1000);
      return { id: 'timer' };
    });
    const loop = startDeployLoop({ deploy, setIntervalFn, log: jest.fn() });
    expect(loop.timer).toEqual({ id: 'timer' });
    expect(deploy).toHaveBeenCalledTimes(1);
    await scheduled();
    expect(deploy).toHaveBeenCalledTimes(1);
    release({ status: 'noop' });
    await new Promise((resolve) => setImmediate(resolve));
    await scheduled();
    expect(deploy).toHaveBeenCalledTimes(2);
  });

  it('holds the filesystem lock until the owner releases it', () => {
    const lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'frank-deploy-')), 'deploy.lock');
    const release = acquireLock(lockPath);
    expect(typeof release).toBe('function');
    expect(acquireLock(lockPath)).toBeNull();
    release();
    const releaseAgain = acquireLock(lockPath);
    expect(typeof releaseAgain).toBe('function');
    releaseAgain();
  });

  it('drops a lock whose pid is dead or that is older than 45 minutes', () => {
    const lockPath = path.join(tmpDir(), 'deploy.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const log = jest.fn();

    // Dead pid → stale, removed, and the caller proceeds.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, started_at: new Date().toISOString() }));
    const release = acquireLock(lockPath, { pidAlive: () => false, log });
    expect(typeof release).toBe('function');
    expect(log.mock.calls.some(([m]) => String(m).includes('stale lock'))).toBe(true);
    release();

    // Older than LOCK_STALE_MS → stale even if the pid looks alive.
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      started_at: new Date(Date.now() - LOCK_STALE_MS - 1).toISOString(),
    }));
    const release2 = acquireLock(lockPath, { pidAlive: () => true, log });
    expect(typeof release2).toBe('function');
    release2();

    // Live pid and a fresh lock → still held.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    expect(acquireLock(lockPath, { pidAlive: () => true, log })).toBeNull();
    expect(lockIsStale(lockPath, { alive: () => true })).toBe(false);
  });

  it('does not reference test commands, environment files, or PM2 cron', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../scripts/frank-auto-deploy.js'), 'utf8');
    expect(source).not.toContain('.env.local');
    expect(source).not.toMatch(/\bnpm(?:\.cmd)?['"]?,\s*\[['"](?:run\s+)?test/);
    // Long-lived loop with an internal interval — never PM2 cron_restart,
    // which would kill a run mid-build.
    expect(source).not.toContain('cron_restart');
    expect(source).not.toContain('cron-restart');
  });

  it('extracts merge PR numbers and titles', () => {
    expect(parseMergedPrTitles(
      'Merge pull request #10 from a\n\nFirst title\n\x1e' +
      'ordinary commit\n\nbody\n\x1e' +
      'Merge pull request #11 from b\n\nSecond title\n\x1e',
    )).toEqual(['#10 First title', '#11 Second title']);
  });
});
