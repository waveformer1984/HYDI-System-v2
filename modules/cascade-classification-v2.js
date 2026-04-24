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
    
    // Exact match patterns - NO fuzzy matching
    this.patterns = {
      [this.CLASSIFICATIONS.INFRA_FAILURE]: [
        { field: 'error_code', value: 'MODULE_NOT_FOUND', exact: true },
        { field: 'error_code', value: 'ECONNREFUSED', exact: true },
        { field: 'error_code', value: 'ENOTFOUND', exact: true },
        { field: 'error', contains: 'Cannot resolve module', exact: false },
        { field: 'service', value: 'database', exact: true },
        { field: 'status', value: 'down', exact: true },
        { field: 'error', contains: 'Connection refused', exact: false },
        { field: 'error', contains: 'Service unavailable', exact: false }
      ],
      
      [this.CLASSIFICATIONS.ROUTE_FAILURE]: [
        { field: 'route', exists: true },
        { field: 'endpoint', exists: true },
        { field: 'status_code', min: 400, max: 599 },
        { field: 'http_error', exists: true },
        { field: 'error', contains: '404', exact: false },
        { field: 'error', contains: '500', exact: false }
      ],
      
      [this.CLASSIFICATIONS.DEPLOYMENT_MISMATCH]: [
        { field: 'env_var_missing', exists: true },
        { field: 'version_mismatch', exists: true },
        { field: 'config_diff', exists: true },
        { field: 'deployment_error', exists: true },
        { field: 'build_failed', exists: true }
      ],
      
      [this.CLASSIFICATIONS.DATA_INTEGRITY_RISK]: [
        { field: 'corruption_detected', exists: true },
        { field: 'checksum_mismatch', exists: true },
        { field: 'data_validation_failed', exists: true },
        { field: 'integrity_check_failed', exists: true },
        { field: 'data_loss', exists: true }
      ],
      
      [this.CLASSIFICATIONS.STREAM_BREAK]: [
        { field: 'stream_disconnected', exists: true },
        { field: 'connection_lost', exists: true },
        { field: 'websocket_error', exists: true },
        { field: 'stream_error', exists: true },
        { field: 'disconnect', exists: true }
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
    
    // Check each classification pattern
    for (const [classification, patterns] of Object.entries(this.patterns)) {
      const matches = this.checkPatterns(event.payload, patterns);
      
      // ALL patterns must match for classification
      if (matches.allMatch) {
        this.stats.classificationCounts[classification]++;
        
        return this.createClassificationResult(
          classification,
          0.9, // High confidence for exact matches
          [],
          false
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

  // Check if payload matches ALL patterns
  checkPatterns(payload, patterns) {
    const results = [];
    
    for (const pattern of patterns) {
      const match = this.checkPattern(payload, pattern);
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

  // Create standardized classification result
  createClassificationResult(classification, confidence, reasons, quarantine) {
    // Validate classification is one of the allowed enums
    if (!Object.values(this.CLASSIFICATIONS).includes(classification)) {
      throw new Error(`Invalid classification: ${classification}`);
    }
    
    return {
      event: 'hyve_opportunity_detected',
      classification: classification,
      confidence: confidence,
      reasons: reasons || [],
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
