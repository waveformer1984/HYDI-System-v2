/**
 * LLM Sensitive Data Enforcement
 * Prevents re-ingestion of sensitive outputs into prompts
 */

class SensitiveDataEnforcer {
  constructor(options = {}) {
    this.config = {
      // Sensitive data patterns
      sensitivePatterns: [
        /sk_[a-zA-Z0-9_]{20,}/,
        /sbp_[a-zA-Z0-9_]{40,}/,
        /whsec_[a-zA-Z0-9_]{40,}/,
        /-----BEGIN [A-Z ]+ KEY-----/,
        /eyJ[a-zA-Z0-9._-]+/i, // JWT tokens
        /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, // Credit card numbers
        /\b\d{3}-\d{2}-\d{4}\b/ // SSN numbers
      ],
      
      // Enforcement actions
      actions: {
        block: true, // Block sensitive data entirely
        mask: true,  // Mask sensitive data
        log: true,   // Log violations
        alert: true  // Send alerts
      },
      
      // Context patterns that indicate re-ingestion
      reingestionPatterns: [
        /include.*(?:previous|last|above).*(?:response|output|result)/i,
        /echo.*(?:response|output|data)/i,
        /repeat.*(?:response|output)/i,
        /show.*(?:response|output|result)/i,
        /print.*(?:response|output|data)/i
      ],
      
      ...options
    };
    
    this.violations = [];
    this.blockedCount = 0;
    this.maskedCount = 0;
  }

  /**
   * Enforce sensitive data rules on response
   */
  enforceResponse(response, context = {}) {
    const enforcement = {
      allowed: true,
      blocked: false,
      masked: false,
      violations: [],
      sanitized: response
    };

    // Check if response is marked sensitive
    if (response.sensitive === true) {
      enforcement.violations.push({
        type: 'sensitive_response',
        reason: 'Response marked as sensitive',
        action: 'block_reingestion'
      });
      
      // Always block re-ingestion of sensitive responses
      return this.blockReingestion(response, enforcement);
    }

    // Scan for sensitive patterns
    const sensitiveMatches = this.scanForSensitiveData(response);
    if (sensitiveMatches.length > 0) {
      enforcement.violations.push({
        type: 'sensitive_patterns',
        matches: sensitiveMatches,
        action: this.config.mask ? 'mask' : 'block'
      });
      
      if (this.config.mask) {
        enforcement.sanitized = this.maskSensitiveData(response, sensitiveMatches);
        enforcement.masked = true;
        this.maskedCount++;
      } else {
        enforcement.blocked = true;
        this.blockedCount++;
      }
    }

    // Log violations
    if (this.config.log && enforcement.violations.length > 0) {
      this.logViolation(enforcement, context);
    }

    // Send alerts for serious violations
    if (this.config.alert && enforcement.blocked) {
      this.sendAlert(enforcement, context);
    }

    return enforcement;
  }

  /**
   * Check if prompt attempts to re-ingest data
   */
  checkPromptReingestion(prompt, previousResponses = []) {
    const violations = [];
    
    // Check for re-ingestion patterns
    for (const pattern of this.config.reingestionPatterns) {
      if (pattern.test(prompt)) {
        violations.push({
          type: 'reingestion_pattern',
          pattern: pattern.source,
          action: 'block'
        });
      }
    }

    // Check if prompt contains previous response data
    for (const prevResponse of previousResponses) {
      if (this.containsResponseData(prompt, prevResponse)) {
        violations.push({
          type: 'response_data_in_prompt',
          action: 'block'
        });
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      blocked: violations.length > 0
    };
  }

  /**
   * Block re-ingestion of sensitive data
   */
  blockReingestion(response, enforcement) {
    enforcement.blocked = true;
    enforcement.sanitized = {
      error: 'SENSITIVE_DATA_BLOCKED',
      message: 'This response contains sensitive data and cannot be re-ingested',
      requestId: response.request_id || 'unknown'
    };
    
    this.blockedCount++;
    
    return enforcement;
  }

  /**
   * Scan for sensitive data patterns
   */
  scanForSensitiveData(data) {
    const matches = [];
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    
    for (const pattern of this.config.sensitivePatterns) {
      const found = dataString.match(pattern);
      if (found) {
        matches.push({
          pattern: pattern.source,
          matches: found,
          count: found.length
        });
      }
    }
    
    return matches;
  }

  /**
   * Mask sensitive data
   */
  maskSensitiveData(data, matches) {
    let masked = typeof data === 'string' ? data : JSON.stringify(data);
    
    for (const match of matches) {
      for (const found of match.matches) {
        if (typeof found === 'string') {
          const maskedValue = found.substring(0, 4) + '[MASKED]' + found.substring(found.length - 4);
          masked = masked.replace(found, maskedValue);
        }
      }
    }
    
    // Try to parse back to original type
    try {
      return JSON.parse(masked);
    } catch {
      return masked;
    }
  }

  /**
   * Check if prompt contains response data
   */
  containsResponseData(prompt, response) {
    const promptStr = prompt.toLowerCase();
    const responseStr = JSON.stringify(response).toLowerCase();
    
    // Check for substantial overlap
    const promptWords = promptStr.split(/\s+/);
    const responseWords = responseStr.split(/\s+/);
    
    let overlapCount = 0;
    for (const word of promptWords) {
      if (word.length > 4 && responseWords.includes(word)) {
        overlapCount++;
      }
    }
    
    // If more than 5 words overlap, consider it re-ingestion
    return overlapCount > 5;
  }

  /**
   * Create safe response wrapper
   */
  createSafeResponse(data, metadata = {}) {
    const safe = {
      success: true,
      data: null,
      metadata: {
        sensitive: false,
        enforcement_applied: false,
        ...metadata
      }
    };

    // Check if data has sensitive patterns
    const matches = this.scanForSensitiveData(data);
    if (matches.length > 0) {
      safe.metadata.sensitive = true;
      safe.data = this.maskSensitiveData(data, matches);
      safe.metadata.enforcement_applied = true;
      safe.metadata.masked_patterns = matches.map(m => m.pattern);
    } else {
      safe.data = data;
    }

    return safe;
  }

  /**
   * Process LLM response with enforcement
   */
  processLLMResponse(response, prompt, context = {}) {
    const enforcement = this.enforceResponse(response, context);
    
    // Check if prompt is attempting re-ingestion
    const promptCheck = this.checkPromptReingestion(prompt);
    
    if (promptCheck.blocked) {
      return {
        allowed: false,
        reason: 'Prompt attempts to re-ingest data',
        violations: promptCheck.violations
      };
    }
    
    if (enforcement.blocked) {
      return {
        allowed: false,
        reason: 'Response contains sensitive data',
        sanitized: enforcement.sanitized,
        violations: enforcement.violations
      };
    }
    
    return {
      allowed: true,
      response: enforcement.sanitized,
      masked: enforcement.masked,
      violations: enforcement.violations
    };
  }

  /**
   * Log violation
   */
  logViolation(enforcement, context) {
    const violation = {
      timestamp: new Date().toISOString(),
      type: enforcement.violations[0].type,
      action: enforcement.violations[0].action,
      context: {
        agentId: context.agentId,
        sessionId: context.sessionId,
        requestId: context.requestId
      },
      violationCount: enforcement.violations.length
    };
    
    this.violations.push(violation);
    
    // Keep only last 1000 violations
    if (this.violations.length > 1000) {
      this.violations = this.violations.slice(-1000);
    }
    
    console.log('[LLM-ENFORCER] Violation logged:', violation);
  }

  /**
   * Send alert for serious violations
   */
  sendAlert(enforcement, context) {
    const alert = {
      level: 'HIGH',
      type: 'SENSITIVE_DATA_VIOLATION',
      timestamp: new Date().toISOString(),
      enforcement,
      context
    };
    
    console.error('[LLM-ENFORCER] ALERT:', alert);
    
    // In a real implementation, this would send to monitoring system
    // await sendAlert(alert);
  }

  /**
   * Get enforcement statistics
   */
  getStats() {
    return {
      blockedCount: this.blockedCount,
      maskedCount: this.maskedCount,
      totalViolations: this.violations.length,
      recentViolations: this.violations.slice(-10),
      patterns: this.config.sensitivePatterns.length,
      reingestionPatterns: this.config.reingestionPatterns.length
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.violations = [];
    this.blockedCount = 0;
    this.maskedCount = 0;
  }
}

module.exports = SensitiveDataEnforcer;
