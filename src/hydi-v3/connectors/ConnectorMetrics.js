'use strict';

class ConnectorMetrics {
  constructor() {
    this.byConnector = new Map();
  }

  record(name, key = 'emitted') {
    const current = this.byConnector.get(name) || { emitted: 0, errors: 0 };
    current[key] = (current[key] || 0) + 1;
    this.byConnector.set(name, current);
  }

  get(name) {
    return this.byConnector.get(name) || { emitted: 0, errors: 0 };
  }

  aggregate() {
    let emitted = 0;
    let errors = 0;
    for (const m of this.byConnector.values()) {
      emitted += m.emitted;
      errors += m.errors;
    }
    return {
      emitted,
      errors,
      byConnector: Object.fromEntries(this.byConnector),
    };
  }

  reset() {
    this.byConnector.clear();
  }
}

module.exports = ConnectorMetrics;
