// Replay Engine V2 - Truth Validator
// Re-runs events through pipeline to verify deterministic behavior
// Same input -> same classification -> same outcome

const rawEventLedgerV2 = require('./raw-event-ledger-v2');
const cascadeClassifierV2 = require('./cascade-classifier-v2');
const kiloAnalyzerV2 = require('./kilo-analyzer-v2');
const protoforgePolicyV2 = require('./protoforge-policy-v2');
const { EventEmitter } = require('events');

class ReplayEngineV2 extends EventEmitter {
  constructor() {
    super();
    
    // Replay configuration
    this.config = {
      batchSize: 100,
      maxConcurrency: 5,
      driftThreshold: 0.01, // 1% difference threshold
      storeReplayHistory: true
    };
    
    // Replay history
    this.replayHistory = [];
    this.driftEvents = [];
    
    // Execution traces
    this.executionTraces = new Map(); // event_id -> trace
    
    // Statistics
    this.stats = {
      totalReplays: 0,
      successfulReplays: 0,
      driftDetected: 0,
      averageReplayTime: 0,
      tracesStored: 0
    };
    
    console.log('[REPLAY ENGINE V2] Initialized - Truth Validator');
    console.log('[REPLAY ENGINE V2] RULE: Same input must produce same output');
  }

  // Replay single event
  async replayEvent(eventId, storeTrace = true) {
    const startTime = Date.now();
    
    try {
      console.log(`[REPLAY V2] Replaying event: ${eventId}`);
      
      // Get original event from RAW LEDGER
      const ledgerRecord = rawEventLedgerV2.getById(eventId);
      if (!ledgerRecord) {
        throw new Error(`Event not found in ledger: ${eventId}`);
      }
      
      // Create execution trace
      const trace = {
        event_id: eventId,
        replay_timestamp: new Date().toISOString(),
        original_timestamp: ledgerRecord.iso_timestamp,
        stages: {}
      };
      
      // Stage 1: CASCADE classification
      const cascadeResult = await cascadeClassifierV2.processEvent(eventId);
      trace.stages.cascade = {
        classification: cascadeResult?.classification,
        confidence: cascadeResult?.confidence,
        success: !!cascadeResult
      };
      
      // Stage 2: KILO analysis (only if CASCADE succeeded)
      if (cascadeResult) {
        const kiloResult = await kiloAnalyzerV2.analyzeEvent(eventId, cascadeResult);
        trace.stages.kilo = {
          hypotheses_count: kiloResult?.hypotheses?.length || 0,
          suggested_fixes_count: kiloResult?.suggested_fixes?.length || 0,
          success: !!kiloResult
        };
      }
      
      // Stage 3: ProtoForge policy (only if KILO succeeded)
      if (trace.stages.kilo?.success) {
        const kiloResult = await kiloAnalyzerV2.analyzeEvent(eventId, cascadeResult);
        const protoforgeResult = await protoforgePolicyV2.processAnalysis(kiloResult);
        trace.stages.protoforge = {
          action_approved: !!protoforgeResult,
          priority: protoforgeResult?.priority,
          success: true // Processing succeeded even if rejected
        };
      }
      
      // Calculate replay duration
      trace.duration_ms = Date.now() - startTime;
      
      // Store trace if requested
      if (storeTrace) {
        this.executionTraces.set(eventId, trace);
        this.stats.tracesStored++;
      }
      
      // Compare with stored trace if exists
      const drift = this.compareWithStoredTrace(eventId, trace);
      
      // Create replay result
      const result = {
        event_id: eventId,
        trace: trace,
        drift_detected: drift,
        replay_duration_ms: trace.duration_ms,
        timestamp: new Date().toISOString()
      };
      
      // Update statistics
      this.updateStats(result);
      
      // Store in history
      if (this.config.storeReplayHistory) {
        this.replayHistory.push(result);
        if (this.replayHistory.length > 1000) {
          this.replayHistory = this.replayHistory.slice(-1000);
        }
      }
      
      // Emit result
      this.emit('event_replayed', result);
      
      if (drift.detected) {
        this.driftEvents.push(drift);
        this.emit('drift_detected', drift);
        console.warn(`[REPLAY V2] DRIFT DETECTED: ${eventId} - ${drift.type}`);
      }
      
      console.log(`[REPLAY V2] Replay complete: ${eventId} (${trace.duration_ms}ms)`);
      
      return result;
      
    } catch (error) {
      console.error(`[REPLAY V2] Replay failed for ${eventId}:`, error);
      
      const errorResult = {
        event_id: eventId,
        error: error.message,
        failed: true,
        timestamp: new Date().toISOString()
      };
      
      this.emit('replay_failed', errorResult);
      throw error;
    }
  }

  // Replay batch of events
  async replayBatch(fromPosition, toPosition, compareMode = true) {
    console.log(`[REPLAY V2] Batch replay: ${fromPosition} to ${toPosition}`);
    
    const startTime = Date.now();
    const results = [];
    
    // Get events from ledger
    const events = rawEventLedgerV2.getRange(fromPosition, toPosition + 1);
    
    // Process in batches
    for (let i = 0; i < events.length; i += this.config.batchSize) {
      const batch = events.slice(i, i + this.config.batchSize);
      
      console.log(`[REPLAY V2] Processing batch ${Math.floor(i / this.config.batchSize) + 1}/${Math.ceil(events.length / this.config.batchSize)}`);
      
      // Process batch with concurrency control
      const promises = batch.map(async (event) => {
        try {
          return await this.replayEvent(event.id, compareMode);
        } catch (error) {
          return {
            event_id: event.id,
            error: error.message,
            failed: true
          };
        }
      });
      
      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const batchResult = {
      from_position: fromPosition,
      to_position: toPosition,
      total_events: events.length,
      results: results,
      successful: results.filter(r => !r.failed).length,
      failed: results.filter(r => r.failed).length,
      drift_detected: results.filter(r => r.drift_detected).length,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
    
    console.log(`[REPLAY V2] Batch complete: ${batchResult.successful}/${batchResult.total_events} successful`);
    
    return batchResult;
  }

  // NORMALIZATION: Stabilize outputs for deterministic comparison
  // Handles precision drift, undefined vs null, and string/number variance
  normalize(stage) {
    if (!stage || typeof stage !== 'object') {
      return { type: 'NONE', confidence: '0.00', count: 0 };
    }
    
    return {
      type: stage.classification || stage.type || 'NONE',
      confidence: Number(stage.confidence || 0).toFixed(2),
      count: Number(stage.hypotheses_count || stage.count || 0),
      success: Boolean(stage.success)
    };
  }

  // Compare with stored trace
  compareWithStoredTrace(eventId, newTrace) {
    const storedTrace = this.executionTraces.get(eventId);
    
    if (!storedTrace) {
      return {
        detected: false,
        type: 'NO_BASELINE',
        message: 'No stored trace to compare'
      };
    }
    
    // REJECT NULL OUTPUTS - can't compare ghosts
    if (!newTrace || !newTrace.stages) {
      return {
        detected: true,
        type: 'NULL_OUTPUT',
        message: 'DETERMINISM_BREAK: NULL_OUTPUT - new trace is null/undefined'
      };
    }
    
    if (!storedTrace.stages) {
      return {
        detected: true,
        type: 'NULL_BASELINE',
        message: 'DETERMINISM_BREAK: NULL_BASELINE - stored trace has no stages'
      };
    }
    
    const differences = [];
    
    // Compare CASCADE output (NORMALIZED)
    const storedCascade = this.normalize(storedTrace.stages.cascade);
    const newCascade = this.normalize(newTrace.stages.cascade);
    
    if (storedCascade.type !== newCascade.type) {
      differences.push({
        stage: 'cascade',
        field: 'classification',
        stored: storedCascade.type,
        new: newCascade.type,
        impact: 'HIGH'
      });
    }
    
    // Compare normalized confidence
    if (storedCascade.confidence !== newCascade.confidence) {
      differences.push({
        stage: 'cascade',
        field: 'confidence',
        stored: storedCascade.confidence,
        new: newCascade.confidence,
        impact: 'MEDIUM'
      });
    }
    
    // Compare KILO hypotheses count (NORMALIZED)
    const storedKilo = this.normalize(storedTrace.stages.kilo);
    const newKilo = this.normalize(newTrace.stages.kilo);
    
    if (storedCascade.count !== newCascade.count) {
      differences.push({
        stage: 'kilo',
        field: 'hypotheses_count',
        stored: storedKilo.count,
        new: newKilo.count,
        impact: 'LOW'
      });
    }
    
    // Determine if drift is significant
    const hasHighImpact = differences.some(d => d.impact === 'HIGH');
    const hasManyDifferences = differences.length > 2;
    
    if (differences.length === 0) {
      return {
        detected: false,
        type: 'NONE',
        message: 'No differences detected'
      };
    }
    
    return {
      detected: hasHighImpact || hasManyDifferences,
      type: hasHighImpact ? 'SIGNIFICANT_DRIFT' : 'MINOR_DRIFT',
      differences: differences,
      message: `${differences.length} differences detected`
    };
  }

  // Validate system determinism
  async validateDeterminism(sampleSize = 100) {
    console.log(`[REPLAY V2] Validating determinism with sample size: ${sampleSize}`);
    
    // Get random sample of events
    const allEvents = rawEventLedgerV2.getLatest(sampleSize * 2);
    const sample = allEvents.slice(-sampleSize);
    
    const results = [];
    let deterministicCount = 0;
    
    for (const event of sample) {
      try {
        const result = await this.replayEvent(event.id, false);
        if (!result.drift_detected || result.drift.type === 'NO_BASELINE') {
          deterministicCount++;
        }
        results.push(result);
      } catch (error) {
        console.error(`[REPLAY V2] Validation error for ${event.id}:`, error);
      }
    }
    
    const determinismRate = (deterministicCount / sample.length * 100).toFixed(2);
    
    console.log(`[REPLAY V2] Determinism: ${determinismRate}% (${deterministicCount}/${sample.length})`);
    
    return {
      sample_size: sample.length,
      deterministic_count: deterministicCount,
      deterministic_rate: parseFloat(determinismRate),
      results: results,
      timestamp: new Date().toISOString()
    };
  }

  // Update statistics
  updateStats(result) {
    this.stats.totalReplays++;
    
    if (!result.failed) {
      this.stats.successfulReplays++;
      
      // Update average replay time
      const totalTime = this.stats.averageReplayTime * (this.stats.successfulReplays - 1) + result.replay_duration_ms;
      this.stats.averageReplayTime = totalTime / this.stats.successfulReplays;
    }
    
    if (result.drift_detected) {
      this.stats.driftDetected++;
    }
  }

  // Get execution trace
  getTrace(eventId) {
    return this.executionTraces.get(eventId);
  }

  // Get drift report
  getDriftReport(limit = 50) {
    const recentDrift = this.driftEvents
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
    
    return {
      total_drift_events: this.driftEvents.length,
      drift_rate: this.stats.totalReplays > 0 
        ? (this.stats.driftDetected / this.stats.totalReplays * 100).toFixed(2) + '%'
        : '0%',
      recent_drift: recentDrift,
      drift_types: this.categorizeDrift()
    };
  }

  // Categorize drift types
  categorizeDrift() {
    const types = {};
    for (const drift of this.driftEvents) {
      types[drift.type] = (types[drift.type] || 0) + 1;
    }
    return types;
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      drift_rate: this.stats.totalReplays > 0 
        ? (this.stats.driftDetected / this.stats.totalReplays * 100).toFixed(2) + '%'
        : '0%',
      determinism_rate: this.stats.totalReplays > 0 
        ? ((this.stats.totalReplays - this.stats.driftDetected) / this.stats.totalReplays * 100).toFixed(2) + '%'
        : '100%'
    };
  }

  // Clear history
  clearHistory() {
    this.replayHistory = [];
    this.driftEvents = [];
    console.log('[REPLAY V2] History cleared');
  }

  // Get info
  getInfo() {
    return {
      type: 'REPLAY_ENGINE_V2',
      description: 'Truth Validator - Ensures deterministic behavior',
      rules: [
        'Same input must produce same output',
        'Detects system drift',
        'Stores execution traces',
        'Validates determinism'
      ],
      config: this.config,
      stats: this.getStats()
    };
  }
}

// Create singleton
const replayEngineV2 = new ReplayEngineV2();

module.exports = replayEngineV2;
