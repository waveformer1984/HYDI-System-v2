/**
 * Memory Separator for LLM Agents
 * Because LLMs LOVE to accidentally leak things
 */

class MemorySeparator {
  constructor(options = {}) {
    this.sensitivePatterns = [
      /sk_[a-zA-Z0-9]{24,}/g, // Stripe keys
      /whsec_[a-zA-Z0-9]{32,}/g, // Webhook secrets
      /sbp_[a-zA-Z0-9]{40,}/g, // Supabase keys
      /Bearer\s+[a-zA-Z0-9\-_\.]+/g, // Bearer tokens
      /password["\s:]+["']?[^\s"']{8,}/gi, // Passwords
      /secret["\s:]+["']?[^\s"']{16,}/gi, // Generic secrets
      /api[_-]?key["\s:]+["']?[^\s"']{16,}/gi, // API keys
      /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // Credit cards
      /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
      /-----BEGIN[A-Z\s]+-----[\s\S]+-----END[A-Z\s]+-----/g // Private keys
    ];

    this.responseFilters = {
      headers: true,
      metadata: true,
      debug: true,
      stack: true,
      internal: true
    };

    this.memoryQuarantine = new Set();
    this.lastSanitization = Date.now();
  }

  /**
   * Sanitize response before returning to LLM
   */
  sanitizeResponse(response, context = {}) {
    const sanitized = {
      data: null,
      safe: true,
      quarantined: [],
      riskLevel: 'low'
    };

    try {
      // Deep clone to avoid mutation
      const cleanData = JSON.parse(JSON.stringify(response));

      // Remove headers and metadata
      if (this.responseFilters.headers) {
        delete cleanData.headers;
        delete cleanData.metadata;
      }

      // Remove debug info
      if (this.responseFilters.debug) {
        delete cleanData.debug;
        delete cleanData.stack;
        delete cleanData.trace;
      }

      // Remove internal fields
      if (this.responseFilters.internal) {
        delete cleanData.internal;
        delete cleanData._internal;
        delete cleanData.__internal;
      }

      // Sanitize data values
      this.sanitizeValues(cleanData, sanitized);

      // Extract only essential information
      sanitized.data = this.extractEssentialInfo(cleanData, context);

      // Assess risk level
      sanitized.riskLevel = this.assessRiskLevel(sanitized);

      // Log sanitization
      this.logSanitization(response, sanitized, context);

      return sanitized;

    } catch (error) {
      console.error('[MEMORY] Sanitization failed:', error);
      return {
        data: { error: 'Response sanitization failed' },
        safe: false,
        riskLevel: 'high'
      };
    }
  }

  /**
   * Sanitize values recursively
   */
  sanitizeValues(obj, sanitized) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Check for sensitive patterns
        const matches = this.findSensitiveData(value);
        
        if (matches.length > 0) {
          // Replace with placeholder
          obj[key] = this.replaceSensitive(value, matches);
          
          // Track quarantined data
          matches.forEach(match => {
            sanitized.quarantined.push({
              field: key,
              type: match.type,
              length: match.value.length
            });
          });
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively sanitize nested objects
        this.sanitizeValues(value, sanitized);
      }
    }
  }

  /**
   * Find sensitive data patterns
   */
  findSensitiveData(text) {
    const matches = [];
    
    for (const pattern of this.sensitivePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        matches.push({
          type: this.getPatternType(pattern),
          value: match[0],
          index: match.index
        });
      }
    }
    
    return matches;
  }

  /**
   * Replace sensitive data with placeholders
   */
  replaceSensitive(text, matches) {
    let result = text;
    
    // Sort matches by index (reverse order to not mess up positions)
    matches.sort((a, b) => b.index - a.index);
    
    for (const match of matches) {
      const placeholder = this.getPlaceholder(match.type, match.value.length);
      result = result.substring(0, match.index) + 
               placeholder + 
               result.substring(match.index + match.value.length);
    }
    
    return result;
  }

  /**
   * Get placeholder for sensitive data
   */
  getPlaceholder(type, length) {
    const placeholders = {
      'stripe': 'sk_live_***',
      'webhook': 'whsec_***',
      'supabase': 'sbp_***',
      'bearer': 'Bearer ***',
      'password': '[REDACTED_PASSWORD]',
      'secret': '[REDACTED_SECRET]',
      'api_key': '[REDACTED_API_KEY]',
      'credit_card': '****-****-****-****',
      'ssn': '***-**-****',
      'private_key': '-----BEGIN REDACTED-----'
    };
    
    return placeholders[type] || '[REDACTED]';
  }

  /**
   * Get pattern type
   */
  getPatternType(pattern) {
    const patternStr = pattern.toString();
    
    if (patternStr.includes('sk_')) return 'stripe';
    if (patternStr.includes('whsec_')) return 'webhook';
    if (patternStr.includes('sbp_')) return 'supabase';
    if (patternStr.includes('Bearer')) return 'bearer';
    if (patternStr.includes('password')) return 'password';
    if (patternStr.includes('secret')) return 'secret';
    if (patternStr.includes('api')) return 'api_key';
    if (patternStr.includes('credit')) return 'credit_card';
    if (patternStr.includes('ssn')) return 'ssn';
    if (patternStr.includes('BEGIN')) return 'private_key';
    
    return 'unknown';
  }

  /**
   * Extract only essential information for LLM
   */
  extractEssentialInfo(data, context) {
    const essential = {};
    
    // Based on context, extract what's needed
    switch (context.action) {
      case 'stripe:transfer':
        essential.transfer_id = data.id;
        essential.amount = data.amount;
        essential.currency = data.currency;
        essential.status = data.status;
        if (data.failure_code) {
          essential.failure_code = data.failure_code;
        }
        break;
        
      case 'stripe:create_connect_account':
        essential.account_id = data.id;
        essential.charges_enabled = data.charges_enabled;
        essential.payouts_enabled = data.payouts_enabled;
        essential.requirements = data.requirements?.currently_due || [];
        break;
        
      case 'email:send':
        essential.message_id = data.id;
        essential.status = data.status;
        if (data.error) {
          essential.error = data.error;
        }
        break;
        
      default:
        // Generic extraction - only safe fields
        const safeFields = ['id', 'status', 'created', 'amount', 'currency', 'type'];
        for (const field of safeFields) {
          if (data[field] !== undefined) {
            essential[field] = data[field];
          }
        }
    }
    
    return essential;
  }

  /**
   * Assess risk level of sanitized data
   */
  assessRiskLevel(sanitized) {
    let risk = 0;
    
    // Based on quarantined items
    if (sanitized.quarantined.length > 0) {
      risk += 0.3 * sanitized.quarantined.length;
    }
    
    // Based on data type
    if (sanitized.data?.failure_code) risk += 0.2;
    if (sanitized.data?.error) risk += 0.1;
    
    // Based on context
    if (sanitized.context?.action?.includes('transfer')) risk += 0.2;
    if (sanitized.context?.amount > 10000) risk += 0.3;
    
    if (risk > 0.8) return 'high';
    if (risk > 0.4) return 'medium';
    return 'low';
  }

  /**
   * Filter data before storing in LLM memory
   */
  filterForMemory(data, context = {}) {
    const memorySafe = {
      timestamp: new Date().toISOString(),
      context: {
        action: context.action,
        agent: context.agent
      },
      data: null,
      safe: true
    };

    // Apply stricter filtering for memory
    const memoryData = this.sanitizeResponse(data, {
      ...context,
      forMemory: true
    });

    // Only store if safe
    if (memoryData.safe && memoryData.riskLevel !== 'high') {
      memoryData.data = memoryData.data;
    } else {
      memoryData.safe = false;
      memoryData.reason = 'Data too sensitive for long-term memory';
    }

    return memoryData;
  }

  /**
   * Check if data should be quarantined
   */
  shouldQuarantine(data) {
    // Check for high-risk indicators
    const highRiskPatterns = [
      /error/i,
      /failure/i,
      /exception/i,
      /unauthorized/i,
      /forbidden/i
    ];

    const dataStr = JSON.stringify(data).toLowerCase();
    
    return highRiskPatterns.some(pattern => pattern.test(dataStr));
  }

  /**
   * Add to quarantine
   */
  addToQuarantine(data, reason) {
    const quarantineId = this.generateQuarantineId();
    
    this.memoryQuarantine.add({
      id: quarantineId,
      data: this.hashData(data),
      reason,
      timestamp: new Date().toISOString()
    });
    
    console.log(`[MEMORY] Quarantined data: ${reason}`);
    return quarantineId;
  }

  /**
   * Generate quarantine ID
   */
  generateQuarantineId() {
    return 'q_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Hash data for quarantine (don't store actual data)
   */
  hashData(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  /**
   * Log sanitization (without sensitive data)
   */
  logSanitization(original, sanitized, context) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      agent: context.agent,
      action: context.action,
      riskLevel: sanitized.riskLevel,
      quarantinedCount: sanitized.quarantined.length,
      safe: sanitized.safe
    };
    
    console.log('[MEMORY] Sanitization:', logEntry);
    
    // Store in audit log (separate system)
    this.auditLog(logEntry);
  }

  /**
   * Audit log (placeholder - would integrate with audit system)
   */
  auditLog(entry) {
    // In production, send to secure audit system
    // Never log actual data, only metadata
  }

  /**
   * Get memory statistics
   */
  getMemoryStats() {
    return {
      quarantinedItems: this.memoryQuarantine.size,
      lastSanitization: new Date(this.lastSanitization).toISOString(),
      sensitivePatterns: this.sensitivePatterns.length,
      responseFilters: Object.keys(this.responseFilters).filter(k => this.responseFilters[k])
    };
  }

  /**
   * Add custom sensitive pattern
   */
  addSensitivePattern(pattern, type) {
    this.sensitivePatterns.push({
      pattern: new RegExp(pattern, 'g'),
      type: type
    });
    
    console.log(`[MEMORY] Added sensitive pattern: ${type}`);
  }

  /**
   * Clear quarantine (only with authorization)
   */
  clearQuarantine(authorized = false) {
    if (!authorized) {
      throw new Error('Authorization required to clear quarantine');
    }
    
    const count = this.memoryQuarantine.size;
    this.memoryQuarantine.clear();
    
    console.log(`[MEMORY] Cleared ${count} quarantined items`);
    return count;
  }
}

module.exports = MemorySeparator;
