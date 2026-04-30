// Heidi Decision Engine - Bounded Autonomy
// Controls what Heidi can do autonomously vs when to escalate
// Prevents "free will" while enabling intelligent decision-making

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

class HeidiDecisionEngine extends EventEmitter {
  constructor(selfStateModel) {
    super();
    
    this.selfState = selfStateModel;
    
    // Decision boundaries
    this.boundaries = {
      autonomy_level: 0.7, // 0.0 - 1.0
      confidence_threshold: 0.6, // Minimum confidence for autonomous action
      escalation_rules: [],
      allowed_actions: new Set(),
      restricted_actions: new Set(),
      max_retry_attempts: 3,
      timeout_duration: 30000 // 30 seconds
    };
    
    // Decision history
    this.decisionHistory = [];
    this.maxHistorySize = 500;
    
    // Current decision context
    this.currentDecision = null;
    
    this.initializeBoundaries();
  }
  
  /**
   * Initialize decision boundaries and allowed actions
   */
  initializeBoundaries() {
    console.log('[HEIDI DECISION] Decision engine initialized');
    console.log('[HEIDI DECISION] Setting bounded autonomy rules...');
    
    // Define allowed autonomous actions
    this.boundaries.allowed_actions = new Set([
      'log_interaction',
      'update_state',
      'perform_reflection',
      'generate_insight',
      'adjust_thresholds',
      'emit_status_update',
      'escalate_to_user',
      'request_confirmation'
    ]);
    
    // Define restricted actions requiring human approval
    this.boundaries.restricted_actions = new Set([
      'modify_system_configuration',
      'delete_data',
      'shutdown_system',
      'change_permissions',
      'deploy_production_changes',
      'handle_billing_operations',
      'access_sensitive_data'
    ]);
    
    // Define escalation rules
    this.boundaries.escalation_rules = [
      {
        condition: 'confidence < 0.3',
        action: 'escalate_immediately',
        reason: 'critically_low_confidence'
      },
      {
        condition: 'repeated_failure > 3',
        action: 'escalate_immediately',
        reason: 'repeated_failures'
      },
      {
        condition: 'health == "critical"',
        action: 'escalate_immediately',
        reason: 'critical_system_health'
      },
      {
        condition: 'action in restricted_actions',
        action: 'require_approval',
        reason: 'restricted_action'
      },
      {
        condition: 'user_interaction_required',
        action: 'escalate_immediately',
        reason: 'user_interaction_needed'
      }
    ];
  }
  
  /**
   * Make a decision about whether to act autonomously
   */
  async makeDecision(action, context = {}) {
    const decision = {
      id: uuidv4(),
      action,
      context,
      timestamp: new Date().toISOString(),
      result: null,
      reasoning: [],
      confidence: 0,
      escalation: false
    };
    
    this.currentDecision = decision;
    
    try {
      console.log(`[HEIDI DECISION] Evaluating action: ${action}`);
      
      // 1. Check if action is allowed
      const actionAllowed = this.checkActionPermission(action);
      decision.reasoning.push({
        step: 'permission_check',
        result: actionAllowed,
        reason: actionAllowed ? 'action_allowed' : 'action_restricted'
      });
      
      if (!actionAllowed) {
        decision.result = 'require_approval';
        decision.escalation = true;
        decision.confidence = 1.0; // Certain about needing approval
        return this.finalizeDecision(decision);
      }
      
      // 2. Assess current system state
      const stateAssessment = this.assessSystemState();
      decision.reasoning.push({
        step: 'state_assessment',
        result: stateAssessment,
        reason: `health: ${stateAssessment.health}, confidence: ${stateAssessment.confidence}`
      });
      
      // 3. Check escalation conditions
      const escalationCheck = this.checkEscalationConditions(action, context, stateAssessment);
      decision.reasoning.push(escalationCheck);
      
      if (escalationCheck.escalate) {
        decision.result = 'escalate';
        decision.escalation = true;
        decision.confidence = escalationCheck.confidence;
        return this.finalizeDecision(decision);
      }
      
      // 4. Calculate decision confidence
      decision.confidence = this.calculateDecisionConfidence(action, context, stateAssessment);
      decision.reasoning.push({
        step: 'confidence_calculation',
        result: decision.confidence,
        reason: 'based_on_system_state_and_action_complexity'
      });
      
      // 5. Compare against threshold
      if (decision.confidence >= this.boundaries.confidence_threshold) {
        decision.result = 'autonomous';
        decision.escalation = false;
      } else {
        decision.result = 'escalate';
        decision.escalation = true;
        decision.reasoning.push({
          step: 'threshold_check',
          result: 'below_threshold',
          reason: `confidence ${decision.confidence} < threshold ${this.boundaries.confidence_threshold}`
        });
      }
      
      return this.finalizeDecision(decision);
      
    } catch (error) {
      decision.result = 'error';
      decision.error = error.message;
      decision.confidence = 0;
      return this.finalizeDecision(decision);
    }
  }
  
  /**
   * Check if action is permitted
   */
  checkActionPermission(action) {
    if (this.boundaries.restricted_actions.has(action)) {
      return false;
    }
    
    if (this.boundaries.allowed_actions.has(action)) {
      return true;
    }
    
    // Unknown actions require approval
    return false;
  }
  
  /**
   * Assess current system state for decision making
   */
  assessSystemState() {
    const state = this.selfState.getDetailedState();
    
    return {
      health: state.health,
      confidence: state.confidence,
      autonomy_level: state.capabilities.decision_autonomy,
      error_rate: state.performance.error_rate,
      recent_errors: state.last_error,
      focus: state.focus
    };
  }
  
  /**
   * Check if escalation conditions are met
   */
  checkEscalationConditions(action, context, stateAssessment) {
    for (const rule of this.boundaries.escalation_rules) {
      if (this.evaluateCondition(rule.condition, action, context, stateAssessment)) {
        return {
          escalate: true,
          rule: rule.action,
          reason: rule.reason,
          confidence: 1.0
        };
      }
    }
    
    return {
      escalate: false,
      reason: 'no_escalation_conditions_met'
    };
  }
  
  /**
   * Evaluate condition expression
   */
  evaluateCondition(condition, action, context, state) {
    // Simple condition evaluation (could be enhanced with a proper expression parser)
    
    // Replace variables in condition
    const expression = condition
      .replace('confidence', state.confidence)
      .replace('health', `"${state.health}"`)
      .replace('repeated_failure', this.getRecentFailureCount())
      .replace('action', `"${action}"`);
    
    try {
      // Simple evaluation - in production, use a proper expression evaluator
      if (expression.includes('confidence <')) {
        const threshold = parseFloat(expression.split('<')[1].trim());
        return state.confidence < threshold;
      }
      
      if (expression.includes('repeated_failure >')) {
        const threshold = parseInt(expression.split('>')[1].trim());
        return this.getRecentFailureCount() > threshold;
      }
      
      if (expression.includes('health ==')) {
        const healthValue = expression.split('==')[1].trim().replace(/"/g, '');
        return state.health === healthValue;
      }
      
      if (expression.includes('action in restricted_actions')) {
        return this.boundaries.restricted_actions.has(action);
      }
      
      if (expression.includes('user_interaction_required')) {
        return context.user_interaction_required === true;
      }
      
      return false;
    } catch (error) {
      console.error('[HEIDI DECISION] Condition evaluation error:', error);
      return false;
    }
  }
  
  /**
   * Calculate confidence for autonomous decision
   */
  calculateDecisionConfidence(action, context, stateAssessment) {
    let confidence = 0.5; // Base confidence
    
    // System health impact
    if (stateAssessment.health === 'stable') {
      confidence += 0.2;
    } else if (stateAssessment.health === 'degraded') {
      confidence -= 0.1;
    } else if (stateAssessment.health === 'critical') {
      confidence -= 0.3;
    }
    
    // System confidence impact
    confidence += (stateAssessment.confidence - 0.5) * 0.4;
    
    // Autonomy level impact
    confidence += (stateAssessment.autonomy_level - 0.5) * 0.3;
    
    // Error rate impact
    if (stateAssessment.error_rate < 0.05) {
      confidence += 0.1;
    } else if (stateAssessment.error_rate > 0.15) {
      confidence -= 0.2;
    }
    
    // Action complexity impact
    const actionComplexity = this.getActionComplexity(action);
    confidence -= actionComplexity * 0.1;
    
    // Recent failures impact
    const recentFailures = this.getRecentFailureCount();
    confidence -= recentFailures * 0.05;
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  /**
   * Get complexity score for an action
   */
  getActionComplexity(action) {
    const complexityMap = {
      'log_interaction': 0.1,
      'update_state': 0.2,
      'perform_reflection': 0.3,
      'generate_insight': 0.4,
      'adjust_thresholds': 0.6,
      'modify_system_configuration': 0.9,
      'delete_data': 0.8,
      'shutdown_system': 1.0
    };
    
    return complexityMap[action] || 0.5;
  }
  
  /**
   * Get count of recent failures
   */
  getRecentFailureCount() {
    const recentDecisions = this.decisionHistory.slice(-20);
    return recentDecisions.filter(d => d.result === 'error' || d.escalation).length;
  }
  
  /**
   * Finalize and record decision
   */
  finalizeDecision(decision) {
    // Add final reasoning
    if (decision.result === 'autonomous') {
      decision.reasoning.push({
        step: 'final_decision',
        result: 'proceed_autonomously',
        reason: `confidence ${decision.confidence} meets threshold`
      });
    } else if (decision.result === 'escalate') {
      decision.reasoning.push({
        step: 'final_decision',
        result: 'escalate_to_human',
        reason: decision.escalation ? 'escalation_required' : 'confidence_below_threshold'
      });
    }
    
    // Record decision
    this.decisionHistory.push(decision);
    
    // Limit history size
    if (this.decisionHistory.length > this.maxHistorySize) {
      this.decisionHistory = this.decisionHistory.slice(-this.maxHistorySize / 2);
    }
    
    // Emit decision event
    this.emit('decision_made', decision);
    
    console.log(`[HEIDI DECISION] Decision: ${decision.result} (confidence: ${decision.confidence.toFixed(2)})`);
    
    this.currentDecision = null;
    return decision;
  }
  
  /**
   * Execute autonomous action
   */
  async executeAutonomousAction(action, context, executor) {
    const decision = await this.makeDecision(action, context);
    
    if (decision.result !== 'autonomous') {
      throw new Error(`Action not approved for autonomous execution: ${decision.result}`);
    }
    
    try {
      console.log(`[HEIDI DECISION] Executing autonomous action: ${action}`);
      
      // Execute the action
      const result = await executor(action, context);
      
      // Record successful execution
      this.recordExecutionResult(decision.id, 'success', result);
      
      return result;
      
    } catch (error) {
      // Record failed execution
      this.recordExecutionResult(decision.id, 'error', error.message);
      
      // Update system state
      this.selfState.recordError(error, { action, context });
      
      throw error;
    }
  }
  
  /**
   * Record execution result
   */
  recordExecutionResult(decisionId, result, data) {
    const decision = this.decisionHistory.find(d => d.id === decisionId);
    if (decision) {
      decision.execution_result = result;
      decision.execution_data = data;
      decision.executed_at = new Date().toISOString();
      
      this.emit('execution_completed', { decisionId, result, data });
    }
  }
  
  /**
   * Request human approval for restricted action
   */
  async requestApproval(action, context) {
    const decision = await this.makeDecision(action, context);
    
    if (decision.result === 'require_approval') {
      const approvalRequest = {
        id: uuidv4(),
        action,
        context,
        decision,
        timestamp: new Date().toISOString(),
        status: 'pending'
      };
      
      this.emit('approval_requested', approvalRequest);
      
      console.log(`[HEIDI DECISION] Human approval requested for: ${action}`);
      
      return approvalRequest;
    }
    
    return decision;
  }
  
  /**
   * Update autonomy level
   */
  updateAutonomyLevel(newLevel) {
    const oldLevel = this.boundaries.autonomy_level;
    this.boundaries.autonomy_level = Math.max(0, Math.min(1, newLevel));
    
    // Update confidence threshold based on autonomy level
    this.boundaries.confidence_threshold = 0.3 + (1 - this.boundaries.autonomy_level) * 0.5;
    
    this.emit('autonomy_updated', {
      old_level: oldLevel,
      new_level: this.boundaries.autonomy_level,
      new_threshold: this.boundaries.confidence_threshold
    });
    
    console.log(`[HEIDI DECISION] Autonomy updated: ${oldLevel} -> ${this.boundaries.autonomy_level}`);
  }
  
  /**
   * Get decision statistics
   */
  getDecisionStats() {
    const recent = this.decisionHistory.slice(-100);
    
    const stats = {
      total_decisions: this.decisionHistory.length,
      recent_decisions: recent.length,
      autonomous_actions: recent.filter(d => d.result === 'autonomous').length,
      escalations: recent.filter(d => d.escalation).length,
      errors: recent.filter(d => d.result === 'error').length,
      average_confidence: recent.reduce((sum, d) => sum + d.confidence, 0) / recent.length,
      current_autonomy_level: this.boundaries.autonomy_level,
      current_confidence_threshold: this.boundaries.confidence_threshold
    };
    
    stats.autonomy_rate = stats.recent_decisions > 0 ? stats.autonomous_actions / stats.recent_decisions : 0;
    stats.escalation_rate = stats.recent_decisions > 0 ? stats.escalations / stats.recent_decisions : 0;
    
    return stats;
  }
  
  /**
   * Get current decision
   */
  getCurrentDecision() {
    return this.currentDecision;
  }
  
  /**
   * Get decision history
   */
  getDecisionHistory(limit = 50) {
    return this.decisionHistory.slice(-limit);
  }
}

module.exports = HeidiDecisionEngine;
