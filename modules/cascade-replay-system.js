// CASCADE Replay System - Reprocesses raw ledger events to detect real drift
// Compares outputs vs historical outputs to identify actual system changes

const rawEventLedger = require('./raw-event-ledger');
const cascade = require('./cascade-complete-v2');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

class CascadeReplaySystem extends EventEmitter {
  constructor() {
    super();
    
    // Replay configuration
    this.config = {
      batchSize: 100,           // Events per batch
      maxConcurrency: 5,        // Parallel replays
      comparisonThreshold: 0.01, // 1% difference threshold
      historyRetention: 30      // Days to keep replay history
    };
    
    // Historical output storage
    this.historyPath = path.join(__dirname, '../data/cascade-output-history.jsonl');
    this.outputHistory = new Map(); // sequence_id -> historical_output
    
    // Replay state
    this.activeReplays = new Map();
    this.replayHistory = [];
    
    // Statistics
    this.stats = {
      totalReplays: 0,
      successfulReplays: 0,
      driftEventsDetected: 0,
      averageReplayTime: 0,
      lastReplayAt: null
    };
    
    // Initialize
    this.initialize();
  }

  async initialize() {
    console.log('[CASCADE REPLAY] Initializing replay system...');
    
    // Ensure data directory exists
    await fs.mkdir(path.dirname(this.historyPath), { recursive: true });
    
    // Load historical outputs
    await this.loadOutputHistory();
    
    console.log('[CASCADE REPLAY] Initialized - Ready to detect real drift');
  }

  // Store current CASCADE output for future comparison
  async storeOutput(sequenceId, cascadeOutput) {
    const historicalRecord = {
      sequence_id: sequenceId,
      stored_at: new Date().toISOString(),
      cascade_output: this.sanitizeOutput(cascadeOutput),
      output_hash: this.calculateOutputHash(cascadeOutput)
    };
    
    // Store in memory
    this.outputHistory.set(sequenceId, historicalRecord);
    
    // Append to history file
    const line = JSON.stringify(historicalRecord) + '\n';
    await fs.appendFile(this.historyPath, line, 'utf8');
    
    console.log(`[CASCADE REPLAY] Stored output for sequence ${sequenceId}`);
  }

  // Replay single event
  async replayEvent(sequenceId, compareWithHistory = true) {
    const replayStart = Date.now();
    const replayId = `replay_${sequenceId}_${Date.now()}`;
    
    try {
      console.log(`[CASCADE REPLAY] Replaying event ${sequenceId}`);
      
      // Get raw event from ledger
      const rawRecord = await rawEventLedger.getRawEvent(sequenceId);
      if (!rawRecord) {
        throw new Error(`Raw event not found: ${sequenceId}`);
      }
      
      // Replay through CASCADE
      const replayOutput = await cascade.processEvent(
        rawRecord.raw_event,
        rawRecord.source_metadata.source
      );
      
      // Sanitize output for comparison
      const sanitizedOutput = this.sanitizeOutput(replayOutput);
      
      // Compare with historical output if requested
      let driftDetected = null;
      if (compareWithHistory) {
        driftDetected = await this.compareWithHistorical(sequenceId, sanitizedOutput);
      }
      
      const replayResult = {
        replay_id: replayId,
        sequence_id: sequenceId,
        replay_timestamp: new Date().toISOString(),
        original_timestamp: rawRecord.received_at,
        replay_output: sanitizedOutput,
        drift_detected: driftDetected,
        replay_duration_ms: Date.now() - replayStart
      };
      
      // Update statistics
      this.updateStats(replayResult);
      
      // Emit result
      this.emit('replay_completed', replayResult);
      
      if (driftDetected) {
        console.log(`[CASCADE REPLAY] DRIFT DETECTED in sequence ${sequenceId}`);
        this.emit('real_drift_detected', driftDetected);
      }
      
      return replayResult;
      
    } catch (error) {
      console.error(`[CASCADE REPLAY] Replay failed for ${sequenceId}:`, error);
      
      const errorResult = {
        replay_id: replayId,
        sequence_id: sequenceId,
        error: error.message,
        failed: true
      };
      
      this.emit('replay_failed', errorResult);
      throw error;
    }
  }

  // Replay batch of events
  async replayBatch(fromSequence, toSequence, compareWithHistory = true) {
    console.log(`[CASCADE REPLAY] Starting batch replay: ${fromSequence} to ${toSequence}`);
    
    const batchStart = Date.now();
    const results = [];
    
    // Get events to replay
    const rawEvents = await rawEventLedger.readRawEvents(fromSequence, toSequence);
    
    // Process in batches
    for (let i = 0; i < rawEvents.length; i += this.config.batchSize) {
      const batch = rawEvents.slice(i, i + this.config.batchSize);
      
      console.log(`[CASCADE REPLAY] Processing batch ${Math.floor(i / this.config.batchSize) + 1}/${Math.ceil(rawEvents.length / this.config.batchSize)}`);
      
      // Process batch events
      const batchPromises = batch.map(async (event) => {
        try {
          return await this.replayEvent(event.sequence_id, compareWithHistory);
        } catch (error) {
          return {
            sequence_id: event.sequence_id,
            error: error.message,
            failed: true
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const batchResult = {
      from_sequence: fromSequence,
      to_sequence: toSequence,
      total_events: rawEvents.length,
      replay_results: results,
      successful: results.filter(r => !r.failed).length,
      failed: results.filter(r => r.failed).length,
      drift_events: results.filter(r => r.drift_detected).length,
      batch_duration_ms: Date.now() - batchStart
    };
    
    console.log(`[CASCADE REPLAY] Batch complete: ${batchResult.successful}/${batchResult.total_events} successful`);
    
    return batchResult;
  }

  // Compare replay output with historical output
  async compareWithHistorical(sequenceId, currentOutput) {
    const historical = this.outputHistory.get(sequenceId);
    
    if (!historical) {
      return {
        type: 'NO_HISTORICAL_DATA',
        sequence_id: sequenceId,
        message: 'No historical output to compare'
      };
    }
    
    // Compare outputs
    const differences = this.findOutputDifferences(
      historical.cascade_output,
      currentOutput
    );
    
    if (differences.length === 0) {
      return null; // No drift
    }
    
    // Calculate drift severity
    const driftSeverity = this.calculateDriftSeverity(differences);
    
    return {
      type: 'OUTPUT_DRIFT',
      sequence_id: sequenceId,
      historical_timestamp: historical.stored_at,
      differences: differences,
      severity: driftSeverity,
      confidence: this.calculateDriftConfidence(differences)
    };
  }

  // Find differences between two outputs
  findOutputDifferences(output1, output2) {
    const differences = [];
    
    // Compare classification
    if (output1.classification?.classification !== output2.classification?.classification) {
      differences.push({
        field: 'classification',
        historical: output1.classification?.classification,
        current: output2.classification?.classification,
        impact: 'HIGH'
      });
    }
    
    // Compare confidence
    const conf1 = output1.confidence || 0;
    const conf2 = output2.confidence || 0;
    if (Math.abs(conf1 - conf2) > this.config.comparisonThreshold) {
      differences.push({
        field: 'confidence',
        historical: conf1,
        current: conf2,
        impact: conf2 < conf1 ? 'HIGH' : 'MEDIUM'
      });
    }
    
    // Compare status
    if (output1.status !== output2.status) {
      differences.push({
        field: 'status',
        historical: output1.status,
        current: output2.status,
        impact: 'HIGH'
      });
    }
    
    // Compare fingerprint
    if (output1.fingerprint !== output2.fingerprint) {
      differences.push({
        field: 'fingerprint',
        historical: output1.fingerprint?.substring(0, 16) + '...',
        current: output2.fingerprint?.substring(0, 16) + '...',
        impact: 'MEDIUM'
      });
    }
    
    return differences;
  }

  // Calculate drift severity
  calculateDriftSeverity(differences) {
    const highImpactCount = differences.filter(d => d.impact === 'HIGH').length;
    
    if (highImpactCount >= 2) return 'CRITICAL';
    if (highImpactCount >= 1) return 'HIGH';
    if (differences.length >= 2) return 'MEDIUM';
    return 'LOW';
  }

  // Calculate drift confidence
  calculateDriftConfidence(differences) {
    const impactWeights = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const totalWeight = differences.reduce((sum, diff) => sum + impactWeights[diff.impact], 0);
    const maxWeight = differences.length * 3;
    
    return Math.min(totalWeight / maxWeight, 1.0);
  }

  // Sanitize output for comparison (remove dynamic fields)
  sanitizeOutput(output) {
    const sanitized = { ...output };
    
    // Remove fields that shouldn't be compared
    delete sanitized.timestamp;
    delete sanitized.processing_time_ms;
    delete sanitized.stats;
    
    return sanitized;
  }

  // Calculate output hash
  calculateOutputHash(output) {
    const sanitized = this.sanitizeOutput(output);
    return require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(sanitized))
      .digest('hex');
  }

  // Load output history from file
  async loadOutputHistory() {
    try {
      const data = await fs.readFile(this.historyPath, 'utf8');
      const lines = data.trim().split('\n');
      
      for (const line of lines) {
        if (!line) continue;
        const record = JSON.parse(line);
        this.outputHistory.set(record.sequence_id, record);
      }
      
      console.log(`[CASCADE REPLAY] Loaded ${this.outputHistory.size} historical outputs`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[CASCADE REPLAY] Failed to load history:', error);
      }
    }
  }

  // Update statistics
  updateStats(replayResult) {
    this.stats.totalReplays++;
    
    if (!replayResult.failed) {
      this.stats.successfulReplays++;
      
      // Update average replay time
      const totalTime = this.stats.averageReplayTime * (this.stats.successfulReplays - 1) + replayResult.replay_duration_ms;
      this.stats.averageReplayTime = totalTime / this.stats.successfulReplays;
    }
    
    if (replayResult.drift_detected) {
      this.stats.driftEventsDetected++;
    }
    
    this.stats.lastReplayAt = new Date().toISOString();
  }

  // Get replay statistics
  getStats() {
    return {
      ...this.stats,
      historical_outputs_count: this.outputHistory.size,
      active_replays: this.activeReplays.size,
      drift_rate: this.stats.totalReplays > 0 
        ? (this.stats.driftEventsDetected / this.stats.totalReplays * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  // Get drift report
  getDriftReport(limit = 50) {
    const driftEvents = this.replayHistory
      .filter(r => r.drift_detected)
      .sort((a, b) => new Date(b.replay_timestamp) - new Date(a.replay_timestamp))
      .slice(0, limit);
    
    return {
      total_drift_events: this.stats.driftEventsDetected,
      drift_rate: this.stats.totalReplays > 0 
        ? (this.stats.driftEventsDetected / this.stats.totalReplays * 100).toFixed(2) + '%'
        : '0%',
      recent_drifts: driftEvents,
      severity_distribution: this.calculateSeverityDistribution(driftEvents)
    };
  }

  // Calculate severity distribution
  calculateSeverityDistribution(driftEvents) {
    const distribution = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0
    };
    
    driftEvents.forEach(event => {
      if (event.drift_detected && event.drift_detected.severity) {
        distribution[event.drift_detected.severity]++;
      }
    });
    
    return distribution;
  }

  // Clean old history
  async cleanOldHistory() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.historyRetention);
    
    let cleaned = 0;
    for (const [sequenceId, record] of this.outputHistory.entries()) {
      if (new Date(record.stored_at) < cutoffDate) {
        this.outputHistory.delete(sequenceId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[CASCADE REPLAY] Cleaned ${cleaned} old historical records`);
    }
  }
}

// Create singleton instance
const cascadeReplaySystem = new CascadeReplaySystem();

// Export the replay system
module.exports = cascadeReplaySystem;
