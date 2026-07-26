'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const { normalizeEntity, validateEntity } = require('./DataIntegrity');

const PERSISTENCE_VERSION = 2;

const ENTITY_TYPES = new Set([
  'project', 'client', 'vendor', 'equipment', 'opportunity', 'task', 'decision', 'activity',
]);

const PRIORITY = {
  critical: 4, high: 3, normal: 2, low: 1,
};

function generateId() {
  return `ent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/**
 * BusinessMemory is the local-first executive memory for the ProtoForge ecosystem.
 *
 * It stores a unified graph of projects, clients, vendors, equipment, opportunities,
 * and tasks. All mutations are debounced-persisted to a local JSON file. The API is
 * designed to integrate with TaskEngine, ProjectPlanner, and ObservabilityDashboard
 * without duplicating their responsibilities.
 *
 * Revenue prioritization surface: rankOpportunities() scores by value, effort, risk,
 * and dependency count and returns the next highest-value action.
 */
class BusinessMemory extends EventEmitter {
  constructor(config = {}) {
    super();
    const StrategicObjectives = require('./StrategicObjectives');
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      ...config,
    };

    this.strategicObjectives = config.strategicObjectives || new StrategicObjectives();
    this.entities = new Map();
    this.relationships = new Map();
    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'business-memory.json');
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('BusinessMemory has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[BusinessMemory] started');
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
    this.config.logger.log('[BusinessMemory] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.entities.clear();
    this.relationships.clear();
    this.removeAllListeners();
    this._destroyed = true;
  }

  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      noOrphanRelationships: true,
      validEntityTypes: true,
      validScores: true,
    };

    for (const rels of this.relationships.values()) {
      for (const r of rels) {
        if (!this.entities.has(r.targetId) || !this.entities.has(r.sourceId)) {
          checks.noOrphanRelationships = false;
        }
      }
    }

    for (const e of this.entities.values()) {
      if (!ENTITY_TYPES.has(e.type)) checks.validEntityTypes = false;
      if (e.value && (typeof e.value !== 'number' || Number.isNaN(e.value))) checks.validScores = false;
      if (e.effort && (typeof e.effort !== 'number' || e.effort < 0)) checks.validScores = false;
      if (e.risk && (typeof e.risk !== 'number' || e.risk < 0 || e.risk > 1)) checks.validScores = false;
    }

    const ok = Object.values(checks).every(Boolean);
    return {
      ok,
      checks,
      entities: this.entities.size,
      relationships: Array.from(this.relationships.values()).flat().length,
    };
  }

  /**
   * Add or upsert an entity. Returns the generated or provided id.
   */
  put(entity) {
    if (this._destroyed) throw new Error('BusinessMemory has been destroyed');

    const id = entity.id || generateId();
    const now = Date.now();
    const existing = this.entities.get(id);
    const type = entity.type || existing?.type || 'task';
    if (!ENTITY_TYPES.has(type)) throw new Error(`Unknown entity type: ${type}`);

    const raw = {
      id,
      type,
      name: entity.name || existing?.name || 'Unnamed',
      status: entity.status || existing?.status || 'active',
      priority: entity.priority || existing?.priority || 'normal',
      value: entity.value ?? existing?.value ?? 0,
      effort: entity.effort ?? existing?.effort ?? 1,
      risk: entity.risk ?? existing?.risk ?? 0,
      probability: entity.probability ?? existing?.probability,
      confidence: entity.confidence ?? existing?.confidence,
      strategic: entity.strategic ?? existing?.strategic,
      cost: entity.cost ?? existing?.cost,
      revenue: entity.revenue ?? existing?.revenue,
      tags: Array.isArray(entity.tags) ? entity.tags : (existing?.tags || []),
      payload: entity.payload !== undefined ? entity.payload : (existing?.payload || {}),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const normalized = normalizeEntity(raw);
    validateEntity(normalized);

    this.entities.set(id, normalized);
    this._persist();
    this.emit('changed', { action: existing ? 'updated' : 'created', id, type });
    return id;
  }

  get(id) {
    return this.entities.get(id);
  }

  remove(id) {
    if (this._destroyed) throw new Error('BusinessMemory has been destroyed');
    const removed = this.entities.delete(id);
    if (removed) {
      this.relationships.delete(id);
      for (const [sourceId, rels] of this.relationships.entries()) {
        const filtered = rels.filter((r) => r.targetId !== id);
        if (filtered.length !== rels.length) this.relationships.set(sourceId, filtered);
      }
      this._persist();
      this.emit('changed', { action: 'removed', id });
    }
    return removed;
  }

  /**
   * Create a typed relationship between two entities.
   */
  relate(sourceId, targetId, relType = 'related') {
    if (this._destroyed) throw new Error('BusinessMemory has been destroyed');
    if (!this.entities.has(sourceId)) throw new Error(`Source ${sourceId} not found`);
    if (!this.entities.has(targetId)) throw new Error(`Target ${targetId} not found`);

    const rels = this.relationships.get(sourceId) || [];
    if (!rels.some((r) => r.targetId === targetId && r.type === relType)) {
      rels.push({ targetId, type: relType, createdAt: Date.now() });
      this.relationships.set(sourceId, rels);
      this._persist();
    }
    return true;
  }

  getRelated(id, relType) {
    const rels = this.relationships.get(id) || [];
    return rels
      .filter((r) => !relType || r.type === relType)
      .map((r) => ({ ...r, entity: this.entities.get(r.targetId) }))
      .filter((r) => r.entity);
  }

  find(query = {}) {
    let results = Array.from(this.entities.values());
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      results = results.filter((e) => types.includes(e.type));
    }
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      results = results.filter((e) => statuses.includes(e.status));
    }
    if (query.priority) {
      const priorities = Array.isArray(query.priority) ? query.priority : [query.priority];
      results = results.filter((e) => priorities.includes(e.priority));
    }
    if (query.tags) {
      const tags = Array.isArray(query.tags) ? query.tags : [query.tags];
      results = results.filter((e) => tags.some((t) => e.tags.includes(t)));
    }
    if (query.text) {
      const q = query.text.toLowerCase();
      results = results.filter((e) => e.name.toLowerCase().includes(q) || JSON.stringify(e.payload).toLowerCase().includes(q));
    }
    if (query.minValue !== undefined) results = results.filter((e) => e.value >= query.minValue);
    if (query.maxEffort !== undefined) results = results.filter((e) => e.effort <= query.maxEffort);
    if (query.since !== undefined) results = results.filter((e) => (e.createdAt || e.timestamp || 0) >= query.since);

    if (query.sortBy === 'value') {
      results.sort((a, b) => b.value - a.value);
    } else if (query.sortBy === 'priority') {
      results.sort((a, b) => (PRIORITY[b.priority] || 0) - (PRIORITY[a.priority] || 0));
    } else if (query.sortBy === 'score') {
      results.sort((a, b) => this._score(b) - this._score(a));
    }
    return results;
  }

  /**
   * Return the next highest-value actions across opportunities and tasks.
   */
  rankOpportunities(options = {}) {
    const types = options.types || ['opportunity', 'task'];
    const candidates = this.find({ type: options.type ? [options.type] : types })
      .filter((e) => e.status !== 'completed' && e.status !== 'cancelled');
    return candidates
      .map((e) => ({ ...e, score: this._score(e), relatedCount: (this.relationships.get(e.id) || []).length }))
      .sort((a, b) => b.score - a.score);
  }

  getStatus() {
    const counts = { project: 0, client: 0, vendor: 0, equipment: 0, opportunity: 0, task: 0 };
    let totalValue = 0;
    for (const e of this.entities.values()) {
      if (counts[e.type] !== undefined) counts[e.type] += 1;
      totalValue += e.value;
    }
    return { total: this.entities.size, counts, totalValue };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  _score(entity) {
    if (this.strategicObjectives) {
      return this.strategicObjectives.score(entity).score;
    }
    const effort = Math.max(entity.effort || 1, 1);
    const risk = 1 - clamp(entity.risk || 0, 0, 1);
    return ((entity.value || 0) * risk) / effort;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[BusinessMemory] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entities)) {
        this.entities = new Map(parsed.entities.map((e) => [e.id, this._hydrateEntity(e)]));
        this.relationships = new Map(Object.entries(parsed.relationships || {}));
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.entities = new Map();
        this.relationships = new Map();
      } else {
        this.config.logger.error('[BusinessMemory] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore();
        this.entities = new Map();
        this.relationships = new Map();
      }
    }
  }

  _hydrateEntity(stored) {
    const type = ENTITY_TYPES.has(stored.type) ? stored.type : 'task';
    const migrated = this._migrateEntity({
      id: stored.id,
      type,
      name: stored.name,
      status: stored.status,
      priority: stored.priority,
      value: stored.value,
      effort: stored.effort,
      risk: stored.risk,
      probability: stored.probability,
      confidence: stored.confidence,
      strategic: stored.strategic,
      cost: stored.cost,
      revenue: stored.revenue,
      tags: stored.tags,
      payload: stored.payload,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    });
    return migrated;
  }

  _migrateEntity(stored) {
    const raw = {
      id: stored.id,
      type: stored.type || 'task',
      name: stored.name || 'Unnamed',
      status: stored.status || 'active',
      priority: stored.priority || 'normal',
      value: stored.value ?? 0,
      effort: stored.effort ?? 1,
      risk: stored.risk ?? 0,
      probability: stored.probability,
      confidence: stored.confidence,
      strategic: stored.strategic,
      cost: stored.cost,
      revenue: stored.revenue,
      tags: Array.isArray(stored.tags) ? stored.tags : [],
      payload: stored.payload || {},
      createdAt: stored.createdAt || Date.now(),
      updatedAt: stored.updatedAt || Date.now(),
    };
    const normalized = normalizeEntity(raw);
    validateEntity(normalized);
    return normalized;
  }

  async _archiveCorruptStore() {
    try {
      const corruptPath = `${this.storePath}.corrupt.${Date.now()}`;
      await fs.rename(this.storePath, corruptPath);
    } catch (archiveError) {
      this.config.logger.error('[BusinessMemory] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
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
      entities: Array.from(this.entities.values()),
      relationships: Object.fromEntries(this.relationships.entries()),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[BusinessMemory] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = BusinessMemory;
