'use strict';

const { EventEmitter } = require('events');

/**
 * ServiceContract defines and validates stable interfaces between the growing
 * set of HYDI subsystems. It prevents subsystems from becoming welded to each
 * other by keeping explicit versioned contracts for inputs and outputs.
 */
class ServiceContract extends EventEmitter {
  constructor(config = {}) {
    super();
    this.contracts = new Map();
    this.logger = config.logger || console;
    this.strict = config.strict !== false;
  }

  define(name, { version = '1.0.0', inputs = [], outputs = [], optional = [] }) {
    const contract = {
      name,
      version,
      inputs: inputs.map((f) => this._normalizeField(f)),
      outputs: outputs.map((f) => this._normalizeField(f)),
      optional: optional.map((f) => this._normalizeField(f).name),
      registeredAt: Date.now(),
    };
    this.contracts.set(name, contract);
    this.emit('defined', contract);
    return contract;
  }

  _normalizeField(field) {
    if (typeof field === 'string') return { name: field, type: 'any' };
    return { name: field.name, type: field.type || 'any' };
  }

  get(name) {
    return this.contracts.get(name) || null;
  }

  list() {
    return Array.from(this.contracts.values());
  }

  validate(name, payload, direction = 'input') {
    const contract = this.contracts.get(name);
    if (!contract) {
      return this.strict
        ? { valid: false, error: `contract_not_defined:${name}` }
        : { valid: true, warning: `contract_not_defined:${name}` };
    }
    const fields = direction === 'input' ? contract.inputs : contract.outputs;
    const missing = [];
    for (const field of fields) {
      if (!(field.name in payload) && !contract.optional.includes(field.name)) {
        missing.push(field.name);
      }
    }
    if (missing.length > 0) {
      return { valid: false, error: `missing_fields:${missing.join(',')}`, contract };
    }
    this.emit('validated', { name, direction, payload });
    return { valid: true, contract };
  }

  compatible(name, version) {
    const contract = this.contracts.get(name);
    if (!contract) return false;
    return this._compareVersion(contract.version, version) >= 0;
  }

  _compareVersion(a, b) {
    const aa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const bb = b.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(aa.length, bb.length); i += 1) {
      const av = aa[i] || 0;
      const bv = bb[i] || 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }
}

module.exports = ServiceContract;
