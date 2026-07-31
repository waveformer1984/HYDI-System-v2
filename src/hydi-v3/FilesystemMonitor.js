'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULT_EXCLUDE = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.env'];

function isExcluded(fullPath, exclude) {
  const parts = fullPath.split(path.sep);
  for (const e of exclude) {
    if (parts.includes(e)) return true;
  }
  return false;
}

async function walk(root, exclude, out = {}, relPrefix = '') {
  const entries = await fs.readdir(path.join(root, relPrefix), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const full = path.join(root, rel);
    if (isExcluded(full, exclude)) continue;
    if (entry.isDirectory()) {
      out[rel] = { type: 'directory' };
      await walk(root, exclude, out, rel);
    } else if (entry.isFile()) {
      const stats = await fs.stat(full).catch(() => null);
      out[rel] = { type: 'file', size: stats ? stats.size : 0, mtime: stats ? stats.mtimeMs : 0 };
    }
  }
  return out;
}

/**
 * FilesystemMonitor watches configured project roots and publishes typed events
 * to a BusinessEventBus. It supports both polling scans and OS-native watchers
 * (with graceful fallback to scan-only mode).
 *
 * Event types:
 *   ProjectOpened, FileCreated, FileModified, FileDeleted, DirectoryCreated,
 *   DirectoryDeleted, ProjectInactive, ProjectActive.
 */
class FilesystemMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      roots: config.roots || {},
      exclude: [...DEFAULT_EXCLUDE, ...(config.exclude || [])],
      scanIntervalMs: config.scanIntervalMs ?? 30000,
      watch: config.watch !== false,
      logger: config.logger || console,
      ...config,
    };
    this.eventBus = config.eventBus || null;
    this.snapshots = {};
    this.lastActivity = {};
    this._timers = [];
    this._watchers = [];
    this._started = false;
    this._destroyed = false;
    this._projectOpened = new Set();
    this._registerEventTypes();
  }

  _registerEventTypes() {
    if (!this.eventBus || !this.eventBus.registry) return;
    const types = [
      'ProjectOpened', 'ProjectActive',
      'FileCreated', 'FileModified', 'FileDeleted',
      'DirectoryCreated', 'DirectoryDeleted',
    ];
    const schema = {
      fields: ['project', 'root', 'path', 'relPath', 'size', 'mtime', 'source'],
    };
    for (const type of types) {
      this.eventBus.registry.register(type, 'FilesystemMonitor', {
        domain: 'filesystem',
        source: 'FilesystemMonitor',
        measurement: 'activity',
        strategicObjective: 'operations',
        schema,
      });
    }
  }

  async start() {
    if (this._destroyed) throw new Error('FilesystemMonitor has been destroyed');
    if (this._started) return;
    this._started = true;

    for (const [project, root] of Object.entries(this.config.roots)) {
      this.lastActivity[project] = 0;
      await this._scanProject(project, root, true);
      if (this.config.watch) this._watchProject(project, root);
    }

    if (this.config.scanIntervalMs > 0) {
      const t = setInterval(() => this.scan(), this.config.scanIntervalMs);
      t.unref && t.unref();
      this._timers.push(t);
    }

    this.config.logger.log('[FilesystemMonitor] started');
  }

  stop() {
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    for (const w of this._watchers) w.close();
    this._watchers = [];
    this._started = false;
    this.config.logger.log('[FilesystemMonitor] stopped');
  }

  destroy() {
    this.stop();
    this._destroyed = true;
    this.removeAllListeners();
  }

  async scan() {
    if (this._destroyed) return;
    for (const [project, root] of Object.entries(this.config.roots)) {
      await this._scanProject(project, root, false);
    }
  }

  async _scanProject(project, root, isInitial) {
    const before = this.snapshots[project] || {};
    const after = await walk(root, this.config.exclude).catch((e) => {
      this.config.logger.error('[FilesystemMonitor] scan error', { project, error: e instanceof Error ? e.message : String(e) });
      return {};
    });

    if (!this._projectOpened.has(project)) {
      this._emit('ProjectOpened', { project, root });
      this._projectOpened.add(project);
    }

    for (const [rel, info] of Object.entries(after)) {
      if (!(rel in before)) {
        if (info.type === 'directory') {
          this._emit('DirectoryCreated', { project, root, path: path.join(root, rel), relPath: rel });
        } else {
          this._emit('FileCreated', { project, root, path: path.join(root, rel), relPath: rel, ...info });
        }
      } else if (info.type === 'file' && (before[rel].mtime !== info.mtime || before[rel].size !== info.size)) {
        this._emit('FileModified', { project, root, path: path.join(root, rel), relPath: rel, ...info });
      }
    }

    for (const rel of Object.keys(before)) {
      if (!(rel in after)) {
        const wasDir = before[rel].type === 'directory';
        this._emit(wasDir ? 'DirectoryDeleted' : 'FileDeleted', {
          project, root, path: path.join(root, rel), relPath: rel,
        });
      }
    }

    this.snapshots[project] = after;
    if (Object.keys(after).length > 1 || Object.keys(after).some((r) => after[r].type === 'file')) {
      this.lastActivity[project] = Date.now();
      if (!isInitial) this._emit('ProjectActive', { project, root });
    }
  }

  _watchProject(project, root) {
    try {
      const watcher = require('fs').watch(root, { recursive: true }, () => {
        this._debouncedScan(project, root);
      });
      this._watchers.push(watcher);
    } catch (e) {
      this.config.logger.warn('[FilesystemMonitor] fs.watch unavailable; using polling only', { project, error: e instanceof Error ? e.message : String(e) });
    }
  }

  _debounceTimers = {};
  _debouncedScan(project, root) {
    if (this._debounceTimers[project]) clearTimeout(this._debounceTimers[project]);
    this._debounceTimers[project] = setTimeout(() => this._scanProject(project, root, false), 200);
  }

  _emit(type, payload) {
    const event = { type, payload: { ...payload, source: 'FilesystemMonitor' } };
    this.emit(type, event);
    if (this.eventBus) this.eventBus.emit(type, event.payload, 'FilesystemMonitor');
  }
}

module.exports = FilesystemMonitor;
