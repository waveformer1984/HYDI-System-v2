// CASCADE Schema Lock - Immutable event schema validation
// Rejects any event that does not match canonical format exactly

const crypto = require('crypto');

class CascadeSchemaLock {
  constructor() {
    // Canonical schema definition - IMMUTABLE
    this.canonicalSchema = {
      event_id: { type: 'string', required: true, format: 'uuid' },
      source: { type: 'string', required: true, enum: ['vercel', 'local', 'supabase', 'user', 'system'] },
      type: { type: 'string', required: true, enum: ['error', 'warning', 'info', 'heartbeat', 'request'] },
      payload: { type: 'object', required: true, minKeys: 1 },
      timestamp: { type: 'string', required: true, format: 'iso8601' }
    };
    
    // Schema hash for validation
    this.schemaHash = this.calculateSchemaHash();
    
    // Validation cache
    this.validationCache = new Map();
    this.cacheMaxSize = 1000;
    
    console.log('[SCHEMA LOCK] Initialized with immutable schema hash:', this.schemaHash);
  }

  calculateSchemaHash() {
    const schemaString = JSON.stringify(this.canonicalSchema, Object.keys(this.canonicalSchema).sort());
    return crypto.createHash('sha256').update(schemaString).digest('hex');
  }

  validateEvent(event) {
    // Check cache first
    const cacheKey = this.getEventHash(event);
    if (this.validationCache.has(cacheKey)) {
      return this.validationCache.get(cacheKey);
    }

    const result = this.performValidation(event);
    
    // Update cache
    if (this.validationCache.size >= this.cacheMaxSize) {
      const firstKey = this.validationCache.keys().next().value;
      this.validationCache.delete(firstKey);
    }
    this.validationCache.set(cacheKey, result);
    
    return result;
  }

  performValidation(event) {
    const errors = [];
    const warnings = [];

    // 1. Exact field matching - no extra fields allowed
    const allowedFields = Object.keys(this.canonicalSchema);
    const eventFields = Object.keys(event);
    
    // Check for missing required fields
    for (const [field, rule] of Object.entries(this.canonicalSchema)) {
      if (rule.required && !(field in event)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Check for unexpected fields
    for (const field of eventFields) {
      if (!allowedFields.includes(field)) {
        errors.push(`Unexpected field: ${field}`);
      }
    }

    // 2. Strict type validation
    if (event.event_id) {
      if (typeof event.event_id !== 'string') {
        errors.push('event_id must be string');
      } else if (!this.isValidUUID(event.event_id)) {
        errors.push('event_id must be valid UUID v4');
      }
    }

    if (event.source) {
      if (!this.canonicalSchema.source.enum.includes(event.source)) {
        errors.push(`source must be one of: ${this.canonicalSchema.source.enum.join(', ')}`);
      }
    }

    if (event.type) {
      if (!this.canonicalSchema.type.enum.includes(event.type)) {
        errors.push(`type must be one of: ${this.canonicalSchema.type.enum.join(', ')}`);
      }
    }

    if (event.payload) {
      if (typeof event.payload !== 'object' || Array.isArray(event.payload)) {
        errors.push('payload must be object');
      } else if (Object.keys(event.payload).length === 0) {
        errors.push('payload cannot be empty');
      }
    }

    if (event.timestamp) {
      if (typeof event.timestamp !== 'string') {
        errors.push('timestamp must be string');
      } else if (!this.isValidISO8601(event.timestamp)) {
        errors.push('timestamp must be valid ISO-8601');
      }
    }

    // 3. Schema hash validation
    const eventSchemaHash = event.schema_hash;
    if (eventSchemaHash) {
      if (eventSchemaHash !== this.schemaHash) {
        errors.push(`Schema hash mismatch. Expected: ${this.schemaHash}, Got: ${eventSchemaHash}`);
      }
    } else {
      warnings.push('No schema hash provided - recommended for all events');
    }

    // 4. No implicit field inference
    // Any field not explicitly defined is an error (already checked above)

    const result = {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings,
      schema_hash: this.schemaHash,
      strict_mode: true
    };

    return result;
  }

  getEventHash(event) {
    // Create hash of normalized event for caching
    const normalized = {
      event_id: event.event_id || '',
      source: event.source || '',
      type: event.type || '',
      payload_keys: event.payload ? Object.keys(event.payload).sort() : [],
      timestamp: event.timestamp || ''
    };
    
    return crypto.createHash('md5').update(JSON.stringify(normalized)).digest('hex');
  }

  isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  isValidISO8601(timestamp) {
    if (typeof timestamp !== 'string') return false;
    
    // Check if it's a valid ISO-8601 date
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return false;
    
    // Check for Z or timezone offset
    return timestamp.endsWith('Z') || timestamp.includes('+') || timestamp.includes('-', 10);
  }

  // Add schema hash to event
  addSchemaHash(event) {
    return {
      ...event,
      schema_hash: this.schemaHash,
      validated_at: new Date().toISOString()
    };
  }

  // Get schema information
  getSchemaInfo() {
    return {
      schema_hash: this.schemaHash,
      canonical_schema: this.canonicalSchema,
      cache_size: this.validationCache.size,
      strict_mode: true,
      immutable: true
    };
  }

  // Clear validation cache
  clearCache() {
    this.validationCache.clear();
    console.log('[SCHEMA LOCK] Validation cache cleared');
  }
}

module.exports = CascadeSchemaLock;
