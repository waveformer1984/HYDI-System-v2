/**
 * Circuit Breaker System
 * Automatic shutdown when things go weird
 */

const EventEmitter = require('events');

class CircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Circuit breaker states
    this.states = {
      CLOSED: 'closed',      // Normal operation
      OPEN: 'open',          // Circuit is open, blocking requests
      HALF_OPEN: 'half_open' // Testing if service recovered
    };
    
    // Configuration
    this.config = {
      // Failure thresholds
      failureThreshold: options.failureThreshold || 5,
      timeoutThreshold: options.timeoutThreshold || 30000, // 30 seconds
      
      // Recovery settings
      recoveryTimeout: options.recoveryTimeout || 60000, // 1 minute
      halfOpenMaxCalls: options.halfOpenMaxCalls || 3,
      
      // Monitoring windows
      monitoringWindow: options.monitoringWindow || 60000, // 1 minute
      statsWindow: options.statsWindow || 300000, // 5 minutes
      
      // Auto-trigger conditions
      maxFailedAuth: options.maxFailedAuth || 10,
      maxSpendingRate: options.maxSpendingRate || 100000, // $1000/min
      maxTrafficSpike: options.maxTrafficSpike || 1000, // requests/min
      
      // Alert settings
      alertChannels: options.alertChannels || ['console', 'log'],
      escalationEmail: options.escalationEmail || null
    };
    
    // State tracking
    this.circuits = new Map();
    this.globalStats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSpent: 0,
      windowStart: Date.now()
    };
    
    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Execute action with circuit breaker protection
   */
  async execute(circuitId, action, context = {}) {
    const circuit = this.getCircuit(circuitId);
    
    // Check if circuit is open
    if (circuit.state === this.states.OPEN) {
      if (Date.now() - circuit.openedAt < this.config.recoveryTimeout) {
        throw new Error(`Circuit ${circuitId} is OPEN until ${new Date(circuit.openedAt + this.config.recoveryTimeout).toISOString()}`);
      } else {
        // Try to recover
        circuit.state = this.states.HALF_OPEN;
        circuit.halfOpenCalls = 0;
        this.emit('stateChange', circuitId, this.states.HALF_OPEN);
      }
    }
    
    // Track request
    this.trackRequest(circuit, context);
    
    try {
      // Execute action
      const startTime = Date.now();
      const result = await action();
      const duration = Date.now() - startTime;
      
      // Track success
      this.trackSuccess(circuit, duration, context);
      
      // Close circuit if in half-open
      if (circuit.state === this.states.HALF_OPEN) {
        circuit.state = this.states.CLOSED;
        this.emit('stateChange', circuitId, this.states.CLOSED);
      }
      
      return result;
      
    } catch (error) {
      // Track failure
      this.trackFailure(circuit, error, context);
      
      // Check if we should open circuit
      if (this.shouldOpenCircuit(circuit)) {
        this.openCircuit(circuitId, error);
      }
      
      throw error;
    }
  }

  /**
   * Get or create circuit
   */
  getCircuit(circuitId) {
    if (!this.circuits.has(circuitId)) {
      this.circuits.set(circuitId, {
        id: circuitId,
        state: this.states.CLOSED,
        failures: [],
        successes: [],
        openedAt: null,
        lastFailure: null,
        halfOpenCalls: 0,
        stats: {
          requests: 0,
          failures: 0,
          successes: 0,
          avgResponseTime: 0,
          totalAmount: 0
        }
      });
    }
    return this.circuits.get(circuitId);
  }

  /**
   * Track incoming request
   */
  trackRequest(circuit, context) {
    circuit.stats.requests++;
    this.globalStats.totalRequests++;
    
    // Track amount if financial
    if (context.amount) {
      circuit.stats.totalAmount += context.amount;
      this.globalStats.totalSpent += context.amount;
    }
    
    // Check for traffic spikes
    this.checkTrafficSpike(circuit);
    
    // Check spending rate
    this.checkSpendingRate(circuit, context);
  }

  /**
   * Track successful request
   */
  trackSuccess(circuit, duration, context) {
    const now = Date.now();
    
    circuit.stats.successes++;
    circuit.successes.push({
      timestamp: now,
      duration,
      amount: context.amount || 0
    });
    
    // Clean old entries
    this.cleanOldEntries(circuit);
    
    // Update average response time
    this.updateAvgResponseTime(circuit, duration);
  }

  /**
   * Track failed request
   */
  trackFailure(circuit, error, context) {
    const now = Date.now();
    
    circuit.stats.failures++;
    circuit.lastFailure = now;
    
    circuit.failures.push({
      timestamp: now,
      error: error.message,
      code: error.code || 'UNKNOWN',
      amount: context.amount || 0
    });
    
    this.globalStats.totalFailures++;
    
    // Check for auth failures
    if (error.code === 'AUTH_FAILED' || error.message.includes('401')) {
      this.checkAuthFailures(circuit);
    }
    
    // Emit failure event
    this.emit('failure', circuit.id, error, context);
  }

  /**
   * Determine if circuit should open
   */
  shouldOpenCircuit(circuit) {
    // Already open
    if (circuit.state === this.states.OPEN) return false;
    
    // Failure threshold
    const recentFailures = circuit.failures.filter(f => 
      Date.now() - f.timestamp < this.config.monitoringWindow
    );
    
    if (recentFailures.length >= this.config.failureThreshold) {
      return true;
    }
    
    // Timeout threshold
    if (circuit.state === this.states.HALF_OPEN && 
        circuit.halfOpenCalls >= this.config.halfOpenMaxCalls) {
      return true;
    }
    
    // Consecutive failures
    const consecutiveFailures = this.getConsecutiveFailures(circuit);
    if (consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }
    
    return false;
  }

  /**
   * Open circuit (trigger shutdown)
   */
  openCircuit(circuitId, error) {
    const circuit = this.getCircuit(circuitId);
    
    circuit.state = this.states.OPEN;
    circuit.openedAt = Date.now();
    
    // Emit events
    this.emit('circuitOpen', circuitId, error);
    this.emit('stateChange', circuitId, this.states.OPEN);
    
    // Send alerts
    this.sendAlert({
      type: 'CIRCUIT_OPEN',
      circuitId,
      error: error.message,
      failures: circuit.stats.failures,
      timestamp: new Date().toISOString()
    });
    
    console.error(`[CIRCUIT] OPEN: ${circuitId} - ${error.message}`);
  }

  /**
   * Check for traffic spikes
   */
  checkTrafficSpike(circuit) {
    const now = Date.now();
    const recentRequests = circuit.successes
      .filter(s => now - s.timestamp < 60000) // Last minute
      .length + circuit.failures
      .filter(f => now - f.timestamp < 60000)
      .length;
    
    if (recentRequests > this.config.maxTrafficSpike) {
      this.openCircuit(circuit.id, new Error(`Traffic spike: ${recentRequests} requests/min`));
    }
  }

  /**
   * Check spending rate
   */
  checkSpendingRate(circuit, context) {
    if (!context.amount) return;
    
    const now = Date.now();
    const recentSpending = circuit.successes
      .filter(s => now - s.timestamp < 60000) // Last minute
      .reduce((sum, s) => sum + (s.amount || 0), 0);
    
    if (recentSpending > this.config.maxSpendingRate) {
      this.openCircuit(circuit.id, new Error(`Spending rate exceeded: $${recentSpending}/min`));
    }
  }

  /**
   * Check authentication failures
   */
  checkAuthFailures(circuit) {
    const now = Date.now();
    const authFailures = circuit.failures
      .filter(f => now - f.timestamp < 300000) // Last 5 minutes
      .filter(f => f.code === 'AUTH_FAILED')
      .length;
    
    if (authFailures >= this.config.maxFailedAuth) {
      this.openCircuit(circuit.id, new Error(`Too many auth failures: ${authFailures}`));
    }
  }

  /**
   * Get consecutive failures
   */
  getConsecutiveFailures(circuit) {
    const allEvents = [
      ...circuit.successes.map(s => ({ ...s, type: 'success' })),
      ...circuit.failures.map(f => ({ ...f, type: 'failure' }))
    ].sort((a, b) => a.timestamp - b.timestamp);
    
    let consecutive = 0;
    
    for (let i = allEvents.length - 1; i >= 0; i--) {
      if (allEvents[i].type === 'failure') {
        consecutive++;
      } else {
        break;
      }
    }
    
    return consecutive;
  }

  /**
   * Clean old entries
   */
  cleanOldEntries(circuit) {
    const cutoff = Date.now() - this.config.statsWindow;
    
    circuit.successes = circuit.successes.filter(s => s.timestamp > cutoff);
    circuit.failures = circuit.failures.filter(f => f.timestamp > cutoff);
  }

  /**
   * Update average response time
   */
  updateAvgResponseTime(circuit, duration) {
    const alpha = 0.1; // Smoothing factor
    circuit.stats.avgResponseTime = 
      circuit.stats.avgResponseTime * (1 - alpha) + duration * alpha;
  }

  /**
   * Send alert
   */
  async sendAlert(alert) {
    console.log('[ALERT]', alert);
    
    // Send to configured channels
    for (const channel of this.config.alertChannels) {
      switch (channel) {
        case 'console':
          // Already logged above
          break;
          
        case 'log':
          // Write to log file
          this.writeToLog(alert);
          break;
          
        case 'email':
          if (this.config.escalationEmail) {
            await this.sendEmailAlert(alert);
          }
          break;
          
        case 'webhook':
          if (this.config.alertWebhook) {
            await this.sendWebhookAlert(alert);
          }
          break;
      }
    }
  }

  /**
   * Write alert to log
   */
  writeToLog(alert) {
    const fs = require('fs');
    const logFile = path.join(__dirname, '../../data/circuit-breaker.log');
    
    const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(alert)}\n`;
    
    fs.appendFile(logFile, logEntry, (err) => {
      if (err) console.error('Failed to write alert log:', err);
    });
  }

  /**
   * Send email alert
   */
  async sendEmailAlert(alert) {
    // Placeholder for email implementation
    console.log(`[EMAIL] Alert sent to ${this.config.escalationEmail}:`, alert.type);
  }

  /**
   * Send webhook alert
   */
  async sendWebhookAlert(alert) {
    // Placeholder for webhook implementation
    console.log(`[WEBHOOK] Alert sent to ${this.config.alertWebhook}:`, alert.type);
  }

  /**
   * Start background monitoring
   */
  startMonitoring() {
    // Check global conditions every minute
    setInterval(() => {
      this.checkGlobalConditions();
    }, 60000);
    
    // Clean old data every 5 minutes
    setInterval(() => {
      this.cleanupOldData();
    }, 300000);
  }

  /**
   * Check global system conditions
   */
  checkGlobalConditions() {
    const now = Date.now();
    const windowMs = this.config.monitoringWindow;
    
    // Reset global stats window
    if (now - this.globalStats.windowStart > windowMs) {
      this.globalStats = {
        totalRequests: 0,
        totalFailures: 0,
        totalSpent: 0,
        windowStart: now
      };
    }
    
    // Check global failure rate
    const failureRate = this.globalStats.totalRequests > 0 ? 
      this.globalStats.totalFailures / this.globalStats.totalRequests : 0;
    
    if (failureRate > 0.5) { // 50% failure rate
      this.sendAlert({
        type: 'GLOBAL_HIGH_FAILURE_RATE',
        failureRate: (failureRate * 100).toFixed(2) + '%',
        requests: this.globalStats.totalRequests,
        failures: this.globalStats.totalFailures
      });
    }
  }

  /**
   * Clean up old data
   */
  cleanupOldData() {
    for (const circuit of this.circuits.values()) {
      this.cleanOldEntries(circuit);
    }
  }

  /**
   * Get circuit status
   */
  getCircuitStatus(circuitId = null) {
    if (circuitId) {
      const circuit = this.getCircuit(circuitId);
      return {
        id: circuit.id,
        state: circuit.state,
        stats: circuit.stats,
        lastFailure: circuit.lastFailure,
        openedAt: circuit.openedAt
      };
    }
    
    // Return all circuits
    const status = {};
    for (const [id, circuit] of this.circuits) {
      status[id] = {
        state: circuit.state,
        stats: circuit.stats,
        lastFailure: circuit.lastFailure
      };
    }
    
    return status;
  }

  /**
   * Manually reset circuit
   */
  resetCircuit(circuitId) {
    const circuit = this.getCircuit(circuitId);
    
    circuit.state = this.states.CLOSED;
    circuit.failures = [];
    circuit.successes = [];
    circuit.openedAt = null;
    circuit.lastFailure = null;
    circuit.halfOpenCalls = 0;
    
    this.emit('stateChange', circuitId, this.states.CLOSED);
    
    console.log(`[CIRCUIT] RESET: ${circuitId}`);
  }

  /**
   * Get system health
   */
  getSystemHealth() {
    const totalCircuits = this.circuits.size;
    const openCircuits = Array.from(this.circuits.values())
      .filter(c => c.state === this.states.OPEN).length;
    
    const health = {
      status: openCircuits === 0 ? 'healthy' : 'degraded',
      totalCircuits,
      openCircuits,
      globalStats: this.globalStats,
      timestamp: new Date().toISOString()
    };
    
    return health;
  }
}

module.exports = CircuitBreaker;
