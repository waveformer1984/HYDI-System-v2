/**
 * HEIDI Operational Control Plane — Health / System State Aggregator
 */

class HealthAggregator {
  constructor() {
    this.components = new Map();
  }

  register(name, checker) {
    this.components.set(name, { name, checker, last: null });
    return this;
  }

  async inspectAll() {
    const results = {};
    for (const [name, c] of this.components) {
      try {
        const r = await c.checker();
        c.last = r;
        results[name] = r;
      } catch (e) {
        results[name] = { status: 'UNKNOWN', error: e.message };
      }
    }
    return results;
  }

  get(name) {
    const c = this.components.get(name);
    if (!c) return { status: 'UNKNOWN' };
    return c.last || { status: 'UNKNOWN' };
  }

  summary() {
    const all = this.components;
    let healthy = 0;
    let unknown = 0;
    for (const c of all.values()) {
      if (!c.last) { unknown++; }
      else if (c.last.status === 'HEALTHY' || c.last.status === 'healthy') { healthy++; }
      else if (c.last.status === 'UNKNOWN') { unknown++; }
    }
    return { total: all.size, healthy, unknown };
  }
}

module.exports = { HealthAggregator };
