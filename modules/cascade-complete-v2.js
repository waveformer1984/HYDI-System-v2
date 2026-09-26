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
const { createPipeline } = require('../lib/pipeline');

class CascadeCompleteV2 extends EventEmitter {
  // options.pipeline: extra createPipeline() options (tests inject an
  // in-memory ledger, a fixed policy engine and their own metrics).
  constructor(options = {}) {
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

    // The canonical six-layer pipeline; see processEvent().
    this.pipeline = createPipeline({
      ingest: (input) => this.ingestRawEvent(input),
      classifier: this.classification,
      minSourceConfidence: 0.75,
      // Emission layer [6]: publish on this emitter; protoforge-core
      // forwards 'pipeline_trace' to Ursula's SSE subscribers.
      emit: (type, data) => this.emit(type, data),
      ...(options.pipeline || {})
    });
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
    this.uptimeInterval.unref?.(); // housekeeping only; don't keep the process alive

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

  // Process one raw source event through the canonical six-layer pipeline
  // (lib/pipeline): ingestion -> RAW LEDGER -> CASCADE -> KILO -> ProtoForge
  // -> emission. This used to classify and route in isolation, never
  // touching the ledger, KILO or the policy engine; it is now the single
  // execution path for every caller (POST /cascade/event and
  // protoforge-core's infrastructure alerts alike).
  //
  // CASCADE keeps its own pieces inside that pipeline: the source adapters
  // and schema lock are stage [1]'s normalization, this.classification is
  // stage [3]'s classifier, and the 0.75 source-confidence gate still
  // quarantines before classification. What changed, on purpose:
  //   - duplicates are decided by the RAW LEDGER's fingerprint
  //     (source + event_id + type, permanent) instead of the in-memory
  //     15-second content-fingerprint window;
  //   - `decision` in the result is ProtoForge's policy decision, not
  //     CascadeCore.routeDecision()'s action routing: CASCADE classifies
  //     only (HEIDI_V2_ARCHITECTURE.md), so it no longer picks actions;
  //   - the result also carries `trace_id` and the full `trace`.
  async processEvent(rawEvent, sourceType) {
    if (!this.isRunning) {
      return {
        error: 'CASCADE not running',
        status: 'rejected'
      };
    }

    const input = { rawEvent, sourceType, normalized: null };
    const trace = await this.pipeline.run(input);
    return this.toResult(trace, input.normalized);
  }

  // Stage [1] normalization for raw source events: adapter + schema lock,
  // then the gateway envelope the RAW LEDGER stores. Throws for an unknown
  // source type, which the pipeline records as an ingestion error.
  ingestRawEvent(input) {
    const adapter = AdapterFactory.getAdapter(input.sourceType);
    const normalized = adapter.normalize(input.rawEvent);

    // The schema lock validates the canonical event (event_id, source,
    // type, payload, timestamp). The adapter's confidence and version are
    // metadata about the event, not event fields; validating them as
    // fields made every event fail with "Unexpected field: confidence"
    // (ISSUES_FOUND.md #81), so they are carried alongside instead.
    // eslint-disable-next-line no-unused-vars -- destructured to separate adapter metadata from the canonical event
    const { confidence, adapter_version: _adapterVersion, ...canonical } = normalized;
    const schemaValidation = this.schemaLock.validateEvent(canonical);
    if (!schemaValidation.valid) {
      this.emit('schema_violation', { event: normalized, violations: schemaValidation.errors });
      return { ok: false, reason: 'schema_violation', violations: schemaValidation.errors };
    }

    input.normalized = { ...this.schemaLock.addSchemaHash(canonical), confidence };
    return {
      ok: true,
      sourceConfidence: confidence,
      envelope: {
        eventId: canonical.event_id,
        eventType: canonical.type,
        source: canonical.source,
        version: '1',
        timestamp: canonical.timestamp,
        payload: canonical.payload
      }
    };
  }

  // Map a pipeline trace back onto processEvent's long-standing result
  // shapes, and keep stats and the quarantine store in step.
  toResult(trace, event) {
    const base = { trace_id: trace.trace_id, trace };
    const stages = trace.stages;

    switch (trace.outcome) {
      case 'invalid': {
        this.stats.events_rejected++;
        const ingestion = stages.ingestion;
        if (ingestion.reason === 'schema_violation') this.stats.schema_violations++;
        return {
          event: 'cascade_event_rejected',
          reason: 'schema_violation',
          violations: ingestion.violations || [ingestion.reason],
          action: 'discard',
          ...base
        };
      }

      case 'duplicate':
        this.stats.duplicate_blocks++;
        this.stats.events_rejected++;
        return {
          event: 'cascade_event_rejected',
          reason: 'duplicate_event',
          fingerprint: trace.fingerprint,
          action: 'discard',
          ...base
        };

      case 'queued':
        return {
          status: 'queued',
          reason: 'ledger_queued',
          event_id: event && event.event_id,
          fingerprint: trace.fingerprint,
          action: 'retry',
          ...base
        };

      case 'quarantined': {
        const cascadeStage = stages.cascade;
        this.stats.events_quarantined++;
        if (cascadeStage.reason === 'low_confidence') {
          this.stats.low_confidence_blocks++;
          this.quarantine.quarantine(event, 'low_confidence', {
            confidence: cascadeStage.source_confidence,
            threshold: cascadeStage.threshold
          });
          return {
            event: 'cascade_event_rejected',
            reason: 'low_confidence',
            confidence: cascadeStage.source_confidence,
            action: 'quarantine',
            ...base
          };
        }
        this.quarantine.quarantine(event, 'unknown_anomaly', {
          classification: cascadeStage.classification,
          confidence: cascadeStage.confidence
        });
        return {
          event: 'cascade_event_rejected',
          reason: 'unknown_anomaly',
          classification: cascadeStage.classification,
          action: 'quarantine',
          ...base
        };
      }

      case 'approve':
      case 'reject':
      case 'escalate': {
        this.stats.events_processed++;
        const classification = {
          event: 'hyve_opportunity_detected',
          classification: stages.cascade.classification,
          confidence: stages.cascade.confidence,
          matched_rules: stages.cascade.matched_rules,
          quarantine: false,
          enum_locked: true,
          version: 'v2'
        };
        const decision = {
          decision: stages.protoforge.decision,
          matched_rule_id: stages.protoforge.matched_rule_id,
          decision_id: stages.protoforge.decision_id
        };
        this.logState(event, classification, decision);
        return {
          status: 'processed',
          event_id: event.event_id,
          fingerprint: trace.fingerprint,
          confidence: event.confidence,
          classification,
          decision,
          schema_hash: event.schema_hash,
          ...base
        };
      }

      default: {
        // 'ledger_error' or 'error': an internal failure in some stage.
        this.stats.events_rejected++;
        const failed = Object.entries(stages).find(([, st]) => st.status === 'error');
        const error = failed ? `${failed[0]}: ${failed[1].error}` : 'pipeline failed';
        this.emit('cascade_error', { error, timestamp: new Date().toISOString() });
        return {
          event: 'cascade_processing_error',
          reason: trace.outcome === 'ledger_error' ? 'ledger_error' : 'internal_error',
          error,
          ...base
        };
      }
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

}

// Export singleton instance
module.exports = new CascadeCompleteV2();
