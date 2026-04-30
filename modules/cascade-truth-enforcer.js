// Cascade - System Orchestration & Truth Layer for ProtoForge
// Enforces correctness, routing, and structural integrity across all event processing systems

const { EventEmitter } = require('events');

class CascadeTruthEnforcer extends EventEmitter {
  constructor() {
    super();
    
    // Canonical schema requirements
    this.canonicalSchema = {
      required_fields: ['event_id', 'type', 'source', 'timestamp', 'payload'],
      timestamp_format: 'ISO-8601-UTC',
      uuid_pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    };
    
    // Opportunity classification thresholds
    this.opportunityThresholds = {
      decision_maker_indicators: ['decision_maker', 'budget_authority', 'cfo', 'cto', 'ceo', 'procurement'],
      revenue_threshold: 100000, // $100k minimum
      procurement_indicators: ['procurement', 'purchase_order', 'rfp', 'contract', 'agreement']
    };
    
    // Pipeline state control
    this.pipelineState = {
      integrity_score: 1.0,
      drift_level: 0,
      violation_count: 0,
      classification_confidence_avg: 0,
      system_state: 'operational',
      total_events: 0,
      accepted_events: 0,
      rejected_events: 0
    };
    
    // Event routing categories
    this.eventCategories = {
      core_event: ['system_critical', 'security_alert', 'data_breach', 'production_incident'],
      derived_event: ['opportunity_detected', 'classification_result', 'insight_generated'],
      noise_event: ['page_view', 'social_engagement', 'email_open', 'site_visit']
    };
  }

  /**
   * EVENT TRUTH ENFORCEMENT
   * Validate event against canonical schema
   */
  validateEventTruth(event) {
    const violations = [];
    
    // Check required fields
    for (const field of this.canonicalSchema.required_fields) {
      if (!event[field]) {
        violations.push(`Missing required field: ${field}`);
      }
    }
    
    // Validate UUID format
    if (event.event_id && !this.canonicalSchema.uuid_pattern.test(event.event_id)) {
      violations.push('Invalid UUID format for event_id');
    }
    
    // Validate timestamp format
    if (event.timestamp) {
      const timestamp = new Date(event.timestamp);
      if (isNaN(timestamp.getTime())) {
        violations.push('Invalid timestamp format - must be ISO-8601');
      } else {
        // Normalize to UTC
        event.timestamp = timestamp.toISOString();
      }
    }
    
    // Validate payload is not null
    if (event.payload === null || event.payload === undefined) {
      violations.push('Payload cannot be null or undefined');
    }
    
    return {
      valid: violations.length === 0,
      violations: violations,
      normalized_event: violations.length === 0 ? event : null
    };
  }

  /**
   * OPPORTUNITY CLASSIFICATION GOVERNOR
   * Only output opportunity when ALL conditions are met
   */
  classifyOpportunity(event) {
    const payload = event.payload || {};
    const text = JSON.stringify(payload).toLowerCase();
    
    // Check for decision-maker or budget authority
    const hasDecisionMaker = this.opportunityThresholds.decision_maker_indicators.some(indicator => 
      text.includes(indicator.toLowerCase())
    );
    
    // Check for revenue signal
    const hasRevenueSignal = this.extractRevenueValue(payload) > this.opportunityThresholds.revenue_threshold;
    
    // Check for procurement intent
    const hasProcurementIntent = this.opportunityThresholds.procurement_indicators.some(indicator => 
      text.includes(indicator.toLowerCase())
    );
    
    // Calculate confidence
    let confidence = 0;
    let score = 0;
    let indicators = [];
    
    if (hasDecisionMaker) {
      confidence += 0.4;
      indicators.push('decision_maker');
    }
    
    if (hasRevenueSignal) {
      confidence += 0.4;
      indicators.push('revenue_signal');
      score = this.extractRevenueValue(payload);
    }
    
    if (hasProcurementIntent) {
      confidence += 0.2;
      indicators.push('procurement_intent');
    }
    
    // Only classify as opportunity if ALL conditions are met
    const isOpportunity = hasDecisionMaker && (hasRevenueSignal || hasProcurementIntent);
    
    if (isOpportunity && confidence >= 0.6) {
      return {
        opportunity_type: 'high_value',
        confidence: confidence,
        score: score,
        indicators: indicators,
        explanation: `Opportunity detected: decision_maker=${hasDecisionMaker}, revenue_signal=${hasRevenueSignal}, procurement_intent=${hasProcurementIntent}`
      };
    }
    
    return {
      opportunity_type: 'none',
      confidence: 0,
      score: 0,
      indicators: [],
      explanation: 'No opportunity detected - missing required conditions'
    };
  }

  /**
   * Extract revenue value from payload
   */
  extractRevenueValue(payload) {
    const revenueFields = ['approved_amount', 'budget', 'value', 'amount', 'price', 'cost'];
    
    for (const field of revenueFields) {
      if (payload[field]) {
        const value = parseFloat(payload[field]);
        if (!isNaN(value) && value > 0) {
          return value;
        }
      }
    }
    
    return 0;
  }

  /**
   * PIPELINE STATE CONTROL
   * Maintain global pipeline state
   */
  updatePipelineState(validationResult, classification) {
    this.pipelineState.total_events++;
    
    if (validationResult.valid) {
      this.pipelineState.accepted_events++;
    } else {
      this.pipelineState.rejected_events++;
      this.pipelineState.violation_count++;
    }
    
    // Update integrity score
    const acceptanceRate = this.pipelineState.accepted_events / this.pipelineState.total_events;
    this.pipelineState.integrity_score = acceptanceRate;
    
    // Update classification confidence average
    if (classification.confidence > 0) {
      const totalConfidence = this.pipelineState.classification_confidence_avg * (this.pipelineState.total_events - 1) + classification.confidence;
      this.pipelineState.classification_confidence_avg = totalConfidence / this.pipelineState.total_events;
    }
    
    // Update system state based on integrity score
    if (this.pipelineState.integrity_score < 0.85) {
      this.pipelineState.system_state = 'degraded';
      this.pipelineState.drift_level = 1 - this.pipelineState.integrity_score;
    } else {
      this.pipelineState.system_state = 'operational';
      this.pipelineState.drift_level = 0;
    }
  }

  /**
   * EVENT ROUTING RULES
   * Route events into exactly one category
   */
  routeEvent(event) {
    const eventType = event.type.toLowerCase();
    
    // Check core events first (highest priority)
    for (const coreType of this.eventCategories.core_event) {
      if (eventType.includes(coreType.toLowerCase())) {
        return 'core_event';
      }
    }
    
    // Check derived events
    for (const derivedType of this.eventCategories.derived_event) {
      if (eventType.includes(derivedType.toLowerCase())) {
        return 'derived_event';
      }
    }
    
    // Check noise events
    for (const noiseType of this.eventCategories.noise_event) {
      if (eventType.includes(noiseType.toLowerCase())) {
        return 'noise_event';
      }
    }
    
    // Default to core_event for unknown types (safety first)
    return 'core_event';
  }

  /**
   * Main event processing method
   */
  processEvent(event) {
    // Step 1: Event Truth Enforcement
    const validationResult = this.validateEventTruth(event);
    
    if (!validationResult.valid) {
      this.updatePipelineState(validationResult, { confidence: 0 });
      
      return {
        event_id: event.event_id || 'unknown',
        status: 'rejected',
        classification: {
          opportunity_type: 'none',
          confidence: 0,
          explanation: 'Event rejected due to validation failures'
        },
        integrity_snapshot: this.getIntegritySnapshot(),
        routing_decision: 'none',
        reason_if_rejected: validationResult.violations.join('; ')
      };
    }
    
    const normalizedEvent = validationResult.normalized_event;
    
    // Step 2: Opportunity Classification Governor
    const classification = this.classifyOpportunity(normalizedEvent);
    
    // Step 3: Pipeline State Control
    this.updatePipelineState(validationResult, classification);
    
    // Step 4: Event Routing Rules
    const routingDecision = this.routeEvent(normalizedEvent);
    
    // Step 5: Determine final status
    let status = 'accepted';
    if (this.pipelineState.system_state === 'degraded') {
      status = 'degraded';
    }
    
    return {
      event_id: normalizedEvent.event_id,
      status: status,
      classification: classification,
      integrity_snapshot: this.getIntegritySnapshot(),
      routing_decision: routingDecision,
      reason_if_rejected: null
    };
  }

  /**
   * Get current integrity snapshot
   */
  getIntegritySnapshot() {
    return {
      integrity_score: this.pipelineState.integrity_score,
      drift_level: this.pipelineState.drift_level,
      violation_count: this.pipelineState.violation_count,
      classification_confidence_avg: this.pipelineState.classification_confidence_avg,
      system_state: this.pipelineState.system_state,
      total_events: this.pipelineState.total_events,
      accepted_events: this.pipelineState.accepted_events,
      rejected_events: this.pipelineState.rejected_events
    };
  }

  /**
   * FAILURE MODE DISCIPLINE
   * Handle downstream system failures
   */
  handleDownstreamFailure(event, error, downstreamSystem) {
    const failureEvent = {
      type: 'downstream_failure',
      event_id: `failure_${Date.now()}`,
      timestamp: new Date().toISOString(),
      payload: {
        original_event_id: event.event_id,
        downstream_system: downstreamSystem,
        error_message: error.message,
        error_type: error.constructor.name,
        timestamp: new Date().toISOString()
      }
    };
    
    this.emit('downstream_failure', failureEvent);
    
    return {
      event_id: event.event_id,
      status: 'processed_but_unpersisted',
      classification: {
        opportunity_type: 'none',
        confidence: 0,
        explanation: 'Event processed but failed to persist due to downstream failure'
      },
      integrity_snapshot: this.getIntegritySnapshot(),
      routing_decision: 'none',
      reason_if_rejected: `Downstream failure in ${downstreamSystem}: ${error.message}`
    };
  }

  /**
   * Reset pipeline state (for testing/recovery)
   */
  resetPipelineState() {
    this.pipelineState = {
      integrity_score: 1.0,
      drift_level: 0,
      violation_count: 0,
      classification_confidence_avg: 0,
      system_state: 'operational',
      total_events: 0,
      accepted_events: 0,
      rejected_events: 0
    };
  }

  /**
   * Get pipeline statistics
   */
  getPipelineStats() {
    return {
      ...this.getIntegritySnapshot(),
      acceptance_rate: this.pipelineState.total_events > 0 ? 
        this.pipelineState.accepted_events / this.pipelineState.total_events : 0,
      rejection_rate: this.pipelineState.total_events > 0 ? 
        this.pipelineState.rejected_events / this.pipelineState.total_events : 0
    };
  }
}

// Export singleton instance
const cascadeTruthEnforcer = new CascadeTruthEnforcer();
module.exports = cascadeTruthEnforcer;
