/**
 * Adaptive Circuit Breaker
 * Automatically escalates based on threat patterns
 */

const EventEmitter = require('events');

class AdaptiveCircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Escalation triggers
      triggers: {
        denialRate: {
          threshold: 0.3, // 30% denials trigger escalation
          window: 300000, // 5 minutes
          escalationLevel: 1
        },
        repeatedViolations: {
          threshold: 10, // 10 violations from same agent
          window: 600000, // 10 minutes
          escalationLevel: 2
        },
        unusualKeyUsage: {
          threshold: 3, // 3x normal usage
          window: 900000, // 15 minutes
          escalationLevel: 1
        },
        concurrentFailures: {
          threshold: 5, // 5 concurrent failures
          window: 60000, // 1 minute
          escalationLevel: 3
        }
      },
      
      // Auto-escalation settings
      autoEscalate: options.autoEscalate !== false,
      maxAutoLevel: options.maxAutoLevel || 3,
      coolDownPeriod: options.coolDownPeriod || 1800000, // 30 minutes
      
      ...options
    };
    
    // State tracking
    this.state = {
      level: 0,
      lastEscalation: 0,
      lastViolation: 0,
      violations: new Map(), // agent_id -> violations[]
      keyUsage: new Map(), // agent_id -> usage count
      denialRate: 0,
      concurrentFailures: 0
    };
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      totalDenials: 0,
      escalations: 0,
      deescalations: 0,
      violationsByType: new Map()
    };
    
    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Process request and check for escalation triggers
   */
  async processRequest(request, response, context = {}) {
    this.metrics.totalRequests++;
    
    // Track metrics
    this.trackMetrics(request, response, context);
    
    // Check escalation triggers
    const escalation = this.checkEscalationTriggers();
    
    if (escalation.shouldEscalate) {
      await this.escalate(escalation.level, escalation.reason);
    }
    
    // Check for de-escalation
    if (this.shouldDeescalate()) {
      await this.deescalate('system_stabilized');
    }
    
    return {
      allowed: this.isRequestAllowed(request, context),
      circuitLevel: this.state.level,
      escalation: escalation
    };
  }

  /**
   * Track metrics for escalation detection
   */
  trackMetrics(request, response, context) {
    const agentId = context.agentId || 'unknown';
    
    // Track denials
    if (response.status === 'denied' || response.status === 'blocked') {
      this.metrics.totalDenials++;
      this.state.denialRate = this.metrics.totalDenials / this.metrics.totalRequests;
    }
    
    // Track violations per agent
    if (response.violations && response.violations.length > 0) {
      if (!this.state.violations.has(agentId)) {
        this.state.violations.set(agentId, []);
      }
      
      this.state.violations.get(agentId).push({
        timestamp: Date.now(),
        violations: response.violations
      });
    }
    
    // Track key usage
    if (request.action && request.action.includes('stripe')) {
      const current = this.state.keyUsage.get(agentId) || 0;
      this.state.keyUsage.set(agentId, current + 1);
    }
    
    // Track concurrent failures
    if (response.status === 'error') {
      this.state.concurrentFailures++;
      
      // Reset counter after window
      setTimeout(() => {
        this.state.concurrentFailures = Math.max(0, this.state.concurrentFailures - 1);
      }, this.config.triggers.concurrentFailures.window);
    }
  }

  /**
   * Check all escalation triggers
   */
  checkEscalationTriggers() {
    const triggers = [];
    
    // Check denial rate
    const denialTrigger = this.checkDenialRate();
    if (denialTrigger) triggers.push(denialTrigger);
    
    // Check repeated violations
    const violationTrigger = this.checkRepeatedViolations();
    if (violationTrigger) triggers.push(violationTrigger);
    
    // Check unusual key usage
    const usageTrigger = this.checkUnusualKeyUsage();
    if (usageTrigger) triggers.push(usageTrigger);
    
    // Check concurrent failures
    const failureTrigger = this.checkConcurrentFailures();
    if (failureTrigger) triggers.push(failureTrigger);
    
    // Determine highest escalation level
    let maxLevel = 0;
    let reason = '';
    
    for (const trigger of triggers) {
      if (trigger.level > maxLevel) {
        maxLevel = trigger.level;
        reason = trigger.reason;
      }
    }
    
    return {
      shouldEscalate: maxLevel > 0 && maxLevel > this.state.level,
      level: Math.min(maxLevel, this.config.maxAutoLevel),
      reason,
      triggers
    };
  }

  /**
   * Check denial rate trigger
   */
  checkDenialRate() {
    const config = this.config.triggers.denialRate;
    
    if (this.state.denialRate >= config.threshold) {
      return {
        type: 'denial_rate',
        level: config.escalationLevel,
        reason: `Denial rate ${Math.round(this.state.denialRate * 100)}% exceeds threshold ${Math.round(config.threshold * 100)}%`,
        current: this.state.denialRate,
        threshold: config.threshold
      };
    }
    
    return null;
  }

  /**
   * Check repeated violations trigger
   */
  checkRepeatedViolations() {
    const config = this.config.triggers.repeatedViolations;
    const now = Date.now();
    
    for (const [agentId, violations] of this.state.violations) {
      const recentViolations = violations.filter(v => 
        now - v.timestamp < config.window
      );
      
      if (recentViolations.length >= config.threshold) {
        return {
          type: 'repeated_violations',
          level: config.escalationLevel,
          reason: `Agent ${agentId} has ${recentViolations.length} violations in ${config.window / 60000} minutes`,
          agentId,
          count: recentViolations.length
        };
      }
    }
    
    return null;
  }

  /**
   * Check unusual key usage trigger
   */
  checkUnusualKeyUsage() {
    const config = this.config.triggers.unusualKeyUsage;
    
    // Calculate baseline usage (average across all agents)
    const usages = Array.from(this.state.keyUsage.values());
    const baseline = usages.length > 0 ? usages.reduce((a, b) => a + b, 0) / usages.length : 0;
    
    for (const [agentId, usage] of this.state.keyUsage) {
      if (baseline > 0 && usage > baseline * config.threshold) {
        return {
          type: 'unusual_key_usage',
          level: config.escalationLevel,
          reason: `Agent ${agentId} usage ${usage} is ${Math.round(usage / baseline)}x baseline`,
          agentId,
          usage,
          baseline
        };
      }
    }
    
    return null;
  }

  /**
   * Check concurrent failures trigger
   */
  checkConcurrentFailures() {
    const config = this.config.triggers.concurrentFailures;
    
    if (this.state.concurrentFailures >= config.threshold) {
      return {
        type: 'concurrent_failures',
        level: config.escalationLevel,
        reason: `${this.state.concurrentFailures} concurrent failures`,
        count: this.state.concurrentFailures
      };
    }
    
    return null;
  }

  /**
   * Escalate circuit level
   */
  async escalate(newLevel, reason) {
    if (newLevel <= this.state.level) return;
    
    const oldLevel = this.state.level;
    this.state.level = newLevel;
    this.state.lastEscalation = Date.now();
    
    this.metrics.escalations++;
    
    // Log escalation
    console.log(`[CIRCUIT] Escalated from level ${oldLevel} to ${newLevel}: ${reason}`);
    
    // Emit event
    this.emit('escalated', {
      from: oldLevel,
      to: newLevel,
      reason,
      timestamp: Date.now(),
      autoEscalate: true
    });
    
    // Send alert for high-level escalations
    if (newLevel >= 3) {
      this.sendHighLevelAlert(newLevel, reason);
    }
  }

  /**
   * De-escalate circuit level
   */
  async deescalate(reason) {
    if (this.state.level === 0) return;
    
    const oldLevel = this.state.level;
    this.state.level = Math.max(0, oldLevel - 1);
    
    this.metrics.deescalations++;
    
    // Log de-escalation
    console.log(`[CIRCUIT] De-escalated from level ${oldLevel} to ${this.state.level}: ${reason}`);
    
    // Emit event
    this.emit('deescalated', {
      from: oldLevel,
      to: this.state.level,
      reason,
      timestamp: Date.now()
    });
  }

  /**
   * Check if should de-escalate
   */
  shouldDeescalate() {
    if (this.state.level === 0) return false;
    
    const timeSinceEscalation = Date.now() - this.state.lastEscalation;
    
    // Must be in cool-down period
    if (timeSinceEscalation < this.config.coolDownPeriod) return false;
    
    // Check if all triggers are clear
    const currentTriggers = this.checkEscalationTriggers();
    
    // No active triggers and system is stable
    return currentTriggers.shouldEscalate === false && this.state.denialRate < 0.1;
  }

  /**
   * Check if request is allowed at current level
   */
  isRequestAllowed(request, context) {
    const level = this.state.level;
    
    switch (level) {
      case 0:
        return true; // Normal operation
        
      case 1:
        // Throttle - allow but rate limit
        return this.checkRateLimit(context);
        
      case 2:
        // Approval required
        return request.action === 'health:ping'; // Only health checks
        
      case 3:
        // Partial shutdown
        return false; // Block everything
        
      case 4:
        // Full freeze
        return false; // Block everything
        
      default:
        return false;
    }
  }

  /**
   * Check rate limit for level 1
   */
  checkRateLimit(context) {
    const agentId = context.agentId || 'unknown';
    const window = 60000; // 1 minute
    const maxRequests = 10; // 10 requests per minute
    
    // This would be implemented with proper rate limiting
    // For now, always allow
    return true;
  }

  /**
   * Send high-level alert
   */
  sendHighLevelAlert(level, reason) {
    const alert = {
      level: 'CRITICAL',
      type: 'CIRCUIT_ESCALATION',
      circuitLevel: level,
      reason,
      timestamp: new Date().toISOString(),
      metrics: this.getMetrics()
    };
    
    console.error('[CIRCUIT] HIGH-LEVEL ALERT:', alert);
    
    // Emit alert event
    this.emit('highLevelAlert', alert);
  }

  /**
   * Manual override
   */
  async manualOverride(newLevel, reason, requestedBy) {
    const oldLevel = this.state.level;
    this.state.level = newLevel;
    
    console.log(`[CIRCUIT] Manual override from level ${oldLevel} to ${newLevel} by ${requestedBy}: ${reason}`);
    
    this.emit('manualOverride', {
      from: oldLevel,
      to: newLevel,
      reason,
      requestedBy,
      timestamp: Date.now()
    });
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      currentState: {
        level: this.state.level,
        denialRate: this.state.denialRate,
        concurrentFailures: this.state.concurrentFailures,
        violationsByAgent: Object.fromEntries(
          Array.from(this.state.violations).map(([agent, violations]) => [
            agent,
            violations.length
          ])
        )
      }
    };
  }

  /**
   * Start background monitoring
   */
  startMonitoring() {
    // Clean up old data periodically
    setInterval(() => {
      this.cleanupOldData();
    }, 60000); // Every minute
    
    // Emit metrics periodically
    setInterval(() => {
      this.emit('metrics', this.getMetrics());
    }, 300000); // Every 5 minutes
  }

  /**
   * Clean up old data
   */
  cleanupOldData() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour
    
    // Clean old violations
    for (const [agentId, violations] of this.state.violations) {
      const recent = violations.filter(v => now - v.timestamp < maxAge);
      this.state.violations.set(agentId, recent);
    }
    
    // Clean old key usage
    for (const [agentId, usage] of this.state.keyUsage) {
      if (usage === 0) {
        this.state.keyUsage.delete(agentId);
      }
    }
  }
}

module.exports = AdaptiveCircuitBreaker;
