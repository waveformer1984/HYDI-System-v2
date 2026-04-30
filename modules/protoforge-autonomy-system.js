/**
 * ProtoForge Autonomy System
 * 
 * Implements the 5-level autonomy system with guardrails:
 * 
 * LEVEL 0 – OBSERVE: Agents collect data only
 * LEVEL 1 – ASSIST: Agents recommend actions
 * LEVEL 2 – EXECUTE WITH APPROVAL: Agents act after confirmation
 * LEVEL 3 – CONDITIONAL AUTONOMY: Agents act within predefined constraints
 * LEVEL 4 – FULL AUTONOMY: Agents operate independently (except for critical decisions)
 * 
 * Guardrails prevent dangerous autonomous actions while enabling
 * progressive autonomy as trust is established.
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class ProtoForgeAutonomySystem extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      defaultLevel: 2, // EXECUTE_WITH_APPROVAL
      maxLevel: 4,
      trustDecayRate: 0.01, // 1% per day
      trustBuildRate: 0.05, // 5% per successful action
      criticalActionThreshold: 10000, // $10,000
      humanApprovalRequired: ['legal_commitments', 'large_financial_decisions', 'structural_changes'],
      ...config
    };
    
    // Autonomy levels
    this.levels = {
      0: { name: 'OBSERVE', description: 'Agents collect data only', canAct: false, canRecommend: false },
      1: { name: 'ASSIST', description: 'Agents recommend actions', canAct: false, canRecommend: true },
      2: { name: 'EXECUTE_WITH_APPROVAL', description: 'Agents act after confirmation', canAct: true, requiresApproval: true },
      3: { name: 'CONDITIONAL_AUTONOMY', description: 'Agents act within constraints', canAct: true, requiresApproval: false, hasConstraints: true },
      4: { name: 'FULL_AUTONOMY', description: 'Agents operate independently', canAct: true, requiresApproval: false, hasConstraints: false }
    };
    
    // Agent autonomy levels
    this.agentLevels = new Map();
    
    // Trust scores
    this.trustScores = new Map();
    
    // Guardrails
    this.guardrails = new Map();
    
    // Action history
    this.actionHistory = [];
    
    // Human approval queue
    this.approvalQueue = [];
    this.approvalHistory = [];
    
    // Metrics
    this.metrics = {
      actionsTaken: 0,
      actionsBlocked: 0,
      humanApprovals: 0,
      trustChanges: 0,
      guardrailTriggers: 0
    };
    
    console.log('[AUTONOMY SYSTEM] Initialized with default level: ' + this.levels[this.config.defaultLevel].name);
  }
  
  /**
   * Register an agent with the autonomy system
   */
  registerAgent(agentId, agentConfig) {
    // Set initial autonomy level
    const initialLevel = agentConfig.initialLevel || this.config.defaultLevel;
    
    this.agentLevels.set(agentId, initialLevel);
    
    // Initialize trust score
    this.trustScores.set(agentId, agentConfig.initialTrust || 0.5);
    
    // Set up default guardrails
    this.setupDefaultGuardrails(agentId, agentConfig);
    
    console.log(`[AUTONOMY SYSTEM] Agent ${agentId} registered at level ${this.levels[initialLevel].name}`);
  }
  
  /**
   * Set up default guardrails for an agent
   */
  setupDefaultGuardrails(agentId, agentConfig) {
    const guardrails = {
      financial: {
        maxSpendingLimit: agentConfig.maxSpendingLimit || 1000,
        requiresApproval: this.config.criticalActionThreshold,
        dailyLimit: agentConfig.dailyLimit || 500
      },
      operational: {
        canModifyStructure: agentConfig.canModifyStructure || false,
        canShutDownSystems: agentConfig.canShutDownSystems || false,
        canAccessSensitiveData: agentConfig.canAccessSensitiveData || false
      },
      legal: {
        canSignContracts: agentConfig.canSignContracts || false,
        canMakeLegalCommitments: agentConfig.canMakeLegalCommitments || false,
        canBindOrganization: agentConfig.canBindOrganization || false
      },
      safety: {
        requiresSafetyCheck: true,
        emergencyOverride: false,
        humanInTheLoop: agentConfig.humanInTheLoop !== false
      }
    };
    
    this.guardrails.set(agentId, guardrails);
  }
  
  /**
   * Check if an agent can perform an action
   */
  async canPerformAction(agentId, action, context = {}) {
    const agentLevel = this.agentLevels.get(agentId);
    const level = this.levels[agentLevel];
    const trustScore = this.trustScores.get(agentId);
    const agentGuardrails = this.guardrails.get(agentId);
    
    // Check basic level permissions
    if (!level.canAct) {
      return {
        allowed: false,
        reason: 'Agent autonomy level does not permit actions',
        level: level.name,
        requiresApproval: false
      };
    }
    
    // Check if approval is required at this level
    if (level.requiresApproval) {
      return {
        allowed: false,
        reason: 'Action requires human approval at current autonomy level',
        level: level.name,
        requiresApproval: true,
        approvalType: 'level_based'
      };
    }
    
    // Check guardrails
    const guardrailCheck = this.checkGuardrails(agentId, action, context, agentGuardrails);
    if (!guardrailCheck.allowed) {
      this.metrics.guardrailTriggers++;
      return guardrailCheck;
    }
    
    // Check trust score
    const trustCheck = this.checkTrustRequirements(agentId, action, trustScore);
    if (!trustCheck.allowed) {
      return trustCheck;
    }
    
    // Check for critical actions that always require approval
    const criticalCheck = this.checkCriticalActions(action);
    if (!criticalCheck.allowed) {
      return criticalCheck;
    }
    
    return {
      allowed: true,
      reason: 'Action permitted',
      level: level.name,
      trustScore
    };
  }
  
  /**
   * Check guardrails for an action
   */
  checkGuardrails(agentId, action, context, guardrails) {
    const actionType = action.type || 'unknown';
    const actionValue = action.value || 0;
    
    // Financial guardrails
    if (actionType === 'financial' || actionValue > 0) {
      if (actionValue > guardrails.financial.maxSpendingLimit) {
        return {
          allowed: false,
          reason: `Action value ${actionValue} exceeds spending limit ${guardrails.financial.maxSpendingLimit}`,
          requiresApproval: true,
          approvalType: 'financial_limit'
        };
      }
      
      if (actionValue > guardrails.financial.requiresApproval) {
        return {
          allowed: false,
          reason: `Action value ${actionValue} exceeds approval threshold ${guardrails.financial.requiresApproval}`,
          requiresApproval: true,
          approvalType: 'financial_threshold'
        };
      }
    }
    
    // Operational guardrails
    if (actionType === 'structural_change' && !guardrails.operational.canModifyStructure) {
      return {
        allowed: false,
        reason: 'Agent not permitted to make structural changes',
        requiresApproval: true,
        approvalType: 'operational_limit'
      };
    }
    
    if (actionType === 'system_shutdown' && !guardrails.operational.canShutDownSystems) {
      return {
        allowed: false,
        reason: 'Agent not permitted to shut down systems',
        requiresApproval: true,
        approvalType: 'operational_limit'
      };
    }
    
    // Legal guardrails
    if (this.config.humanApprovalRequired.includes(actionType)) {
      if (actionType === 'legal_commitment' && !guardrails.legal.canMakeLegalCommitments) {
        return {
          allowed: false,
          reason: 'Agent not permitted to make legal commitments',
          requiresApproval: true,
          approvalType: 'legal_limit'
        };
      }
    }
    
    // Safety guardrails
    if (guardrails.safety.requiresSafetyCheck && actionType === 'safety_critical') {
      return {
        allowed: false,
        reason: 'Safety-critical actions require human oversight',
        requiresApproval: true,
        approvalType: 'safety_critical'
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Check trust score requirements
   */
  checkTrustRequirements(agentId, action, trustScore) {
    const actionRisk = this.assessActionRisk(action);
    
    // Higher risk actions require higher trust scores
    const requiredTrust = this.getRequiredTrustScore(actionRisk);
    
    if (trustScore < requiredTrust) {
      return {
        allowed: false,
        reason: `Agent trust score ${trustScore} below required ${requiredTrust} for action risk level ${actionRisk}`,
        requiresApproval: true,
        approvalType: 'trust_insufficient',
        currentTrust: trustScore,
        requiredTrust
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Assess action risk level
   */
  assessActionRisk(action) {
    const actionType = action.type || 'unknown';
    const actionValue = action.value || 0;
    
    // High risk actions
    if (this.config.humanApprovalRequired.includes(actionType)) {
      return 'critical';
    }
    
    // Financial risk
    if (actionValue > this.config.criticalActionThreshold) {
      return 'critical';
    } else if (actionValue > 5000) {
      return 'high';
    } else if (actionValue > 1000) {
      return 'medium';
    }
    
    // Operational risk
    if (actionType === 'structural_change' || actionType === 'system_shutdown') {
      return 'high';
    }
    
    // Default risk
    return 'low';
  }
  
  /**
   * Get required trust score for action risk level
   */
  getRequiredTrustScore(riskLevel) {
    const requirements = {
      critical: 0.9,
      high: 0.8,
      medium: 0.6,
      low: 0.4
    };
    
    return requirements[riskLevel] || 0.5;
  }
  
  /**
   * Check for critical actions that always require approval
   */
  checkCriticalActions(action) {
    const actionType = action.type || 'unknown';
    
    if (this.config.humanApprovalRequired.includes(actionType)) {
      return {
        allowed: false,
        reason: `Action type ${actionType} always requires human approval`,
        requiresApproval: true,
        approvalType: 'critical_action'
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Request human approval for an action
   */
  async requestApproval(agentId, action, context, reason) {
    const approvalRequest = {
      id: uuidv4(),
      agentId,
      action,
      context,
      reason,
      requestedAt: Date.now(),
      status: 'pending',
      response: null,
      timeout: 24 * 60 * 60 * 1000 // 24 hours
    };
    
    this.approvalQueue.push(approvalRequest);
    this.metrics.humanApprovals++;
    
    console.log(`[AUTONOMY SYSTEM] Human approval requested: ${agentId} - ${action.type} - ${reason}`);
    
    // Emit approval request event
    this.emit('approval_requested', approvalRequest);
    
    return approvalRequest.id;
  }
  
  /**
   * Handle human approval response
   */
  async handleApprovalResponse(approvalId, approved, response = {}) {
    const request = this.approvalQueue.find(req => req.id === approvalId);
    
    if (!request) {
      throw new Error(`Approval request ${approvalId} not found`);
    }
    
    request.status = approved ? 'approved' : 'rejected';
    request.response = response;
    request.respondedAt = Date.now();
    
    // Move to history
    this.approvalHistory.push(request);
    this.approvalQueue = this.approvalQueue.filter(req => req.id !== approvalId);
    
    console.log(`[AUTONOMY SYSTEM] Approval ${approved ? 'granted' : 'denied'}: ${approvalId}`);
    
    // Emit response event
    this.emit('approval_response', request);
    
    // Update trust based on approval outcome
    if (approved) {
      this.updateTrustScore(request.agentId, 0.1, 'human_approval');
    } else {
      this.updateTrustScore(request.agentId, -0.05, 'human_rejection');
    }
    
    return request;
  }
  
  /**
   * Execute an action with autonomy checks
   */
  async executeAction(agentId, action, context = {}) {
    const actionId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Check if action is permitted
      const permission = await this.canPerformAction(agentId, action, context);
      
      if (!permission.allowed) {
        if (permission.requiresApproval) {
          // Request approval
          const approvalId = await this.requestApproval(agentId, action, context, permission.reason);
          
          return {
            actionId,
            status: 'awaiting_approval',
            approvalId,
            reason: permission.reason
          };
        } else {
          // Action blocked
          this.metrics.actionsBlocked++;
          
          return {
            actionId,
            status: 'blocked',
            reason: permission.reason
          };
        }
      }
      
      // Execute action
      const result = await this.performAction(agentId, action, context);
      
      // Record successful action
      this.recordAction(agentId, action, context, 'success', result);
      
      // Update trust score
      this.updateTrustScore(agentId, this.config.trustBuildRate, 'successful_action');
      
      this.metrics.actionsTaken++;
      
      return {
        actionId,
        status: 'completed',
        result,
        executionTime: Date.now() - startTime
      };
      
    } catch (error) {
      // Record failed action
      this.recordAction(agentId, action, context, 'failed', { error: error.message });
      
      // Decrease trust score
      this.updateTrustScore(agentId, -0.1, 'failed_action');
      
      return {
        actionId,
        status: 'failed',
        error: error.message,
        executionTime: Date.now() - startTime
      };
    }
  }
  
  /**
   * Perform the actual action
   */
  async performAction(agentId, action, context) {
    // This would interface with the actual agent/system to perform the action
    // For now, we simulate the action
    
    console.log(`[AUTONOMY SYSTEM] Executing action: ${action.type} for agent ${agentId}`);
    
    // Simulate action execution
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 500));
    
    return {
      success: true,
      message: `Action ${action.type} completed successfully`,
      timestamp: Date.now()
    };
  }
  
  /**
   * Record an action in the history
   */
  recordAction(agentId, action, context, status, result) {
    const record = {
      id: uuidv4(),
      agentId,
      action,
      context,
      status,
      result,
      timestamp: Date.now(),
      autonomyLevel: this.agentLevels.get(agentId),
      trustScore: this.trustScores.get(agentId)
    };
    
    this.actionHistory.push(record);
    
    // Keep history size manageable
    if (this.actionHistory.length > 10000) {
      this.actionHistory = this.actionHistory.slice(-5000);
    }
    
    console.log(`[AUTONOMY SYSTEM] Action recorded: ${agentId} - ${action.type} - ${status}`);
  }
  
  /**
   * Update agent trust score
   */
  updateTrustScore(agentId, delta, reason) {
    const currentScore = this.trustScores.get(agentId) || 0.5;
    const newScore = Math.max(0, Math.min(1, currentScore + delta));
    
    this.trustScores.set(agentId, newScore);
    this.metrics.trustChanges++;
    
    console.log(`[AUTONOMY SYSTEM] Trust score updated: ${agentId} ${currentScore} -> ${newScore} (${reason})`);
    
    // Check for autonomy level changes
    this.checkAutonomyLevelAdjustment(agentId, newScore);
    
    // Emit trust change event
    this.emit('trust_changed', {
      agentId,
      previousScore: currentScore,
      newScore,
      delta,
      reason
    });
  }
  
  /**
   * Check if autonomy level should be adjusted based on trust score
   */
  checkAutonomyLevelAdjustment(agentId, trustScore) {
    const currentLevel = this.agentLevels.get(agentId);
    
    // Trust thresholds for level changes
    const thresholds = {
      0: { min: 0, max: 0.3 },     // OBSERVE
      1: { min: 0.3, max: 0.5 },   // ASSIST
      2: { min: 0.5, max: 0.7 },   // EXECUTE_WITH_APPROVAL
      3: { min: 0.7, max: 0.9 },   // CONDITIONAL_AUTONOMY
      4: { min: 0.9, max: 1 }      // FULL_AUTONOMY
    };
    
    // Find appropriate level for trust score
    let targetLevel = currentLevel;
    
    for (const [level, range] of Object.entries(thresholds)) {
      const levelNum = parseInt(level);
      if (trustScore >= range.min && trustScore <= range.max) {
        targetLevel = levelNum;
        break;
      }
    }
    
    // Adjust level if needed
    if (targetLevel !== currentLevel) {
      this.setAutonomyLevel(agentId, targetLevel, 'trust_based_adjustment');
    }
  }
  
  /**
   * Set autonomy level for an agent
   */
  setAutonomyLevel(agentId, level, reason = 'manual_override') {
    if (level < 0 || level > this.config.maxLevel) {
      throw new Error(`Invalid autonomy level: ${level}`);
    }
    
    const previousLevel = this.agentLevels.get(agentId);
    this.agentLevels.set(agentId, level);
    
    console.log(`[AUTONOMY SYSTEM] Autonomy level changed: ${agentId} ${this.levels[previousLevel].name} -> ${this.levels[level].name} (${reason})`);
    
    // Emit level change event
    this.emit('autonomy_level_changed', {
      agentId,
      previousLevel,
      newLevel: level,
      previousName: this.levels[previousLevel].name,
      newName: this.levels[level].name,
      reason
    });
  }
  
  /**
   * Apply trust decay over time
   */
  applyTrustDecay() {
    for (const [agentId, trustScore] of this.trustScores.entries()) {
      const decayedScore = Math.max(0.1, trustScore - this.config.trustDecayRate);
      this.trustScores.set(agentId, decayedScore);
      
      // Check if level should be reduced
      this.checkAutonomyLevelAdjustment(agentId, decayedScore);
    }
    
    console.log(`[AUTONOMY SYSTEM] Applied trust decay to ${this.trustScores.size} agents`);
  }
  
  /**
   * Get agent autonomy status
   */
  getAgentStatus(agentId) {
    const level = this.agentLevels.get(agentId);
    const trustScore = this.trustScores.get(agentId);
    const guardrails = this.guardrails.get(agentId);
    
    if (!level || trustScore === undefined) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    return {
      agentId,
      autonomyLevel: level,
      autonomyLevelName: this.levels[level].name,
      trustScore,
      guardrails,
      recentActions: this.getRecentActions(agentId, 10),
      pendingApprovals: this.getPendingApprovals(agentId)
    };
  }
  
  /**
   * Get recent actions for an agent
   */
  getRecentActions(agentId, limit = 10) {
    return this.actionHistory
      .filter(action => action.agentId === agentId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
  
  /**
   * Get pending approvals for an agent
   */
  getPendingApprovals(agentId) {
    return this.approvalQueue.filter(request => request.agentId === agentId);
  }
  
  /**
   * Get system-wide autonomy status
   */
  getSystemStatus() {
    const agentStatuses = [];
    
    for (const agentId of this.agentLevels.keys()) {
      try {
        agentStatuses.push(this.getAgentStatus(agentId));
      } catch (error) {
        // Skip agents that can't be found
      }
    }
    
    return {
      totalAgents: this.agentLevels.size,
      agentsByLevel: this.getAgentsByLevel(),
      averageTrustScore: this.calculateAverageTrustScore(),
      pendingApprovals: this.approvalQueue.length,
      recentActions: this.actionHistory.slice(-20),
      metrics: this.metrics,
      agents: agentStatuses
    };
  }
  
  /**
   * Get agents grouped by autonomy level
   */
  getAgentsByLevel() {
    const byLevel = {};
    
    for (const [agentId, level] of this.agentLevels.entries()) {
      const levelName = this.levels[level].name;
      
      if (!byLevel[levelName]) {
        byLevel[levelName] = [];
      }
      
      byLevel[levelName].push({
        agentId,
        trustScore: this.trustScores.get(agentId)
      });
    }
    
    return byLevel;
  }
  
  /**
   * Calculate average trust score across all agents
   */
  calculateAverageTrustScore() {
    const scores = Array.from(this.trustScores.values());
    
    if (scores.length === 0) {
      return 0;
    }
    
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
  
  /**
   * Update guardrails for an agent
   */
  updateGuardrails(agentId, guardrailUpdates) {
    const currentGuardrails = this.guardrails.get(agentId) || {};
    
    const updatedGuardrails = {
      ...currentGuardrails,
      ...guardrailUpdates
    };
    
    this.guardrails.set(agentId, updatedGuardrails);
    
    console.log(`[AUTONOMY SYSTEM] Guardrails updated for agent: ${agentId}`);
    
    this.emit('guardrails_updated', {
      agentId,
      previousGuardrails: currentGuardrails,
      newGuardrails: updatedGuardrails
    });
  }
  
  /**
   * Start background processes
   */
  startBackgroundProcesses() {
    // Apply trust decay daily
    setInterval(() => {
      this.applyTrustDecay();
    }, 24 * 60 * 60 * 1000); // 24 hours
    
    // Clean up old approval requests
    setInterval(() => {
      this.cleanupExpiredApprovals();
    }, 60 * 60 * 1000); // 1 hour
    
    console.log('[AUTONOMY SYSTEM] Background processes started');
  }
  
  /**
   * Clean up expired approval requests
   */
  cleanupExpiredApprovals() {
    const now = Date.now();
    const expired = [];
    
    for (const request of this.approvalQueue) {
      if (now - request.requestedAt > request.timeout) {
        expired.push(request);
      }
    }
    
    // Move expired requests to history
    expired.forEach(request => {
      request.status = 'expired';
      request.expiredAt = now;
      this.approvalHistory.push(request);
    });
    
    // Remove from queue
    this.approvalQueue = this.approvalQueue.filter(request => 
      now - request.requestedAt <= request.timeout
    );
    
    if (expired.length > 0) {
      console.log(`[AUTONOMY SYSTEM] Cleaned up ${expired.length} expired approval requests`);
    }
  }
  
  /**
   * Get autonomy level information
   */
  getAutonomyLevels() {
    return this.levels;
  }
  
  /**
   * Export autonomy configuration
   */
  exportConfiguration() {
    return {
      config: this.config,
      agentLevels: Object.fromEntries(this.agentLevels),
      trustScores: Object.fromEntries(this.trustScores),
      guardrails: Object.fromEntries(this.guardrails),
      timestamp: Date.now()
    };
  }
  
  /**
   * Import autonomy configuration
   */
  importConfiguration(configuration) {
    this.config = { ...this.config, ...configuration.config };
    
    // Restore agent levels
    Object.entries(configuration.agentLevels).forEach(([agentId, level]) => {
      this.agentLevels.set(agentId, level);
    });
    
    // Restore trust scores
    Object.entries(configuration.trustScores).forEach(([agentId, score]) => {
      this.trustScores.set(agentId, score);
    });
    
    // Restore guardrails
    Object.entries(configuration.guardrails).forEach(([agentId, guardrails]) => {
      this.guardrails.set(agentId, guardrails);
    });
    
    console.log('[AUTONOMY SYSTEM] Configuration imported');
  }
}

module.exports = ProtoForgeAutonomySystem;
