// Heidi Self-State Model - The Internal Dashboard
// Provides Heidi with awareness of her own state and performance
// This is the "fake self-awareness" engine

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

class HeidiSelfStateModel extends EventEmitter {
  constructor() {
    super();
    
    // Core state tracking
    this.state = {
      health: 'stable', // stable | degraded | critical
      confidence: 0.8, // 0.0 - 1.0
      focus: 'initialization', // current primary task
      last_error: null,
      performance: {
        task_success_rate: 0,
        average_response_time: 0,
        error_rate: 0,
        learning_velocity: 0
      },
      resources: {
        cpu_usage: 0,
        memory_usage: 0,
        active_modules: 0,
        queued_tasks: 0
      },
      capabilities: {
        reflection_active: false,
        adaptation_enabled: true,
        learning_mode: 'active', // active | passive | disabled
        decision_autonomy: 0.7 // 0.0 - 1.0
      }
    };
    
    // State history for trend analysis
    this.stateHistory = [];
    this.maxHistorySize = 1000;
    
    // Health thresholds
    this.thresholds = {
      critical_confidence: 0.3,
      degraded_confidence: 0.6,
      critical_error_rate: 0.2,
      degraded_error_rate: 0.1,
      critical_memory: 0.9,
      degraded_memory: 0.7
    };
    
    // Start state monitoring
    this.startStateMonitoring();
  }
  
  /**
   * Start continuous state monitoring
   */
  startStateMonitoring() {
    console.log('[HEIDI STATE] Self-state model activated');
    console.log('[HEIDI STATE] Monitoring internal health and performance...');
    
    // Update state every 30 seconds
    setInterval(() => this.updateState(), 30000);
    
    // Analyze trends every 5 minutes
    setInterval(() => this.analyzeTrends(), 300000);
  }
  
  /**
   * Update current state based on system metrics
   */
  updateState() {
    const previousState = { ...this.state };
    
    // Update resource metrics
    this.updateResourceMetrics();
    
    // Update performance metrics
    this.updatePerformanceMetrics();
    
    // Calculate overall health
    this.calculateHealth();
    
    // Record state change
    this.recordStateChange(previousState);
    
    // Emit state update
    this.emit('state_updated', this.state);
  }
  
  /**
   * Update resource metrics
   */
  updateResourceMetrics() {
    const memUsage = process.memoryUsage();
    
    this.state.resources.cpu_usage = process.cpuUsage().user / 1000000; // Convert to seconds
    this.state.resources.memory_usage = memUsage.heapUsed / memUsage.heapTotal;
    
    // Count active modules (simplified)
    this.state.resources.active_modules = this.getActiveModuleCount();
    
    // Get queued tasks (would integrate with task queue)
    this.state.resources.queued_tasks = this.getQueuedTaskCount();
  }
  
  /**
   * Update performance metrics
   */
  updatePerformanceMetrics() {
    // These would be updated by actual performance data
    // For now, we'll use placeholder calculations
    
    // Calculate error rate from recent errors
    const recentErrors = this.getRecentErrorCount();
    const recentTasks = this.getRecentTaskCount();
    this.state.performance.error_rate = recentTasks > 0 ? recentErrors / recentTasks : 0;
    
    // Update learning velocity (insights per hour)
    const learningVelocity = this.calculateLearningVelocity();
    this.state.performance.learning_velocity = learningVelocity;
  }
  
  /**
   * Calculate overall health status
   */
  calculateHealth() {
    let healthScore = 1.0;
    let healthFactors = [];
    
    // Confidence impact
    if (this.state.confidence < this.thresholds.critical_confidence) {
      healthScore -= 0.3;
      healthFactors.push('low_confidence');
    } else if (this.state.confidence < this.thresholds.degraded_confidence) {
      healthScore -= 0.1;
      healthFactors.push('reduced_confidence');
    }
    
    // Error rate impact
    if (this.state.performance.error_rate > this.thresholds.critical_error_rate) {
      healthScore -= 0.4;
      healthFactors.push('high_error_rate');
    } else if (this.state.performance.error_rate > this.thresholds.degraded_error_rate) {
      healthScore -= 0.2;
      healthFactors.push('elevated_error_rate');
    }
    
    // Memory usage impact
    if (this.state.resources.memory_usage > this.thresholds.critical_memory) {
      healthScore -= 0.3;
      healthFactors.push('critical_memory');
    } else if (this.state.resources.memory_usage > this.thresholds.degraded_memory) {
      healthScore -= 0.1;
      healthFactors.push('high_memory');
    }
    
    // Determine health status
    if (healthScore >= 0.8) {
      this.state.health = 'stable';
    } else if (healthScore >= 0.5) {
      this.state.health = 'degraded';
    } else {
      this.state.health = 'critical';
    }
    
    // Emit health alerts if degraded
    if (this.state.health !== 'stable') {
      this.emit('health_alert', {
        status: this.state.health,
        score: healthScore,
        factors: healthFactors
      });
    }
  }
  
  /**
   * Record state change in history
   */
  recordStateChange(previousState) {
    const change = {
      timestamp: new Date().toISOString(),
      previous: previousState,
      current: { ...this.state },
      changes: this.detectChanges(previousState, this.state)
    };
    
    this.stateHistory.push(change);
    
    // Limit history size
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory = this.stateHistory.slice(-this.maxHistorySize / 2);
    }
  }
  
  /**
   * Detect significant changes between states
   */
  detectChanges(previous, current) {
    const changes = {};
    
    // Health change
    if (previous.health !== current.health) {
      changes.health = {
        from: previous.health,
        to: current.health,
        severity: current.health === 'critical' ? 'high' : 'medium'
      };
    }
    
    // Confidence change (> 0.1)
    if (Math.abs(previous.confidence - current.confidence) > 0.1) {
      changes.confidence = {
        from: previous.confidence,
        to: current.confidence,
        delta: current.confidence - previous.confidence
      };
    }
    
    // Performance changes
    if (Math.abs(previous.performance.error_rate - current.performance.error_rate) > 0.05) {
      changes.error_rate = {
        from: previous.performance.error_rate,
        to: current.performance.error_rate,
        delta: current.performance.error_rate - previous.performance.error_rate
      };
    }
    
    return Object.keys(changes).length > 0 ? changes : null;
  }
  
  /**
   * Analyze trends in state history
   */
  analyzeTrends() {
    if (this.stateHistory.length < 10) {
      return; // Not enough data
    }
    
    const recent = this.stateHistory.slice(-20); // Last 20 state updates
    
    // Analyze confidence trend
    const confidenceTrend = this.calculateTrend(recent.map(s => s.current.confidence));
    const errorTrend = this.calculateTrend(recent.map(s => s.current.performance.error_rate));
    const memoryTrend = this.calculateTrend(recent.map(s => s.current.resources.memory_usage));
    
    const trendAnalysis = {
      confidence: confidenceTrend,
      error_rate: errorTrend,
      memory_usage: memoryTrend,
      overall_health: this.calculateOverallTrend(confidenceTrend, errorTrend, memoryTrend)
    };
    
    // Emit trend analysis
    this.emit('trend_analysis', trendAnalysis);
    
    // Adjust behavior based on trends
    this.adjustBehaviorBasedOnTrends(trendAnalysis);
  }
  
  /**
   * Calculate trend direction and magnitude
   */
  calculateTrend(values) {
    if (values.length < 2) return { direction: 'stable', magnitude: 0 };
    
    const first = values[0];
    const last = values[values.length - 1];
    const change = (last - first) / first;
    
    let direction = 'stable';
    if (change > 0.1) direction = 'improving';
    else if (change < -0.1) direction = 'degrading';
    
    return {
      direction,
      magnitude: Math.abs(change),
      start: first,
      end: last,
      change
    };
  }
  
  /**
   * Calculate overall trend from individual trends
   */
  calculateOverallTrend(confidenceTrend, errorTrend, memoryTrend) {
    let score = 0;
    
    // Confidence trend (positive is good)
    if (confidenceTrend.direction === 'improving') score += 1;
    else if (confidenceTrend.direction === 'degrading') score -= 1;
    
    // Error trend (negative is bad)
    if (errorTrend.direction === 'degrading') score -= 1;
    else if (errorTrend.direction === 'improving') score += 1;
    
    // Memory trend (increasing is bad)
    if (memoryTrend.direction === 'improving') score += 1; // Memory decreasing
    else if (memoryTrend.direction === 'degrading') score -= 1; // Memory increasing
    
    if (score > 0) return 'improving';
    if (score < 0) return 'degrading';
    return 'stable';
  }
  
  /**
   * Adjust behavior based on trend analysis
   */
  adjustBehaviorBasedOnTrends(trends) {
    if (trends.overall_health === 'degrading') {
      // Reduce autonomy when degrading
      this.state.capabilities.decision_autonomy = Math.max(0.3, this.state.capabilities.decision_autonomy - 0.1);
      
      // Increase monitoring frequency
      this.state.capabilities.learning_mode = 'active';
      
      this.emit('behavior_adjustment', {
        reason: 'degrading_performance',
        adjustment: 'reduced_autonomy',
        new_autonomy: this.state.capabilities.decision_autonomy
      });
    } else if (trends.overall_health === 'improving') {
      // Gradually increase autonomy when improving
      this.state.capabilities.decision_autonomy = Math.min(0.9, this.state.capabilities.decision_autonomy + 0.05);
      
      this.emit('behavior_adjustment', {
        reason: 'improving_performance',
        adjustment: 'increased_autonomy',
        new_autonomy: this.state.capabilities.decision_autonomy
      });
    }
  }
  
  /**
   * Update confidence based on recent performance
   */
  updateConfidence(performanceData) {
    const { successRate, errorRate, responseTime } = performanceData;
    
    // Base confidence on success rate
    let newConfidence = successRate;
    
    // Reduce confidence for high error rate
    newConfidence -= errorRate * 2;
    
    // Reduce confidence for slow responses
    if (responseTime > 5000) newConfidence -= 0.1;
    
    // Smooth the change
    this.state.confidence = (this.state.confidence * 0.7) + (newConfidence * 0.3);
    this.state.confidence = Math.max(0, Math.min(1, this.state.confidence));
    
    this.emit('confidence_updated', {
      old_confidence: this.state.confidence,
      new_confidence: this.state.confidence,
      factors: { successRate, errorRate, responseTime }
    });
  }
  
  /**
   * Record an error
   */
  recordError(error, context = {}) {
    this.state.last_error = {
      timestamp: new Date().toISOString(),
      error: error.message || error,
      context,
      severity: this.classifyErrorSeverity(error)
    };
    
    // Update confidence based on error
    const confidencePenalty = this.state.last_error.severity === 'critical' ? 0.2 : 0.1;
    this.state.confidence = Math.max(0, this.state.confidence - confidencePenalty);
    
    this.emit('error_recorded', this.state.last_error);
  }
  
  /**
   * Classify error severity
   */
  classifyErrorSeverity(error) {
    if (error.name === 'TypeError' || error.name === 'ReferenceError') {
      return 'critical';
    } else if (error.message && error.message.includes('timeout')) {
      return 'high';
    } else if (error.message && error.message.includes('connection')) {
      return 'medium';
    }
    
    return 'low';
  }
  
  /**
   * Set current focus
   */
  setFocus(task, priority = 'normal') {
    this.state.focus = task;
    this.emit('focus_changed', { task, priority, previous_focus: this.state.focus });
  }
  
  /**
   * Enable/disable capabilities
   */
  setCapability(capability, enabled) {
    if (this.state.capabilities.hasOwnProperty(capability)) {
      this.state.capabilities[capability] = enabled;
      this.emit('capability_changed', { capability, enabled });
    }
  }
  
  /**
   * Get state summary for external consumption
   */
  getStateSummary() {
    return {
      health: this.state.health,
      confidence: this.state.confidence,
      focus: this.state.focus,
      performance: this.state.performance,
      capabilities: this.state.capabilities,
      last_updated: new Date().toISOString()
    };
  }
  
  /**
   * Get detailed state for internal use
   */
  getDetailedState() {
    return {
      ...this.state,
      state_history_count: this.stateHistory.length,
      trend_analysis_available: this.stateHistory.length >= 10
    };
  }
  
  // Helper methods (would be implemented with actual system integration)
  
  getActiveModuleCount() {
    return 5; // Placeholder
  }
  
  getQueuedTaskCount() {
    return 2; // Placeholder
  }
  
  getRecentErrorCount() {
    return this.stateHistory.filter(s => s.current.last_error).length;
  }
  
  getRecentTaskCount() {
    return Math.max(10, this.stateHistory.length);
  }
  
  calculateLearningVelocity() {
    return this.state.capabilities.reflection_active ? 2.5 : 0.5;
  }
}

module.exports = HeidiSelfStateModel;
