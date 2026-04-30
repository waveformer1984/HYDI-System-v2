/**
 * Graded Circuit Breaker Response
 * Because "shut everything down" is safe... and also how you DoS yourself
 */

const EventEmitter = require('events');

class GradedCircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Response levels
    this.levels = {
      NORMAL: { name: 'normal', threshold: 0.2 },
      THROTTLE: { name: 'throttle', threshold: 0.4 },
      APPROVAL: { name: 'approval', threshold: 0.6 },
      PARTIAL: { name: 'partial', threshold: 0.8 },
      FREEZE: { name: 'freeze', threshold: 1.0 }
    };
    
    // Configuration
    this.config = {
      // Level-specific settings
      throttle: {
        rateLimit: 0.5, // 50% of normal rate
        windowMs: 60000,
        maxRequests: 50
      },
      approval: {
        requireHumanApproval: true,
        autoApproveLowRisk: true,
        approvalTimeout: 300000 // 5 minutes
      },
      partial: {
        allowedActions: ['read', 'status', 'health'],
        blockedActions: ['write', 'transfer', 'delete'],
        maxConcurrency: 1
      },
      freeze: {
        allowEmergencyOverride: true,
        emergencyRoles: ['admin', 'emergency'],
        freezeDuration: 300000 // 5 minutes
      },
      ...options
    };
    
    // State tracking
    this.circuits = new Map();
    this.globalState = {
      level: this.levels.NORMAL,
      since: Date.now(),
      reason: null
    };
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      throttledRequests: 0,
      approvalRequests: 0,
      partialBlocks: 0,
      fullFreezes: 0
    };
    
    // Approval queue
    this.approvalQueue = new Map();
    
    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Execute action with graded circuit breaking
   */
  async execute(circuitId, action, context = {}) {
    const circuit = this.getCircuit(circuitId);
    const globalLevel = this.getGlobalLevel();
    
    // Check global level first
    const globalCheck = this.checkGlobalLevel(globalLevel, action, context);
    if (!globalCheck.allowed) {
      this.metrics.globalBlocks++;
      throw new Error(`Global circuit level ${globalLevel.name}: ${globalCheck.reason}`);
    }
    
    // Check circuit-specific level
    const circuitLevel = this.getCircuitLevel(circuit);
    const circuitCheck = this.checkCircuitLevel(circuitLevel, action, context);
    
    if (!circuitCheck.allowed) {
      // Apply graded response
      return await this.applyGradedResponse(circuitId, circuitLevel, action, context);
    }
    
    // Execute normally
    return await this.executeNormal(circuitId, action, context);
  }

  /**
   * Get current global level based on system metrics
   */
  getGlobalLevel() {
    const now = Date.now();
    let riskScore = 0;
    let reason = null;

    // Check failure rate
    const totalRequests = Array.from(this.circuits.values())
      .reduce((sum, c) => sum + c.stats.requests, 0);
    
    const totalFailures = Array.from(this.circuits.values())
      .reduce((sum, c) => sum + c.stats.failures, 0);
    
    const failureRate = totalRequests > 0 ? totalFailures / totalRequests : 0;
    riskScore += failureRate * 0.4;
    
    if (failureRate > 0.5) {
      reason = 'High global failure rate';
    }

    // Check number of open circuits
    const openCircuits = Array.from(this.circuits.values())
      .filter(c => c.state === 'OPEN').length;
    
    if (openCircuits > 0) {
      riskScore += (openCircuits / Math.max(this.circuits.size, 1)) * 0.3;
      if (!reason) reason = 'Multiple circuits open';
    }

    // Check approval queue backlog
    if (this.approvalQueue.size > 10) {
      riskScore += 0.2;
      if (!reason) reason = 'Approval queue backlog';
    }

    // Check recent freezes
    if (this.metrics.fullFreezes > 0 && 
        now - this.lastFreeze < 300000) { // Within 5 minutes
      riskScore += 0.3;
      if (!reason) reason = 'Recent freeze event';
    }

    // Determine level
    for (const [levelName, level] of Object.entries(this.levels)) {
      if (riskScore <= level.threshold) {
        if (this.globalState.level !== level) {
          this.globalState = {
            level,
            since: now,
            reason
          };
          this.emit('globalLevelChange', level, reason);
        }
        return level;
      }
    }

    return this.levels.FREEZE;
  }

  /**
   * Get circuit-specific level
   */
  getCircuitLevel(circuit) {
    const recentFailures = circuit.failures
      .filter(f => Date.now() - f.timestamp < 300000) // Last 5 minutes
      .length;
    
    const riskScore = Math.min(recentFailures / 10, 1); // 10 failures = max risk
    
    // Determine level
    for (const [levelName, level] of Object.entries(this.levels)) {
      if (riskScore <= level.threshold) {
        return level;
      }
    }
    
    return this.levels.FREEZE;
  }

  /**
   * Check if action is allowed at global level
   */
  checkGlobalLevel(level, action, context) {
    switch (level.name) {
      case 'normal':
        return { allowed: true };
        
      case 'throttle':
        return this.checkThrottle(action, context);
        
      case 'approval':
        return this.checkApproval(action, context);
        
      case 'partial':
        return this.checkPartial(action, context);
        
      case 'freeze':
        return this.checkFreeze(action, context);
        
      default:
        return { allowed: true };
    }
  }

  /**
   * Check if action is allowed at circuit level
   */
  checkCircuitLevel(level, action, context) {
    // Similar to global check but circuit-specific
    return this.checkGlobalLevel(level, action, context);
  }

  /**
   * Apply graded response based on level
   */
  async applyGradedResponse(circuitId, level, action, context) {
    switch (level.name) {
      case 'throttle':
        return await this.applyThrottle(circuitId, action, context);
        
      case 'approval':
        return await this.applyApproval(circuitId, action, context);
        
      case 'partial':
        return await this.applyPartial(circuitId, action, context);
        
      case 'freeze':
        return await this.applyFreeze(circuitId, action, context);
        
      default:
        throw new Error(`Unknown level: ${level.name}`);
    }
  }

  /**
   * Throttle response
   */
  async applyThrottle(circuitId, action, context) {
    this.metrics.throttledRequests++;
    
    // Check rate limit
    const key = `throttle:${circuitId}`;
    const now = Date.now();
    const window = this.config.throttle.windowMs;
    
    if (!this.throttleWindows) {
      this.throttleWindows = new Map();
    }
    
    const windowData = this.throttleWindows.get(key) || { count: 0, resetAt: now + window };
    
    if (now > windowData.resetAt) {
      windowData.count = 0;
      windowData.resetAt = now + window;
    }
    
    if (windowData.count >= this.config.throttle.maxRequests) {
      throw new Error('Rate limit exceeded');
    }
    
    windowData.count++;
    this.throttleWindows.set(key, windowData);
    
    // Add delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Execute with warning
    const result = await this.executeNormal(circuitId, action, context);
    result.throttled = true;
    
    return result;
  }

  /**
   * Approval response
   */
  async applyApproval(circuitId, action, context) {
    this.metrics.approvalRequests++;
    
    // Check if auto-approvable
    const riskScore = this.calculateRiskScore(action, context);
    
    if (riskScore < 0.3 && this.config.approval.autoApproveLowRisk) {
      console.log(`[CIRCUIT] Auto-approved low-risk action: ${action}`);
      return await this.executeNormal(circuitId, action, context);
    }
    
    // Queue for approval
    const approvalId = this.generateApprovalId();
    const approval = {
      id: approvalId,
      circuitId,
      action,
      context,
      riskScore,
      requestedAt: Date.now(),
      status: 'pending'
    };
    
    this.approvalQueue.set(approvalId, approval);
    
    // Notify
    this.emit('approvalRequired', approval);
    
    // Wait for approval
    const approved = await this.waitForApproval(approvalId);
    
    if (!approved) {
      throw new Error('Action not approved');
    }
    
    return await this.executeNormal(circuitId, action, context);
  }

  /**
   * Partial shutdown response
   */
  async applyPartial(circuitId, action, context) {
    this.metrics.partialBlocks++;
    
    // Check if action is allowed
    const actionType = this.getActionType(action);
    
    if (this.config.partial.blockedActions.includes(actionType)) {
      throw new Error(`Action ${action} blocked in partial shutdown mode`);
    }
    
    // Check concurrency
    const activeCount = this.getActivePartialActions();
    if (activeCount >= this.config.partial.maxConcurrency) {
      throw new Error('Partial shutdown concurrency limit exceeded');
    }
    
    // Execute with monitoring
    return await this.executeWithMonitoring(circuitId, action, context, 'partial');
  }

  /**
   * Full freeze response
   */
  async applyFreeze(circuitId, action, context) {
    this.metrics.fullFreezes++;
    this.lastFreeze = Date.now();
    
    // Check for emergency override
    if (this.config.freeze.allowEmergencyOverride) {
      const hasOverride = this.checkEmergencyOverride(context);
      
      if (hasOverride) {
        console.warn(`[CIRCUIT] Emergency override used for action: ${action}`);
        this.emit('emergencyOverride', { circuitId, action, context });
        return await this.executeNormal(circuitId, action, context);
      }
    }
    
    // Block everything
    throw new Error('System frozen - all actions blocked');
  }

  /**
   * Process approval decision
   */
  processApproval(approvalId, approved, approver = null) {
    const approval = this.approvalQueue.get(approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }
    
    approval.status = approved ? 'approved' : 'rejected';
    approval.decidedAt = Date.now();
    approval.decidedBy = approver;
    
    if (approved) {
      this.emit('approvalGranted', approval);
    } else {
      this.emit('approvalDenied', approval);
    }
    
    // Clean up after timeout
    setTimeout(() => {
      this.approvalQueue.delete(approvalId);
    }, 60000);
  }

  /**
   * Get approval queue
   */
  getApprovalQueue() {
    return Array.from(this.approvalQueue.values()).map(a => ({
      id: a.id,
      circuitId: a.circuitId,
      action: a.action,
      riskScore: a.riskScore,
      requestedAt: a.requestedAt,
      status: a.status
    }));
  }

  /**
   * Get system status
   */
  getSystemStatus() {
    return {
      globalLevel: this.globalState.level.name,
      globalLevelSince: this.globalState.since,
      globalReason: this.globalState.reason,
      circuits: this.getCircuitStatuses(),
      metrics: this.metrics,
      approvalQueueSize: this.approvalQueue.size
    };
  }

  /**
   * Manual level override
   */
  setGlobalLevel(levelName, reason = 'manual override') {
    const level = this.levels[levelName.toUpperCase()];
    if (!level) {
      throw new Error(`Unknown level: ${levelName}`);
    }
    
    this.globalState = {
      level,
      since: Date.now(),
      reason
    };
    
    this.emit('manualLevelChange', level, reason);
    console.log(`[CIRCUIT] Manual level change to ${level.name}: ${reason}`);
  }

  /**
   * Helper methods
   */
  getCircuit(circuitId) {
    if (!this.circuits.has(circuitId)) {
      this.circuits.set(circuitId, {
        id: circuitId,
        state: 'CLOSED',
        failures: [],
        stats: { requests: 0, failures: 0, successes: 0 }
      });
    }
    return this.circuits.get(circuitId);
  }

  async executeNormal(circuitId, action, context) {
    // This would call the actual action
    // For now, simulate execution
    const circuit = this.getCircuit(circuitId);
    circuit.stats.requests++;
    
    return {
      success: true,
      circuitId,
      action,
      executedAt: Date.now()
    };
  }

  async executeWithMonitoring(circuitId, action, context, mode) {
    const result = await this.executeNormal(circuitId, action, context);
    result.executedInMode = mode;
    return result;
  }

  checkThrottle(action, context) {
    // Always allowed, will be throttled in applyThrottle
    return { allowed: true };
  }

  checkApproval(action, context) {
    // Always allowed, will require approval in applyApproval
    return { allowed: true };
  }

  checkPartial(action, context) {
    const actionType = this.getActionType(action);
    const allowed = this.config.partial.allowedActions.includes(actionType);
    
    return {
      allowed,
      reason: allowed ? null : `Action type ${actionType} not allowed in partial mode`
    };
  }

  checkFreeze(action, context) {
    const hasOverride = this.checkEmergencyOverride(context);
    
    return {
      allowed: hasOverride,
      reason: hasOverride ? null : 'System frozen'
    };
  }

  checkEmergencyOverride(context) {
    return context.role && 
           this.config.freeze.emergencyRoles.includes(context.role) &&
           context.emergencyToken;
  }

  getActionType(action) {
    // Extract action type from action string
    if (action.includes('transfer')) return 'transfer';
    if (action.includes('create')) return 'write';
    if (action.includes('delete')) return 'delete';
    if (action.includes('get') || action.includes('list')) return 'read';
    return 'unknown';
  }

  calculateRiskScore(action, context) {
    // Simple risk calculation
    let score = 0;
    
    if (action.includes('transfer')) score += 0.3;
    if (context.amount && context.amount > 1000) score += 0.2;
    if (context.newDestination) score += 0.2;
    
    return Math.min(score, 1.0);
  }

  async waitForApproval(approvalId) {
    return new Promise((resolve) => {
      const checkApproval = () => {
        const approval = this.approvalQueue.get(approvalId);
        if (!approval) {
          resolve(false);
          return;
        }
        
        if (approval.status === 'approved') {
          resolve(true);
        } else if (approval.status === 'rejected') {
          resolve(false);
        } else {
          // Check timeout
          if (Date.now() - approval.requestedAt > this.config.approval.approvalTimeout) {
            approval.status = 'timeout';
            resolve(false);
          } else {
            setTimeout(checkApproval, 1000);
          }
        }
      };
      
      checkApproval();
    });
  }

  generateApprovalId() {
    return 'approval_' + Math.random().toString(36).substr(2, 9);
  }

  getActivePartialActions() {
    // Count active partial mode actions
    return Array.from(this.circuits.values())
      .filter(c => c.mode === 'partial')
      .length;
  }

  getCircuitStatuses() {
    const statuses = {};
    for (const [id, circuit] of this.circuits) {
      statuses[id] = {
        state: circuit.state,
        requests: circuit.stats.requests,
        failures: circuit.stats.failures,
        level: this.getCircuitLevel(circuit).name
      };
    }
    return statuses;
  }

  startMonitoring() {
    // Reset metrics daily
    setInterval(() => {
      this.metrics = {
        totalRequests: 0,
        throttledRequests: 0,
        approvalRequests: 0,
        partialBlocks: 0,
        fullFreezes: 0
      };
    }, 24 * 60 * 60 * 1000);
  }
}

module.exports = GradedCircuitBreaker;
