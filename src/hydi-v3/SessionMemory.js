'use strict';

const fs = require('fs').promises;
const path = require('path');

const PERSISTENCE_VERSION = 1;
const MAX_RECENT_COMMANDS = 50;
const MAX_CONVERSATION_HISTORY = 100;

const DEFAULT_STATE = () => ({
  focus: null,
  activeProject: null,
  activeObjective: null,
  ownerPriority: 'default',
  recentCommands: [],
  conversationHistory: [],
  windowLayout: {},
  updatedAt: null,
});

/**
 * SessionMemory persists everything the Local Operations Console needs to
 * avoid making the owner restate context every turn, and to restore that
 * context automatically after a restart: current focus, active project or
 * objective, owner priority, recent commands, conversation history, and
 * (for the web console) window layout.
 *
 * It follows the same debounced-persist, corrupt-store-archiving pattern as
 * every other hydi-v3 store so a bad write can never wedge the console.
 */
class SessionMemory {
  constructor(config = {}) {
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      ...config,
    };

    this.state = DEFAULT_STATE();

    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'session-memory.json');
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('SessionMemory has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[SessionMemory] started');
  }

  async flush() {
    return this._flush();
  }

  stop() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._started = false;
    this.config.logger.log('[SessionMemory] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this._destroyed = true;
  }

  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      boundedHistory: this.state.conversationHistory.length <= MAX_CONVERSATION_HISTORY,
      boundedCommands: this.state.recentCommands.length <= MAX_RECENT_COMMANDS,
    };
    return { ok: Object.values(checks).every(Boolean), checks };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  getContext() {
    return { ...this.state };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  setFocus(focus) {
    this.state.focus = focus || null;
    this._touch();
    return this.state.focus;
  }

  setActiveProject(activeProject) {
    this.state.activeProject = activeProject || null;
    this._touch();
    return this.state.activeProject;
  }

  setActiveObjective(activeObjective) {
    this.state.activeObjective = activeObjective || null;
    this._touch();
    return this.state.activeObjective;
  }

  setOwnerPriority(ownerPriority) {
    this.state.ownerPriority = ownerPriority || 'default';
    this._touch();
    return this.state.ownerPriority;
  }

  setWindowLayout(layout) {
    this.state.windowLayout = { ...(layout || {}) };
    this._touch();
    return this.state.windowLayout;
  }

  recordCommand(text) {
    if (!text) return;
    this.state.recentCommands.push({ at: Date.now(), text });
    if (this.state.recentCommands.length > MAX_RECENT_COMMANDS) {
      this.state.recentCommands = this.state.recentCommands.slice(-MAX_RECENT_COMMANDS);
    }
    this._touch();
  }

  recordConversationTurn(text, response) {
    this.state.conversationHistory.push({
      at: Date.now(),
      text,
      response: response && response.text ? response.text : null,
      intent: response && response.intent ? response.intent : null,
    });
    if (this.state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
      this.state.conversationHistory = this.state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY);
    }
    this._touch();
  }

  /** Merge an arbitrary set of context fields in one call. */
  update(partial = {}) {
    const allowed = ['focus', 'activeProject', 'activeObjective', 'ownerPriority'];
    for (const key of allowed) {
      if (partial[key] !== undefined) this.state[key] = partial[key];
    }
    this._touch();
    return this.getContext();
  }

  reset() {
    this.state = DEFAULT_STATE();
    this._touch();
  }

  _touch() {
    this.state.updatedAt = Date.now();
    this._persist();
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[SessionMemory] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.state) {
        this.state = { ...DEFAULT_STATE(), ...parsed.state };
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.state = DEFAULT_STATE();
      } else {
        this.config.logger.error('[SessionMemory] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore();
        this.state = DEFAULT_STATE();
      }
    }
  }

  async _archiveCorruptStore() {
    try {
      const corruptPath = `${this.storePath}.corrupt.${Date.now()}`;
      await fs.rename(this.storePath, corruptPath);
    } catch (archiveError) {
      this.config.logger.error('[SessionMemory] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
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
      state: this.state,
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[SessionMemory] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = SessionMemory;
