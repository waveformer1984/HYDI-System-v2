/**
 * HEIDI Operational Intelligence — Incident Store
 *
 * Durable, append-only operational incident record.
 * Stores structured incident records without secrets.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { SecretBroker } = require('./SecretBroker');

class IncidentStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(os.homedir(), '.hydi', 'incidents');
    this.redactor = options.redactor || new SecretBroker();
    this.maxInMemory = options.maxInMemory || 1000;
    this._ensureDir();
    this._incidents = this._loadRecent();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _incidentFile() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return path.join(this.dataDir, `incidents-${y}-${m}.jsonl`);
  }

  _loadRecent() {
    const file = this._incidentFile();
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const parsed = [];
    for (const line of lines.slice(-this.maxInMemory)) {
      try { parsed.push(JSON.parse(line)); } catch (_) {}
    }
    return parsed;
  }

  _redact(record) {
    return {
      ...record,
      symptoms: this.redactor.redact(record.symptoms || {}),
      evidence: this.redactor.redact(record.evidence || {}),
      action: this.redactor.redact(record.action || {}),
    };
  }

  append(record) {
    const incident = {
      incident_id: record.incident_id || `inc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: record.timestamp || new Date().toISOString(),
      component: record.component || 'unknown',
      failure_class: record.failure_class || 'UNKNOWN_FAILURE',
      symptoms: record.symptoms || {},
      environment: record.environment || {},
      dependency_state: record.dependency_state || {},
      diagnosis: record.diagnosis || { cause: 'UNKNOWN', confidence: 'LOW' },
      action: record.action || null,
      result: record.result || null,
      recovery_time: record.recovery_time || null,
      final_state: record.final_state || 'UNKNOWN',
      evidence_paths: record.evidence_paths || [],
    };
    const safe = this._redact(incident);
    this._incidents.push(safe);
    if (this._incidents.length > this.maxInMemory) this._incidents.shift();
    const line = JSON.stringify(safe) + '\n';
    fs.appendFileSync(this._incidentFile(), line);
    return safe;
  }

  query(filters = {}) {
    return this._incidents.filter((inc) => {
      if (filters.component && inc.component !== filters.component) return false;
      if (filters.failure_class && inc.failure_class !== filters.failure_class) return false;
      if (filters.final_state && inc.final_state !== filters.final_state) return false;
      if (filters.since && new Date(inc.timestamp) < new Date(filters.since)) return false;
      if (filters.until && new Date(inc.timestamp) > new Date(filters.until)) return false;
      return true;
    });
  }

  recent(limit = 10) {
    return this._incidents.slice(-limit).reverse();
  }

  summary() {
    const byComponent = {};
    const byClass = {};
    const byState = {};
    for (const inc of this._incidents) {
      byComponent[inc.component] = (byComponent[inc.component] || 0) + 1;
      byClass[inc.failure_class] = (byClass[inc.failure_class] || 0) + 1;
      byState[inc.final_state] = (byState[inc.final_state] || 0) + 1;
    }
    return {
      total: this._incidents.length,
      byComponent,
      byClass,
      byState,
    };
  }
}

module.exports = { IncidentStore };
