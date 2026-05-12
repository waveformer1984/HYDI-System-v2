// Event Contract Versioning System
const { v4: uuidv4 } = require('uuid');

// Event Schema Registry
const EVENT_CONTRACTS = {
  // v1.0.0 - Initial schema
  '1.0.0': {
    required: ['event_id', 'type', 'status', 'timestamp', 'payload', 'source', 'retry_count'],
    optional: ['ai_analysis', 'failure_reason', 'final_failure_at', 'state_history'],
    payload_schema: 'object',
    status_enum: ['pending', 'processed', 'failed', 'permanently_failed']
  },
  
  // v1.1.0 - Added metadata
  '1.1.0': {
    required: ['event_id', 'type', 'status', 'timestamp', 'payload', 'source', 'retry_count', 'schema_version'],
    optional: ['ai_analysis', 'failure_reason', 'final_failure_at', 'state_history', 'metadata'],
    payload_schema: 'object',
    status_enum: ['pending', 'processed', 'failed', 'permanently_failed'],
    metadata: {
      environment: 'string',
      version: 'string',
      correlation_id: 'string'
    }
  },
  
  // Current version
  '1.2.0': {
    required: ['event_id', 'type', 'status', 'timestamp', 'payload', 'source', 'retry_count', 'schema_version', 'correlation_id'],
    optional: ['ai_analysis', 'failure_reason', 'final_failure_at', 'state_history', 'metadata'],
    payload_schema: 'object',
    status_enum: ['pending', 'processed', 'failed', 'permanently_failed'],
    metadata: {
      environment: 'string',
      version: 'string',
      correlation_id: 'string',
      trace_id: 'string'
    }
  }
};

// Current contract version
const CURRENT_VERSION = '1.2.0';

class EventContractValidator {
  constructor() {
    this.currentVersion = CURRENT_VERSION;
    this.contracts = EVENT_CONTRACTS;
  }

  validateEvent(event, targetVersion = null) {
    const version = targetVersion || event.schema_version || this.currentVersion;
    const contract = this.contracts[version];
    
    if (!contract) {
      throw new Error(`Unsupported schema version: ${version}`);
    }
    
    const errors = [];
    const warnings = [];
    
    // Check required fields
    for (const field of contract.required) {
      if (!(field in event)) {
        errors.push(`Missing required field: ${field}`);
      } else if (event[field] === null || event[field] === undefined) {
        errors.push(`Required field cannot be null/undefined: ${field}`);
      }
    }
    
    // Check field types
    if (event.type && typeof event.type !== 'string') {
      errors.push('Event type must be a string');
    }
    
    if (event.status && !contract.status_enum.includes(event.status)) {
      errors.push(`Invalid status: ${event.status}. Must be one of: ${contract.status_enum.join(', ')}`);
    }
    
    if (event.timestamp && !this.isValidTimestamp(event.timestamp)) {
      errors.push('Invalid timestamp format');
    }
    
    if (event.payload && typeof event.payload !== 'object') {
      errors.push('Payload must be an object');
    }
    
    // Check for deprecated fields
    if (version === '1.2.0' && !event.correlation_id) {
      warnings.push('correlation_id is recommended in v1.2.0');
    }
    
    // Auto-migrate if needed
    const migratedEvent = this.migrateEvent(event, version);
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      event: migratedEvent,
      version
    };
  }
  
  migrateEvent(event, fromVersion) {
    let migrated = { ...event };
    
    // Add missing fields with defaults
    const contract = this.contracts[this.currentVersion];
    
    for (const field of contract.required) {
      if (!(field in migrated)) {
        if (field === 'schema_version') {
          migrated[field] = this.currentVersion;
        } else if (field === 'correlation_id') {
          migrated[field] = event.event_id || uuidv4();
        } else if (field === 'retry_count') {
          migrated[field] = 0;
        } else if (field === 'source') {
          migrated[field] = 'unknown';
        } else if (field === 'status') {
          migrated[field] = 'pending';
        }
      }
    }
    
    // Add metadata if missing
    if (!migrated.metadata) {
      migrated.metadata = {
        environment: process.env.NODE_ENV || 'development',
        version: process.env.VERSION || '1.0.0',
        correlation_id: migrated.correlation_id || migrated.event_id,
        trace_id: uuidv4()
      };
    }
    
    return migrated;
  }
  
  isValidTimestamp(timestamp) {
    try {
      const date = new Date(timestamp);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  }
  
  createEvent(type, payload, options = {}) {
    const event = {
      event_id: options.event_id || uuidv4(),
      type,
      status: 'pending',
      timestamp: new Date().toISOString(),
      payload,
      source: options.source || 'system',
      retry_count: 0,
      schema_version: this.currentVersion,
      correlation_id: options.correlation_id || uuidv4(),
      metadata: {
        environment: process.env.NODE_ENV || 'development',
        version: process.env.VERSION || '1.0.0',
        trace_id: uuidv4(),
        ...options.metadata
      }
    };
    
    return this.validateEvent(event);
  }
}

module.exports = { EventContractValidator, EVENT_CONTRACTS, CURRENT_VERSION };
