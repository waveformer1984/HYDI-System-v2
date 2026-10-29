'use strict';

/**
 * Provenance writer. Git is injected — these tests do not invoke git.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  captureProvenance,
  writeProvenance,
  readProvenance,
  resolveGitIdentity,
  recordProcessProvenance,
} = require('../../lib/runtime/provenance');
const { stampBuild } = require('../../scripts/stamp-hydi-build');

function failingExec() {
  return (_cmd, _args, _opts, cb) => {
    process.nextTick(() => cb(new Error('git missing')));
    return { on() {} };
  };
}

describe('provenance writer', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes atomically and leaves no tmp file', async () => {
    const record = await captureProvenance({
      name: 'hydi-boot',
      cwd: root,
      env: { BUILD_SHA: 'abc123', BUILD_BRANCH: 'clean-main' },
      now: () => Date.parse('2026-10-16T00:00:00.000Z'),
      pid: 42,
    });
    expect(writeProvenance(root, record)).toBeNull();
    const dir = path.join(root, '.runtime', 'provenance');
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual(['hydi-boot.json']);
    const saved = readProvenance(root, 'hydi-boot');
    expect(saved.gitSha).toBe('abc123');
    expect(saved.pid).toBe(42);
    expect(saved.branch).toBe('clean-main');
    expect(saved.startedAt).toBe('2026-10-16T00:00:00.000Z');
    expect(saved.cwd).toBe(root);
  });

  it('gitSha is null when git fails and BUILD_SHA is unset', async () => {
    const id = await resolveGitIdentity({ cwd: root, env: {}, execFile: failingExec() });
    expect(id.gitSha).toBeNull();
    expect(id.gitDirty).toBeNull();
    expect(id.source).toBe('git_failed');
    const record = await captureProvenance({
      name: 'hydi-daemon',
      cwd: root,
      env: {},
      execFile: failingExec(),
    });
    expect(record.gitSha).toBeNull();
    expect(record.source).toBe('git_failed');
  });

  it('build-regenerated files do not count as dirty', async () => {
    // next-env.d.ts is rewritten by every `next build` and restored by the
    // deploy loop itself. A process started mid-build must not latch
    // gitDirty=true and read STALE_CODE forever.
    const exec = (cmd, args, _opts, cb) => {
      const key = args.join(' ');
      const out = key === 'status --porcelain --untracked-files=no'
        ? ' M next-env.d.ts\n'
        : key === 'rev-parse HEAD' ? 'abc123\n' : 'clean-main\n';
      process.nextTick(() => cb(null, out));
      return { on() {} };
    };
    const id = await resolveGitIdentity({ cwd: root, env: {}, execFile: exec });
    expect(id.gitSha).toBe('abc123');
    expect(id.gitDirty).toBe(false);
  });

  it('a real tracked modification still counts as dirty', async () => {
    const exec = (cmd, args, _opts, cb) => {
      const key = args.join(' ');
      const out = key === 'status --porcelain --untracked-files=no'
        ? ' M lib/real.js\n'
        : key === 'rev-parse HEAD' ? 'abc123\n' : 'clean-main\n';
      process.nextTick(() => cb(null, out));
      return { on() {} };
    };
    const id = await resolveGitIdentity({ cwd: root, env: {}, execFile: exec });
    expect(id.gitDirty).toBe(true);
  });

  it('BUILD_SHA overrides git and does not invoke git', async () => {
    const execFile = jest.fn(() => {
      throw new Error('git must not run');
    });
    const id = await resolveGitIdentity({
      cwd: root,
      env: { BUILD_SHA: 'deadbeef', BUILD_BRANCH: 'clean-main' },
      execFile,
    });
    expect(id).toMatchObject({
      gitSha: 'deadbeef',
      branch: 'clean-main',
      gitDirty: false,
      source: 'BUILD_SHA',
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('heidi-web reads the build stamp and ignores the working tree', async () => {
    fs.mkdirSync(path.join(root, '.next'), { recursive: true });
    fs.writeFileSync(path.join(root, '.next', 'hydi-build.json'), JSON.stringify({
      gitSha: 'builtsha',
      branch: 'clean-main',
      gitDirty: true,
      stampedAt: '2026-10-16T00:00:00.000Z',
    }));
    const execFile = jest.fn(() => {
      throw new Error('git must not run');
    });
    const record = await captureProvenance({
      name: 'heidi-web-standalone',
      cwd: root,
      env: {},
      execFile,
      fs,
    });
    expect(record.gitSha).toBe('builtsha');
    expect(record.gitDirty).toBe(true);
    expect(record.source).toBe('build_stamp');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('heidi-web with no stamp and no BUILD_SHA has a null gitSha', async () => {
    const record = await captureProvenance({
      name: 'heidi-web',
      cwd: root,
      env: {},
      execFile: failingExec(),
    });
    expect(record.gitSha).toBeNull();
    expect(record.source).toBe('build_stamp_missing');
  });

  it('returns an error string instead of throwing when the directory cannot be created', () => {
    const fsImpl = {
      mkdirSync() { throw new Error('read-only'); },
      writeFileSync() {},
      renameSync() {},
      unlinkSync() {},
    };
    expect(writeProvenance(root, { name: 'hydi-boot', gitSha: null }, fsImpl)).toBe('read-only');
  });

  it('recordProcessProvenance returns null instead of throwing on a bad name', async () => {
    const record = await recordProcessProvenance('not a name', { root, env: { BUILD_SHA: 'abc' } });
    expect(record).toBeNull();
  });
});

describe('stampBuild', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes BUILD_SHA and writes null when git fails', async () => {
    const stamped = await stampBuild({
      root,
      env: { BUILD_SHA: 'built', BUILD_BRANCH: 'clean-main' },
      execFile: failingExec(),
      now: () => Date.parse('2026-10-16T00:00:00.000Z'),
    });
    expect(stamped.gitSha).toBe('built');
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.next', 'hydi-build.json'), 'utf8'));
    expect(onDisk.gitSha).toBe('built');
    expect(onDisk.stampedAt).toBe('2026-10-16T00:00:00.000Z');
    const leftovers = fs.readdirSync(path.join(root, '.next')).filter((name) => name.includes('.tmp-'));
    expect(leftovers).toEqual([]);

    const missing = await stampBuild({ root, env: {}, execFile: failingExec() });
    expect(missing.gitSha).toBeNull();
    expect(missing.source).toBe('git_failed');
  });
});
