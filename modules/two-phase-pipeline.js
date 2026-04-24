// Two-Phase Pipeline - Separates raw truth from interpretation
// Phase 1: Raw truth ingestion → RAW LEDGER
// Phase 2: Interpretation layer → CASCADE → KILO → ProtoForge

const rawEventLedger = require('./raw-event-ledger');
const cascade = require('./cascade-complete-v2');
const { EventEmitter } = require('events');

class TwoPhasePipeline extends EventEmitter {
  constructor() {
    super();
    
    // Pipeline configuration
    this.phases = {
      RAW_TRUTH: {
        name: 'RAW_TRUTH',
        description: 'Event ingestion → RAW LEDGER (immutable)',
        status: 'active'
      },
      INTERPRETATION: {
        name: 'INTERPRETATION',
        description: 'RAW LEDGER → CASCADE → KILO → ProtoForge',
        status: 'active'
      }
    };
    
    // Observation windows (prevents over-enforcement)
    this.observationWindows = {
      startup: 120000,      // 2 minutes startup window
      drift: 30000,         // 30 seconds drift observation
      quarantine: 60000,    // 1 minute before quarantine escalation
      repair: 120000        // 2 minutes before repair triggers
    };
    
    // Startup tracking
    this.startTime = Date.now();
    this.eventsInStartup = 0;
    
    // Phase statistics
    this.stats = {
      phase1: {
        events_ingested: 0,
        events_ledgered: 0,
        ingestion_errors: 0
      },
      phase2: {
        events_processed: 0,
        classifications_generated: 0,
        repairs_suggested: 0,
        processing_errors: 0
      }
    };
    
    // Initialize
    this.initialize();
  }

  initialize() {
    console.log('[TWO-PHASE PIPELINE] Initializing...');
    console.log('[TWO-PHASE PIPELINE] Phase 1: Raw truth → LEDGER (immutable)');
    console.log('[TWO-PHASE PIPELINE] Phase 2: LEDGER → Interpretation (controlled)');
    
    // Listen to raw ledger events
    rawEventLedger.on('raw_event_appended', this.handleRawEventAppended.bind(this));
    
    // Start the interpretation processor
    this.startInterpretationProcessor();
    
    console.log('[TWO-PHASE PIPELINE] Initialized - Ready for raw truth ingestion');
  }

  // PHASE 1: Raw truth ingestion
  async ingestRawEvent(rawEvent, sourceMetadata = {}) {
    const phaseStart = Date.now();
    
    try {
      console.log(`[PHASE 1] Ingesting raw event from ${sourceMetadata.source || 'unknown'}`);
      
      // Store in RAW LEDGER (immutable truth)
      const ledgerRecord = await rawEventLedger.appendRawEvent(rawEvent, sourceMetadata);
      
      // Update statistics
      this.stats.phase1.events_ingested++;
      this.stats.phase1.events_ledgered++;
      
      // Track startup events
      if (this.isInStartupWindow()) {
        this.eventsInStartup++;
      }
      
      const duration = Date.now() - phaseStart;
      
      console.log(`[PHASE 1] Raw event ledgered: ${ledgerRecord.sequence_id} (${duration}ms)`);
      
      // Emit phase 1 complete
      this.emit('phase1_complete', {
        sequence_id: ledgerRecord.sequence_id,
        event_hash: ledgerRecord.integrity.event_hash,
        duration: duration
      });
      
      return ledgerRecord;
      
    } catch (error) {
      this.stats.phase1.ingestion_errors++;
      console.error('[PHASE 1] Ingestion failed:', error);
      
      this.emit('phase1_error', {
        error: error.message,
        raw_event: rawEvent
      });
      
      throw error;
    }
  }

  // Handle raw event appended (trigger Phase 2)
  async handleRawEventAppended(ledgerInfo) {
    // Don't process during startup observation window
    if (this.isInStartupWindow()) {
      console.log(`[PHASE 2] Skipping interpretation during startup window (${ledgerInfo.sequence_id})`);
      return;
    }
    
    // Add to interpretation queue
    this.emit('interpretation_queued', {
      sequence_id: ledgerInfo.sequence_id,
      event_hash: ledgerInfo.event_hash,
      source: ledgerInfo.source
    });
  }

  // PHASE 2: Interpretation layer
  async processInterpretation(sequenceId) {
    const phaseStart = Date.now();
    
    try {
      console.log(`[PHASE 2] Processing interpretation for sequence ${sequenceId}`);
      
      // Get raw event from ledger (truth source)
      const rawRecord = await rawEventLedger.getRawEvent(sequenceId);
      if (!rawRecord) {
        throw new Error(`Raw event not found: ${sequenceId}`);
      }
      
      // Process through CASCADE (interpretation, not truth)
      const cascadeResult = await cascade.processEvent(
        rawRecord.raw_event,
        rawRecord.source_metadata.source
      );
      
      // Update statistics
      this.stats.phase2.events_processed++;
      
      if (cascadeResult.classification) {
        this.stats.phase2.classifications_generated++;
      }
      
      if (cascadeResult.decision && cascadeResult.decision.event === 'repair_manifest_generated') {
        this.stats.phase2.repairs_suggested++;
      }
      
      const duration = Date.now() - phaseStart;
      
      console.log(`[PHASE 2] Interpretation complete: ${sequenceId} (${duration}ms)`);
      console.log(`[PHASE 2] Classification: ${cascadeResult.classification?.classification || 'none'}`);
      
      // Emit phase 2 complete
      this.emit('phase2_complete', {
        sequence_id: sequenceId,
        cascade_result: cascadeResult,
        duration: duration,
        raw_event_hash: rawRecord.integrity.event_hash
      });
      
      return cascadeResult;
      
    } catch (error) {
      this.stats.phase2.processing_errors++;
      console.error(`[PHASE 2] Interpretation failed for ${sequenceId}:`, error);
      
      this.emit('phase2_error', {
        sequence_id: sequenceId,
        error: error.message
      });
      
      throw error;
    }
  }

  // Start interpretation processor
  startInterpretationProcessor() {
    // Process queued interpretations
    this.on('interpretation_queued', async (queueInfo) => {
      // Add observation delay before processing
      const delay = this.isInStartupWindow() 
        ? this.observationWindows.startup 
        : this.observationWindows.drift;
      
      setTimeout(async () => {
        try {
          await this.processInterpretation(queueInfo.sequence_id);
        } catch (error) {
          console.error(`[PHASE 2] Failed to process ${queueInfo.sequence_id}:`, error);
        }
      }, delay);
    });
  }

  // Check if in startup observation window
  isInStartupWindow() {
    return (Date.now() - this.startTime) < this.observationWindows.startup;
  }

  // Get observation window status
  getObservationStatus() {
    const now = Date.now();
    const uptime = now - this.startTime;
    
    return {
      uptime_ms: uptime,
      startup_window_active: this.isInStartupWindow(),
      startup_window_remaining: Math.max(0, this.observationWindows.startup - uptime),
      events_in_startup: this.eventsInStartup,
      observation_windows: this.observationWindows
    };
  }

  // Replay system - reprocess raw ledger events
  async replayEvents(fromSequence = 1, toSequence = null, compareMode = false) {
    console.log(`[REPLAY] Starting replay from sequence ${fromSequence}`);
    
    const rawEvents = await rawEventLedger.readRawEvents(fromSequence, toSequence);
    const replayResults = [];
    
    for (const rawRecord of rawEvents) {
      try {
        // Re-process through CASCADE
        const originalResult = await cascade.processEvent(
          rawRecord.raw_event,
          rawRecord.source_metadata.source
        );
        
        const replayResult = {
          sequence_id: rawRecord.sequence_id,
          original_timestamp: rawRecord.received_at,
          replay_timestamp: new Date().toISOString(),
          classification: originalResult.classification?.classification,
          confidence: originalResult.confidence,
          fingerprint: originalResult.fingerprint
        };
        
        // In compare mode, we'd check against historical output
        if (compareMode) {
          // TODO: Load historical classification and compare
          replayResult.drift_detected = false; // Would be calculated
        }
        
        replayResults.push(replayResult);
        
      } catch (error) {
        replayResults.push({
          sequence_id: rawRecord.sequence_id,
          error: error.message,
          failed: true
        });
      }
    }
    
    console.log(`[REPLAY] Completed replay: ${replayResults.length} events processed`);
    
    return {
      replay_results: replayResults,
      total_processed: replayResults.length,
      successful: replayResults.filter(r => !r.failed).length,
      failed: replayResults.filter(r => r.failed).length
    };
  }

  // Get pipeline statistics
  getStats() {
    return {
      phases: this.phases,
      stats: this.stats,
      observation_status: this.getObservationStatus(),
      system_health: this.calculateSystemHealth()
    };
  }

  // Calculate system health
  calculateSystemHealth() {
    const phase1ErrorRate = this.stats.phase1.events_ingested > 0 
      ? this.stats.phase1.ingestion_errors / this.stats.phase1.events_ingested 
      : 0;
    
    const phase2ErrorRate = this.stats.phase2.events_processed > 0
      ? this.stats.phase2.processing_errors / this.stats.phase2.events_processed
      : 0;
    
    const overallErrorRate = (phase1ErrorRate + phase2ErrorRate) / 2;
    
    if (overallErrorRate > 0.1) return 'critical';
    if (overallErrorRate > 0.05) return 'warning';
    if (this.isInStartupWindow()) return 'starting';
    return 'healthy';
  }

  // Get phase status
  getPhaseStatus() {
    return {
      phase1: {
        name: this.phases.RAW_TRUTH.name,
        description: this.phases.RAW_TRUTH.description,
        status: this.phases.RAW_TRUTH.status,
        events_processed: this.stats.phase1.events_ledgered,
        error_rate: this.stats.phase1.events_ingested > 0 
          ? (this.stats.phase1.ingestion_errors / this.stats.phase1.events_ingested * 100).toFixed(2) + '%'
          : '0%'
      },
      phase2: {
        name: this.phases.INTERPRETATION.name,
        description: this.phases.INTERPRETATION.description,
        status: this.phases.INTERPRETATION.status,
        events_processed: this.stats.phase2.events_processed,
        classifications: this.stats.phase2.classifications_generated,
        repairs: this.stats.phase2.repairs_suggested,
        error_rate: this.stats.phase2.events_processed > 0
          ? (this.stats.phase2.processing_errors / this.stats.phase2.events_processed * 100).toFixed(2) + '%'
          : '0%'
      }
    };
  }

  // Stop pipeline
  async stop() {
    console.log('[TWO-PHASE PIPELINE] Stopping...');
    
    // Flush raw ledger
    await rawEventLedger.stop();
    
    console.log('[TWO-PHASE PIPELINE] Stopped');
  }
}

// Create singleton instance
const twoPhasePipeline = new TwoPhasePipeline();

// Export the pipeline
module.exports = twoPhasePipeline;
