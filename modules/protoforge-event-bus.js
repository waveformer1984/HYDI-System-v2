// ProtoForge Event Bus - Central event coordination system
// Integrates HEIDI + KILO + URSULA + HYVE validation gate

const { EventEmitter } = require('events');
const { cascade } = require('./cascade');
const { eventIntegrityFirewall } = require('./event-integrity-firewall');
const cascadeEvolutionProtocol = require('./cascade-evolution-protocol');
const protoforgePrimeDirective = require('./protoforge-prime-directive');
const { v4: uuidv4 } = require('uuid');

class ProtoForgeEventBus extends EventEmitter {
  constructor() {
    super();
    this.eventStreams = new Map();
    this.subscribers = new Map();
    this.heidiProcessor = null;
    this.kiloNode = null;
    this.ursulaSSE = null;
    this.hyveValidator = cascade;
    this.integrityFirewall = eventIntegrityFirewall;
    this.evolutionProtocol = cascadeEvolutionProtocol;
    this.primeDirective = protoforgePrimeDirective;
    
    // Event flow pipeline with deterministic truth enforcement
    this.pipeline = {
      integrity_check: this.checkEventIntegrity.bind(this),
      validate: this.validateEvent.bind(this),
      classify: this.classifyEvent.bind(this),
      emit: this.emitHyveOpportunity.bind(this),
      persist: this.persistEvent.bind(this),
      broadcast: this.broadcastEvent.bind(this)
    };
    
    // Statistics with integrity metrics
    this.stats = {
      eventsProcessed: 0,
      eventsRejected: 0,
      opportunitiesDetected: 0,
      broadcastsSent: 0,
      failures: 0,
      integrityViolations: 0,
      systemIntegrityScore: 1.0
    };
    
    this.initializeEventHandlers();
  }

  initializeEventHandlers() {
    // Listen for cascade validation events
    this.hyveValidator.on('validation_event', (validationEvent) => {
      this.emit('validation_complete', validationEvent);
    });

    // Listen for hyve opportunity events
    this.hyveValidator.on('hyve_opportunity_detected', (opportunityEvent) => {
      this.emit('opportunity_detected', opportunityEvent);
      this.stats.opportunitiesDetected++;
    });

    // Error handling
    this.on('error', (error) => {
      console.error('ProtoForge Event Bus Error:', error);
      this.stats.failures++;
    });

    // Listen for integrity firewall violations
    this.integrityFirewall.on('violation_detected', (violationEvent) => {
      const reason = violationEvent.payload.reason || violationEvent.payload.violation_reason || 'Unknown violation';
      console.error('[INTEGRITY] Violation detected:', reason);
      this.stats.integrityViolations++;
      this.stats.systemIntegrityScore = this.integrityFirewall.calculateIntegrityScore();
      this.emit('integrity_violation', violationEvent);
      
      // Forward to evolution protocol for tracking
      this.evolutionProtocol.emit('violation_detected', violationEvent);
      
      // Update Prime Directive with new integrity score
      this.primeDirective.emit('integrity_score_updated', {
        type: 'integrity_score_updated',
        event_id: `integrity_${Date.now()}`,
        timestamp: new Date().toISOString(),
        integrity_score: this.stats.systemIntegrityScore
      });
    });

    // Listen for evolution protocol events
    this.evolutionProtocol.on('schema_proposal_generated', (proposalEvent) => {
      console.log(`[EVOLUTION] Schema proposal requires Heidi audit: ${proposalEvent.proposal_id}`);
      this.emit('heidi_audit_required', proposalEvent);
    });

    this.evolutionProtocol.on('state_snapshot_generated', (snapshotEvent) => {
      console.log(`[EVOLUTION] State snapshot: ${snapshotEvent.snapshot_id}`);
      this.emit('system_state_snapshot', snapshotEvent);
    });

    this.evolutionProtocol.on('hard_stop_triggered', (hardStopEvent) => {
      console.error('[EVOLUTION] HARD STOP TRIGGERED - Kilo execution blocked');
      this.emit('kilo_execution_blocked', hardStopEvent);
    });

    this.evolutionProtocol.on('unreliable_bandwidth_detected', (bandwidthEvent) => {
      console.warn('[EVOLUTION] Unreliable bandwidth detected - adjusting Kilo priorities');
      this.emit('kilo_priority_adjustment', bandwidthEvent);
    });

    // Listen for Prime Directive events
    this.primeDirective.on('kilo_restriction_activated', (restrictionEvent) => {
      console.error('[PRIME DIRECTIVE] KILO RESTRICTION ACTIVATED - Revenue artifacts blocked');
      this.emit('kilo_execution_restricted', restrictionEvent);
    });

    this.primeDirective.on('kilo_restriction_deactivated', (restorationEvent) => {
      console.log('[PRIME DIRECTIVE] KILO RESTRICTION DEACTIVATED - Normal operations resumed');
      this.emit('kilo_execution_restored', restorationEvent);
    });

    this.primeDirective.on('artifact_execution_blocked', (blockedEvent) => {
      console.error(`[PRIME DIRECTIVE] Artifact blocked: ${blockedEvent.payload.artifact_type}`);
      this.emit('artifact_blocked', blockedEvent);
    });

    this.primeDirective.on('artifact_execution_allowed', (allowedEvent) => {
      console.log(`[PRIME DIRECTIVE] Artifact allowed: ${allowedEvent.payload.artifact_type}`);
      this.emit('artifact_allowed', allowedEvent);
    });
  }

  /**
   * Main event processing pipeline - enforces deterministic truth
   * integrity_check -> validate -> classify -> emit -> persist -> broadcast
   */
  async processEvent(event) {
    try {
      // HARD SEPARATION: Derived events never enter validation again
      if (event.type === 'cascade_validation_event' || 
          event.type === 'hyve_opportunity_detected' ||
          event.type === 'hyve_event_rejected') {
        console.log(`[PROTOFORGE] HARD SEPARATION: Skipping derived event: ${event.type}`);
        return { status: 'skipped', reason: 'Derived event - validation bypass' };
      }
      
      // Additional derived event patterns to bypass validation
      const derivedEventPatterns = [
        /^opportunity_/,
        /^inference_/, 
        /^classification_/,
        /^system_integrity_/
      ];
      
      const isDerivedEvent = derivedEventPatterns.some(pattern => pattern.test(event.type));
      if (isDerivedEvent) {
        console.log(`[PROTOFORGE] HARD SEPARATION: Bypassing validation for derived event: ${event.type}`);
        // Persist derived events directly without validation
        await this.pipeline.persist(event, { status: 'accepted' }, {}, null);
        return { status: 'processed', reason: 'Derived event - direct persistence' };
      }

      this.stats.eventsProcessed++;
      
      console.log(`[PROTOFORGE] Processing event: ${event.event_id}`);
      
      // STEP 0: Integrity Check (deterministic truth enforcement)
      const integrityResult = await this.pipeline.integrity_check(event);
      if (integrityResult.status === 'rejected') {
        this.stats.eventsRejected++;
        console.error(`[INTEGRITY] Event rejected: ${integrityResult.reason}`);
        return { status: 'rejected', reason: integrityResult.reason, violations: integrityResult.violations };
      }
      
      // STEP 1: Validate
      const validationResult = await this.pipeline.validate(event);
      if (validationResult.status === 'rejected') {
        this.stats.eventsRejected++;
        await this.emitRejectionEvent(event, validationResult);
        return { status: 'rejected', reason: validationResult.reason };
      }

      // STEP 2: Classify
      const classification = await this.pipeline.classify(event);
      
      // STEP 3: Emit (if opportunity)
      let opportunityEvent = null;
      if (classification.opportunity_type !== 'none') {
        opportunityEvent = await this.pipeline.emit(event, classification);
        
        // Enforce Prime Directive on artifact execution
        if (opportunityEvent && opportunityEvent.payload.artifact_type) {
          const primeDirectiveCheck = this.primeDirective.enforcePrimeDirective({
            event_id: opportunityEvent.event_id,
            artifact_type: opportunityEvent.payload.artifact_type,
            timestamp: opportunityEvent.timestamp
          });
          
          if (primeDirectiveCheck.status === 'blocked') {
            console.error('[PRIME DIRECTIVE] Opportunity blocked due to integrity restrictions');
            // Still emit the opportunity but mark as restricted
            opportunityEvent.payload.prime_directive_restricted = true;
            opportunityEvent.payload.restriction_reason = primeDirectiveCheck.reason;
          }
        }
      }

      // STEP 4: Persist
      await this.pipeline.persist(event, validationResult, classification, opportunityEvent);

      // STEP 5: Broadcast to all subscribers with Ursula contract enforcement
      await this.pipeline.broadcast(event, validationResult, classification, opportunityEvent);

      // Notify evolution protocol of processed event
      this.evolutionProtocol.emit('event_processed', event);

      return {
        status: 'processed',
        validation: validationResult,
        classification: classification,
        opportunity: opportunityEvent
      };

    } catch (error) {
      this.stats.failures++;
      this.emit('error', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * STEP 0: Check event integrity through firewall
   */
  async checkEventIntegrity(event) {
    return this.integrityFirewall.validateEvent(event);
  }

  /**
   * STEP 1: Validate event through cascade
   */
  async validateEvent(event) {
    return this.hyveValidator.validateEvent(event);
  }

  /**
   * STEP 2: Classify event (enhanced with real confidence scoring)
   */
  async classifyEvent(event) {
    if (!event.payload) {
      return { opportunity_type: 'none', confidence: 0, score: 0, indicators: [] };
    }

    // Enhanced classification with real payload analysis
    const classification = this.hyveValidator.classifyOpportunity(event);
    
    // Add structural integrity scoring
    const structuralScore = this.calculateStructuralIntegrity(event);
    const completenessScore = this.calculateCompleteness(event);
    const noveltyScore = this.calculateNoveltySignals(event);
    
    // Real confidence derived from multiple factors
    const realConfidence = (
      classification.confidence * 0.4 +  // Base classification
      structuralScore * 0.3 +           // Structural integrity
      completenessScore * 0.2 +         // Data completeness
      noveltyScore * 0.1               // Novelty signals
    );

    return {
      ...classification,
      confidence: Math.min(realConfidence, 0.95),
      structural_integrity: structuralScore,
      completeness: completenessScore,
      novelty: noveltyScore
    };
  }

  /**
   * STEP 3: Emit hyve opportunity with proper contract
   */
  async emitHyveOpportunity(event, classification) {
    // Only emit if real confidence threshold is met
    if (classification.confidence < 0.3) {
      return null;
    }

    const opportunityEvent = {
      type: 'hyve_opportunity_detected',
      event_id: uuidv4(),
      source_event_id: event.event_id,
      timestamp: new Date().toISOString(),
      payload: {
        original_event: event,
        opportunity_classification: classification,
        detected_at: new Date().toISOString(),
        action_required: classification.opportunity_type !== 'none',
        // Phase 5: KILO handoff contract
        execution_required: true,
        artifact_type: this.determineArtifactType(classification),
        minimal_build_spec: this.generateBuildSpec(event, classification)
      }
    };

    this.emit('hyve_opportunity_detected', opportunityEvent);
    return opportunityEvent;
  }

  /**
   * STEP 4: Persist events to storage
   */
  async persistEvent(event, validation, classification, opportunity) {
    try {
      // In real implementation, this would persist to database
      console.log(`[PERSIST] Event ${event.event_id}: ${validation.status}`);
      
      if (opportunity) {
        console.log(`[PERSIST] Opportunity ${opportunity.event_id}: ${classification.opportunity_type}`);
      }
      
      // Check for infrastructure failures during persistence
      // This is where we would detect MODULE_NOT_FOUND or TypeError
      if (validation.error) {
        if (validation.error.includes('MODULE_NOT_FOUND') || 
            validation.error.includes('Cannot read properties of undefined')) {
          
          // Emit infrastructure failure event
          this.emit('system_event', {
            type: 'INFRASTRUCTURE_FAILURE',
            severity: 'CRITICAL',
            target: 'PersistenceLayer',
            action: 'SUSPEND_SELF_BUILD',
            event_id: `infra_${Date.now()}`,
            timestamp: new Date().toISOString(),
            payload: {
              original_error: validation.error,
              affected_event: event.event_id,
              diagnosis: 'Database connection or module import failure'
            }
          });
          
          console.error('[CASCADE] INFRASTRUCTURE FAILURE DETECTED - Suspending self-build');
          return { status: 'infrastructure_failure', error: validation.error };
        }
      }
      
      return { status: 'persisted' };
      
    } catch (error) {
      // Detect infrastructure failures in catch block
      if (error.code === 'MODULE_NOT_FOUND' || error instanceof TypeError) {
        this.emit('system_event', {
          type: 'INFRASTRUCTURE_FAILURE',
          severity: 'CRITICAL',
          target: 'PersistenceLayer',
          action: 'SUSPEND_SELF_BUILD',
          event_id: `infra_${Date.now()}`,
          timestamp: new Date().toISOString(),
          payload: {
            original_error: error.message,
            error_code: error.code,
            diagnosis: 'Critical infrastructure component missing'
          }
        });
        
        console.error('[CASCADE] INFRASTRUCTURE FAILURE DETECTED - Suspending self-build');
      }
      
      throw error;
    }
  }

  /**
   * STEP 5: Broadcast to all subscribers with Ursula contract enforcement
   */
  async broadcastEvent(event, validation, classification, opportunity) {
    const broadcastData = {
      event_id: event.event_id,
      validation_status: validation.status,
      opportunity_type: classification.opportunity_type,
      timestamp: new Date().toISOString()
    };

    // Validate Ursula contract (broadcast only)
    const ursulaContractCheck = this.integrityFirewall.validateUrsulaContract(broadcastData);
    if (!ursulaContractCheck.valid) {
      console.error('[URSULA] Contract violation:', ursulaContractCheck.violations);
      this.emit('ursula_contract_violation', {
        event_id: event.event_id,
        violations: ursulaContractCheck.violations
      });
      return;
    }

    // Broadcast to all subscribers
    this.emit('broadcast', broadcastData);
    this.stats.broadcastsSent++;

    // Specific broadcasts
    if (opportunity) {
      // Ensure opportunity events are marked for Ursula broadcast only
      const ursulaOpportunity = {
        ...opportunity,
        ursula_action: 'broadcast',
        ursula_recipient: true,
        broadcast_timestamp: new Date().toISOString()
      };
      
      const opportunityContractCheck = this.integrityFirewall.validateUrsulaContract(ursulaOpportunity);
      if (opportunityContractCheck.valid) {
        this.emit('opportunity_broadcast', ursulaOpportunity);
        // Track Ursula broadcast latency for evolution protocol
        this.evolutionProtocol.emit('ursula_broadcast', ursulaOpportunity);
      } else {
        console.error('[URSULA] Opportunity contract violation:', opportunityContractCheck.violations);
      }
    }
  }

  /**
   * Calculate structural integrity score
   */
  calculateStructuralIntegrity(event) {
    let score = 0;
    
    // Check required fields
    const requiredFields = ['event_id', 'type', 'source', 'timestamp', 'payload'];
    const presentFields = requiredFields.filter(field => event[field]);
    score += (presentFields.length / requiredFields.length) * 0.4;
    
    // Check UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (UUID_REGEX.test(event.event_id)) score += 0.3;
    
    // Check timestamp validity
    if (!isNaN(Date.parse(event.timestamp))) score += 0.3;
    
    return Math.min(score, 1.0);
  }

  /**
   * Calculate completeness score
   */
  calculateCompleteness(event) {
    if (!event.payload) return 0;
    
    const payloadFields = Object.keys(event.payload);
    const nonEmptyFields = payloadFields.filter(key => {
      const value = event.payload[key];
      return value !== null && value !== undefined && value !== '';
    });
    
    return Math.min((nonEmptyFields.length / Math.max(payloadFields.length, 1)), 1.0);
  }

  /**
   * Calculate novelty signals
   */
  calculateNoveltySignals(event) {
    let novelty = 0;
    
    // Check for unique combinations
    const eventSignature = `${event.type}:${event.source}`;
    if (!this.eventStreams.has(eventSignature)) {
      novelty += 0.5;
      this.eventStreams.set(eventSignature, 1);
    } else {
      this.eventStreams.set(eventSignature, this.eventStreams.get(eventSignature) + 1);
      novelty = Math.max(0, 0.5 - (this.eventStreams.get(eventSignature) * 0.1));
    }
    
    // Check for high-value indicators
    const highValueIndicators = ['urgent', 'immediate', 'critical', 'emergency'];
    const eventText = JSON.stringify(event).toLowerCase();
    const foundIndicators = highValueIndicators.filter(indicator => eventText.includes(indicator));
    novelty += foundIndicators.length * 0.1;
    
    return Math.min(novelty, 1.0);
  }

  /**
   * Determine artifact type for KILO handoff
   */
  determineArtifactType(classification) {
    const { indicators } = classification;
    
    if (indicators.includes('purchase_intent') || indicators.includes('rfp_request')) {
      return 'service';
    } else if (indicators.includes('demo_request') || indicators.includes('trial_signup')) {
      return 'automation';
    } else if (indicators.includes('content_download') || indicators.includes('page_view')) {
      return 'content';
    } else {
      return 'tool';
    }
  }

  /**
   * Generate minimal build spec for KILO
   */
  generateBuildSpec(event, classification) {
    return {
      priority: classification.opportunity_type,
      confidence: classification.confidence,
      indicators: classification.indicators,
      requirements: {
        validation_passed: true,
        structural_integrity: classification.structural_integrity,
        completeness: classification.completeness,
        novelty: classification.novelty
      },
      execution_context: {
        source_event: event.event_id,
        detected_at: new Date().toISOString(),
        processing_pipeline: 'protoforge_validation_gate'
      }
    };
  }

  /**
   * Emit rejection event for failed validation
   */
  async emitRejectionEvent(event, validationResult) {
    const rejectionEvent = {
      type: 'hyve_event_rejected',
      event_id: uuidv4(),
      source_event_id: event.event_id,
      timestamp: new Date().toISOString(),
      payload: {
        original_event: event,
        validation_result: validationResult,
        rejection_reason: validationResult.reason || validationResult.errors?.join('; '),
        rejected_at: new Date().toISOString()
      }
    };

    this.emit('event_rejected', rejectionEvent);
    await this.persistEvent(event, validationResult, {}, null);
  }

  /**
   * Subscribe to event streams
   */
  subscribe(eventType, callback) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType).add(callback);
    
    this.on(eventType, callback);
    
    return () => {
      this.subscribers.get(eventType)?.delete(callback);
      this.off(eventType, callback);
    };
  }

  /**
   * Get system statistics with integrity reporting
   */
  getStats() {
    const pipelineHealthReport = this.integrityFirewall.generatePipelineHealthReport();
    const schemaDriftAlerts = this.integrityFirewall.getSchemaDriftAlerts();
    
    const evolutionStatus = this.evolutionProtocol.getEvolutionStatus();
    const primeDirectiveStatus = this.primeDirective.getPrimeDirectiveStatus();
    
    return {
      ...this.stats,
      rejection_rate: this.stats.eventsProcessed > 0 ? 
        (this.stats.eventsRejected / this.stats.eventsProcessed) * 100 : 0,
      opportunity_rate: this.stats.eventsProcessed > 0 ? 
        (this.stats.opportunitiesDetected / this.stats.eventsProcessed) * 100 : 0,
      subscribers: Array.from(this.subscribers.entries()).map(([type, subs]) => ({
        event_type: type,
        subscriber_count: subs.size
      })),
      system_integrity: {
        score: this.stats.systemIntegrityScore,
        pipeline_health: pipelineHealthReport,
        schema_drift_alerts: schemaDriftAlerts,
        violation_events: this.stats.integrityViolations
      },
      evolution_protocol: evolutionStatus,
      prime_directive: primeDirectiveStatus
    };
  }
}

// Export singleton instance
module.exports = new ProtoForgeEventBus();
