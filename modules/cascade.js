// Cascade Validation Gate for ProtoForge
// Implements schema validation for events and emits validation results

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CascadeValidator extends EventEmitter {
  constructor() {
    super();
    this.validationRules = {
      event_id: (value) => typeof value === 'string' && UUID_REGEX.test(value),
      type: (value) => typeof value === 'string' && value.length > 0,
      source: (value) => typeof value === 'string' && value.length > 0,
      timestamp: (value) => {
        // Accepts ISO string or numeric timestamp
        if (typeof value === 'string') {
          return !isNaN(Date.parse(value));
        }
        if (typeof value === 'number') {
          return !isNaN(value) && value > 0;
        }
        return false;
      },
      payload: (value) => value !== undefined && value !== null
    };
    
    // Opportunity classification rules
    this.opportunityRules = {
      // High-value opportunity indicators
      high_value: [
        'purchase_intent',
        'budget_approved', 
        'decision_maker',
        'urgent_timeline',
        'rfp_request',
        'partnership_inquiry',
        'closed_deal',
        'enterprise',
        'cto',
        'cfo', 
        'chief_financial_officer',
        'chief_technology_officer',
        'production_incident',
        'revenue_systems',
        'strategic_partnership',
        'mega_deal',
        'crisis_event',
        'compliance_violation',
        'data_breach'
      ],
      
      // Medium-value opportunity indicators  
      medium_value: [
        'demo_request',
        'trial_signup',
        'contact_form',
        'newsletter_signup',
        'webinar_registration'
      ],
      
      // Low-value opportunity indicators
      low_value: [
        'page_view',
        'content_download',
        'social_engagement',
        'email_open',
        'site_visit'
      ]
    };
  }

  /**
   * Classify opportunity based on event content
   * @param {Object} event - The validated event
   * @returns {Object} Opportunity classification with confidence score
   */
  classifyOpportunity(event) {
    const payload = event.payload || {};
    const eventType = event.type || '';
    const source = event.source || '';
    
    let opportunityScore = 0;
    let opportunityType = 'none';
    let confidence = 0;
    let indicators = [];
    
    // Check event type against opportunity rules
    const allIndicators = [
      ...this.opportunityRules.high_value,
      ...this.opportunityRules.medium_value,
      ...this.opportunityRules.low_value
    ];
    
    // Find matching indicators in event type, source, and payload
    const textToCheck = `${eventType} ${source} ${JSON.stringify(payload)}`.toLowerCase();
    
    for (const indicator of allIndicators) {
      if (textToCheck.includes(indicator.toLowerCase())) {
        indicators.push(indicator);
        
        // Score based on category
        if (this.opportunityRules.high_value.includes(indicator)) {
          opportunityScore += 30;
        } else if (this.opportunityRules.medium_value.includes(indicator)) {
          opportunityScore += 15;
        } else if (this.opportunityRules.low_value.includes(indicator)) {
          opportunityScore += 5;
        }
      }
    }
    
    // Determine opportunity type and confidence
    if (opportunityScore >= 30) {
      opportunityType = 'high_value';
      confidence = Math.min(opportunityScore / 35, 0.95);
    } else if (opportunityScore >= 15) {
      opportunityType = 'medium_value';
      confidence = Math.min(opportunityScore / 25, 0.85);
    } else if (opportunityScore >= 5) {
      opportunityType = 'low_value';
      confidence = Math.min(opportunityScore / 15, 0.75);
    }
    
    return {
      opportunity_type: opportunityType,
      confidence: confidence,
      score: opportunityScore,
      indicators: indicators,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Emit hyve_opportunity_detected event
   * @param {Object} event - The original validated event
   * @param {Object} opportunity - The opportunity classification
   */
  emitOpportunityEvent(event, opportunity) {
    const opportunityEvent = {
      type: 'hyve_opportunity_detected',
      event_id: uuidv4(),
      source_event_id: event.event_id,
      timestamp: new Date().toISOString(),
      payload: {
        original_event: event,
        opportunity_classification: opportunity,
        detected_at: new Date().toISOString(),
        action_required: opportunity.opportunity_type !== 'none'
      }
    };
    
    this.emit('hyve_opportunity_detected', opportunityEvent);
    return opportunityEvent;
  }

  /**
   * Validate an event against the schema and classify opportunities
   * @param {Object} event - The event to validate
   * @returns {Object} Validation result with opportunity classification
   */
  validateEvent(event) {
    // Prevent processing internal validation events
    if (event.type === 'cascade_validation_event' || 
        event.type === 'hyve_opportunity_detected' ||
        event.type === 'hyve_event_rejected') {
      return {
        type: 'cascade_validation_event',
        status: 'skipped',
        confidence: 0,
        reason: 'Internal system event - not processed',
        timestamp: new Date().toISOString()
      };
    }

    const errors = [];
    const actions = [];

    // Check each required field
    for (const [field, validator] of Object.entries(this.validationRules)) {
      if (!(field in event)) {
        errors.push(`Missing required field: ${field}`);
        actions.push(`Add ${field} field`);
        continue;
      }

      if (!validator(event[field])) {
        errors.push(`Invalid ${field}: ${JSON.stringify(event[field])}`);
        actions.push(this.getFixAction(field, event[field]));
      }
    }

    if (errors.length === 0) {
      // Valid event - emit cascade_validation_event with status: accepted
      const validationEvent = {
        type: 'cascade_validation_event',
        status: 'accepted',
        confidence: 1.0,
        event_id: event.event_id,
        timestamp: new Date().toISOString(),
        payload: event
      };
      this.emit('validation_event', validationEvent);
      
      // Classify opportunity for valid events
      const opportunity = this.classifyOpportunity(event);
      
      // Emit hyve_opportunity_detected if opportunity found
      if (opportunity.opportunity_type !== 'none') {
        const opportunityEvent = this.emitOpportunityEvent(event, opportunity);
        return {
          type: 'cascade_validation_event',
          status: 'accepted',
          confidence: 1.0,
          event_id: event.event_id,
          timestamp: new Date().toISOString(),
          opportunity_event: opportunityEvent
        };
      }
      
      return {
        type: 'cascade_validation_event',
        status: 'accepted',
        confidence: 1.0,
        event_id: event.event_id,
        timestamp: new Date().toISOString()
      };
    } else {
      // Invalid event - emit cascade_validation_event with status: rejected
      const validationEvent = {
        type: 'cascade_validation_event',
        status: 'rejected',
        confidence: 0,
        errors: errors,
        actions: actions,
        timestamp: new Date().toISOString()
      };
      this.emit('validation_event', validationEvent);
      return {
        type: 'cascade_validation_event',
        status: 'rejected',
        confidence: 0,
        reason: errors.join('; '),
        actions: actions,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get specific fix action for a field
   * @param {string} field - The field name
   * @param {*} value - The invalid value
   * @returns {string} Suggested action to fix the field
   */
  getFixAction(field, value) {
    switch (field) {
      case 'event_id':
        return 'Provide a valid UUID (e.g., "123e4567-e89b-12d3-a456-426614174000")';
      case 'type':
        return 'Provide a non-empty string for event type';
      case 'source':
        return 'Provide a non-empty string for event source';
      case 'timestamp':
        return 'Provide a valid ISO timestamp string or positive numeric timestamp';
      case 'payload':
        return 'Provide a payload object (cannot be undefined or null)';
      default:
        return `Fix the ${field} field`;
    }
  }

  /**
   * Bridge HEIDI's processing - route through validation
   * @param {Function} heidiProcess - The original heidi.process function
   * @returns {Function} Wrapped function that includes validation
   */
  bridgeHeidiProcessing(heidiProcess) {
    return async function(event) {
      // First validate the event
      const validationResult = this.validateEvent(event);
      
      if (validationResult.status === 'rejected') {
        // Return early with validation failure
        return {
          confidence: 0,
          contradiction_check: 'Event failed validation',
          actions: validationResult.actions,
          validation: validationResult
        };
      }
      
      // If valid, proceed with HEIDI processing
      try {
        const heidiResult = await heidiProcess.call(this, event);
        
        // Add confidence score and contradiction check to result
        return {
          ...heidiResult,
          confidence: heidiResult.confidence || 0.8, // Default if not provided
          contradiction_check: heidiResult.contradiction_check || 'No contradictions detected',
          validation: {
            confidence: 1.0,
            status: 'accepted'
          }
        };
      } catch (error) {
        return {
          confidence: 0,
          contradiction_check: `HEIDI processing failed: ${error.message}`,
          error: error.message,
          validation: {
            confidence: 1.0,
            status: 'accepted'
          }
        };
      }
    }.bind(this);
  }
}

// Create a singleton instance
const cascadeInstance = new CascadeValidator();

module.exports = {
  CascadeValidator,
  cascade: cascadeInstance,
  validateEvent: cascadeInstance.validateEvent.bind(cascadeInstance)
};