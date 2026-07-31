'use strict';

/**
 * ArchitectureInvariant is a single executable architectural rule.
 * It can perform static source checks, runtime instantiation checks,
 * or report that it requires manual verification.
 */
class ArchitectureInvariant {
  constructor(config = {}) {
    this.id = config.id || `inv-${Date.now()}`;
    this.name = config.name || this.id;
    this.description = config.description || '';
    this.category = config.category || 'general';
    this.severity = config.severity || 'error';
    this.requires = config.requires || [];
    this.check = config.check || null;
  }

  verify(guard) {
    if (typeof this.check !== 'function') {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        severity: this.severity,
        status: 'manual',
        details: 'no automated check configured',
        manual: true,
        ts: Date.now(),
      };
    }

    try {
      const outcome = this.check(guard);
      if (outcome && outcome.status === 'manual') {
        return {
          id: this.id,
          name: this.name,
          category: this.category,
          severity: this.severity,
          status: 'manual',
          details: outcome.details || 'manual verification required',
          manual: true,
          ts: Date.now(),
        };
      }
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        severity: this.severity,
        status: (outcome && outcome.status) || 'pass',
        details: (outcome && outcome.details) || '',
        affected: (outcome && outcome.affected) || null,
        manual: false,
        ts: Date.now(),
      };
    } catch (err) {
      return {
        id: this.id,
        name: this.name,
        category: this.category,
        severity: this.severity,
        status: 'error',
        details: `check threw: ${err instanceof Error ? err.message : String(err)}`,
        manual: true,
        ts: Date.now(),
      };
    }
  }
}

module.exports = ArchitectureInvariant;
