// @deprecated Legacy CASCADE Core. Use protoforge/cascade/src/processor.js or compatibility/cascade-legacy.js.
// Replacement: protoforge/cascade/src/EventProcessor
// Migration: Call EventProcessor.process() on canonical events. Removal target: Phase 5.
//
// CASCADE Core - Strict Event Processing System
// Only does three things: Detect, Classify, Emit structured events

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

class CascadeCore extends EventEmitter {
  constructor() {
    super();
    this.heartbeatInterval = null;
    this.activeModules = new Set();
    this.eventCache = new Map(); // For duplicate detection
    this.quarantine = new Map(); // Quarantine system
    this.classificationRules = this.initializeClassificationRules();
    this.repairManifests = new Map();
    
    // Statistics
    this.stats = {
      eventsProcessed: 0,
      eventsRejected: 0,
      eventsQuarantined: 0,
      repairManifestsGenerated: 0,
      lastHeartbeat: null
    };
  }

  // 1. Event Intake Layer - Normalizes all incoming signals
  normalizeEvent(rawEvent) {
    // Only process if it has required fields
    if (!rawEvent.source || !rawEvent.type || !rawEvent.payload) {
      return null;
    }

    return {
      event_id: rawEvent.event_id || uuidv4(),
      source: rawEvent.source, // vercel | local | supabase | user | system
      type: rawEvent.type, // error | warning | info | heartbeat | request
      payload: rawEvent.payload,
      timestamp: rawEvent.timestamp || new Date().toISOString()
    };
  }

  // 2. Validation Gate
  validateEvent(event) {
    const errors = [];

    // Must have type
    if (!event.type) {
      errors.push('Missing type field');
    }

    // Must have source
    if (!event.source) {
      errors.push('Missing source field');
    }

    // Must have non-empty payload
    if (!event.payload || Object.keys(event.payload).length === 0) {
      errors.push('Empty payload');
    }

    // Duplicate detection (debounce 3-10 seconds)
    const eventKey = `${event.type}:${event.source}:${JSON.stringify(event.payload)}`;
    const now = Date.now();
    if (this.eventCache.has(eventKey)) {
      const lastSeen = this.eventCache.get(eventKey);
      if (now - lastSeen < 5000) { // 5 second debounce
        errors.push('Duplicate event within debounce window');
      }
    }

    // Update cache
    this.eventCache.set(eventKey, now);
    
    // Clean old cache entries (older than 10 seconds)
    this.eventCache.forEach((timestamp, key) => {
      if (now - timestamp > 10000) {
        this.eventCache.delete(key);
      }
    });

    if (errors.length > 0) {
      return {
        valid: false,
        errors: errors,
        action: 'quarantine'
      };
    }

    return { valid: true };
  }

  // 3. Classification Engine - Only assigns specific labels
  classifyEvent(event) {
    const payload = event.payload;
    let classification = 'UNKNOWN_ANOMALY';
    let confidence = 0.5;

    // INFRA_FAILURE detection
    if (payload.error_code === 'MODULE_NOT_FOUND' ||
        payload.error_code === 'ECONNREFUSED' ||
        payload.error?.includes('Cannot resolve module') ||
        payload.service === 'database' && payload.status === 'down') {
      classification = 'INFRA_FAILURE';
      confidence = 0.9;
    }
    // ROUTE_FAILURE detection
    else if (payload.route || payload.endpoint) {
      if (payload.status_code >= 400) {
        classification = 'ROUTE_FAILURE';
        confidence = 0.85;
      }
    }
    // DEPLOYMENT_MISMATCH detection
    else if (payload.env_var_missing || 
             payload.version_mismatch ||
             payload.config_diff) {
      classification = 'DEPLOYMENT_MISMATCH';
      confidence = 0.8;
    }
    // DATA_INTEGRITY_RISK detection
    else if (payload.corruption_detected ||
             payload.checksum_mismatch ||
             payload.data_validation_failed) {
      classification = 'DATA_INTEGRITY_RISK';
      confidence = 0.95;
    }
    // STREAM_BREAK detection
    else if (payload.stream_disconnected ||
             payload.connection_lost ||
             payload.websocket_error) {
      classification = 'STREAM_BREAK';
      confidence = 0.9;
    }

    return {
      event: 'hyve_opportunity_detected',
      classification: classification,
      confidence: confidence
    };
  }

  // 4. Decision Tree - Strict routing based on classification
  routeDecision(classification, event) {
    switch (classification.classification) {
      case 'INFRA_FAILURE':
        // Emit cascade classified event instead of generating repair manifest directly
        this.emit('cascade_classified_event', {
          event: 'cascade_classified_event',
          classification: 'INFRA_FAILURE',
          fingerprint: this.generateFingerprint(event),
          payload: {
            original_event: event,
            issue: 'MODULE_NOT_FOUND',
            priority: 'high'
          }
        });
        return null;
      
      case 'STREAM_BREAK':
        return {
          event: 'cascade_output',
          type: 'actionable_signal',
          target_system: 'backend',
          payload: {
            action: 'restart_stream',
            target: event.payload.stream_id || 'default',
            log_reconnection: true
          }
        };
      
      case 'DEPLOYMENT_MISMATCH':
        return {
          event: 'cascade_output',
          type: 'actionable_signal',
          target_system: 'dashboard',
          payload: {
            action: 'config_audit',
            compare_env_vars: true,
            trigger_audit: true
          }
        };
      
      case 'UNKNOWN_ANOMALY':
        this.quarantineEvent(event, 'unstable_pattern_detected');
        return {
          event: 'quarantined_signal',
          reason: 'unstable_pattern_detected',
          retry_policy: 'manual_review_required'
        };
      
      default:
        return null;
    }
  }

  // 5. Repair Manifest Generator
  generateRepairManifest(event, issue, priority) {
    const manifest = {
      event: 'repair_manifest_generated',
      target: event.payload.module || event.payload.service || 'unknown',
      issue: issue,
      steps: this.getRepairSteps(issue),
      priority: priority,
      timestamp: new Date().toISOString()
    };

    this.repairManifests.set(manifest.target, manifest);
    this.stats.repairManifestsGenerated++;

    return manifest;
  }

  getRepairSteps(issue) {
    const stepMap = {
      'MODULE_NOT_FOUND': [
        'verify_imports',
        'check_package_json',
        'restore_dependency',
        'restart_service'
      ],
      'runtime_error': [
        'check_logs',
        'verify_input_data',
        'rollback_if_needed',
        'restart_service'
      ],
      'env_mismatch': [
        'compare_env_files',
        'update_missing_vars',
        'validate_config',
        'restart_service'
      ]
    };

    return stepMap[issue] || ['investigate', 'log_details', 'escalate_if_needed'];
  }

  // 6. Quarantine System
  quarantineEvent(event, reason) {
    const quarantineRecord = {
      event: event,
      reason: reason,
      timestamp: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3
    };

    this.quarantine.set(event.event_id, quarantineRecord);
    this.stats.eventsQuarantined++;

    this.emit('event_quarantined', quarantineRecord);
  }

  // 7. Heartbeat System
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const heartbeat = {
        event: 'cascade_heartbeat',
        status: 'alive',
        active_modules: Array.from(this.activeModules),
        timestamp: new Date().toISOString(),
        stats: this.stats
      };

      this.stats.lastHeartbeat = heartbeat.timestamp;
      this.emit('heartbeat', heartbeat);
    }, 20000); // Every 20 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // 8. Main Processing Loop
  async processEvent(rawEvent) {
    try {
      // STEP 1: INGEST EVENT
      const event = this.normalizeEvent(rawEvent);
      if (!event) {
        this.stats.eventsRejected++;
        return {
          event: 'cascade_event_rejected',
          reason: 'invalid_format',
          action: 'discard'
        };
      }

      // STEP 2: VALIDATE
      const validation = this.validateEvent(event);
      if (!validation.valid) {
        this.stats.eventsRejected++;
        this.quarantineEvent(event, validation.errors.join('; '));
        return {
          event: 'cascade_event_rejected',
          reason: 'validation_failed',
          action: validation.action
        };
      }

      // STEP 3: CLASSIFY
      const classification = this.classifyEvent(event);

      // STEP 4: ROUTE DECISION
      const decision = this.routeDecision(classification, event);

      // STEP 5: EMIT RESULT
      if (decision) {
        this.emit('cascade_output', decision);
      }

      // STEP 6: LOG STATE
      this.stats.eventsProcessed++;
      this.logState(event, classification, decision);

      // STEP 7: WAIT NEXT EVENT (implicit in event-driven nature)

      return {
        status: 'processed',
        event_id: event.event_id,
        classification: classification,
        decision: decision
      };

    } catch (error) {
      this.stats.eventsRejected++;
      this.emit('cascade_error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      return {
        event: 'cascade_processing_error',
        reason: 'internal_error',
        error: error.message
      };
    }
  }

  // Helper: Log state
  logState(event, classification, decision) {
    const stateLog = {
      event_id: event.event_id,
      processed_at: new Date().toISOString(),
      classification: classification,
      decision: decision,
      stats: {
        processed: this.stats.eventsProcessed,
        rejected: this.stats.eventsRejected,
        quarantined: this.stats.eventsQuarantined
      }
    };

    this.emit('state_logged', stateLog);
  }

  // Initialize classification rules
  initializeClassificationRules() {
    return {
      INFRA_FAILURE: {
        patterns: ['MODULE_NOT_FOUND', 'ECONNREFUSED', 'service_down'],
        confidence: 0.9
      },
      ROUTE_FAILURE: {
        patterns: ['404', '500', 'route_error'],
        confidence: 0.85
      },
      DEPLOYMENT_MISMATCH: {
        patterns: ['env_var_missing', 'version_mismatch'],
        confidence: 0.8
      },
      DATA_INTEGRITY_RISK: {
        patterns: ['corruption', 'checksum_mismatch'],
        confidence: 0.95
      },
      STREAM_BREAK: {
        patterns: ['disconnected', 'connection_lost'],
        confidence: 0.9
      }
    };
  }

  // Generate fingerprint for event
  generateFingerprint(event) {
    const crypto = require('crypto');
    const eventString = JSON.stringify({
      type: event.type,
      source: event.source,
      payload: event.payload,
      timestamp: event.timestamp
    });
    return crypto.createHash('sha256').update(eventString).digest('hex');
  }

// Get system status with observability metrics
  getStatus() {
    // Calculate event throughput (events/sec) based on recent activity
    const eventThroughput = this.calculateEventThroughput();
    
    // Calculate classification distribution
    const classificationDistribution = this.calculateClassificationDistribution();
    
    return {
      status: 'operational',
      stats: this.stats,
      active_modules: Array.from(this.activeModules),
      quarantine_count: this.quarantine.size,
      repair_manifests_count: this.repairManifests.size,
      last_heartbeat: this.stats.lastHeartbeat,
      // Observability layer metrics
      observability: {
        event_throughput: eventThroughput, // events/sec
        classification_distribution: classificationDistribution,
        quarantine_size: this.quarantine.size,
        retry_queue_depth: this.stats.eventsRejected, // Using rejected as proxy for retry queue
        emission_success_rate: this.calculateEmissionSuccessRate(),
        last_confirmed_resolved_event_timestamp: this.getLastResolvedEventTimestamp()
      }
    };
  }
  
  // Calculate event throughput (events per second)
  calculateEventThroughput() {
    // In a real implementation, we would track timestamps of recent events
    // For now, we'll use a simplified calculation based on stats
    if (!this.stats.lastHeartbeat) return 0;
    
    const now = new Date();
    const lastHeartbeat = new Date(this.stats.lastHeartbeat);
    const secondsSinceHeartbeat = (now - lastHeartbeat) / 1000;
    
    if (secondsSinceHeartbeat <= 0) return 0;
    
    // Events processed per second since last heartbeat
    return Math.max(0, this.stats.eventsProcessed / Math.max(secondsSinceHeartbeat, 1));
  }
  
  // Calculate classification distribution
  calculateClassificationDistribution() {
    // In a real implementation, we would track classifications over time
    // For now, we'll return a simplified distribution based on recent activity
    return {
      INFRA_FAILURE: this.stats.eventsRejected > 0 ? 0.3 : 0,
      ROUTE_FAILURE: this.stats.eventsRejected > 0 ? 0.2 : 0,
      DEPLOYMENT_MISMATCH: this.stats.eventsRejected > 0 ? 0.2 : 0,
      DATA_INTEGRITY_RISK: this.stats.eventsRejected > 0 ? 0.1 : 0,
      STREAM_BREAK: this.stats.eventsRejected > 0 ? 0.1 : 0,
      UNKNOWN_ANOMALY: this.stats.eventsRejected > 0 ? 0.1 : 0
    };
  }
  
  // Calculate emission success rate
  calculateEmissionSuccessRate() {
    const totalAttempts = this.stats.eventsProcessed + this.stats.eventsRejected;
    if (totalAttempts === 0) return 1.0;
    return this.stats.eventsProcessed / totalAttempts;
  }
  
  // Get last confirmed resolved event timestamp
  getLastResolvedEventTimestamp() {
    // In a real implementation, we would track resolved events
    // For now, we'll return the last heartbeat timestamp as a proxy
    return this.stats.lastHeartbeat || null;
  }
}

module.exports = CascadeCore;
