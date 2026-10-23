/**
 * HEIDI Operational Decision Engine — Maintenance Mode
 */

class MaintenanceMode {
  constructor() {
    this.active = new Map();
  }

  start(record) {
    const id = record.id || `mnt-${Date.now()}`;
    const m = {
      id,
      scope: record.scope || [],
      startTime: record.startTime || new Date().toISOString(),
      expectedDurationMs: record.expectedDurationMs || 3600000,
      reason: record.reason || '',
      source: record.source || 'operator',
    };
    this.active.set(id, m);
    return m;
  }

  end(id) {
    return this.active.delete(id);
  }

  isUnderMaintenance(component) {
    for (const m of this.active.values()) {
      if (m.scope.includes('*') || m.scope.includes(component)) {
        if (!this.isExpired(m)) return { active: true, maintenance: m };
        this.active.delete(m.id);
      }
    }
    return { active: false };
  }

  isExpired(m) {
    const start = new Date(m.startTime).getTime();
    return Date.now() > start + m.expectedDurationMs;
  }

  list() {
    const out = [];
    for (const [id, m] of this.active.entries()) {
      if (this.isExpired(m)) {
        this.active.delete(id);
      } else {
        out.push(m);
      }
    }
    return out;
  }
}

module.exports = { MaintenanceMode };
