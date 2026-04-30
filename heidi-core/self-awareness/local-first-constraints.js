/**
 * HEIDI Local-First Constraints Manager
 * Ensures LOCAL > HYBRID > EXTERNAL priority with fallbacks
 */

const EventEmitter = require('events');

class LocalFirstConstraints extends EventEmitter {
  constructor() {
    super();
    
    this.constraints = {
      local_priority: true,
      allow_hybrid: false,
      allow_external: false,
      fallback_enabled: true,
      degraded_mode_enabled: true
    };
    
    this.adapters = {
      local: null,
      hybrid: null,
      external: null
    };
    
    this.mode = 'local'; // local, hybrid, external, degraded
    this.fallbackChain = [];
    this.performanceHistory = [];
  }

  /**
   * Configure local-first constraints
   */
  configureConstraints(config = {}) {
    this.constraints = {
      local_priority: config.local_priority !== false, // Default true
      allow_hybrid: config.allow_hybrid === true, // Default false
      allow_external: config.allow_external === true, // Default false
      fallback_enabled: config.fallback_enabled !== false, // Default true
      degraded_mode_enabled: config.degraded_mode_enabled !== false // Default true
    };

    console.log('[Local-First] Constraints configured:', this.constraints);
    this.emit('constraints_updated', this.constraints);
  }

  /**
   * Register adapters for different modes
   */
  registerAdapter(mode, adapter) {
    if (!this.adapters.hasOwnProperty(mode)) {
      throw new Error(`Invalid adapter mode: ${mode}`);
    }
    
    this.adapters[mode] = adapter;
    console.log(`[Local-First] Adapter registered for mode: ${mode}`);
  }

  /**
   * Execute with local-first constraints
   */
  async execute(input, options = {}) {
    const executionPlan = this.createExecutionPlan(options);
    
    try {
      // Try local first
      if (executionPlan.local && this.adapters.local) {
        const result = await this.executeWithAdapter('local', input, options);
        this.recordPerformance('local', true, Date.now() - options.startTime);
        return result;
      }

      // Fallback to hybrid if allowed
      if (executionPlan.hybrid && this.constraints.allow_hybrid && this.adapters.hybrid) {
        console.log('[Local-First] Falling back to hybrid mode');
        const result = await this.executeWithAdapter('hybrid', input, options);
        this.recordPerformance('hybrid', true, Date.now() - options.startTime);
        return result;
      }

      // Fallback to external if allowed
      if (executionPlan.external && this.constraints.allow_external && this.adapters.external) {
        console.log('[Local-First] Falling back to external mode');
        const result = await this.executeWithAdapter('external', input, options);
        this.recordPerformance('external', true, Date.now() - options.startTime);
        return result;
      }

      // Fallback to degraded mode
      if (this.constraints.degraded_mode_enabled) {
        console.log('[Local-First] Using degraded mode');
        return this.executeDegradedMode(input, options);
      }

      throw new Error('No execution mode available');

    } catch (error) {
      this.recordPerformance(this.mode, false, Date.now() - options.startTime);
      
      // Try next fallback if available
      const nextMode = this.getNextFallbackMode(this.mode);
      if (nextMode && this.constraints.fallback_enabled) {
        console.log(`[Local-First] ${this.mode} failed, trying ${nextMode}`);
        this.mode = nextMode;
        return this.execute(input, options);
      }
      
      throw error;
    }
  }

  /**
   * Create execution plan based on constraints and options
   */
  createExecutionPlan(options = {}) {
    const plan = {
      local: true, // Always try local first
      hybrid: false,
      external: false
    };

    // Allow hybrid if explicitly requested or local fails repeatedly
    if (options.allowHybrid || this.shouldAllowHybrid()) {
      plan.hybrid = this.constraints.allow_hybrid;
    }

    // Allow external if explicitly requested or all else fails
    if (options.allowExternal || this.shouldAllowExternal()) {
      plan.external = this.constraints.allow_external;
    }

    return plan;
  }

  /**
   * Execute with specific adapter
   */
  async executeWithAdapter(mode, input, options) {
    if (!this.adapters[mode]) {
      throw new Error(`No adapter available for mode: ${mode}`);
    }

    this.mode = mode;
    const startTime = Date.now();
    
    try {
      const result = await this.adapters[mode].execute(input, {
        ...options,
        mode,
        timeout: this.getTimeoutForMode(mode)
      });
      
      const executionTime = Date.now() - startTime;
      this.emit('execution_success', { mode, executionTime, result });
      
      return result;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.emit('execution_error', { mode, executionTime, error });
      throw error;
    }
  }

  /**
   * Execute in degraded mode (local simulation)
   */
  async executeDegradedMode(input, options) {
    console.log('[Local-First] Executing in degraded mode');
    
    // Simulate processing with basic logic
    const degradedResult = {
      mode: 'degraded',
      input: this.sanitizeInput(input),
      output: this.generateDegradedOutput(input),
      confidence: 0.3, // Low confidence in degraded mode
      warnings: ['Running in degraded mode - limited functionality'],
      timestamp: new Date().toISOString()
    };

    this.mode = 'degraded';
    this.emit('degraded_mode_used', { input, result: degradedResult });
    
    return degradedResult;
  }

  /**
   * Get timeout for specific mode
   */
  getTimeoutForMode(mode) {
    const timeouts = {
      local: 8000,  // 8 seconds for local
      hybrid: 15000, // 15 seconds for hybrid
      external: 30000 // 30 seconds for external
    };
    
    return timeouts[mode] || 8000;
  }

  /**
   * Determine if hybrid should be allowed
   */
  shouldAllowHybrid() {
    // Allow hybrid if local has failed multiple times recently
    const recentLocalFailures = this.getRecentFailures('local', 5);
    return recentLocalFailures >= 3;
  }

  /**
   * Determine if external should be allowed
   */
  shouldAllowExternal() {
    // Allow external if both local and hybrid have failed
    const recentLocalFailures = this.getRecentFailures('local', 5);
    const recentHybridFailures = this.getRecentFailures('hybrid', 5);
    
    return recentLocalFailures >= 3 && recentHybridFailures >= 3;
  }

  /**
   * Get next fallback mode
   */
  getNextFallbackMode(currentMode) {
    const fallbackOrder = ['local', 'hybrid', 'external', 'degraded'];
    const currentIndex = fallbackOrder.indexOf(currentMode);
    
    if (currentIndex === -1 || currentIndex === fallbackOrder.length - 1) {
      return null;
    }
    
    return fallbackOrder[currentIndex + 1];
  }

  /**
   * Record performance for adaptive behavior
   */
  recordPerformance(mode, success, executionTime) {
    this.performanceHistory.push({
      mode,
      success,
      executionTime,
      timestamp: new Date().toISOString()
    });

    // Keep only last 100 entries
    if (this.performanceHistory.length > 100) {
      this.performanceHistory = this.performanceHistory.slice(-100);
    }

    // Adjust constraints based on performance
    this.adaptConstraints(mode, success, executionTime);
  }

  /**
   * Adapt constraints based on performance patterns
   */
  adaptConstraints(mode, success, executionTime) {
    // If local consistently fails, consider enabling hybrid
    if (mode === 'local' && !success) {
      const recentLocalFailures = this.getRecentFailures('local', 10);
      if (recentLocalFailures >= 5 && !this.constraints.allow_hybrid) {
        console.log('[Local-First] Enabling hybrid mode due to local failures');
        this.constraints.allow_hybrid = true;
        this.emit('constraints_adapted', { reason: 'local_failures', change: 'hybrid_enabled' });
      }
    }

    // If hybrid consistently works, keep it enabled
    if (mode === 'hybrid' && success) {
      const recentHybridSuccess = this.getRecentSuccesses('hybrid', 5);
      if (recentHybridSuccess >= 4) {
        this.constraints.allow_hybrid = true;
      }
    }

    // If external is needed and works, consider keeping it available
    if (mode === 'external' && success) {
      const recentExternalSuccess = this.getRecentSuccesses('external', 3);
      if (recentExternalSuccess >= 2) {
        this.constraints.allow_external = true;
      }
    }
  }

  /**
   * Get recent failures for a mode
   */
  getRecentFailures(mode, limit = 10) {
    const recent = this.performanceHistory
      .filter(p => p.mode === mode && !p.success)
      .slice(-limit);
    
    return recent.length;
  }

  /**
   * Get recent successes for a mode
   */
  getRecentSuccesses(mode, limit = 10) {
    const recent = this.performanceHistory
      .filter(p => p.mode === mode && p.success)
      .slice(-limit);
    
    return recent.length;
  }

  /**
   * Get current mode and constraints
   */
  getCurrentState() {
    return {
      mode: this.mode,
      constraints: { ...this.constraints },
      adapters_available: {
        local: !!this.adapters.local,
        hybrid: !!this.adapters.hybrid,
        external: !!this.adapters.external
      },
      performance_summary: this.getPerformanceSummary(),
      fallback_chain: this.fallbackChain
    };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const summary = {
      total_executions: this.performanceHistory.length,
      mode_performance: {},
      recent_failures: {},
      avg_execution_times: {}
    };

    // Calculate per-mode statistics
    const modes = ['local', 'hybrid', 'external', 'degraded'];
    
    modes.forEach(mode => {
      const modeHistory = this.performanceHistory.filter(p => p.mode === mode);
      const successes = modeHistory.filter(p => p.success);
      const failures = modeHistory.filter(p => !p.success);
      
      summary.mode_performance[mode] = {
        total: modeHistory.length,
        successes: successes.length,
        failures: failures.length,
        success_rate: modeHistory.length > 0 ? successes.length / modeHistory.length : 0
      };
      
      summary.recent_failures[mode] = this.getRecentFailures(mode, 5);
      
      if (modeHistory.length > 0) {
        const totalTime = modeHistory.reduce((sum, p) => sum + p.executionTime, 0);
        summary.avg_execution_times[mode] = totalTime / modeHistory.length;
      }
    });

    return summary;
  }

  /**
   * Force mode change (for testing or manual override)
   */
  forceMode(mode) {
    if (!['local', 'hybrid', 'external', 'degraded'].includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    
    const previousMode = this.mode;
    this.mode = mode;
    
    console.log(`[Local-First] Mode forced: ${previousMode} → ${mode}`);
    this.emit('mode_forced', { previousMode, currentMode: mode });
  }

  /**
   * Reset performance history
   */
  resetPerformanceHistory() {
    this.performanceHistory = [];
    this.mode = 'local';
    console.log('[Local-First] Performance history reset');
  }

  /**
   * Validate local-first constraints are being followed
   */
  validateConstraints() {
    const violations = [];

    // Check if local is being prioritized
    if (this.mode !== 'local' && this.constraints.local_priority) {
      const recentLocalFailures = this.getRecentFailures('local', 3);
      if (recentLocalFailures < 3) {
        violations.push('Not using local mode despite availability and few failures');
      }
    }

    // Check if external is being used without permission
    if (this.mode === 'external' && !this.constraints.allow_external) {
      violations.push('Using external mode without permission');
    }

    // Check if hybrid is being used without permission
    if (this.mode === 'hybrid' && !this.constraints.allow_hybrid) {
      violations.push('Using hybrid mode without permission');
    }

    return {
      valid: violations.length === 0,
      violations,
      current_state: this.getCurrentState()
    };
  }

  // Utility methods
  sanitizeInput(input) {
    if (typeof input === 'string') {
      return input.length > 200 ? input.substring(0, 200) + '...' : input;
    }
    return JSON.stringify(input).length > 200 ? 
      JSON.stringify(input).substring(0, 200) + '...' : 
      JSON.stringify(input);
  }

  generateDegradedOutput(input) {
    // Simple degraded mode response
    if (typeof input === 'string') {
      return `Degraded mode response to: ${this.sanitizeInput(input)}`;
    }
    
    return {
      message: 'Processed in degraded mode',
      input_summary: this.sanitizeInput(input),
      capabilities: 'limited'
    };
  }
}

module.exports = LocalFirstConstraints;
