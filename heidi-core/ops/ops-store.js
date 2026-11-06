'use strict';

/**
 * Durable store for the ops agent — tables live inside heidi_memory.db via
 * the memory store's run/get/all, so incidents, events, leases and the
 * pause flag survive a heidi-core restart exactly like missions do.
 */

const { redactOutput } = require('../missions/lifecycle');
const redact = (v) => (v == null ? null : redactOutput(String(v), 2000));

const TABLES = [
  `CREATE TABLE IF NOT EXISTS ops_incidents (
    id TEXT PRIMARY KEY,
    signature TEXT NOT NULL,
    component TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    mode TEXT NOT NULL,
    observation TEXT,
    diagnosis TEXT,
    confirmed INTEGER DEFAULT 0,
    hypothesis TEXT,
    owner TEXT,
    runbook TEXT,
    mission_id INTEGER,
    authorization TEXT,
    attempts INTEGER DEFAULT 0,
    opened_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deadline_at TEXT,
    resolved_at TEXT,
    result TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS ops_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id TEXT,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT,
    data TEXT,
    at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ops_leases (
    resource TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    generation INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ops_control (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

class OpsStore {
  constructor(memory) {
    this.memory = memory;
    this.ready = this.ensure();
  }

  async ensure() {
    for (const ddl of TABLES) await this.memory.run(ddl);
    return true;
  }

  async openIncident(incident) {
    const at = incident.opened_at;
    await this.memory.run(
      `INSERT INTO ops_incidents (id, signature, component, kind, state, mode, observation, confirmed, opened_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, 0, ?, ?)`,
      [incident.id, incident.signature, incident.component, incident.kind, incident.mode, redact(JSON.stringify(incident.observation || null)), at, at]
    );
    await this.event(incident.id, 'incident_opened', 'ops-agent', incident.kind, incident.observation);
  }

  async getIncident(id) {
    return this.memory.get(`SELECT * FROM ops_incidents WHERE id = ?`, [id]);
  }

  async openIncidentFor(signature) {
    return this.memory.get(
      `SELECT * FROM ops_incidents WHERE signature = ? AND state NOT IN ('resolved','closed','expired') ORDER BY opened_at DESC LIMIT 1`,
      [signature]
    );
  }

  async incidents(states, limit = 50) {
    if (Array.isArray(states)) {
      const q = states.map(() => '?').join(',');
      return this.memory.all(`SELECT * FROM ops_incidents WHERE state IN (${q}) ORDER BY updated_at DESC LIMIT ?`, [...states, limit]);
    }
    return this.memory.all(`SELECT * FROM ops_incidents WHERE state = ? ORDER BY updated_at DESC LIMIT ?`, [states, limit]);
  }

  async updateIncident(id, patch, event) {
    const inc = await this.getIncident(id);
    if (!inc) return null;
    const next = { ...inc, ...patch, updated_at: new Date().toISOString() };
    for (const k of ['observation', 'diagnosis', 'authorization', 'result']) {
      if (next[k] && typeof next[k] === 'object') next[k] = JSON.stringify(next[k]);
      if (typeof next[k] === 'string') next[k] = redact(next[k]);
    }
    if (typeof next.hypothesis === 'string') next.hypothesis = redact(next.hypothesis);
    await this.memory.run(
      `UPDATE ops_incidents SET state=?, observation=?, diagnosis=?, confirmed=?, hypothesis=?, owner=?, runbook=?,
        mission_id=?, authorization=?, attempts=?, updated_at=?, deadline_at=?, resolved_at=?, result=?, mode=? WHERE id=?`,
      [next.state, next.observation, next.diagnosis, next.confirmed, next.hypothesis, next.owner, next.runbook,
        next.mission_id, next.authorization, next.attempts, next.updated_at, next.deadline_at, next.resolved_at, next.result, next.mode, id]
    );
    if (event) await this.event(id, event.kind, event.actor || 'ops-agent', event.reason, event.data);
    return next;
  }

  async event(incidentId, kind, actor, reason = null, data = null) {
    await this.memory.run(
      `INSERT INTO ops_events (incident_id, kind, actor, reason, data, at) VALUES (?, ?, ?, ?, ?, ?)`,
      [incidentId, kind, actor, redact(reason), data ? redact(JSON.stringify(data)) : null, new Date().toISOString()]
    );
  }

  async eventsFor(incidentId, limit = 50) {
    return this.memory.all(
      `SELECT * FROM (SELECT * FROM ops_events WHERE incident_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`,
      [incidentId, limit]
    );
  }

  async recentEvents(limit = 50) {
    return this.memory.all(
      `SELECT * FROM (SELECT * FROM ops_events ORDER BY id DESC LIMIT ?) ORDER BY id ASC`, [limit]
    );
  }

  /** Conditional lease claim: succeeds only if unheld, expired, or ours. */
  async claimLease(resource, owner, ttlMs) {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlMs).toISOString();
    const existing = await this.memory.get(`SELECT * FROM ops_leases WHERE resource = ?`, [resource]);
    if (existing && existing.owner !== owner && new Date(existing.expires_at) > now) {
      return null; // held by a live owner
    }
    const gen = (existing ? existing.generation : 0) + 1;
    await this.memory.run(
      `INSERT INTO ops_leases (resource, owner, generation, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(resource) DO UPDATE SET owner=excluded.owner, generation=excluded.generation, expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
      [resource, owner, gen, expires, now.toISOString()]
    );
    return { resource, owner, generation: gen, expires_at: expires };
  }

  /** Fencing check: owner+generation must still hold a live lease. */
  async verifyLease(resource, owner, generation) {
    const l = await this.memory.get(`SELECT * FROM ops_leases WHERE resource = ?`, [resource]);
    if (!l || l.owner !== owner || l.generation !== generation) return false;
    return new Date(l.expires_at) > new Date();
  }

  async renewLease(resource, owner, generation, ttlMs) {
    if (!(await this.verifyLease(resource, owner, generation))) return false;
    await this.memory.run(
      `UPDATE ops_leases SET expires_at = ?, updated_at = ? WHERE resource = ? AND owner = ? AND generation = ?`,
      [new Date(Date.now() + ttlMs).toISOString(), new Date().toISOString(), resource, owner, generation]
    );
    return true;
  }

  async releaseLease(resource, owner, generation) {
    await this.memory.run(
      `DELETE FROM ops_leases WHERE resource = ? AND owner = ? AND generation = ?`,
      [resource, owner, generation]
    );
  }

  async getControl(key) {
    const r = await this.memory.get(`SELECT value FROM ops_control WHERE key = ?`, [key]);
    return r ? r.value : null;
  }

  async setControl(key, value, actor = 'ops-agent') {
    await this.memory.run(
      `INSERT INTO ops_control (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      [key, String(value), new Date().toISOString()]
    );
    await this.event(null, 'control_changed', actor, `${key} = ${value}`);
  }
}

module.exports = OpsStore;
