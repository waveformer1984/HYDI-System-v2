'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const GitRepository = require('./GitRepository');

const PERSISTENCE_VERSION = 1;

/**
 * GitSensor publishes typed events about a git working copy to a
 * BusinessEventBus. It is a second producer alongside FilesystemMonitor and
 * follows the same contract, which is what makes the bus a real integration
 * boundary rather than a convention:
 *
 *   GitSensor  ──┐
 *                ├──▶ BusinessEventBus ──▶ BusinessSignalInterpreter ──▶ ExecutiveOperatingSystem
 *   Filesystem ──┘
 *
 * The sensor knows git and nothing about business meaning. The interpreter
 * assigns meaning. The Executive OS consumes only `BusinessSignal` and needs no
 * knowledge that git exists — adding this sensor required no change to it.
 *
 * Event types published:
 *   CommitCreated        a new commit reachable from HEAD
 *   BranchCreated        a local branch that was not present last poll
 *   BranchDeleted        a local branch that has gone away
 *   WorkingTreeDirty     uncommitted work appeared (edge-triggered)
 *   WorkingTreeClean     uncommitted work was resolved (edge-triggered)
 *   BranchStale          a branch untouched for longer than staleAfterMs
 *
 * All state transitions are edge-triggered against the previous poll, so a
 * steady state produces no events and the briefing does not fill with noise.
 */
class GitSensor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      pollIntervalMs: config.pollIntervalMs ?? 60000,
      maxCommitsPerPoll: config.maxCommitsPerPoll ?? 50,
      staleAfterMs: config.staleAfterMs ?? 14 * 24 * 60 * 60 * 1000,
      reportWorkingTree: config.reportWorkingTree !== false,
      reportBranches: config.reportBranches !== false,
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      ...config,
    };

    this.cwd = config.cwd || process.cwd();
    this.project = config.project || path.basename(this.cwd);
    this.eventBus = config.eventBus || null;
    this.repo = config.repository || new GitRepository({
      cwd: this.cwd,
      gitPath: config.gitPath,
      timeoutMs: config.gitTimeoutMs,
      logger: this.config.logger,
    });

    this.state = {
      lastSha: null,
      branches: {},
      dirty: false,
      staleReported: {},
    };
    this.available = false;
    this.unavailableReason = null;

    this._timer = null;
    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;
    this._polling = false;

    this.storePath = path.join(this.config.dataPath, `git-sensor-${this._slug(this.project)}.json`);
    this._registerEventTypes();
  }

  _registerEventTypes() {
    if (!this.eventBus || !this.eventBus.registry) return;
    const types = [
      'CommitCreated', 'BranchCreated', 'BranchDeleted',
      'WorkingTreeDirty', 'WorkingTreeClean', 'BranchStale',
    ];
    const schema = {
      fields: ['project', 'sha', 'shortSha', 'author', 'subject', 'committedAt', 'branch', 'fileCount', 'files', 'relPath'],
    };
    for (const type of types) {
      this.eventBus.registry.register(type, 'GitSensor', {
        domain: 'git',
        source: 'GitSensor',
        measurement: 'activity',
        strategicObjective: 'operations',
        schema,
      });
    }
  }

  _slug(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repo';
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('GitSensor has been destroyed');
    if (this._started) return this;

    await this._ensureDataDir();
    await this._load();

    const diagnosis = await this.repo.diagnose();
    this.available = diagnosis.ok;
    this.unavailableReason = diagnosis.ok ? null : diagnosis.reason;

    if (!this.available) {
      // Not an error. A machine without git, or a directory that is not a
      // repository, simply produces no git signals — every other subsystem
      // continues unaffected.
      this.config.logger.log('[GitSensor] inactive', { reason: diagnosis.reason, detail: diagnosis.detail });
      this._started = true;
      return this;
    }

    // A cold start adopts current state as the baseline instead of publishing
    // it. Without this, first run would replay the whole repository as though
    // it had all just happened.
    const coldStart = this.state.lastSha === null;
    await this.poll({ baselineOnly: coldStart });

    if (this.config.pollIntervalMs > 0) {
      this._timer = setInterval(() => {
        this.poll().catch((error) => this.config.logger.error('[GitSensor] poll error', {
          error: error instanceof Error ? error.message : String(error),
        }));
      }, this.config.pollIntervalMs);
      if (this._timer.unref) this._timer.unref();
    }

    this._started = true;
    this.config.logger.log('[GitSensor] started', { project: this.project, cwd: this.cwd });
    return this;
  }

  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      repositoryAvailable: this.available,
      hasEventBus: !!this.eventBus,
    };
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      project: this.project,
      lastSha: this.state.lastSha,
      unavailableReason: this.unavailableReason,
    };
  }

  /**
   * Observe the repository once and publish whatever changed.
   * @param {{baselineOnly?: boolean}} options when baselineOnly, state is
   *        recorded but nothing is published.
   */
  async poll(options = {}) {
    if (this._destroyed || !this.available) return { published: 0, skipped: true };
    if (this._polling) return { published: 0, skipped: true, reason: 'already-polling' };

    this._polling = true;
    const published = [];

    try {
      const baselineOnly = !!options.baselineOnly;

      await this._pollCommits(published, baselineOnly);
      if (this.config.reportBranches) await this._pollBranches(published, baselineOnly);
      if (this.config.reportWorkingTree) await this._pollWorkingTree(published, baselineOnly);

      this._persist();
      return { published: published.length, events: published, baselineOnly };
    } finally {
      this._polling = false;
    }
  }

  async _pollCommits(published, baselineOnly) {
    const commits = await this.repo.commitsSince(this.state.lastSha, this.config.maxCommitsPerPoll);
    if (commits.length === 0) return;

    const head = commits[commits.length - 1].sha;

    if (baselineOnly) {
      this.state.lastSha = head;
      return;
    }

    const branch = await this.repo.currentBranch();
    for (const commit of commits) {
      const files = await this.repo.filesInCommit(commit.sha);
      published.push(this._emit('CommitCreated', {
        project: this.project,
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        author: commit.author,
        subject: commit.subject,
        committedAt: commit.at,
        branch,
        fileCount: files.length,
        files: files.slice(0, 50),
        // relPath lets the interpreter's existing subsystem/category detection
        // work on a commit without knowing anything about commits.
        relPath: files[0] || '',
      }));
    }

    this.state.lastSha = head;
  }

  async _pollBranches(published, baselineOnly) {
    const branches = await this.repo.branches();
    const seen = {};
    const now = Date.now();

    for (const branch of branches) {
      seen[branch.name] = branch.lastCommitAt;

      // BranchCreated is a *change* relative to the last poll. On a cold start
      // every existing branch would look new, which is history replay.
      if (!baselineOnly && !(branch.name in this.state.branches)) {
        published.push(this._emit('BranchCreated', {
          project: this.project,
          branch: branch.name,
          lastCommitAt: branch.lastCommitAt,
        }));
      }

      // Staleness, by contrast, is a fact about the present. Suppressing it on
      // a cold start would mean the first briefing after configuring the sensor
      // reports nothing at all, hiding risk the owner already has.
      const stale = branch.lastCommitAt > 0 && (now - branch.lastCommitAt) > this.config.staleAfterMs;
      if (stale && !this.state.staleReported[branch.name]) {
        published.push(this._emit('BranchStale', {
          project: this.project,
          branch: branch.name,
          lastCommitAt: branch.lastCommitAt,
          staleForMs: now - branch.lastCommitAt,
        }));
        this.state.staleReported[branch.name] = true;
      }
      if (!stale) delete this.state.staleReported[branch.name];
    }

    if (!baselineOnly) {
      for (const name of Object.keys(this.state.branches)) {
        if (!(name in seen)) {
          published.push(this._emit('BranchDeleted', { project: this.project, branch: name }));
          delete this.state.staleReported[name];
        }
      }
    }

    this.state.branches = seen;
  }

  async _pollWorkingTree(published, baselineOnly) {
    const status = await this.repo.status();
    const dirty = !status.clean;

    // Uncommitted work is a fact about the present, so it is reported on a cold
    // start too — but only when dirty. Announcing a clean tree the operator
    // never saw become dirty would be noise.
    if (baselineOnly) {
      this.state.dirty = dirty;
      if (!dirty) return;
    } else if (dirty === this.state.dirty) {
      return;
    }

    published.push(this._emit(dirty ? 'WorkingTreeDirty' : 'WorkingTreeClean', {
      project: this.project,
      counts: status.counts,
      fileCount: status.files.length,
      files: status.files.slice(0, 50).map((f) => f.path),
      relPath: status.files.length ? status.files[0].path : '',
    }));

    this.state.dirty = dirty;
  }

  _emit(type, payload) {
    const enriched = { ...payload, source: 'GitSensor' };
    this.emit(type, { type, payload: enriched });
    if (this.eventBus) this.eventBus.emit(type, enriched, 'GitSensor');
    return { type, payload: enriched };
  }

  async flush() {
    return this._flush();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._started = false;
    this.config.logger.log('[GitSensor] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.removeAllListeners();
    this._destroyed = true;
  }

  // -------------------------------------------------------------------------
  // Persistence — same debounced, atomic, corrupt-archiving pattern as every
  // other hydi-v3 store, so a bad write cannot wedge the sensor.
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[GitSensor] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.state && typeof parsed.state === 'object') {
        this.state = {
          lastSha: parsed.state.lastSha || null,
          branches: parsed.state.branches || {},
          dirty: !!parsed.state.dirty,
          staleReported: parsed.state.staleReported || {},
        };
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        this.config.logger.error('[GitSensor] load error, archiving corrupt store', {
          error: e instanceof Error ? e.message : String(e),
        });
        await this._archiveCorruptStore();
      }
      this.state = { lastSha: null, branches: {}, dirty: false, staleReported: {} };
    }
  }

  async _archiveCorruptStore() {
    try {
      await fs.rename(this.storePath, `${this.storePath}.corrupt.${Date.now()}`);
    } catch (archiveError) {
      this.config.logger.error('[GitSensor] failed to archive corrupt store', {
        error: archiveError instanceof Error ? archiveError.message : String(archiveError),
      });
    }
  }

  _persist() {
    if (this._destroyed) return;
    this._persistPending = true;
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => this._flush(), this.config.persistDebounceMs);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  async _flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (!this._persistPending) return;
    this._persistPending = false;

    const snapshot = {
      version: PERSISTENCE_VERSION,
      updatedAt: Date.now(),
      project: this.project,
      cwd: this.cwd,
      state: this.state,
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[GitSensor] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = GitSensor;
