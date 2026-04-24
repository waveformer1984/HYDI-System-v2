// No Silent Success Enforcer - Ensures every cycle emits explicit state
// Prevents ambiguous completion states in CASCADE → KILO → ProtoForge cycles

const EventEmitter = require('events');
const { checkPermission } = require('./system-contract-guard-v2');

class NoSilentSuccessEnforcer extends EventEmitter {
  constructor() {
    super();
    
    // Track active cycles
    this.activeCycles = new Map();
    this.cycleTimeout = 300000; // 5 minutes max cycle time
    
    // Required states for each cycle
    this.requiredStates = {
      cascade: ['processed', 'rejected', 'quarantined'],
      kilo: ['manifest_generated', 'repair_attempted', 'repair_aborted'],
      protoforge: ['success', 'failure', 'degraded']
    };
    
    // State tracking
    this.cycleHistory = [];
    this.maxHistorySize = 1000;
    
    // Violation tracking
    this.violations = [];
    
    // Timeout checker
    this.timeoutInterval = null;
    
    this.initialize();
  }

  initialize() {
    console.log('[NO SILENT SUCCESS] Initialized - Tracking all system cycles');
    
    // Start timeout checker
    this.startTimeoutChecker();
  }

  // Start a new cycle
  startCycle(cycleId, initiator, context = {}) {
    checkPermission('SYSTEM', 'track_cycle', { cycleId, initiator });
    
    const cycle = {
      id: cycleId,
      initiator: initiator,
      context: context,
      started_at: new Date().toISOString(),
      states: new Map(),
      current_stage: initiator,
      status: 'active',
      timeout_at: new Date(Date.now() + this.cycleTimeout).toISOString()
    };
    
    this.activeCycles.set(cycleId, cycle);
    
    console.log(`[NO SILENT SUCCESS] Cycle started: ${cycleId} by ${initiator}`);
    
    return cycle;
  }

  // Record state transition in cycle
  recordState(cycleId, stage, state, details = {}) {
    const cycle = this.activeCycles.get(cycleId);
    
    if (!cycle) {
      // Log violation for unknown cycle
      this.logViolation('UNKNOWN_CYCLE_STATE', {
        cycle_id: cycleId,
        stage: stage,
        state: state,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // Validate state is allowed for stage
    if (!this.requiredStates[stage]) {
      this.logViolation('UNKNOWN_STAGE', {
        cycle_id: cycleId,
        stage: stage,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    if (!this.requiredStates[stage].includes(state)) {
      this.logViolation('INVALID_STATE', {
        cycle_id: cycleId,
        stage: stage,
        state: state,
        allowed_states: this.requiredStates[stage],
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // Record the state
    cycle.states.set(stage, {
      state: state,
      timestamp: new Date().toISOString(),
      details: details
    });
    
    cycle.current_stage = stage;
    cycle.last_activity = new Date().toISOString();
    
    console.log(`[NO SILENT SUCCESS] ${cycleId}: ${stage} → ${state}`);
    
    // Check if cycle is complete
    this.checkCycleCompletion(cycleId);
  }

  // Check if cycle has completed all required stages
  checkCycleCompletion(cycleId) {
    const cycle = this.activeCycles.get(cycleId);
    if (!cycle) return;
    
    // Check if all stages have states
    const completedStages = Array.from(cycle.states.keys());
    const requiredStages = ['cascade', 'kilo', 'protoforge'];
    
    if (requiredStages.every(stage => completedStages.includes(stage))) {
      // Cycle is complete
      cycle.status = 'completed';
      cycle.completed_at = new Date().toISOString();
      
      // Move to history
      this.cycleHistory.push(cycle);
      this.activeCycles.delete(cycleId);
      
      // Trim history
      if (this.cycleHistory.length > this.maxHistorySize) {
        this.cycleHistory = this.cycleHistory.slice(-this.maxHistorySize);
      }
      
      console.log(`[NO SILENT SUCCESS] Cycle completed: ${cycleId}`);
      
      // Emit completion event
      this.emit('cycle_completed', {
        cycle_id: cycleId,
        duration: this.calculateCycleDuration(cycle),
        final_states: Object.fromEntries(cycle.states)
      });
    }
  }

  // Force complete a cycle (for error conditions)
  forceCompleteCycle(cycleId, reason, finalState = 'failure') {
    const cycle = this.activeCycles.get(cycleId);
    
    if (!cycle) return;
    
    // Mark as force completed
    cycle.status = 'force_completed';
    cycle.force_completed_at = new Date().toISOString();
    cycle.force_completion_reason = reason;
    
    // Add final state if missing
    if (!cycle.states.has(cycle.current_stage)) {
      cycle.states.set(cycle.current_stage, {
        state: finalState,
        timestamp: new Date().toISOString(),
        details: { reason: reason }
      });
    }
    
    // Move to history
    this.cycleHistory.push(cycle);
    this.activeCycles.delete(cycleId);
    
    console.log(`[NO SILENT SUCCESS] Cycle force completed: ${cycleId} - ${reason}`);
    
    // Emit event
    this.emit('cycle_force_completed', {
      cycle_id: cycleId,
      reason: reason,
      final_state: finalState
    });
  }

  // Start timeout checker
  startTimeoutChecker() {
    this.timeoutInterval = setInterval(() => {
      this.checkTimeouts();
    }, 30000); // Check every 30 seconds
  }

  // Check for timed out cycles
  checkTimeouts() {
    const now = new Date();
    const timedOut = [];
    
    this.activeCycles.forEach((cycle, cycleId) => {
      const timeoutTime = new Date(cycle.timeout_at);
      
      if (now > timeoutTime) {
        timedOut.push(cycleId);
      }
    });
    
    // Handle timed out cycles
    timedOut.forEach(cycleId => {
      this.logViolation('CYCLE_TIMEOUT', {
        cycle_id: cycleId,
        timeout_at: this.activeCycles.get(cycleId).timeout_at,
        current_stage: this.activeCycles.get(cycleId).current_stage,
        timestamp: new Date().toISOString()
      });
      
      this.forceCompleteCycle(cycleId, 'TIMEOUT', 'failure');
    });
  }

  // Log violation
  logViolation(type, details) {
    const violation = {
      type: type,
      details: details,
      timestamp: new Date().toISOString()
    };
    
    this.violations.push(violation);
    
    // Log error
    console.error(`[NO SILENT SUCCESS] VIOLATION: ${type}`);
    console.error(`[NO SILENT SUCCESS] Details:`, JSON.stringify(details, null, 2));
    
    // Emit violation event
    this.emit('STATE_AMBIGUOUS_ERROR', violation);
    
    // In a real system, this might trigger alerts
  }

  // Calculate cycle duration
  calculateCycleDuration(cycle) {
    const start = new Date(cycle.started_at);
    const end = new Date(cycle.completed_at || cycle.force_completed_at);
    return end - start;
  }

  // Get cycle statistics
  getStats() {
    const completed = this.cycleHistory.filter(c => c.status === 'completed');
    const forceCompleted = this.cycleHistory.filter(c => c.status === 'force_completed');
    
    // Calculate average duration
    const durations = completed.map(c => this.calculateCycleDuration(c));
    const avgDuration = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;
    
    // Calculate stage completion rates
    const stageStats = {};
    Object.keys(this.requiredStates).forEach(stage => {
      const completedWithStage = completed.filter(c => c.states.has(stage));
      stageStats[stage] = {
        completed: completedWithStage.length,
        rate: completed.length > 0 
          ? (completedWithStage.length / completed.length * 100).toFixed(2) + '%'
          : '0%'
      };
    });
    
    return {
      active_cycles: this.activeCycles.size,
      total_completed: completed.length,
      total_force_completed: forceCompleted.length,
      average_duration_ms: Math.round(avgDuration),
      stage_completion_rates: stageStats,
      violations_count: this.violations.length,
      recent_violations: this.violations.slice(-10)
    };
  }

  // Get active cycles
  getActiveCycles() {
    return Array.from(this.activeCycles.entries()).map(([id, cycle]) => ({
      id: id,
      ...cycle,
      states: Object.fromEntries(cycle.states)
    }));
  }

  // Get cycle history
  getHistory(limit = 50) {
    return this.cycleHistory
      .slice(-limit)
      .reverse()
      .map(cycle => ({
        ...cycle,
        states: Object.fromEntries(cycle.states)
      }));
  }

  // Stop the enforcer
  stop() {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }
    
    // Force complete all active cycles
    const activeIds = Array.from(this.activeCycles.keys());
    activeIds.forEach(id => {
      this.forceCompleteCycle(id, 'SYSTEM_SHUTDOWN', 'failure');
    });
    
    console.log('[NO SILENT SUCCESS] Stopped');
  }
}

// Create singleton instance
const noSilentSuccessEnforcer = new NoSilentSuccessEnforcer();

// Export the enforcer
module.exports = noSilentSuccessEnforcer;
