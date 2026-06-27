/**
 * SCHEMA VERIFIER (HOSTILE VERIFIER)
 * 
 * Assumes every decision output is trying to break the execution layer
 */

import { createHash } from 'crypto';

class SchemaVerifier {
  constructor() {
    this.approvedSchemas = new Map();
    this.verificationLog = [];
    this.strictMode = true;
    
    this.initializeSchemas();
  }
  
  initializeSchemas() {
    // Define strict schemas - no heuristics, no interpretation
    this.approvedSchemas.set('transfer_funds', {
      name: 'transfer_funds',
      required: ['user_id', 'amount', 'destination', 'signature'],
      optional: ['description', 'reference'],
      types: {
        user_id: 'string',
        amount: 'number',
        destination: 'string',
        signature: 'string',
        description: 'string',
        reference: 'string'
      },
      constraints: {
        amount: { min: 0.01, max: 1000000 },
        user_id: { minLength: 1, maxLength: 100 },
        destination: { minLength: 1, maxLength: 100 },
        signature: { minLength: 64, maxLength: 64, pattern: /^[a-f0-9]+$/ }
      }
    });
    
    this.approvedSchemas.set('send_message', {
      name: 'send_message',
      required: ['channel', 'content', 'signature'],
      optional: ['priority', 'metadata'],
      types: {
        channel: 'string',
        content: 'string',
        signature: 'string',
        priority: 'string',
        metadata: 'object'
      },
      constraints: {
        channel: { allowedValues: ['email', 'sms', 'push', 'internal'] },
        content: { minLength: 1, maxLength: 10000 },
        signature: { minLength: 64, maxLength: 64, pattern: /^[a-f0-9]+$/ }
      }
    });
    
    this.approvedSchemas.set('delete_record', {
      name: 'delete_record',
      required: ['record_id', 'source_verified'],
      optional: ['reason', 'approver'],
      types: {
        record_id: 'string',
        source_verified: 'boolean',
        reason: 'string',
        approver: 'string'
      },
      constraints: {
        record_id: { minLength: 1, maxLength: 100 },
        source_verified: { type: 'boolean' },
        reason: { maxLength: 500 },
        approver: { minLength: 1, maxLength: 100 }
      }
    });
    
    this.approvedSchemas.set('general_query', {
      name: 'general_query',
      required: ['query'],
      optional: ['context'],
      types: {
        query: 'string',
        context: 'object'
      },
      constraints: {
        query: { minLength: 1, maxLength: 1000 },
        context: { maxKeys: 10 }
      }
    });
  }
  
  verify(proposal, requestId = null) {
    const verification = {
      valid: false,
      errors: [],
      warnings: [],
      canonical: null,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: requestId || 'unknown',
        verifier: 'schema_verifier',
        strictMode: this.strictMode
      }
    };
    
    try {
      // Step 1: Check if action type exists
      const schema = this.approvedSchemas.get(proposal.actionType);
      if (!schema) {
        verification.errors.push(`Unknown action type: ${proposal.actionType}`);
        this.logVerification(proposal, verification);
        return verification;
      }
      
      // Step 2: Strip all non-schema metadata (hostile assumption)
      const stripped = this.stripNonSchemaFields(proposal, schema);
      
      // Step 3: Validate required fields
      for (const field of schema.required) {
        if (!(field in stripped)) {
          verification.errors.push(`Missing required field: ${field}`);
        }
      }
      
      // Step 4: Validate types strictly
      for (const [field, expectedType] of Object.entries(schema.types)) {
        if (field in stripped) {
          const actualType = typeof stripped[field];
          
          // Special handling for boolean (typeof null === 'object')
          if (expectedType === 'boolean') {
            if (stripped[field] !== true && stripped[field] !== false) {
              verification.errors.push(`Field ${field} must be boolean, got ${actualType}`);
            }
          } else if (actualType !== expectedType) {
            verification.errors.push(`Field ${field} must be ${expectedType}, got ${actualType}`);
          }
        }
      }
      
      // Step 5: Validate constraints
      for (const [field, constraint] of Object.entries(schema.constraints)) {
        if (field in stripped) {
          const value = stripped[field];
          const constraintErrors = this.validateConstraint(field, value, constraint);
          verification.errors.push(...constraintErrors);
        }
      }
      
      // Step 6: Check for hostile patterns
      const hostileChecks = this.checkHostilePatterns(stripped);
      verification.errors.push(...hostileChecks);
      
      // Step 7: Create canonical form
      if (verification.errors.length === 0) {
        verification.canonical = this.createCanonicalForm(stripped, schema);
        verification.valid = true;
      }
      
    } catch (error) {
      verification.errors.push('Verification failed: ' + error.message);
    }
    
    this.logVerification(proposal, verification);
    return verification;
  }
  
  stripNonSchemaFields(proposal, schema) {
    const stripped = {};
    
    // Only keep schema-defined fields
    const allowedFields = [...schema.required, ...(schema.optional || [])];
    
    for (const field of allowedFields) {
      if (field in proposal) {
        stripped[field] = proposal[field];
      }
    }
    
    return stripped;
  }
  
  validateConstraint(field, value, constraint) {
    const errors = [];
    
    if (constraint.min !== undefined && value < constraint.min) {
      errors.push(`Field ${field} below minimum: ${value} < ${constraint.min}`);
    }
    
    if (constraint.max !== undefined && value > constraint.max) {
      errors.push(`Field ${field} above maximum: ${value} > ${constraint.max}`);
    }
    
    if (constraint.minLength !== undefined && value.length < constraint.minLength) {
      errors.push(`Field ${field} below minimum length: ${value.length} < ${constraint.minLength}`);
    }
    
    if (constraint.maxLength !== undefined && value.length > constraint.maxLength) {
      errors.push(`Field ${field} above maximum length: ${value.length} > ${constraint.maxLength}`);
    }
    
    if (constraint.allowedValues && !constraint.allowedValues.includes(value)) {
      errors.push(`Field ${field} not in allowed values: ${value} not in [${constraint.allowedValues.join(', ')}]`);
    }
    
    if (constraint.pattern && !constraint.pattern.test(value)) {
      errors.push(`Field ${field} does not match required pattern`);
    }
    
    if (constraint.maxKeys && typeof value === 'object' && Object.keys(value).length > constraint.maxKeys) {
      errors.push(`Field ${field} has too many keys: ${Object.keys(value).length} > ${constraint.maxKeys}`);
    }
    
    return errors;
  }
  
  checkHostilePatterns(proposal) {
    const errors = [];
    
    // Check for suspicious field names
    const suspiciousFields = ['__proto__', 'constructor', 'prototype', 'eval', 'Function'];
    for (const field of Object.keys(proposal)) {
      if (suspiciousFields.includes(field)) {
        errors.push(`Hostile field name detected: ${field}`);
      }
    }
    
    // Check for code injection patterns
    for (const [field, value] of Object.entries(proposal)) {
      if (typeof value === 'string') {
        if (value.includes('eval(') || value.includes('Function(') || value.includes('setTimeout(')) {
          errors.push(`Code injection pattern in field ${field}`);
        }
      }
    }
    
    // Check for JSON injection
    const jsonStr = JSON.stringify(proposal);
    if (jsonStr.includes('\u0000') || jsonStr.includes('\u2028') || jsonStr.includes('\u2029')) {
      errors.push('Unicode injection pattern detected');
    }
    
    return errors;
  }
  
  createCanonicalForm(proposal, schema) {
    // Create deterministic canonical form
    const canonical = {};
    
    // Sort fields by name
    const sortedFields = [...schema.required, ...(schema.optional || [])].sort();
    
    for (const field of sortedFields) {
      if (field in proposal) {
        // Normalize values
        canonical[field] = this.normalizeValue(proposal[field], schema.types[field]);
      }
    }
    
    // Add hash for integrity
    canonical._hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    canonical._schema = schema.name;
    canonical._verified = new Date().toISOString();
    
    return canonical;
  }
  
  normalizeValue(value, type) {
    switch (type) {
      case 'string':
        return value.trim();
      case 'number':
        return Number(value);
      case 'boolean':
        return Boolean(value);
      case 'object':
        if (value === null) return null;
        return JSON.parse(JSON.stringify(value)); // Deep clone
      default:
        return value;
    }
  }
  
  logVerification(proposal, verification) {
    const logEntry = {
      timestamp: verification.metadata.timestamp,
      requestId: verification.metadata.requestId,
      input: {
        actionType: proposal.actionType,
        fieldCount: Object.keys(proposal).length,
        hasSignature: 'signature' in proposal
      },
      output: {
        valid: verification.valid,
        errorCount: verification.errors.length,
        warningCount: verification.warnings.length,
        hasCanonical: verification.canonical !== null
      },
      errors: verification.errors,
      warnings: verification.warnings
    };
    
    this.verificationLog.push(logEntry);
    
    // Keep log size manageable
    if (this.verificationLog.length > 1000) {
      this.verificationLog = this.verificationLog.slice(-1000);
    }
  }
  
  getVerificationLog() {
    return [...this.verificationLog];
  }
  
  getApprovedSchemas() {
    const schemas = {};
    for (const [key, value] of this.approvedSchemas) {
      schemas[key] = {
        name: value.name,
        required: value.required,
        optional: value.optional,
        types: value.types,
        constraints: value.constraints
      };
    }
    return schemas;
  }
  
  setStrictMode(enabled) {
    this.strictMode = enabled;
  }
}

export default SchemaVerifier;
