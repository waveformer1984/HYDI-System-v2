// CASCADE Complete V2 - Enhanced with all strict enforcement features
// Schema lock, fingerprinting, confidence scoring, hard boundaries, health snapshots, ack tracking, dead letters

const CascadeCore = require('./cascade-core');
const CascadeSchemaLock = require('./cascade-schema-lock');
const CascadeEventFingerprint = require('./cascade-event-fingerprint');
const { AdapterFactory } = require('./cascade-adapters-v2');
const CascadeClassificationV2 = require('./cascade-classification-v2');
const CascadeEmissionV2 = require('./cascade-emission-v2');
const CascadeQuarantineV2 = require('./cascade-quarantine-v2');
const CascadeHealthSnapshot = require('./cascade-health-snapshot');
const { EventEmitter } = require('events');

class CascadeCompleteV2 extends EventEmitter {
  constructor() {
    super();
    
    // Core components
    this.core = new CascadeCore();
    this.schemaLock = new CascadeSchemaLock();
    this.fingerprint = new CascadeEventFingerprint();
    this.classification = new CascadeClassificationV2();
    this.emission = new CascadeEmissionV2();
    this.quarantine = new CascadeQuarantineV2();
    this.healthSnapshot = new CascadeHealthSnapshot();
    
    // State
    this.isRunning = false;
    this.stats = {
      start_time: null,
      events_processed: 0,
      events_rejected: 0,
      events_quarantined: 0,
      events_dead_lettered: 0,
      schema_violations: 0,
      duplicate_blocks: 0,
      low_confidence_blocks: 0,
      repair_manifests_generated: 0,
      uptime: 0
    };
    
    this.setupIntegrations();
  }

  setupIntegrations() {
    // Register components with health snapshot
    this.healthSnapshot.registerComponent('cascade', this);
    this.healthSnapshot.registerComponent('emission', this.emission);
    this.healthSnapshot.registerComponent('quarantine', this.quarantine);
    
    // Emission tracking
    this.emission.on('emission_success', (success) => {
      this.components.lastEmissionSuccess = success.timestamp;
      this.emit('emission_success', success);
    });
    
    this.emission.on('emission_failed', (failure) => {
      this.components.failedEmissions = (this.components.failedEmissions || 0) + 1;
      this.emit('emission_failed', failure);
    });
    
    // Quarantine events
    this.quarantine.on('event_dead_lettered', (deadLetter) => {
      this.stats.events_dead_lettered++;
      this.emit('event_dead_lettered', deadLetter);
    });
    
    // Health snapshot updates
    this.healthSnapshot.on('snapshot_updated', (snapshot) => {
      this.emit('health_snapshot', snapshot);
    });
    
    // Initialize component tracking
    this.components = {
      totalEmissions: 0,
      failedEmissions: 0,
      lastEmissionSuccess: null
    };
  }

  // Start CASCADE system
  start() {
    if (this.isRunning) {
      return { status: 'already_running' };
    }

    this.isRunning = true;
    this.stats.start_time = new Date().toISOString();
    
    // Start health monitoring
    this.healthSnapshot.start();
    
    // Update uptime
    this.uptimeInterval = setInterval(() => {
      this.updateUptime();
    }, 1000);

    this.emit('cascade_started', {
      timestamp: this.stats.start_time,
      version: 'v2',
      features: [
        'schema_lock',
        'fingerprinting',
        'confidence_scoring',
        'hard_classification',
        'health_snapshots',
        'ack_tracking',
        'dead_letters'
      ]
    });

    return { 
      status: 'started',
      start_time: this.stats.start_time,
      version: 'v2'
    };
  }

  // Stop CASCADE system
  stop() {
    if (!this.isRunning) {
      return { status: 'already_stopped' };
    }

    this.isRunning = false;
    
    // Stop components
    this.healthSnapshot.stop();
    this.fingerprint.stop();
    this.quarantine.stop();
    
    // Stop periodic tasks
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }

    this.emit('cascade_stopped', {
      timestamp: new Date().toISOString(),
      final_stats: this.stats
    });

    return { 
      status: 'stopped',
      stop_time: new Date().toISOString()
    };
  }

  // Process events with all V2 enhancements
  async processEvent(rawEvent, sourceType) {
    if (!this.isRunning) {
      return {
        error: 'CASCADE not running',
        status: 'rejected'
      };
    }

    try {
      // STEP 1: Get adapter with confidence scoring
      const adapter = AdapterFactory.getAdapter(sourceType);
      
      // STEP 2: Normalize with adapter
      const normalized = adapter.normalize(rawEvent);
      
      // STEP 3: Schema lock validation
      const schemaValidation = this.schemaLock.validateEvent(normalized);
      if (!schemaValidation.valid) {
        this.stats.schema_violations++;
        this.stats.events_rejected++;
        
        const rejection = {
          event: 'cascade_event_rejected',
          reason: 'schema_violation',
          violations: schemaValidation.errors,
          action: 'discard'
        };
        
        this.emit('schema_violation', {
          event: normalized,
          violations: schemaValidation.errors
        });
        
        return rejection;
      }
      
      // STEP 4: Add schema hash
      const schemaValidated = this.schemaLock.addSchemaHash(normalized);
      
      // STEP 5: Fingerprint duplicate detection
      const fingerprintResult = this.fingerprint.processEvent(schemaValidated);
      if (fingerprintResult.isDuplicate) {
        this.stats.duplicate_blocks++;
        this.stats.events_rejected++;
        
        return {
          event: 'cascade_event_rejected',
          reason: 'duplicate_event',
          fingerprint: fingerprintResult.fingerprint,
          action: 'discard'
        };
      }
      
      // STEP 6: Confidence check (< 0.75 = quarantine)
      if (schemaValidated.confidence < 0.75) {
        this.stats.low_confidence_blocks++;
        this.stats.events_quarantined++;
        
        this.quarantine.quarantine(schemaValidated, 'low_confidence', {
          confidence: schemaValidated.confidence,
          threshold: 0.75
        });
        
        return {
          event: 'cascade_event_rejected',
          reason: 'low_confidence',
          confidence: schemaValidated.confidence,
          action: 'quarantine'
        };
      }
      
      // STEP 7: Hard classification (enum only)
      const classification = this.classification.classify(schemaValidated);
      
      // STEP 8: Auto-quarantine unknown anomalies
      if (classification.quarantine) {
        this.stats.events_quarantined++;
        this.quarantine.quarantine(schemaValidated, 'unknown_anomaly', {
          classification: classification.classification,
          confidence: classification.confidence
        });
        
        return {
          event: 'cascade_event_rejected',
          reason: 'unknown_anomaly',
          classification: classification.classification,
          action: 'quarantine'
        };
      }
      
      // STEP 9: Route decision (repair manifest or action)
      const decision = this.core.routeDecision(classification, schemaValidated);
      
      // STEP 10: Emit with acknowledgment tracking
      if (decision) {
        const trackingId = await this.emission.emit(decision);
        this.components.totalEmissions++;
        decision.tracking_id = trackingId;
      }
      
      // STEP 11: Update statistics
      this.stats.events_processed++;
      if (decision && decision.event === 'repair_manifest_generated') {
        this.stats.repair_manifests_generated++;
      }
      
      // STEP 12: Log state
      this.logState(schemaValidated, classification, decision);
      
      return {
        status: 'processed',
        event_id: schemaValidated.event_id,
        fingerprint: fingerprintResult.fingerprint,
        confidence: schemaValidated.confidence,
        classification: classification,
        decision: decision,
        schema_hash: schemaValidated.schema_hash
      };
      
    } catch (error) {
      this.stats.events_rejected++;
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

  // Update uptime
  updateUptime() {
    if (this.stats.start_time) {
      const now = new Date();
      const start = new Date(this.stats.start_time);
      this.stats.uptime = Math.floor((now - start) / 1000);
    }
  }

  // Log state
  logState(event, classification, decision) {
    const stateLog = {
      event_id: event.event_id,
      processed_at: new Date().toISOString(),
      confidence: event.confidence,
      classification: classification,
      decision: decision,
      stats: {
        processed: this.stats.events_processed,
        rejected: this.stats.events_rejected,
        quarantined: this.stats.events_quarantined,
        dead_lettered: this.stats.events_dead_lettered
      }
    };

    this.emit('state_logged', stateLog);
  }

  // Get comprehensive system status
  getStatus() {
    const healthSnapshot = this.healthSnapshot.getSnapshot();
    
    return {
      is_running: this.isRunning,
      version: 'v2',
      stats: this.stats,
      health: healthSnapshot,
      schema_lock: this.schemaLock.getSchemaInfo(),
      fingerprint: this.fingerprint.getStats(),
      classification: this.classification.getStats(),
      emission: this.emission.getStats(),
      quarantine: this.quarantine.getStats(),
      adapters: AdapterFactory.getAllStats(),
      system_health: healthSnapshot.system_health
    };
  }

  // Get health report
  getHealthReport() {
    return this.healthSnapshot.getHealthReport();
  }

  // Manual quarantine management
  getQuarantineReport(limit = 50) {
    return this.quarantine.getReport(limit);
  }

  manualReleaseFromQuarantine(eventId, approvedBy) {
    return this.quarantine.manualRelease(eventId, approvedBy);
  }

  // Dead letter management
  getDeadLetterReport(limit = 50) {
    return this.quarantine.getDeadLetterReport(limit);
  }

  // Emission tracking
  getEmissionTracking(eventId = null) {
    return this.emission.getTrackingReport(eventId);
  }

  // Configuration methods
  updateQuarantinePolicy(reason, policy) {
    this.quarantine.retryPolicies.set(reason, policy);
    this.emit('policy_updated', { reason, policy });
  }

  setMaxQuarantineSize(size) {
    this.quarantine.maxQuarantineSize = size;
    this.emit('config_updated', { maxQuarantineSize: size });
  }

  // Process quarantine retries
  async processQuarantineRetries() {
    const readyEvents = this.quarantine.getEventsReadyForRetry();
    
    for (const record of readyEvents) {
      try {
        const result = await this.quarantine.attemptRelease(record.event_id);
        
        if (result.status === 'retrying') {
          // Re-process the event
          await this.processEvent(record.event, record.event.source);
        }
      } catch (error) {
        this.emit('retry_error', {
          event_id: record.event_id,
          error: error.message
        });
      }
    }
  }
}

// Export singleton instance
module.exports = new CascadeCompleteV2();
