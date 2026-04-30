// Event Integrity Firewall - Deterministic Truth Enforcement
// Prevents system from lying to itself through strict event architecture

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

const EVENT_CLASSES = {
  CORE_EVENT: 'core_event',
  DERIVED_EVENT: 'derived_event', 
  SYSTEM_EVENT: 'system_event'
};

const VALIDATION_RULES = {
  [EVENT_CLASSES.CORE_EVENT]: {
    required_fields: ['event_id', 'type', 'source', 'timestamp', 'payload'],
    forbidden_types: ['hyve_opportunity_detected', 'cascade_validation_event', 'hyve_event_rejected'],
    uuid_required: true,
    timestamp_immutable: true,
    payload_non_null: true
  },
  [EVENT_CLASSES.DERIVED_EVENT]: {
    required_fields: ['event_id', 'type', 'source_event_id', 'timestamp', 'payload'],
    allowed_types: ['hyve_opportunity_detected', 'opportunity_classification', 'inference_result'],
    uuid_required: true,
    timestamp_immutable: false,
    payload_non_null: true
  },
  [EVENT_CLASSES.SYSTEM_EVENT]: {
    required_fields: ['event_id', 'type', 'timestamp', 'payload'],
    allowed_types: ['validation_violation_detected', 'event_conflict_detected', 'system_integrity_alert'],
    uuid_required: true,
    timestamp_immutable: false,
    payload_non_null: false
  }
};

class EventIntegrityFirewall extends EventEmitter {
  constructor() {
    super();
    
    // Event lineage tracking
    this.eventLineage = new Map(); // event_id -> { origin_chain, depth, class }
    this.loopDetection = new Map(); // hash -> count
    this.canonicalEvents = new Map(); // event_id -> canonical representation
    
    // System integrity metrics
    this.integrityMetrics = {
      total_events: 0,
      validation_violations: 0,
      circular_attempts: 0,
      classification_violations: 0,
      conflict_detections: 0
    };
    
    // Initialize validation schemas
    this.initializeSchemas();
  }

  initializeSchemas() {
    // UUID validation regex
    this.UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    // Event class detection patterns
    this.CLASS_PATTERNS = {
      [EVENT_CLASSES.CORE_EVENT]: [
        /^user_/,
        /^external_/,
        /^api_/,
        /^webhook_/
      ],
      [EVENT_CLASSES.DERIVED_EVENT]: [
        /^hyve_opportunity_detected/,
        /^opportunity_/,
        /^inference_/,
        /^classification_/
      ],
      [EVENT_CLASSES.SYSTEM_EVENT]: [
        /^validation_violation/,
        /^system_integrity/,
        /^event_conflict/,
        /^pipeline_health/
      ]
    };
  }

  /**
   * Primary event validation gate - enforces deterministic truth
   */
  validateEvent(event, proposedClass = null) {
    this.integrityMetrics.total_events++;
    
    // Step 1: Detect event class if not provided
    const eventClass = proposedClass || this.detectEventClass(event);
    
    // Step 2: Schema-first validation
    const schemaValidation = this.validateSchema(event, eventClass);
    if (!schemaValidation.valid) {
      return this.emitViolation('validation_violation_detected', {
        event_id: event.event_id || 'unknown',
        violations: schemaValidation.violations,
        proposed_class: eventClass,
        event: event
      });
    }
    
    // Step 3: UUID integrity enforcement
    const uuidValidation = this.validateUUID(event);
    if (!uuidValidation.valid) {
      return this.emitViolation('validation_violation_detected', {
        event_id: event.event_id,
        violations: uuidValidation.violations,
        reason: 'UUID integrity failure'
      });
    }
    
    // Step 4: Timestamp immutability rules
    const timestampValidation = this.validateTimestamp(event, eventClass);
    if (!timestampValidation.valid) {
      return this.emitViolation('validation_violation_detected', {
        event_id: event.event_id,
        violations: timestampValidation.violations,
        reason: 'Timestamp immutability violation'
      });
    }
    
    // Step 5: Anti-circular event logic
    const circularityCheck = this.checkCircularity(event, eventClass);
    if (!circularityCheck.safe) {
      this.integrityMetrics.circular_attempts++;
      return this.emitViolation('validation_violation_detected', {
        event_id: event.event_id,
        violations: circularityCheck.violations,
        reason: 'Circular event logic detected',
        loop_depth: circularityCheck.depth
      });
    }
    
    // Step 6: Check for canonical representation conflicts
    const conflictCheck = this.checkEventConflict(event);
    if (conflictCheck.conflict) {
      this.integrityMetrics.conflict_detections++;
      return this.emitViolation('event_conflict_detected', {
        event_id: event.event_id,
        existing_event: conflictCheck.existing,
        new_event: event,
        conflict_reason: conflictCheck.reason
      });
    }
    
    // Step 7: Update lineage tracking
    this.updateEventLineage(event, eventClass);
    
    // Step 8: Store canonical representation
    this.storeCanonicalEvent(event);
    
    return {
      status: 'accepted',
      event_class: eventClass,
      event_id: event.event_id,
      validated_at: new Date().toISOString(),
      lineage: this.eventLineage.get(event.event_id),
      integrity_score: this.calculateIntegrityScore()
    };
  }

  /**
   * Detect event class based on type patterns
   */
  detectEventClass(event) {
    const eventType = event.type || '';
    
    for (const [eventClass, patterns] of Object.entries(this.CLASS_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(eventType)) {
          return eventClass;
        }
      }
    }
    
    // Default to CORE_EVENT for unknown types
    return EVENT_CLASSES.CORE_EVENT;
  }

  /**
   * Schema-first validation (never payload-first)
   */
  validateSchema(event, eventClass) {
    const rules = VALIDATION_RULES[eventClass];
    const violations = [];
    
    if (!rules) {
      violations.push(`Unknown event class: ${eventClass}`);
      return { valid: false, violations };
    }
    
    // Check required fields
    for (const field of rules.required_fields) {
      if (!(field in event)) {
        violations.push(`Missing required field: ${field}`);
      }
    }
    
    // Check forbidden/allowed types
    if (rules.forbidden_types && rules.forbidden_types.includes(event.type)) {
      violations.push(`Forbidden event type for class ${eventClass}: ${event.type}`);
      this.integrityMetrics.classification_violations++;
    }
    
    if (rules.allowed_types && !rules.allowed_types.includes(event.type)) {
      violations.push(`Event type not allowed for class ${eventClass}: ${event.type}`);
      this.integrityMetrics.classification_violations++;
    }
    
    // UUID requirement
    if (rules.uuid_required && !this.UUID_REGEX.test(event.event_id)) {
      violations.push(`Invalid UUID format: ${event.event_id}`);
    }
    
    // Payload non-null enforcement
    if (rules.payload_non_null && (event.payload === undefined || event.payload === null)) {
      violations.push('Payload cannot be null or undefined');
    }
    
    return {
      valid: violations.length === 0,
      violations
    };
  }

  /**
   * UUID integrity enforcement
   */
  validateUUID(event) {
    const violations = [];
    
    if (!event.event_id) {
      violations.push('Missing event_id');
      return { valid: false, violations };
    }
    
    if (!this.UUID_REGEX.test(event.event_id)) {
      violations.push(`Invalid UUID format: ${event.event_id}`);
    }
    
    return {
      valid: violations.length === 0,
      violations
    };
  }

  /**
   * Timestamp immutability rules
   */
  validateTimestamp(event, eventClass) {
    const violations = [];
    const rules = VALIDATION_RULES[eventClass];
    
    if (!event.timestamp) {
      violations.push('Missing timestamp');
      return { valid: false, violations };
    }
    
    // Check timestamp format
    const timestamp = new Date(event.timestamp);
    if (isNaN(timestamp.getTime())) {
      violations.push(`Invalid timestamp format: ${event.timestamp}`);
      return { valid: false, violations };
    }
    
    // Enforce immutability for core events
    if (rules.timestamp_immutable) {
      const now = new Date();
      const maxAge = 60000; // 1 minute tolerance
      
      if (Math.abs(now.getTime() - timestamp.getTime()) > maxAge) {
        violations.push('Core event timestamp too far from present (immutability violation)');
      }
    }
    
    return {
      valid: violations.length === 0,
      violations
    };
  }

  /**
   * Anti-circular event logic detection
   */
  checkCircularity(event, eventClass) {
    const violations = [];
    
    // Create event signature for loop detection
    const signature = this.createEventSignature(event);
    const currentDepth = this.loopDetection.get(signature) || 0;
    
    // Enforce recursion depth cap (max 2 hops)
    if (currentDepth >= 2) {
      violations.push(`Maximum recursion depth exceeded: ${currentDepth}`);
      return { 
        safe: false, 
        violations, 
        depth: currentDepth 
      };
    }
    
    // Check for derived events re-entering core pipeline
    if (eventClass === EVENT_CLASSES.DERIVED_EVENT) {
      const corePatterns = this.CLASS_PATTERNS[EVENT_CLASSES.CORE_EVENT];
      for (const pattern of corePatterns) {
        if (pattern.test(event.type)) {
          violations.push(`Derived event attempting to re-enter core pipeline: ${event.type}`);
          this.integrityMetrics.classification_violations++;
        }
      }
    }
    
    // Update loop detection registry
    this.loopDetection.set(signature, currentDepth + 1);
    
    return {
      safe: violations.length === 0,
      violations,
      depth: currentDepth + 1
    };
  }

  /**
   * Create event signature for loop detection
   */
  createEventSignature(event) {
    const signature = {
      type: event.type,
      source: event.source || 'unknown',
      payload_hash: this.hashPayload(event.payload || {})
    };
    
    return JSON.stringify(signature);
  }

  /**
   * Hash payload for signature creation
   */
  hashPayload(payload) {
    const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
    let hash = 0;
    for (let i = 0; i < payloadString.length; i++) {
      const char = payloadString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Check for canonical representation conflicts
   */
  checkEventConflict(event) {
    const existing = this.canonicalEvents.get(event.event_id);
    
    if (!existing) {
      return { conflict: false };
    }
    
    // Compare events for conflicts
    const conflicts = [];
    
    if (existing.type !== event.type) {
      conflicts.push(`Type mismatch: ${existing.type} vs ${event.type}`);
    }
    
    if (JSON.stringify(existing.payload) !== JSON.stringify(event.payload)) {
      conflicts.push('Payload mismatch');
    }
    
    if (conflicts.length > 0) {
      return {
        conflict: true,
        existing,
        reason: conflicts.join('; ')
      };
    }
    
    return { conflict: false };
  }

  /**
   * Update event lineage tracking
   */
  updateEventLineage(event, eventClass) {
    const lineage = {
      event_id: event.event_id,
      event_class: eventClass,
      origin_chain: [event.type],
      depth: 0,
      parent_event_id: event.source_event_id || null,
      created_at: new Date().toISOString()
    };
    
    // Build origin chain from parent if exists
    if (event.source_event_id && this.eventLineage.has(event.source_event_id)) {
      const parentLineage = this.eventLineage.get(event.source_event_id);
      lineage.origin_chain = [...parentLineage.origin_chain, event.type];
      lineage.depth = parentLineage.depth + 1;
    }
    
    this.eventLineage.set(event.event_id, lineage);
  }

  /**
   * Store canonical event representation
   */
  storeCanonicalEvent(event) {
    const canonical = {
      event_id: event.event_id,
      type: event.type,
      source: event.source,
      timestamp: event.timestamp,
      payload: JSON.parse(JSON.stringify(event.payload)), // Deep copy
      stored_at: new Date().toISOString()
    };
    
    this.canonicalEvents.set(event.event_id, canonical);
  }

  /**
   * Emit violation event
   */
  emitViolation(violationType, violationData) {
    this.integrityMetrics.validation_violations++;
    
    const violationEvent = {
      type: violationType,
      event_id: uuidv4(),
      timestamp: new Date().toISOString(),
      payload: violationData
    };
    
    this.emit('violation_detected', violationEvent);
    
    return {
      status: 'rejected',
      reason: violationType,
      violations: violationData.violations || [],
      event_id: violationData.event_id,
      violation_reason: violationData.reason || violationType
    };
  }

  /**
   * Calculate system integrity score
   */
  calculateIntegrityScore() {
    const total = this.integrityMetrics.total_events;
    if (total === 0) return 1.0;
    
    const violations = this.integrityMetrics.validation_violations + 
                      this.integrityMetrics.circular_attempts + 
                      this.integrityMetrics.classification_violations;
    
    return Math.max(0, 1.0 - (violations / total));
  }

  /**
   * Generate pipeline health report
   */
  generatePipelineHealthReport() {
    const integrityScore = this.calculateIntegrityScore();
    
    return {
      system_integrity_score: integrityScore,
      pipeline_health: integrityScore > 0.9 ? 'healthy' : integrityScore > 0.7 ? 'degraded' : 'critical',
      metrics: { ...this.integrityMetrics },
      event_classes: {
        core_events: Array.from(this.eventLineage.values()).filter(l => l.event_class === EVENT_CLASSES.CORE_EVENT).length,
        derived_events: Array.from(this.eventLineage.values()).filter(l => l.event_class === EVENT_CLASSES.DERIVED_EVENT).length,
        system_events: Array.from(this.eventLineage.values()).filter(l => l.event_class === EVENT_CLASSES.SYSTEM_EVENT).length
      },
      loop_registry_size: this.loopDetection.size,
      canonical_events: this.canonicalEvents.size,
      generated_at: new Date().toISOString()
    };
  }

  /**
   * Get schema drift alerts
   */
  getSchemaDriftAlerts() {
    const alerts = [];
    
    // Check for high violation rate
    if (this.integrityMetrics.total_events > 0) {
      const violationRate = this.integrityMetrics.validation_violations / this.integrityMetrics.total_events;
      if (violationRate > 0.1) {
        alerts.push({
          type: 'high_violation_rate',
          severity: 'high',
          message: `Validation violation rate: ${(violationRate * 100).toFixed(2)}%`,
          threshold: 0.1,
          actual: violationRate
        });
      }
    }
    
    // Check for circular logic attempts
    if (this.integrityMetrics.circular_attempts > 5) {
      alerts.push({
        type: 'circular_logic_detected',
        severity: 'medium',
        message: `Circular logic attempts: ${this.integrityMetrics.circular_attempts}`,
        threshold: 5,
        actual: this.integrityMetrics.circular_attempts
      });
    }
    
    // Check for classification violations
    if (this.integrityMetrics.classification_violations > 3) {
      alerts.push({
        type: 'classification_violations',
        severity: 'medium',
        message: `Event classification violations: ${this.integrityMetrics.classification_violations}`,
        threshold: 3,
        actual: this.integrityMetrics.classification_violations
      });
    }
    
    return alerts;
  }

  /**
   * Enforce Ursula integration contract (broadcast only)
   */
  validateUrsulaContract(event) {
    // Ursula must be broadcast only (no mutation)
    const violations = [];
    
    if (event.ursula_action && event.ursula_action !== 'broadcast') {
      violations.push(`Ursula violation: non-broadcast action detected: ${event.ursula_action}`);
    }
    
    // Ursula can only receive finalized derived events
    if (event.ursula_recipient) {
      const eventClass = this.detectEventClass(event);
      if (eventClass !== EVENT_CLASSES.DERIVED_EVENT) {
        violations.push(`Ursula violation: received non-derived event class: ${eventClass}`);
      }
    }
    
    return {
      valid: violations.length === 0,
      violations
    };
  }

  /**
   * Clear lineage for cleanup (prevent memory leaks)
   */
  cleanupLineage(maxAge = 3600000) { // 1 hour default
    const now = Date.now();
    const toDelete = [];
    
    for (const [eventId, lineage] of this.eventLineage) {
      const age = now - new Date(lineage.created_at).getTime();
      if (age > maxAge) {
        toDelete.push(eventId);
      }
    }
    
    toDelete.forEach(eventId => {
      this.eventLineage.delete(eventId);
      this.canonicalEvents.delete(eventId);
    });
    
    return { cleaned: toDelete.length };
  }
}

// Export singleton instance
const eventIntegrityFirewall = new EventIntegrityFirewall();
module.exports = { eventIntegrityFirewall, EventIntegrityFirewall };
