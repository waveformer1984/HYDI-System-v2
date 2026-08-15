'use strict';

/**
 * Apex local-first boundary stub.
 *
 * Apex is a production-only / cloud-coordination capability that is not part of
 * the local HYDI core. It has no local persistence, no routes, and no required
 * operational role for local-first mode.
 *
 * Any code that attempts to use Apex locally gets a deterministic, safe failure
 * instead of silently missing or invoking an undefined path.
 */

class ApexLocalBoundary {
  constructor() {
    this.status = 'NOT_AVAILABLE_IN_LOCAL_MODE';
    this.reason = 'Apex is not implemented for local-first HYDI operation.';
  }

  async execute() {
    return {
      status: 'NOT_AVAILABLE_IN_LOCAL_MODE',
      reason: this.reason,
      details: 'Use the production deployment path if Apex is required.',
    };
  }

  async getStatus() {
    return this.execute();
  }
}

function createApex() {
  return new ApexLocalBoundary();
}

module.exports = { ApexLocalBoundary, createApex };
