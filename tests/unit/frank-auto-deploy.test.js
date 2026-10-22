'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const board = require('../../lib/forge-board/sdk');
const {
  APP_NAME,
  acquireLock,
  parseMergedPrTitles,
  runAutoDeploy,
} = require('../../scripts/frank-auto-deploy');

const OLD = '1111111111111111111111111111111111111111';
const NEW = '2222222222222222222222222222222222222222';

function ok(stdout = '') {
  return { code: 0, stdout, stderr: '' };
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
    if (key === 'git status --porcelain') return ok();
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
    const run = baseGitRun({ 'git status --porcelain': ok(' M lib/file.js\n') });
    const post = jest.spyOn(board, 'post').mockResolvedValue({ ok: true });
    try {
      const result = await runAutoDeploy({
        root: '/repo',
        run,
        acquireLock: () => jest.fn(),
      });
      expect(result).toEqual({ status: 'blocked', reason: 'working tree is dirty' });
      expect(post).toHaveBeenCalledWith(
        'alerts',
        'Frank auto-deploy stopped: working tree is dirty. Nothing changed.',
        null,
        { sender: 'hydi-daemon' },
      );
      expect(run.mock.calls.some(([, args]) => args[0] === 'merge')).toBe(false);
    } finally {
      post.mockRestore();
    }
  });

  it('rolls back after failed health and excludes itself from PM2 restarts', async () => {
    let rolledBack = false;
    const calls = [];
    const run = jest.fn(async (file, args) => {
      calls.push([file, ...args]);
      const key = `${file} ${args.join(' ')}`;
      if (key === 'git fetch origin clean-main') return ok();
      if (key === 'git branch --show-current') return ok('clean-main\n');
      if (key === 'git status --porcelain') return ok();
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
          { name: 'heidi-web' },
          { name: 'heidi-mobile-chat' },
          { name: 'heidi-core' },
          { name: APP_NAME },
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
    const restarts = calls.filter((call) => call[0] === 'pm2.cmd' && call[1] === 'restart');
    expect(restarts).toHaveLength(2);
    expect(restarts.every((call) => !call.includes(APP_NAME))).toBe(true);
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

  it('does not reference test commands or environment files', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../scripts/frank-auto-deploy.js'), 'utf8');
    expect(source).not.toContain('.env.local');
    expect(source).not.toMatch(/\bnpm(?:\.cmd)?['"]?,\s*\[['"](?:run\s+)?test/);
  });

  it('extracts merge PR numbers and titles', () => {
    expect(parseMergedPrTitles(
      'Merge pull request #10 from a\n\nFirst title\n\x1e' +
      'ordinary commit\n\nbody\n\x1e' +
      'Merge pull request #11 from b\n\nSecond title\n\x1e',
    )).toEqual(['#10 First title', '#11 Second title']);
  });
});
