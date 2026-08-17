// ProtoForge V2 - Policy Engine
// Accepts/rejects KILO suggestions, prioritizes actions, throttles system load
// NO direct modifications, NO bypassing layers

const kiloAnalyzerV2 = require('./kilo-analyzer-v2');
const { EventEmitter } = require('events');

class ProtoForgePolicyV2 extends EventEmitter {
  constructor() {
    super();
    
    // Policy configuration
    this.policies = {
      maxActionsPerMinute: 10,
      priorityWeights: {
        'INFRA_FAILURE': 10,
        'DATA_INTEGRITY_RISK': 9,
        'DEPLOYMENT_MISMATCH': 7,
        'ROUTE_FAILURE': 5,
        'STREAM_BREAK': 3,
        'UNKNOWN_ANOMALY': 1
      },
      requiredConfidence: {
        'INFRA_FAILURE': 0.7,
        'DATA_INTEGRITY_RISK': 0.8,
        'DEPLOYMENT_MISMATCH': 0.6,
        'ROUTE_FAILURE': 0.5,
        'STREAM_BREAK': 0.4,
        'UNKNOWN_ANOMALY': 0.3
      }
    };
    
    // State tracking
    this.pendingActions = new Map(); // action_id -> action
    this.approvedActions = [];
    this.rejectedActions = [];
    this.actionHistory = [];
    
    // Rate limiting
    this.actionTimestamps = [];
    this.throttledClassifications = new Set();
    
    // Statistics
    this.stats = {
      totalSuggestions: 0,
      approvedActions: 0,
      rejectedActions: 0,
      throttledActions: 0,
      actionsByClassification: new Map()
    };
    
    console.log('[PROTOFORGE V2] Initialized - Policy Engine');
    console.log('[PROTOFORGE V2] RULE: Accept/reject suggestions, no direct execution');
  }

  // Process KILO analysis - decide to accept or reject
  async processAnalysis(analysis) {
    this.stats.totalSuggestions++;
    
    try {
      // Check if we should throttle this classification
      if (this.shouldThrottle(analysis.classification)) {
        this.stats.throttledActions++;
        this.emit('action_throttled', {
          event_id: analysis.event_id,
          classification: analysis.classification,
          reason: 'Rate limit exceeded',
          timestamp: new Date().toISOString()
        });
        
        console.log(`[PROTOFORGE V2] Throttled: ${analysis.classification} - Rate limit`);
        return null;
      }
      
      // Check confidence threshold
      const minConfidence = this.policies.requiredConfidence[analysis.classification] || 0.5;
      if (analysis.confidence < minConfidence) {
        this.rejectAction(analysis, 'Low confidence');
        return null;
      }
      
      // Create action from analysis
      const action = this.createAction(analysis);
      
      // If action creation failed, emit revenue path blocked
      if (!action) {
        this.emit('revenue_path_blocked', {
          event_id: analysis.event_id,
          classification: analysis.classification,
          reason: 'Failed to create action from analysis',
          timestamp: new Date().toISOString()
        });
        return null;
      }
      
      // Evaluate action against policies
      const decision = this.evaluateAction(action);
      
      if (decision.approved) {
        this.approveAction(action, decision.reason);
        return action;
      } else {
        this.rejectAction(analysis, decision.reason);
        return null;
      }
      
    } catch (error) {
      console.error(`[PROTOFORGE V2] Error processing analysis:`, error);
      return null;
    }
  }

  // Create action from analysis
  createAction(analysis) {
    // INPUT CONTRACT ENFORCEMENT at system boundary
    // Reject invalid inputs immediately - no silent failures
    if (!analysis || typeof analysis !== 'object') {
      console.error('[PROTOFORGE V2] REJECTED: analysis is null/undefined');
      return { type: 'REJECTED', reason: 'INVALID_ANALYSIS_OBJECT', confidence: 0 };
    }
    
    if (!analysis.event_id) {
      console.error('[PROTOFORGE V2] REJECTED: missing event_id');
      return { type: 'REJECTED', reason: 'MISSING_EVENT_ID', confidence: analysis.confidence || 0 };
    }
    
    if (!analysis.classification) {
      console.error('[PROTOFORGE V2] REJECTED: missing classification');
      return { type: 'REJECTED', reason: 'MISSING_CLASSIFICATION', confidence: analysis.confidence || 0 };
    }
    
    // Normalize arrays - guaranteed safe for slice()
    const suggestedFixes = Array.isArray(analysis.suggested_fixes) 
      ? analysis.suggested_fixes 
      : ['Manual investigation required'];
    
    const investigationSteps = Array.isArray(analysis.investigation_steps)
      ? analysis.investigation_steps
      : ['Review event logs'];
    
    const hypotheses = Array.isArray(analysis.hypotheses) ? analysis.hypotheses : [];
    
    return {
      action_id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event_id: analysis.event_id,
      classification: analysis.classification,
      confidence: analysis.confidence || 0,
      priority: this.calculatePriority(analysis),
      suggested_fixes: suggestedFixes.slice(0, 3), // Safe: always an array
      investigation_steps: investigationSteps.slice(0, 3), // Safe: always an array
      created_at: new Date().toISOString(),
      status: 'pending',
      metadata: {
        hypotheses_count: hypotheses.length,
        context_summary: analysis.context_summary || 'No context available'
      }
    };
  }

  // Calculate action priority
  calculatePriority(analysis) {
    const basePriority = this.policies.priorityWeights[analysis.classification] || 1;
    const confidenceMultiplier = analysis.confidence;
    const urgencyMultiplier = this.calculateUrgencyMultiplier(analysis);
    
    return Math.round(basePriority * confidenceMultiplier * urgencyMultiplier);
  }

  // Calculate urgency based on context
  calculateUrgencyMultiplier(analysis) {
    let multiplier = 1.0;
    
    // Increase urgency for recurring issues
    if (analysis.context_summary && analysis.context_summary.error_pattern === 'recurring') {
      multiplier *= 1.5;
    }
    
    // Increase urgency for multiple affected services
    if (analysis.context_summary && Object.keys(analysis.context_summary.sources || {}).length > 2) {
      multiplier *= 1.3;
    }
    
    return multiplier;
  }

  // Evaluate action against policies
  evaluateAction(action) {
    // Check rate limiting
    if (this.isRateLimited()) {
      return {
        approved: false,
        reason: 'System rate limit exceeded'
      };
    }
    
    // Check duplicate actions
    if (this.hasRecentSimilarAction(action)) {
      return {
        approved: false,
        reason: 'Similar action recently processed'
      };
    }
    
    // Check system load (simplified)
    if (this.getSystemLoad() > 0.8) {
      // Only allow high priority actions under load
      if (action.priority < 8) {
        return {
          approved: false,
          reason: 'System load too high for low priority action'
        };
      }
    }
    
    return {
      approved: true,
      reason: 'Action meets all policy requirements'
    };
  }

  // Check if classification should be throttled
  shouldThrottle(classification) {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    
    // Count actions for this classification in the last minute
    const recentCount = this.actionTimestamps.filter(timestamp => 
      timestamp > windowStart
    ).length;
    
    return recentCount >= this.policies.maxActionsPerMinute;
  }

  // Check if rate limited
  isRateLimited() {
    const now = Date.now();
    const windowStart = now - 60000;
    
    // Count all actions in the last minute
    const recentCount = this.actionTimestamps.filter(timestamp => 
      timestamp > windowStart
    ).length;
    
    return recentCount >= this.policies.maxActionsPerMinute;
  }

  // Check for recent similar actions
  hasRecentSimilarAction(action) {
    const oneHourAgo = Date.now() - 3600000; // 1 hour
    
    return this.actionHistory.some(history => 
      history.classification === action.classification &&
      history.timestamp > oneHourAgo &&
      history.status === 'approved'
    );
  }

  // Get system load (simplified simulation)
  getSystemLoad() {
    // In real implementation, this would check actual system metrics
    const recentActions = this.actionTimestamps.filter(timestamp => 
      Date.now() - timestamp < 300000 // Last 5 minutes
    ).length;
    
    return Math.min(recentActions / 20, 1.0); // Normalize to 0-1
  }

  // Approve action
  approveAction(action, reason) {
    action.status = 'approved';
    action.approved_at = new Date().toISOString();
    action.approval_reason = reason;
    
    this.approvedActions.push(action);
    this.actionHistory.push(action);
    this.actionTimestamps.push(Date.now());
    
    // Update statistics
    this.stats.approvedActions++;
    const count = this.stats.actionsByClassification.get(action.classification) || 0;
    this.stats.actionsByClassification.set(action.classification, count + 1);
    
    // Emit approved action
    this.emit('action_approved', action);
    
    console.log(`[PROTOFORGE V2] Approved: ${action.action_id} (${action.classification}) - Priority: ${action.priority}`);
  }

  // Reject action
  rejectAction(analysis, reason) {
    const rejection = {
      event_id: analysis.event_id,
      classification: analysis.classification,
      confidence: analysis.confidence,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason
    };
    
    this.rejectedActions.push(rejection);
    this.stats.rejectedActions++;
    
    // Emit rejection
    this.emit('action_rejected', rejection);
    
    console.log(`[PROTOFORGE V2] Rejected: ${analysis.event_id} - ${reason}`);
  }

  // Get pending actions
  getPendingActions() {
    return Array.from(this.pendingActions.values());
  }

  // Get approved actions
  getApprovedActions(limit = 50) {
    return this.approvedActions
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);
  }

  // Get action queue ordered by priority
  getActionQueue() {
    return this.approvedActions
      .filter(action => action.status === 'approved')
      .sort((a, b) => b.priority - a.priority);
  }

  // Update policy configuration
  updatePolicy(policy, value) {
    if (this.policies[policy] !== undefined) {
      this.policies[policy] = value;
      console.log(`[PROTOFORGE V2] Updated policy: ${policy} = ${value}`);
    }
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      actionsByClassification: Object.fromEntries(this.stats.actionsByClassification),
      pendingActions: this.pendingActions.size,
      approvedActionsCount: this.approvedActions.length,
      rejectedActionsCount: this.rejectedActions.length,
      currentSystemLoad: this.getSystemLoad(),
      policies: this.policies
    };
  }

  // Get info
  getInfo() {
    return {
      type: 'PROTOFORGE_POLICY_V2',
      description: 'Policy Engine - Accept/reject suggestions',
      rules: [
        'ACCEPT or REJECT KILO suggestions',
        'PRIORITIZE actions based on severity',
        'THROTTLE system load',
        'NO direct system modifications',
        'NO bypassing CASCADE or KILO'
      ],
      stats: this.getStats()
    };
  }
}

// Create singleton
const protoforgePolicyV2 = new ProtoForgePolicyV2();

// Process analyses from KILO
kiloAnalyzerV2.on('event_analyzed', (analysis) => {
  // Process asynchronously
  setImmediate(() => {
    protoforgePolicyV2.processAnalysis(analysis);
  });
});

module.exports = protoforgePolicyV2;
