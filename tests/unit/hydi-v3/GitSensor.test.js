'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { execFileSync } = require('child_process');
const GitRepository = require('../../../src/hydi-v3/GitRepository');
const GitSensor = require('../../../src/hydi-v3/GitSensor');
const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const BusinessSignalInterpreter = require('../../../src/hydi-v3/BusinessSignalInterpreter');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

async function makeRepo() {
  const dir = path.join(os.tmpdir(), `heidi-git-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test Author');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

async function commit(dir, file, content, message) {
  const target = path.join(dir, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  git(dir, 'add', file);
  git(dir, 'commit', '--quiet', '-m', message);
}

describe('GitRepository', () => {
  let dir;

  beforeEach(async () => {
    dir = await makeRepo();
    await commit(dir, 'README.md', '# hello', 'Initial commit');
  });

  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('recognises a repository', async () => {
    const repo = new GitRepository({ cwd: dir, logger: silent });
    expect(await repo.isRepository()).toBe(true);
    const diagnosis = await repo.diagnose();
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.reason).toBe('ok');
  });

  test('reports a non-repository without throwing', async () => {
    const plain = path.join(os.tmpdir(), `heidi-plain-${Date.now()}`);
    await fs.mkdir(plain, { recursive: true });
    try {
      const repo = new GitRepository({ cwd: plain, logger: silent });
      expect(await repo.isRepository()).toBe(false);
      expect((await repo.diagnose()).reason).toBe('not-a-repository');
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });

  test('reports a missing git executable without throwing', async () => {
    const repo = new GitRepository({ cwd: dir, gitPath: '/nonexistent/git-binary', logger: silent });
    const diagnosis = await repo.diagnose();
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.reason).toBe('git-not-installed');
  });

  test('refuses any subcommand that is not on the read-only allowlist', async () => {
    const repo = new GitRepository({ cwd: dir, logger: silent });
    for (const forbidden of ['commit', 'push', 'reset', 'clean', 'checkout', 'config']) {
      const result = await repo.run([forbidden, '--help']);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('is not permitted');
    }
  });

  test('reads commits oldest-first with author, subject and time', async () => {
    await commit(dir, 'a.js', 'const a = 1;', 'Add module a');
    const repo = new GitRepository({ cwd: dir, logger: silent });
    const commits = await repo.commitsSince(null, 10);

    expect(commits.length).toBe(2);
    expect(commits[0].subject).toBe('Initial commit');
    expect(commits[1].subject).toBe('Add module a');
    expect(commits[1].author).toBe('Test Author');
    expect(Number.isFinite(commits[1].at)).toBe(true);
  });

  test('commitsSince returns only newer commits', async () => {
    const repo = new GitRepository({ cwd: dir, logger: silent });
    const head = await repo.head();
    await commit(dir, 'b.js', 'const b = 2;', 'Add module b');

    const commits = await repo.commitsSince(head, 10);
    expect(commits.map((c) => c.subject)).toEqual(['Add module b']);
  });

  test('an unknown since-sha falls back to a cold read instead of failing', async () => {
    const repo = new GitRepository({ cwd: dir, logger: silent });
    const commits = await repo.commitsSince('0'.repeat(40), 10);
    expect(commits.length).toBeGreaterThan(0);
  });

  test('a commit subject containing shell metacharacters is handled literally', async () => {
    // execFile means no shell, so this must be data, never a command.
    await commit(dir, 'c.js', 'x', 'fix; rm -rf / && echo $(whoami) `id`');
    const repo = new GitRepository({ cwd: dir, logger: silent });
    const commits = await repo.commitsSince(null, 1);
    expect(commits[0].subject).toBe('fix; rm -rf / && echo $(whoami) `id`');
  });

  test('lists files in a commit', async () => {
    await commit(dir, 'src.js', 'x', 'Add src');
    const repo = new GitRepository({ cwd: dir, logger: silent });
    const head = await repo.head();
    expect(await repo.filesInCommit(head)).toEqual(['src.js']);
  });

  test('lists branches and reads working-tree status', async () => {
    git(dir, 'branch', 'feature/audio');
    const repo = new GitRepository({ cwd: dir, logger: silent });

    const branches = await repo.branches();
    expect(branches.map((b) => b.name).sort()).toEqual(['feature/audio', 'main']);

    expect((await repo.status()).clean).toBe(true);
    await fs.writeFile(path.join(dir, 'dirty.txt'), 'uncommitted');
    const status = await repo.status();
    expect(status.clean).toBe(false);
    expect(status.counts.untracked).toBe(1);
  });
});

describe('GitSensor', () => {
  let dir;
  let dataPath;
  let bus;
  let sensor;
  let events;

  beforeEach(async () => {
    dir = await makeRepo();
    await commit(dir, 'README.md', '# hello', 'Initial commit');
    dataPath = path.join(os.tmpdir(), `heidi-gitsensor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });

    bus = new BusinessEventBus({ maxHistory: 500 });
    events = [];
    bus.subscribeAll((event) => events.push(event));
  });

  afterEach(async () => {
    if (sensor) await sensor.destroy().catch(() => {});
    if (bus) bus.destroy();
    try { await fs.rm(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    sensor = null;
  });

  function makeSensor(extra = {}) {
    return new GitSensor({
      cwd: dir, dataPath, eventBus: bus, project: 'Resonate',
      pollIntervalMs: 0, logger: silent, ...extra,
    });
  }

  test('a cold start adopts existing history as a baseline instead of replaying it', async () => {
    sensor = makeSensor();
    await sensor.start();

    expect(events.filter((e) => e.type === 'CommitCreated')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'BranchCreated')).toHaveLength(0);
    expect(sensor.state.lastSha).toBeTruthy();
  });

  test('a cold start still reports present-state facts, not just changes', async () => {
    // History must not be replayed, but risk that already exists should not be
    // invisible on the first run either.
    await fs.writeFile(path.join(dir, 'wip.txt'), 'uncommitted work');
    sensor = makeSensor({ staleAfterMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sensor.start();

    expect(events.filter((e) => e.type === 'WorkingTreeDirty')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'BranchStale')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'CommitCreated')).toHaveLength(0);
  });

  test('a cold start on a clean tree announces nothing', async () => {
    sensor = makeSensor();
    await sensor.start();
    expect(events.filter((e) => e.type === 'WorkingTreeClean')).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test('publishes CommitCreated for work done after the baseline', async () => {
    sensor = makeSensor();
    await sensor.start();
    events.length = 0;

    await commit(dir, 'engine.js', 'const x = 1;', 'Add audio engine');
    await sensor.poll();

    const commits = events.filter((e) => e.type === 'CommitCreated');
    expect(commits).toHaveLength(1);
    expect(commits[0].payload.subject).toBe('Add audio engine');
    expect(commits[0].payload.author).toBe('Test Author');
    expect(commits[0].payload.files).toEqual(['engine.js']);
    expect(commits[0].payload.branch).toBe('main');
    expect(commits[0].source).toBe('GitSensor');
  });

  test('does not republish a commit on a subsequent poll', async () => {
    sensor = makeSensor();
    await sensor.start();
    await commit(dir, 'engine.js', 'x', 'Add audio engine');
    await sensor.poll();
    events.length = 0;

    await sensor.poll();
    expect(events.filter((e) => e.type === 'CommitCreated')).toHaveLength(0);
  });

  test('the cursor survives a restart so history is not replayed', async () => {
    sensor = makeSensor();
    await sensor.start();
    await commit(dir, 'a.js', 'x', 'First');
    await sensor.poll();
    await sensor.flush();
    await sensor.destroy();

    events.length = 0;
    sensor = makeSensor();
    await sensor.start();
    expect(events.filter((e) => e.type === 'CommitCreated')).toHaveLength(0);

    await commit(dir, 'b.js', 'x', 'Second');
    await sensor.poll();
    const commits = events.filter((e) => e.type === 'CommitCreated');
    expect(commits.map((c) => c.payload.subject)).toEqual(['Second']);
  });

  test('publishes branch creation and deletion', async () => {
    sensor = makeSensor();
    await sensor.start();
    events.length = 0;

    git(dir, 'branch', 'feature/audio');
    await sensor.poll();
    expect(events.filter((e) => e.type === 'BranchCreated').map((e) => e.payload.branch)).toEqual(['feature/audio']);

    events.length = 0;
    git(dir, 'branch', '-D', 'feature/audio');
    await sensor.poll();
    expect(events.filter((e) => e.type === 'BranchDeleted').map((e) => e.payload.branch)).toEqual(['feature/audio']);
  });

  test('working-tree signals are edge-triggered, not repeated every poll', async () => {
    sensor = makeSensor();
    await sensor.start();
    events.length = 0;

    await fs.writeFile(path.join(dir, 'wip.txt'), 'in progress');
    await sensor.poll();
    expect(events.filter((e) => e.type === 'WorkingTreeDirty')).toHaveLength(1);

    events.length = 0;
    await sensor.poll();
    expect(events.filter((e) => e.type === 'WorkingTreeDirty')).toHaveLength(0);

    await fs.rm(path.join(dir, 'wip.txt'));
    await sensor.poll();
    expect(events.filter((e) => e.type === 'WorkingTreeClean')).toHaveLength(1);
  });

  test('a steady repository produces no events at all', async () => {
    sensor = makeSensor();
    await sensor.start();
    events.length = 0;

    await sensor.poll();
    await sensor.poll();
    expect(events).toHaveLength(0);
  });

  test('reports a stale branch once, not on every poll', async () => {
    sensor = makeSensor({ staleAfterMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sensor.start();

    // Staleness is present-state, so it is reported on the cold start itself.
    expect(events.filter((e) => e.type === 'BranchStale')).toHaveLength(1);

    events.length = 0;
    await sensor.poll();
    await sensor.poll();
    expect(events.filter((e) => e.type === 'BranchStale')).toHaveLength(0);
  });

  test('a branch that becomes active again can go stale a second time', async () => {
    sensor = makeSensor({ staleAfterMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sensor.start();
    expect(sensor.state.staleReported.main).toBe(true);

    // A fresh commit clears the stale flag rather than latching it forever.
    sensor.config.staleAfterMs = 10 * 60 * 1000;
    await commit(dir, 'fresh.js', 'x', 'Fresh work');
    events.length = 0;
    await sensor.poll();
    expect(sensor.state.staleReported.main).toBeUndefined();
  });

  test('working-tree and branch reporting can be switched off', async () => {
    sensor = makeSensor({ reportWorkingTree: false, reportBranches: false });
    await sensor.start();
    events.length = 0;

    await fs.writeFile(path.join(dir, 'wip.txt'), 'x');
    git(dir, 'branch', 'extra');
    await sensor.poll();

    expect(events.filter((e) => e.type === 'WorkingTreeDirty')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'BranchCreated')).toHaveLength(0);
  });

  test('stays inactive and silent outside a repository', async () => {
    const plain = path.join(os.tmpdir(), `heidi-plain-${Date.now()}`);
    await fs.mkdir(plain, { recursive: true });
    try {
      sensor = makeSensor({ cwd: plain });
      await sensor.start();

      expect(sensor.available).toBe(false);
      expect(sensor.unavailableReason).toBe('not-a-repository');
      expect(sensor.healthCheck().ok).toBe(false);
      expect(await sensor.poll()).toEqual({ published: 0, skipped: true });
      expect(events).toHaveLength(0);
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });

  test('recovers from a corrupt cursor store', async () => {
    sensor = makeSensor();
    await fs.writeFile(sensor.storePath, 'not json at all');
    await sensor.start();

    expect(sensor.available).toBe(true);
    const archived = (await fs.readdir(dataPath)).filter((f) => f.includes('.corrupt.'));
    expect(archived.length).toBe(1);
  });

  test('overlapping polls do not double-publish', async () => {
    sensor = makeSensor();
    await sensor.start();
    await commit(dir, 'engine.js', 'x', 'Concurrent');
    events.length = 0;

    const [first, second] = await Promise.all([sensor.poll(), sensor.poll()]);
    const skipped = [first, second].filter((r) => r.skipped);
    expect(skipped).toHaveLength(1);
    expect(events.filter((e) => e.type === 'CommitCreated')).toHaveLength(1);
  });

  test('destroy is idempotent and stops the poll timer', async () => {
    sensor = makeSensor({ pollIntervalMs: 10 });
    await sensor.start();
    await sensor.destroy();
    await expect(sensor.destroy()).resolves.toBeUndefined();
    expect(sensor._timer).toBeNull();
  });
});

describe('GitSensor through the interpreter', () => {
  let dir;
  let dataPath;
  let bus;
  let sensor;
  let interpreter;
  let signals;

  beforeEach(async () => {
    dir = await makeRepo();
    await commit(dir, 'README.md', '# hello', 'Initial commit');
    dataPath = path.join(os.tmpdir(), `heidi-gitsig-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });

    bus = new BusinessEventBus({ maxHistory: 500 });
    interpreter = new BusinessSignalInterpreter({ eventBus: bus });
    signals = [];
    bus.subscribe('BusinessSignal', (event) => signals.push(event));

    sensor = new GitSensor({
      cwd: dir, dataPath, eventBus: bus, project: 'Resonate',
      pollIntervalMs: 0, logger: silent,
    });
    await sensor.start();
    signals.length = 0;
  });

  afterEach(async () => {
    if (interpreter) interpreter.detach();
    if (sensor) await sensor.destroy().catch(() => {});
    if (bus) bus.destroy();
    try { await fs.rm(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('a commit becomes a business signal with objective and impact', async () => {
    await commit(dir, 'audio/engine.js', 'x', 'Fix audio engine crash');
    await sensor.poll();

    const signal = signals.find((s) => s.payload.originatingEvent === 'CommitCreated');
    expect(signal).toBeTruthy();
    expect(signal.payload.interpretation).toContain('Work committed to Resonate');
    expect(signal.payload.interpretation).toContain('Fix audio engine crash');
    expect(signal.payload.strategicObjective).toBe('resonate');
    expect(signal.payload.impact).toBe('engineering-delivered');
  });

  test('uncommitted work is interpreted as a risk', async () => {
    await fs.writeFile(path.join(dir, 'wip.txt'), 'x');
    await sensor.poll();

    const signal = signals.find((s) => s.payload.originatingEvent === 'WorkingTreeDirty');
    expect(signal.payload.impact).toBe('risk-uncommitted');
    expect(signal.payload.interpretation).toContain('not yet committed');
  });

  test('a stale branch is interpreted as a staleness risk', async () => {
    await sensor.destroy();
    sensor = new GitSensor({
      cwd: dir, dataPath: path.join(dataPath, 'stale'), eventBus: bus,
      project: 'Resonate', pollIntervalMs: 0, staleAfterMs: 1, logger: silent,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sensor.start();

    const signal = signals.find((s) => s.payload.originatingEvent === 'BranchStale');
    expect(signal).toBeTruthy();
    expect(signal.payload.impact).toBe('risk-stale');
  });

  test('a commit reaches the briefing without the Executive OS knowing git exists', async () => {
    const OperatorSession = require('../../../src/hydi-v3/OperatorSession');
    const ExecutiveOperatingSystem = require('../../../src/hydi-v3/ExecutiveOperatingSystem');

    // The whole point of the bus boundary: adding a second sensor must require
    // no git vocabulary anywhere downstream of it.
    const eosSource = require('fs').readFileSync(
      require.resolve('../../../src/hydi-v3/ExecutiveOperatingSystem'), 'utf8',
    );
    expect(eosSource).not.toMatch(/\bgit\b/i);
    expect(ExecutiveOperatingSystem).toBeTruthy();

    const sessionData = path.join(dataPath, 'session');
    await fs.mkdir(sessionData, { recursive: true });
    const session = new OperatorSession({
      dataPath: sessionData,
      logger: silent,
      taskIntervalMs: 10,
      git: { cwd: dir, project: 'Resonate', pollIntervalMs: 0 },
    });
    await session.start();

    try {
      expect(session.gitSensor.available).toBe(true);

      await commit(dir, 'audio/dsp.js', 'x', 'Improve reverb tail');
      await session.gitSensor.poll();

      const activity = session.memory.find({ type: 'activity' });
      expect(activity.length).toBeGreaterThan(0);
      expect(activity.some((a) => String(a.name).includes('Improve reverb tail'))).toBe(true);

      const briefing = session.briefing();
      expect(briefing.recentActivity).toBeTruthy();
      const rendered = require('../../../src/hydi-v3/BriefingRenderer').toText(briefing);
      expect(rendered).toContain('Improve reverb tail');
    } finally {
      await session.destroy();
    }
  });

  test('git events never carry the generic fallback interpretation', async () => {
    git(dir, 'branch', 'feature/x');
    await commit(dir, 'a.js', 'x', 'Add a');
    await fs.writeFile(path.join(dir, 'wip.txt'), 'x');
    await sensor.poll();

    const gitSignals = signals.filter((s) => s.source === 'BusinessSignalInterpreter');
    expect(gitSignals.length).toBeGreaterThan(0);
    for (const signal of gitSignals) {
      expect(signal.payload.interpretation).not.toMatch(/^Activity in /);
    }
  });
});
