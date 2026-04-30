/**
 * LLM Tool Boundary Enforcement
 * Because LLMs leak via prompt injection and tool chaining
 */

class ToolBoundaryEnforcer {
  constructor(options = {}) {
    this.boundaries = new Map();
    this.sensitiveFlags = new Set(['sensitive', 'secret', 'private', 'credential']);
    this.chainDepth = options.chainDepth || 3; // Max tool chain depth
    this.promptInjectionPatterns = [
      /ignore\s+previous\s+instructions/i,
      /system\s*:\s*you\s+are/i,
      /act\s+as\s+if/i,
      /pretend\s+you\s+are/i,
      /disregard\s+the\s+above/i,
      /forget\s+everything/i,
      /new\s+instructions?:/i
    ];
    
    this.initializeBoundaries();
  }

  /**
   * Initialize tool boundaries
   */
  initializeBoundaries() {
    // Define boundaries for each tool type
    this.boundaries.set('stripe_transfer', {
      inputs: ['amount', 'currency', 'destination', 'metadata'],
      outputs: ['transfer_id', 'status', 'created'],
      sensitiveInputs: ['destination'],
      sensitiveOutputs: [],
      allowChaining: false,
      autoFeedToPrompt: false
    });

    this.boundaries.set('stripe_create_account', {
      inputs: ['type', 'country', 'email', 'capabilities'],
      outputs: ['account_id', 'charges_enabled', 'payouts_enabled'],
      sensitiveInputs: [],
      sensitiveOutputs: ['account_id'],
      allowChaining: false,
      autoFeedToPrompt: false
    });

    this.boundaries.set('email_send', {
      inputs: ['to', 'subject', 'body'],
      outputs: ['message_id', 'status'],
      sensitiveInputs: ['to', 'body'],
      sensitiveOutputs: [],
      allowChaining: true,
      autoFeedToPrompt: false
    });

    this.boundaries.set('database_query', {
      inputs: ['table', 'query', 'parameters'],
      outputs: ['data', 'rows_affected'],
      sensitiveInputs: ['parameters'],
      sensitiveOutputs: ['data'],
      allowChaining: true,
      autoFeedToPrompt: false
    });
  }

  /**
   * Enforce boundary on tool execution
   */
  enforceBoundary(toolName, inputs, outputs, context = {}) {
    const boundary = this.boundaries.get(toolName);
    if (!boundary) {
      console.warn(`[BOUNDARY] No boundary defined for tool: ${toolName}`);
      return { allowed: true, warnings: ['No boundary defined'] };
    }

    const enforcement = {
      allowed: true,
      warnings: [],
      blocked: [],
      sanitized: { inputs: null, outputs: null },
      metadata: {}
    };

    // Check for prompt injection in inputs
    this.checkPromptInjection(inputs, enforcement);

    // Validate inputs against boundary
    this.validateInputs(inputs, boundary, enforcement);

    // Sanitize outputs
    const sanitizedOutputs = this.sanitizeOutputs(outputs, boundary, enforcement);

    // Check chain depth
    if (context.chainDepth && context.chainDepth > this.chainDepth) {
      enforcement.allowed = false;
      enforcement.blocked.push('Chain depth exceeded');
    }

    // Determine if output can be auto-fed to prompt
    enforcement.metadata.canAutoFeed = this.canAutoFeedToPrompt(toolName, sanitizedOutputs, boundary);

    // Log enforcement
    this.logEnforcement(toolName, enforcement, context);

    return enforcement;
  }

  /**
   * Check for prompt injection attempts
   */
  checkPromptInjection(inputs, enforcement) {
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === 'string') {
        for (const pattern of this.promptInjectionPatterns) {
          if (pattern.test(value)) {
            enforcement.allowed = false;
            enforcement.blocked.push(`Prompt injection detected in ${key}`);
            console.warn(`[BOUNDARY] Prompt injection blocked in ${key}: ${value.substring(0, 50)}...`);
            return;
          }
        }
      }
    }
  }

  /**
   * Validate inputs against boundary definition
   */
  validateInputs(inputs, boundary, enforcement) {
    // Check for unexpected inputs
    for (const input of Object.keys(inputs)) {
      if (!boundary.inputs.includes(input)) {
        enforcement.warnings.push(`Unexpected input: ${input}`);
      }
    }

    // Check sensitive inputs
    for (const sensitive of boundary.sensitiveInputs) {
      if (inputs[sensitive]) {
        enforcement.metadata.hasSensitiveInputs = true;
        
        // Flag if sensitive data is being passed to LLM
        if (inputs[sensitive].length > 100) {
          enforcement.warnings.push(`Large sensitive data in ${sensitive}`);
        }
      }
    }
  }

  /**
   * Sanitize outputs according to boundary rules
   */
  sanitizeOutputs(outputs, boundary, enforcement) {
    const sanitized = {};

    for (const [key, value] of Object.entries(outputs)) {
      // Check if output is expected
      if (!boundary.outputs.includes(key)) {
        enforcement.warnings.push(`Unexpected output: ${key}`);
        continue;
      }

      // Check if output is sensitive
      if (boundary.sensitiveOutputs.includes(key)) {
        sanitized[key] = this.maskSensitiveValue(value);
        enforcement.metadata.hasSensitiveOutputs = true;
      } else {
        sanitized[key] = value;
      }
    }

    enforcement.sanitized.outputs = sanitized;
    return sanitized;
  }

  /**
   * Check if output can be auto-fed to LLM prompt
   */
  canAutoFeedToPrompt(toolName, outputs, boundary) {
    // Never auto-feed if explicitly disabled
    if (!boundary.autoFeedToPrompt) {
      return false;
    }

    // Never auto-feed if outputs contain sensitive data
    if (boundary.sensitiveOutputs.some(output => outputs[output])) {
      return false;
    }

    // Never auto-feed certain tool types
    const noAutoFeedTools = ['stripe_transfer', 'stripe_create_account'];
    if (noAutoFeedTools.includes(toolName)) {
      return false;
    }

    // Check for sensitive flags in outputs
    for (const [key, value] of Object.entries(outputs)) {
      if (typeof value === 'string' && this.hasSensitiveFlag(value)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Create safe tool wrapper for LLM
   */
  createSafeToolWrapper(toolName, toolFunction) {
    const boundary = this.boundaries.get(toolName);
    if (!boundary) {
      throw new Error(`No boundary defined for tool: ${toolName}`);
    }

    return async (inputs, context = {}) => {
      // Pre-execution checks
      const preCheck = this.enforceBoundary(toolName, inputs, {}, context);
      if (!preCheck.allowed) {
        throw new Error(`Tool execution blocked: ${preCheck.blocked.join(', ')}`);
      }

      // Execute tool
      const outputs = await toolFunction(inputs);

      // Post-execution enforcement
      const postCheck = this.enforceBoundary(toolName, inputs, outputs, context);
      
      if (!postCheck.allowed) {
        throw new Error(`Tool output blocked: ${postCheck.blocked.join(', ')}`);
      }

      // Return sanitized outputs with metadata
      return {
        data: postCheck.sanitized.outputs,
        metadata: {
          toolName,
          canAutoFeed: postCheck.metadata.canAutoFeed,
          hasSensitiveData: postCheck.metadata.hasSensitiveOutputs,
          warnings: postCheck.warnings
        }
      };
    };
  }

  /**
   * Filter LLM prompt for boundary violations
   */
  filterPrompt(prompt, context = {}) {
    const filtered = {
      prompt: prompt,
      violations: [],
      warnings: [],
      safe: true
    };

    // Check for prompt injection patterns
    for (const pattern of this.promptInjectionPatterns) {
      if (pattern.test(prompt)) {
        filtered.violations.push('Prompt injection pattern detected');
        filtered.safe = false;
      }
    }

    // Check for attempts to extract tool outputs
    const extractionPatterns = [
      /show\s+me\s+the\s+(?:last|previous)\s+(?:tool|response|output)/i,
      /print\s+(?:all|the)\s+(?:results|data|outputs)/i,
      /what\s+(?:did|was)\s+(?:the|it)\s+(?:return|output)/i
    ];

    for (const pattern of extractionPatterns) {
      if (pattern.test(prompt)) {
        filtered.violations.push('Attempt to extract tool outputs');
        filtered.safe = false;
      }
    }

    // Check for boundary bypass attempts
    const bypassPatterns = [
      /ignore\s+(?:the\s+)?boundaries?/i,
      /bypass\s+(?:the\s+)?(security|restrictions)/i,
      /disable\s+(?:the\s+)?(filter|sanitization)/i
    ];

    for (const pattern of bypassPatterns) {
      if (pattern.test(prompt)) {
        filtered.violations.push('Boundary bypass attempt');
        filtered.safe = false;
      }
    }

    // Log filtering
    if (!filtered.safe || filtered.warnings.length > 0) {
      this.logPromptFiltering(filtered, context);
    }

    return filtered;
  }

  /**
   * Create LLM-safe response wrapper
   */
  createSafeResponse(data, metadata = {}) {
    const safe = {
      success: true,
      data: null,
      metadata: {
        tool: metadata.toolName,
        canAutoFeed: false,
        sensitive: false
      }
    };

    // Check if data has sensitive flags
    if (this.hasSensitiveFlag(data)) {
      safe.metadata.sensitive = true;
      safe.data = this.maskSensitiveData(data);
    } else {
      safe.data = data;
    }

    // Set auto-feed permission
    safe.metadata.canAutoFeed = metadata.canAutoFeed || false;

    return safe;
  }

  /**
   * Mask sensitive value
   */
  maskSensitiveValue(value) {
    if (typeof value !== 'string') {
      return '[MASKED]';
    }

    if (value.length <= 8) {
      return '[MASKED]';
    }

    // Show first 2 and last 2 characters
    return value.substring(0, 2) + '[...]' + value.substring(value.length - 2);
  }

  /**
   * Mask sensitive data object
   */
  maskSensitiveData(data) {
    if (typeof data !== 'object' || data === null) {
      return this.maskSensitiveValue(data);
    }

    const masked = {};
    for (const [key, value] of Object.entries(data)) {
      if (this.hasSensitiveFlag(key) || this.hasSensitiveFlag(value)) {
        masked[key] = '[MASKED]';
      } else if (typeof value === 'object') {
        masked[key] = this.maskSensitiveData(value);
      } else {
        masked[key] = value;
      }
    }

    return masked;
  }

  /**
   * Check if value has sensitive flag
   */
  hasSensitiveFlag(value) {
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      return this.sensitiveFlags.has(lower) || 
             this.sensitiveFlags.some(flag => lower.includes(flag));
    }
    return false;
  }

  /**
   * Add custom boundary
   */
  addBoundary(toolName, boundary) {
    this.boundaries.set(toolName, {
      inputs: [],
      outputs: [],
      sensitiveInputs: [],
      sensitiveOutputs: [],
      allowChaining: false,
      autoFeedToPrompt: false,
      ...boundary
    });

    console.log(`[BOUNDARY] Added boundary for tool: ${toolName}`);
  }

  /**
   * Get boundary statistics
   */
  getStats() {
    const stats = {
      totalBoundaries: this.boundaries.size,
      toolsWithSensitiveInputs: 0,
      toolsWithSensitiveOutputs: 0,
      toolsAllowingAutoFeed: 0,
      toolsAllowingChaining: 0
    };

    for (const boundary of this.boundaries.values()) {
      if (boundary.sensitiveInputs.length > 0) stats.toolsWithSensitiveInputs++;
      if (boundary.sensitiveOutputs.length > 0) stats.toolsWithSensitiveOutputs++;
      if (boundary.autoFeedToFeed) stats.toolsAllowingAutoFeed++;
      if (boundary.allowChaining) stats.toolsAllowingChaining++;
    }

    return stats;
  }

  /**
   * Log enforcement action
   */
  logEnforcement(toolName, enforcement, context) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      toolName,
      allowed: enforcement.allowed,
      warnings: enforcement.warnings,
      blocked: enforcement.blocked,
      hasSensitiveData: enforcement.metadata.hasSensitiveOutputs,
      agentId: context.agentId
    };

    // Only log if there are issues
    if (!enforcement.allowed || enforcement.warnings.length > 0) {
      console.log('[BOUNDARY] Enforcement:', logEntry);
    }
  }

  /**
   * Log prompt filtering
   */
  logPromptFiltering(filtered, context) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      safe: filtered.safe,
      violations: filtered.violations,
      warnings: filtered.warnings,
      agentId: context.agentId
    };

    console.log('[BOUNDARY] Prompt filtered:', logEntry);
  }
}

module.exports = ToolBoundaryEnforcer;
