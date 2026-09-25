// CASCADE Classification V2 - Hard enum boundaries
// No semantic drift, no creative labeling

class CascadeClassificationV2 {
  constructor() {
    // Strict enum definitions - IMMUTABLE
    this.CLASSIFICATIONS = {
      INFRA_FAILURE: 'INFRA_FAILURE',
      ROUTE_FAILURE: 'ROUTE_FAILURE',
      DEPLOYMENT_MISMATCH: 'DEPLOYMENT_MISMATCH',
      DATA_INTEGRITY_RISK: 'DATA_INTEGRITY_RISK',
      STREAM_BREAK: 'STREAM_BREAK',
      UNKNOWN_ANOMALY: 'UNKNOWN_ANOMALY'
    };
    
    // Exact match patterns - NO fuzzy matching.
    //
    // Matching rule (ISSUES_FOUND.md #80): a category matches when ANY ONE
    // of its indicator groups matches, and a group matches when ALL of its
    // conditions match. Categories are tried in the order below and the
    // first match wins. This is the rule modules/cascade-core.js's V1
    // classifyEvent() implements (`||` between indicators, the same order),
    // the rule CASCADE_README.md describes ("INFRA_FAILURE - Module not
    // found, connection refused"), and what V2's own scripts expect
    // (test-cascade-v2.js labels an event carrying only
    // error_code: 'MODULE_NOT_FOUND' as "Valid INFRA_FAILURE").
    //
    // Two groups combine conditions, both taken from V1:
    //   - database down: service === 'database' AND status === 'down'
    //   - route failure: a route or endpoint AND an HTTP error signal
    //     (V1: `(payload.route || payload.endpoint) && status_code >= 400`)
    // Every other indicator names a failure on its own and is its own group.
    //
    // Field-level checks (exact / contains / exists / range) are unchanged:
    // `exists` still means "present", so `build_failed: false` counts as a
    // DEPLOYMENT_MISMATCH indicator exactly as it did before.
    const P = (field, spec) => ({ field, ...spec });
    const one = (pattern) => [pattern];
    const ROUTE_CONTEXT = { anyOf: [P('route', { exists: true }), P('endpoint', { exists: true })] };
    const HTTP_ERROR = {
      anyOf: [
        P('status_code', { min: 400, max: 599 }),
        P('http_error', { exists: true }),
        P('error', { contains: '404', exact: false }),
        P('error', { contains: '500', exact: false })
      ]
    };

    this.patterns = {
      [this.CLASSIFICATIONS.INFRA_FAILURE]: [
        one(P('error_code', { value: 'MODULE_NOT_FOUND', exact: true })),
        one(P('error_code', { value: 'ECONNREFUSED', exact: true })),
        one(P('error_code', { value: 'ENOTFOUND', exact: true })),
        one(P('error', { contains: 'Cannot resolve module', exact: false })),
        [P('service', { value: 'database', exact: true }), P('status', { value: 'down', exact: true })],
        one(P('error', { contains: 'Connection refused', exact: false })),
        one(P('error', { contains: 'Service unavailable', exact: false }))
      ],

      [this.CLASSIFICATIONS.ROUTE_FAILURE]: [
        [ROUTE_CONTEXT, HTTP_ERROR]
      ],

      [this.CLASSIFICATIONS.DEPLOYMENT_MISMATCH]: [
        one(P('env_var_missing', { exists: true })),
        one(P('version_mismatch', { exists: true })),
        one(P('config_diff', { exists: true })),
        one(P('deployment_error', { exists: true })),
        one(P('build_failed', { exists: true }))
      ],

      [this.CLASSIFICATIONS.DATA_INTEGRITY_RISK]: [
        one(P('corruption_detected', { exists: true })),
        one(P('checksum_mismatch', { exists: true })),
        one(P('data_validation_failed', { exists: true })),
        one(P('integrity_check_failed', { exists: true })),
        one(P('data_loss', { exists: true }))
      ],

      [this.CLASSIFICATIONS.STREAM_BREAK]: [
        one(P('stream_disconnected', { exists: true })),
        one(P('connection_lost', { exists: true })),
        one(P('websocket_error', { exists: true })),
        one(P('stream_error', { exists: true })),
        one(P('disconnect', { exists: true }))
      ]
    };
    
    // Statistics
    this.stats = {
      totalClassifications: 0,
      classificationCounts: {},
      unknownCount: 0,
      quarantinedCount: 0
    };
    
    // Initialize counts
    Object.values(this.CLASSIFICATIONS).forEach(cls => {
      this.stats.classificationCounts[cls] = 0;
    });
  }

  // Classify event with strict boundaries
  classify(event) {
    this.stats.totalClassifications++;
    
    // Must have payload
    if (!event || !event.payload) {
      return this.createClassificationResult(
        this.CLASSIFICATIONS.UNKNOWN_ANOMALY,
        0.5,
        ['Missing payload'],
        true // quarantine
      );
    }
    
    // Check each category in order; the first one with a matching group wins
    for (const [classification, groups] of Object.entries(this.patterns)) {
      const matchedRules = [];
      for (const group of groups) {
        const matches = this.checkPatterns(event.payload, group);
        if (matches.allMatch) matchedRules.push(this.describeGroup(classification, matches.results));
      }

      if (matchedRules.length > 0) {
        this.stats.classificationCounts[classification]++;
        
        return this.createClassificationResult(
          classification,
          0.9, // High confidence for exact matches
          [],
          false,
          matchedRules
        );
      }
    }
    
    // No patterns matched = UNKNOWN_ANOMALY
    this.stats.unknownCount++;
    this.stats.quarantinedCount++;
    
    return this.createClassificationResult(
      this.CLASSIFICATIONS.UNKNOWN_ANOMALY,
      0.3, // Low confidence for unknown
      ['No matching pattern found'],
      true // Always quarantine unknown
    );
  }

  // Check if payload matches ALL conditions of one group. A condition is a
  // single pattern, or { anyOf: [patterns] } which matches when any does.
  checkPatterns(payload, patterns) {
    const results = [];
    
    for (const pattern of patterns) {
      const match = pattern.anyOf
        ? this.checkAnyOf(payload, pattern.anyOf)
        : this.checkPattern(payload, pattern);
      results.push(match);
    }
    
    return {
      allMatch: results.every(r => r.matched),
      results: results
    };
  }

  // Check single pattern
  checkPattern(payload, pattern) {
    const value = payload[pattern.field];
    
    // Field must exist
    if (pattern.exists !== undefined) {
      return {
        field: pattern.field,
        matched: pattern.exists ? (value !== undefined) : (value === undefined),
        expected: pattern.exists ? 'exists' : 'not exists',
        actual: value !== undefined ? 'exists' : 'not exists'
      };
    }
    
    // Exact value match
    if (pattern.exact && pattern.value !== undefined) {
      return {
        field: pattern.field,
        matched: value === pattern.value,
        expected: pattern.value,
        actual: value
      };
    }
    
    // Contains match
    if (pattern.contains && typeof value === 'string') {
      return {
        field: pattern.field,
        matched: value.includes(pattern.contains),
        expected: `contains "${pattern.contains}"`,
        actual: value
      };
    }
    
    // Range match
    if (pattern.min !== undefined || pattern.max !== undefined) {
      const numValue = Number(value);
      if (isNaN(numValue)) {
        return {
          field: pattern.field,
          matched: false,
          expected: `number between ${pattern.min || 0} and ${pattern.max || Infinity}`,
          actual: value
        };
      }
      
      const inRange = (pattern.min === undefined || numValue >= pattern.min) &&
                     (pattern.max === undefined || numValue <= pattern.max);
      
      return {
        field: pattern.field,
        matched: inRange,
        expected: `between ${pattern.min || 0} and ${pattern.max || Infinity}`,
        actual: numValue
      };
    }
    
    // Default: no match
    return {
      field: pattern.field,
      matched: false,
      expected: 'unknown pattern',
      actual: value
    };
  }

  checkAnyOf(payload, alternatives) {
    const results = alternatives.map(p => this.checkPattern(payload, p));
    const hit = results.find(r => r.matched);
    return hit || { field: alternatives.map(p => p.field).join('|'), matched: false, expected: 'any of', actual: undefined };
  }

  // Stable, human-readable id for a matched group, e.g.
  // "INFRA_FAILURE:service=database+status=down"
  describeGroup(classification, results) {
    const parts = results.map(r => {
      if (r.expected === 'exists') return `${r.field}`;
      if (typeof r.expected === 'string' && r.expected.startsWith('contains')) return `${r.field}~${r.expected.slice(10, -1)}`;
      if (typeof r.expected === 'string' && r.expected.startsWith('between')) return `${r.field}:${r.expected.slice(8).replace(' and ', '-')}`;
      return `${r.field}=${r.expected}`;
    });
    return `${classification}:${parts.join('+')}`;
  }

  // Create standardized classification result
  createClassificationResult(classification, confidence, reasons, quarantine, matchedRules = []) {
    // Validate classification is one of the allowed enums
    if (!Object.values(this.CLASSIFICATIONS).includes(classification)) {
      throw new Error(`Invalid classification: ${classification}`);
    }
    
    return {
      event: 'hyve_opportunity_detected',
      classification: classification,
      confidence: confidence,
      reasons: reasons || [],
      matched_rules: matchedRules,
      quarantine: quarantine,
      enum_locked: true,
      version: 'v2'
    };
  }

  // Get classification statistics
  getStats() {
    const total = this.stats.totalClassifications;
    
    return {
      ...this.stats,
      classificationRates: Object.entries(this.stats.classificationCounts).map(([cls, count]) => ({
        classification: cls,
        count: count,
        rate: total > 0 ? (count / total * 100).toFixed(2) + '%' : '0%'
      })),
      unknownRate: total > 0 ? (this.stats.unknownCount / total * 100).toFixed(2) + '%' : '0%',
      quarantineRate: total > 0 ? (this.stats.quarantinedCount / total * 100).toFixed(2) + '%' : '0%'
    };
  }

  // Validate classification is allowed
  isValidClassification(classification) {
    return Object.values(this.CLASSIFICATIONS).includes(classification);
  }

  // Get all allowed classifications
  getAllowedClassifications() {
    return Object.values(this.CLASSIFICATIONS);
  }

  // Reset statistics
  resetStats() {
    this.stats.totalClassifications = 0;
    this.stats.unknownCount = 0;
    this.stats.quarantinedCount = 0;
    
    Object.values(this.CLASSIFICATIONS).forEach(cls => {
      this.stats.classificationCounts[cls] = 0;
    });
  }
}

module.exports = CascadeClassificationV2;
