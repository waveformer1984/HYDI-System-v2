'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const board = require('../../lib/forge-board/sdk');
const {
  APP_NAME,
  LOCK_STALE_MS,
  acquireLock,
  cmdNeedsShell,
  externalAppNames,
  lockIsStale,
  NEVER_RESTART,
  pm2AppNames,
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

/**
 * In-memory stand-in for the deploy's directory operations. `dirs` holds the
 * directories that exist; a staged build "produces" its markers when `run`
 * sees the build command.
 */
function memFs(initial = []) {
  const dirs = new Set(initial.map((p) => p.replace(/\\/g, '/')));
  const norm = (p) => p.replace(/\\/g, '/');
  const ops = [];
  const api = {
    dirs,
    ops,
    exists: (p) => dirs.has(norm(p)),
    rm: (p) => {
      const n = norm(p);
      for (const d of [...dirs]) if (d === n || d.startsWith(`${n}/`)) dirs.delete(d);
    },
    mkdir: (p) => { dirs.add(norm(p)); },
    rename: (a, b) => {
      const from = norm(a);
      const to = norm(b);
      if (api.failRename && api.failRename(from, to)) {
        ops.push(`rename-failed ${from} -> ${to}`);
        throw new Error('EPERM');
      }
      if (!dirs.has(from)) throw new Error(`ENOENT ${from}`);
      if (dirs.has(to)) throw new Error(`EEXIST ${to}`);
      for (const d of [...dirs]) {
        if (d === from || d.startsWith(`${from}/`)) {
          dirs.delete(d);
          dirs.add(to + d.slice(from.length));
        }
      }
      ops.push(`rename ${from} -> ${to}`);
    },
    produceBuild(root) {
      const r = norm(root);
      dirs.add(`${r}/.next-staging`);
      dirs.add(`${r}/.next-staging/BUILD_ID`);
      dirs.add(`${r}/.next-staging/server/pages-manifest.json`);
    },
  };
  return api;
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

  it('rolls back after failed health by restoring the previous build — no rebuild — and restarts only online PM2 apps', async () => {
    let rolledBack = false;
    const calls = [];
    const ROOT = 'C:/HYDI-System-v2';
    const fsx = memFs([`${ROOT}/.next`, `${ROOT}/.next/BUILD_ID`, `${ROOT}/.next/cache`]);
    let buildEnv = null;
    const run = jest.fn(async (file, args, options = {}) => {
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
      if (key === 'npm.cmd run build') {
        buildEnv = options.env;
        fsx.produceBuild(ROOT);
        return ok();
      }
      if (key === 'pm2.cmd jlist') {
        return ok(JSON.stringify([
          { name: 'heidi-web', pm2_env: { status: 'online' } },
          { name: 'heidi-mobile-chat', pm2_env: { status: 'online' } },
          { name: 'heidi-core', pm2_env: { status: 'online' } },
          { name: 'heidi-assessment-crew', pm2_env: { status: 'stopped' } },
          { name: 'heidi-errored', pm2_env: { status: 'errored' } },
          { name: APP_NAME, pm2_env: { status: 'online' } },
          { name: 'hydi-public-tunnel', pm2_env: { status: 'online' } },
        ]));
      }
      if (key === 'pm2.cmd restart heidi-web heidi-mobile-chat heidi-core --update-env') return ok();
      throw new Error(`unexpected command: ${key}`);
    });
    const posts = [];
    let clock = 0;
    const result = await runAutoDeploy({
      root: ROOT,
      platform: 'win32',
      run,
      fsx,
      post: async (channel, body) => { posts.push({ channel, body }); return { ok: true }; },
      acquireLock: () => jest.fn(),
      alertStatePath: path.join(tmpDir(), 'alert.json'),
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      diskPreflight: () => ({ ok: true, freeGb: 50, reason: 'ok' }),
      memoryPreflight: () => ({ ok: true, freeGb: 4, reason: 'ok' }),
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
    // One build, into the staging dir; the rollback renames, it never rebuilds.
    expect(calls.filter((call) => call.join(' ') === 'npm.cmd run build')).toHaveLength(1);
    expect(buildEnv.HYDI_NEXT_DIST_DIR).toBe('.next-staging');
    expect(fsx.ops).toEqual([
      `rename ${ROOT}/.next/cache -> ${ROOT}/.next-staging/cache`,
      `rename ${ROOT}/.next -> ${ROOT}/.next-prev`,
      `rename ${ROOT}/.next-staging -> ${ROOT}/.next`,
      `rename ${ROOT}/.next -> ${ROOT}/.next-failed`,
      `rename ${ROOT}/.next-prev -> ${ROOT}/.next`,
    ]);
    expect(fsx.exists(`${ROOT}/.next/BUILD_ID`)).toBe(true);
    // Build-regenerated files are restored after the deploy build, after the
    // rollback, and before the dirty check.
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

  it('pauses before merging or building when the disk is below the deploy floor', async () => {
    const run = baseGitRun({ [`git merge-base --is-ancestor ${OLD} ${NEW}`]: ok() });
    const posts = [];
    const preflight = jest.fn(() => ({ ok: false, freeGb: 1.2, reason: 'only 1.2 GB free, needs 5 GB' }));
    const result = await runAutoDeploy({
      root: tmpDir(),
      platform: 'win32',
      run,
      post: async (channel, body) => { posts.push({ channel, body }); return { ok: true }; },
      acquireLock: () => jest.fn(),
      alertStatePath: path.join(tmpDir(), 'alert.json'),
      diskPreflight: preflight,
      env: {},
    });

    expect(result).toEqual({ status: 'blocked', reason: 'low disk: only 1.2 GB free, needs 5 GB' });
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ minFreeGb: 5 }));
    const commands = run.mock.calls.map(([file, args]) => `${file} ${args.join(' ')}`);
    expect(commands).not.toContain('git merge --ff-only origin/clean-main');
    expect(commands.some((c) => c.includes('run build'))).toBe(false);
    expect(posts).toHaveLength(1);
    expect(posts[0].channel).toBe('alerts');
    expect(posts[0].body).toContain('paused: only 1.2 GB free');
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

  it('routes .cmd/.bat spawns through a shell on win32 only (Node EINVAL fix)', () => {
    // Node >= 20.12 throws `spawn EINVAL` on execFile('npm.cmd') without
    // shell:true (CVE-2024-27980) — this broke every deploy step after merge.
    expect(cmdNeedsShell('npm.cmd', 'win32')).toBe(true);
    expect(cmdNeedsShell('pm2.cmd', 'win32')).toBe(true);
    expect(cmdNeedsShell('git', 'win32')).toBe(false);
    expect(cmdNeedsShell('git.exe', 'win32')).toBe(false);
    expect(cmdNeedsShell('npm.cmd', 'linux')).toBe(false);
    expect(cmdNeedsShell('npm', 'win32')).toBe(false);
  });

  it('extracts merge PR numbers and titles', () => {
    expect(parseMergedPrTitles(
      'Merge pull request #10 from a\n\nFirst title\n\x1e' +
      'ordinary commit\n\nbody\n\x1e' +
      'Merge pull request #11 from b\n\nSecond title\n\x1e',
    )).toEqual(['#10 First title', '#11 Second title']);
  });
});

describe('Frank auto-deploy restart set', () => {
  const jlist = (apps) => jest.fn(async () => ok(JSON.stringify(apps)));

  it('never restarts the ngrok tunnel, even with no ecosystem config', async () => {
    expect(NEVER_RESTART).toContain('hydi-public-tunnel');
    const run = jlist([
      { name: 'heidi-web', pm2_env: { status: 'online' } },
      { name: 'hydi-public-tunnel', pm2_env: { status: 'online' } },
    ]);
    const names = await pm2AppNames(run, path.join(tmpDir(), 'missing-root'), 'linux');
    expect(names).toEqual(['heidi-web']);
  });

  it('reads external:true apps from ecosystem.config.js and skips them', () => {
    const loader = () => ({
      apps: [
        { name: 'heidi-web' },
        { name: 'stripe-listener', external: true },
        { name: 'other-binary', external: true },
        { name: 'not-external', external: 'yes' },
      ],
    });
    expect(externalAppNames('/repo', loader)).toEqual(['stripe-listener', 'other-binary']);
  });

  it('treats an unreadable ecosystem config as no extra externals', () => {
    expect(externalAppNames('/repo', () => { throw new Error('boom'); })).toEqual([]);
    expect(externalAppNames('/repo', () => null)).toEqual([]);
  });

  it('skips declared external apps alongside itself and stopped apps', async () => {
    const run = jlist([
      { name: 'heidi-web', pm2_env: { status: 'online' } },
      { name: 'stripe-listener', pm2_env: { status: 'online' } },
      { name: APP_NAME, pm2_env: { status: 'online' } },
      { name: 'heidi-assessment-crew', pm2_env: { status: 'stopped' } },
    ]);
    const skip = new Set([APP_NAME, ...NEVER_RESTART, 'stripe-listener']);
    expect(await pm2AppNames(run, '/repo', 'linux', skip)).toEqual(['heidi-web']);
  });

  it('the real ecosystem.config.js declares the tunnel as external', () => {
    const root = path.resolve(__dirname, '..', '..');
    expect(externalAppNames(root)).toContain('hydi-public-tunnel');
  });
});

describe('Frank auto-deploy staged builds', () => {
  const ROOT = 'C:/HYDI-System-v2';
  const JLIST = JSON.stringify([
    { name: 'heidi-web-standalone', pm2_env: { status: 'online' } },
    { name: 'heidi-core', pm2_env: { status: 'online' } },
  ]);

  function harness({ build = 'ok', healthy = () => true, fsx = memFs([`${ROOT}/.next`, `${ROOT}/.next/BUILD_ID`]) } = {}) {
    const calls = [];
    const posts = [];
    let clock = 0;
    const run = jest.fn(async (file, args) => {
      const key = `${file} ${args.join(' ')}`;
      calls.push(key);
      const base = {
        'git fetch origin clean-main': ok(),
        'git branch --show-current': ok('clean-main\n'),
        'git checkout -- next-env.d.ts': ok(),
        'git status --porcelain --untracked-files=no': ok(),
        'git rev-parse HEAD': ok(`${OLD}\n`),
        'git rev-parse origin/clean-main': ok(`${NEW}\n`),
        [`git merge-base --is-ancestor ${OLD} ${NEW}`]: ok(),
        [`git log --format=%B%x1e ${OLD}..${NEW}`]: ok(''),
        [`git diff --name-only ${OLD} ${NEW} -- package-lock.json`]: ok(),
        'git merge --ff-only origin/clean-main': ok(),
        [`git reset --hard ${OLD}`]: ok(),
        'pm2.cmd jlist': ok(JLIST),
        'pm2.cmd stop heidi-web-standalone': ok(),
      };
      if (key === 'npm.cmd run build') {
        if (build === 'fail') return { code: 1, stdout: '', stderr: 'Error: Failed to collect page data for /push-setup' };
        if (build === 'ok') fsx.produceBuild(ROOT);
        return ok();
      }
      if (key.startsWith('pm2.cmd restart ')) return ok();
      if (base[key]) return base[key];
      throw new Error(`unexpected command: ${key}`);
    });
    const deploy = (extra = {}) => runAutoDeploy({
      root: ROOT,
      platform: 'win32',
      run,
      fsx,
      post: async (channel, body) => { posts.push({ channel, body }); return { ok: true }; },
      acquireLock: () => jest.fn(),
      alertStatePath: path.join(tmpDir(), 'alert.json'),
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      diskPreflight: () => ({ ok: true, freeGb: 50, reason: 'ok' }),
      memoryPreflight: () => ({ ok: true, freeGb: 4, reason: 'ok' }),
      healthTimeoutMs: 50,
      healthIntervalMs: 25,
      probe: async (check) => ({ name: check.name, ok: healthy(), status: healthy() ? 200 : 0 }),
      ...extra,
    });
    return { calls, posts, fsx, deploy };
  }

  it('deploys by swapping the finished build in and keeping the previous one', async () => {
    const h = harness();
    const result = await h.deploy();
    expect(result.status).toBe('deployed');
    expect(h.fsx.exists(`${ROOT}/.next/BUILD_ID`)).toBe(true);
    expect(h.fsx.exists(`${ROOT}/.next-prev/BUILD_ID`)).toBe(true);
    expect(h.fsx.exists(`${ROOT}/.next-staging`)).toBe(false);
    expect(h.calls.filter((c) => c.startsWith('pm2.cmd restart'))).toHaveLength(1);
  });

  it('a failed build never touches the live site: no swap, no restart, no rebuild', async () => {
    const h = harness({ build: 'fail' });
    const result = await h.deploy();
    expect(result.status).toBe('rolled_back');
    expect(h.calls.filter((c) => c === 'npm.cmd run build')).toHaveLength(1);
    expect(h.calls.some((c) => c.startsWith('pm2.cmd restart'))).toBe(false);
    expect(h.calls).toContain(`git reset --hard ${OLD}`);
    expect(h.fsx.ops.some((op) => op.includes('-> C:/HYDI-System-v2/.next-prev'))).toBe(false);
    expect(h.fsx.exists(`${ROOT}/.next/BUILD_ID`)).toBe(true);
    const alert = h.posts.find((p) => p.channel === 'alerts').body;
    expect(alert).toContain('the live site was never touched');
    expect(alert).toContain('Failed to collect page data for /push-setup');
  });

  it('an incomplete build (exit 0, missing BUILD_ID) is treated as failed', async () => {
    const h = harness({ build: 'empty' });
    const result = await h.deploy();
    expect(result.status).toBe('rolled_back');
    expect(h.posts.find((p) => p.channel === 'alerts').body).toContain('build incomplete');
    expect(h.calls.some((c) => c.startsWith('pm2.cmd restart'))).toBe(false);
  });

  it('when Windows refuses to rename the live build, stops the web app, retries, and starts it again', async () => {
    const fsx = memFs([`${ROOT}/.next`, `${ROOT}/.next/BUILD_ID`]);
    let refused = false;
    fsx.failRename = (from) => {
      if (!refused && from === `${ROOT}/.next`) { refused = true; return true; }
      return false;
    };
    const h = harness({ fsx });
    const result = await h.deploy();
    expect(result.status).toBe('deployed');
    expect(h.calls).toContain('pm2.cmd stop heidi-web-standalone');
    const restart = h.calls.find((c) => c.startsWith('pm2.cmd restart'));
    expect(restart).toContain('heidi-web-standalone');
    expect(h.fsx.exists(`${ROOT}/.next/BUILD_ID`)).toBe(true);
  });

  it('the first staged deploy has no previous build to restore, so rollback rebuilds', async () => {
    const h = harness({ fsx: memFs([]), healthy: () => false });
    const result = await h.deploy();
    expect(result.status).toBe('rolled_back');
    expect(h.calls.filter((c) => c === 'npm.cmd run build')).toHaveLength(2);
  });

  it('waits instead of building when free RAM is below the floor', async () => {
    const h = harness();
    const result = await h.deploy({ memoryPreflight: () => ({ ok: false, freeGb: 0.3, reason: 'only 0.3 GB RAM free, needs 0.75 GB' }) });
    expect(result).toEqual({ status: 'blocked', reason: 'low memory: only 0.3 GB RAM free, needs 0.75 GB' });
    expect(h.calls).not.toContain('git merge --ff-only origin/clean-main');
    expect(h.posts[0].body).toContain('waiting: only 0.3 GB RAM free');
  });

  it('memoryPreflight reads free RAM against HYDI_DEPLOY_MIN_FREE_RAM_GB (default 0.75)', () => {
    const { memoryPreflight } = require('../../scripts/frank-auto-deploy');
    const GB = 1024 ** 3;
    expect(memoryPreflight({}, () => 0.5 * GB)).toMatchObject({ ok: false });
    expect(memoryPreflight({}, () => 2 * GB)).toMatchObject({ ok: true });
    expect(memoryPreflight({ HYDI_DEPLOY_MIN_FREE_RAM_GB: '3' }, () => 2 * GB)).toMatchObject({ ok: false });
  });

  it('the build stamp lands in the staging dir the build wrote to', async () => {
    const { stampBuild } = require('../../scripts/stamp-hydi-build');
    const root = tmpDir();
    const exec = (cmd, args, _o, cb) => { process.nextTick(() => cb(null, args.includes('HEAD') ? 'abc\n' : '')); return { on() {} }; };
    await stampBuild({ root, env: { HYDI_NEXT_DIST_DIR: '.next-staging' }, execFile: exec, now: () => 0 });
    expect(fs.existsSync(path.join(root, '.next-staging', 'hydi-build.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.next', 'hydi-build.json'))).toBe(false);
  });
});
