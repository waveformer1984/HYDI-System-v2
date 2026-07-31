'use strict';

const { EventEmitter } = require('events');

/**
 * ArchitectureAudit records ArchitectureGuard results to the lifecycle
 * registry and emits auditable events.
 */
class ArchitectureAudit extends EventEmitter {
  constructor(config = {}) {
    super();
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.entries = [];
  }

  record(result) {
    const entry = {
      at: Date.now(),
      invariant: result.id,
      name: result.name,
      category: result.category,
      status: result.status,
      details: result.details,
      affected: result.affected,
    };
    this.entries.push(entry);
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('recorded', entry);
    return entry;
  }

  list() {
    return this.entries.slice();
  }
}

module.exports = ArchitectureAudit;
