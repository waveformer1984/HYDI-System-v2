// Readiness Gate - Final integration gate (go/no-go control)
// System is "READY" only if:
// CASCADE error rate < 2%
// quarantine stable or decreasing
// KILO confidence average > 0.7
// no unresolved dead-letter backlog
// Otherwise system remains in "STABILIZATION MODE"

const EventEmitter = require('events');

class ReadinessGate extends EventEmitter {
  constructor() {
    super();
    
    // Readiness thresholds
    this.thresholds = {
      cascadeErrorRate: 0.02,        // 2% max error rate
      kiloConfidenceMin: 0.7,        // 0.7 min confidence average
      quarantineGrowthMax: 0,        // Quarantine must be stable or decreasing
      deadLetterBacklogMax: 0        // No unresolved dead-letter backlog
    };
    
    // System state
    this.systemState = 'STABILIZATION_MODE'; // Start in stabilization mode
    this.lastEvaluation = null;
    this.evaluationInterval = null;
    this.evalIntervalMs = 30000; // Evaluate every 30 seconds
    
    // Metrics tracking
    this.metrics = {
      cascade: {
        errorRate: 0,
        eventsProcessed: 0,
        eventsRejected: 0
      },
      kilo: {
        confidenceSum: 0,
        confidenceCount: 0,
        confidenceAverage: 0
      },
      quarantine: {
        currentSize: 0,
        previousSize: 0,
        growthRate: 0
      },
      deadLetters: {
        backlogCount: 0
      }
    };
    
    console.log('[READINESS GATE] Initialized in STABILIZATION_MODE');
  }
  
  // Start readiness evaluation
  start() {
    if (this.evaluationInterval) {
      console.log('[READINESS GATE] Already running');
      return;
    }
    
    console.log('[READINESS GATE] Starting readiness evaluation');
    this.evaluateReadiness(); // Initial evaluation
    
    // Set up periodic evaluation
    this.evaluationInterval = setInterval(() => {
      this.evaluateReadiness();
    }, this.evalIntervalMs);
  }
  
  // Stop readiness evaluation
  stop() {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = null;
      console.log('[READINESS GATE] Stopped readiness evaluation');
    }
  }
  
  // Update CASCADE metrics
  updateCascadeMetrics(processed, rejected) {
    this.metrics.cascade.eventsProcessed = processed;
    this.metrics.cascade.eventsRejected = rejected;
    this.metrics.cascade.errorRate = processed > 0 ? rejected / processed : 0;
  }
  
  // Update KILO metrics
  updateKiloMetrics(confidence) {
    this.metrics.kilo.confidenceSum += confidence;
    this.metrics.kilo.confidenceCount++;
    this.metrics.kilo.confidenceAverage = this.metrics.kilo.confidenceSum / this.metrics.kilo.confidenceCount;
  }
  
  // Update quarantine metrics
  updateQuarantineMetrics(currentSize) {
    this.metrics.quarantine.previousSize = this.metrics.quarantine.currentSize;
    this.metrics.quarantine.currentSize = currentSize;
    this.metrics.quarantine.growthRate = currentSize - this.metrics.quarantine.previousSize;
  }
  
  // Update dead letter metrics
  updateDeadLetterMetrics(backlogCount) {
    this.metrics.deadLetters.backlogCount = backlogCount;
  }
  
  // Evaluate system readiness
  evaluateReadiness() {
    const now = new Date();
    this.lastEvaluation = now.toISOString();
    
    // Check all readiness conditions
    const conditions = {
      cascadeErrorRateOk: this.metrics.cascade.errorRate < this.thresholds.cascadeErrorRate,
      quarantineStableOrDecreasing: this.metrics.quarantine.growthRate <= this.thresholds.quarantineGrowthMax,
      kiloConfidenceOk: this.metrics.kilo.confidenceAverage >= this.thresholds.kiloConfidenceMin,
      noDeadLetterBacklog: this.metrics.deadLetters.backlogCount <= this.thresholds.deadLetterBacklogMax
    };
    
    // Determine if system is ready
    const allConditionsMet = Object.values(conditions).every(Boolean);
    const newState = allConditionsMet ? 'READY' : 'STABILIZATION_MODE';
    
    // Only emit if state changed
    if (newState !== this.systemState) {
      const oldState = this.systemState;
      this.systemState = newState;
      
      console.log(`[READINESS GATE] State changed: ${oldState} → ${newState}`);
      console.log(`[READINESS GATE] Conditions:`, JSON.stringify(conditions, null, 2));
      console.log(`[READINESS GATE] Metrics:`, JSON.stringify(this.metrics, null, 2));
      
      // Emit state change event
      this.emit('readiness_state_changed', {
        timestamp: this.lastEvaluation,
        oldState: oldState,
        newState: newState,
        conditions: conditions,
        metrics: this.metrics
      });
    }
    
    return {
      state: this.systemState,
      timestamp: this.lastEvaluation,
      conditions: conditions,
      metrics: this.metrics
    };
  }
  
  // Get current readiness status
  getStatus() {
    return {
      state: this.systemState,
      last_evaluation: this.lastEvaluation,
      thresholds: this.thresholds,
      metrics: this.metrics,
      conditions: {
        cascadeErrorRateOk: this.metrics.cascade.errorRate < this.thresholds.cascadeErrorRate,
        quarantineStableOrDecreasing: this.metrics.quarantine.growthRate <= this.thresholds.quarantineGrowthMax,
        kiloConfidenceOk: this.metrics.kilo.confidenceAverage >= this.thresholds.kiloConfidenceMin,
        noDeadLetterBacklog: this.metrics.deadLetters.backlogCount <= this.thresholds.deadLetterBacklogMax
      }
    };
  }
  
  // Get detailed readiness report
  getReadinessReport() {
    const status = this.getStatus();
    const allConditionsMet = Object.values(status.conditions).every(Boolean);
    
    return {
      ...status,
      ready: allConditionsMet,
      blocking_conditions: Object.entries(status.conditions)
        .filter(([key, value]) => !value)
        .map(([key, value]) => key),
      recommendation: allConditionsMet 
        ? 'System is ready for normal operations' 
        : `System requires stabilization. Blocking conditions: ${Object.entries(status.conditions)
            .filter(([key, value]) => !value)
            .map(([key, value]) => key)
            .join(', ')}`
    };
  }
}

// Create singleton instance
const readinessGate = new ReadinessGate();

module.exports = { ReadinessGate, readinessGate };