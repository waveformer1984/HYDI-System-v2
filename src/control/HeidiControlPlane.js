/**
 * HEIDI CONTROL PLANE - The Missing Layer
 * 
 * This is what makes it ONE system instead of six systems talking politely.
 * Without this, Heidi is just architectural cosplay.
 * 
 * 🔗 CONTROL PLANE RESPONSIBILITIES:
 * 
 * 1. Decision Authority Hierarchy
 *    - Local model → default thinker
 *    - External model → escalation only  
 *    - Orchestrator → final decision gate
 * 
 * 2. Action Gating
 *    - confidence threshold
 *    - risk level
 *    - revenue impact estimate
 *    - rollback availability
 * 
 * 3. Learning Enforcement Loop
 *    - memory stores experience
 *    - memory modifies routing weights
 *    - measurable behavioral change
 */

const EventEmitter = require('events');
const GlobalConstraintEnforcer = require('./GlobalConstraintEnforcer');
const RealityFilter = require('./RealityFilter');
const OutcomeValidator = require('./OutcomeValidator');
const logger = require('../../lib/structured-logger').child({ component: 'HeidiControlPlane' });

class HeidiControlPlane extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // CASCADE v3 Control Plane Settings
      minConfidenceForActions: config.minConfidenceForActions || 0.7,
      maxRiskForAutoActions: config.maxRiskForAutoActions || 0.3,
      maxRevenueImpactForAutoActions: config.maxRevenueImpactForAutoActions || 100,
      
      // Model scoring system
      modelPerformanceTable: new Map(), // CASCADE v3: persistent performance tracking
      modelFailurePenalty: config.modelFailurePenalty || 0.1,
      modelSuccessReward: config.modelSuccessReward || 0.05,
      
      // Adaptive routing thresholds
      localModelThreshold: config.localModelThreshold || 0.6,
      externalJustificationThreshold: config.externalJustificationThreshold || 0.2,
      
      // Learning rates
      learningRate: config.learningRate || 0.1,
      adaptationThreshold: config.adaptationThreshold || 5,
      
      // Action gating (CASCADE v3: CRITICAL)
      sandboxMode: config.sandboxMode !== false,
      requireHumanApprovalFor: config.requireHumanApprovalFor || ['stripe_payment', 'deploy_production'],
      actionTiers: {
        LOW_RISK: { maxRisk: 0.3, autoExecute: true },
        MEDIUM_RISK: { maxRisk: 0.7, autoExecute: true, log: true },
        HIGH_RISK: { maxRisk: 1.0, autoExecute: false, requiresApproval: true }
      },
      
      // Feedback loop settings
      feedbackLoopInterval: config.feedbackLoopInterval || 60000,
      enableAdaptiveLearning: config.enableAdaptiveLearning !== false,
      
      // Drift calculation (CASCADE v3: MAKE IT REAL)
      driftWeighting: {
        revenueImpact: 0.5,
        confidenceError: 0.3,
        latencyPenalty: 0.2
      },
      
      // Model performance weights for tracking
      modelPerformanceWeights: new Map()
    };
    
    // CASCADE v3 Control Plane State
    this.state = {
      // TASK 1: Model Scoring System
      modelPerformanceTable: new Map(), // CASCADE v3: persistent structure
      
      // TASK 2: Adaptive Model Routing
      routingHistory: [], // Track all routing decisions
      modelRankings: new Map(), // Dynamic model rankings per task type
      
      // TASK 3: Action Gate
      actionPermissions: new Map(), // actionType -> permission level
      riskAssessments: new Map(), // actionId -> risk score
      actionExecutionLog: [], // All action attempts
      
      // TASK 4: Feedback Injection Loop
      feedbackPackets: [], // CASCADE v3: structured feedback
      learningHistory: [],
      adaptationLog: [],
      
      // TASK 5: Real Drift Tracking
      driftScores: new Map(), // taskType -> drift history
      driftTriggers: [], // When drift exceeds thresholds
      
      // TASK 6: Revenue Feedback Loop
      revenueInfluence: new Map(), // How revenue affects decisions
      revenueAlignment: 0, // System alignment with revenue goals
      
      // TASK 7: System Output Tracking
      systemOutputs: [] // Every cycle's output
    };
    
    // Initialize Global Constraint Enforcer (the actual governance layer)
    this.globalConstraintEnforcer = new GlobalConstraintEnforcer({
      minExplorationRate: config.minExplorationRate || 0.15,
      maxVolatilityScore: config.maxVolatilityScore || 0.3,
      enableVolatilityPenalty: config.enableVolatilityPenalty !== false,
      enableExplorationEnforcement: config.enableExplorationEnforcement !== false,
      enableLongHorizonTracking: config.enableLongHorizonTracking !== false
    });
    
    // Initialize Reality Filter (CASCADE - kills bad tasks before they're born)
    this.realityFilter = new RealityFilter();
    
    // Initialize Outcome Validator (learns from real-world outcomes)
    this.outcomeValidator = new OutcomeValidator();
    
    // Initialize model performance tracking
    this.initializeModelTracking();
    
    // Initialize action permissions
    this.initializeActionPermissions();
    
    logger.info('Heidi Control Plane initialized');
    logger.info('Sandbox mode', { sandboxMode: this.config.sandboxMode ? 'ENABLED' : 'DISABLED' });
    logger.info('Adaptive learning', { adaptiveLearning: this.config.enableAdaptiveLearning ? 'ENABLED' : 'DISABLED' });
    logger.info('Global constraints', { globalConstraints: 'ENABLED' });
  }
  
  /**
   * DECISION AUTHORITY HIERARCHY
   */
  
  async routeDecision(task, availableModels, context = {}) {
    logger.info('Routing decision for task', { taskType: task.type });
    
    // Step 1: Check if local models can handle it
    const localModels = availableModels.filter(m => m.type === 'local');
    const localRecommendation = this.evaluateLocalModels(task, localModels, context);
    
    // Step 2: If local insufficient, consider external escalation
    if (localRecommendation.confidence < this.config.minConfidenceForActions) {
      const externalModels = availableModels.filter(m => m.type === 'external');
      const externalRecommendation = this.evaluateExternalModels(task, externalModels, context);
      
      // Decision: escalate to external if significantly better
      if (externalRecommendation.confidence > localRecommendation.confidence + 0.2) {
        return this.authorizeDecision('external', externalRecommendation, task, context);
      }
    }
    
    // Step 3: Default to local with orchestrator oversight
    return this.authorizeDecision('local', localRecommendation, task, context);
  }
  
  // TASK 2: CASCADE v3 Adaptive Model Routing
  evaluateLocalModels(task, models, _context) {
    if (models.length === 0) {
      return { confidence: 0, recommendedModel: null, reason: 'no_local_models' };
    }
    
    // CASCADE v3: Score models using persistent performance table
    const scoredModels = models.map(model => {
      const performance = this.getModelPerformance(model.id, task.type);
      
      // CASCADE v3: f(performance, cost, latency, confidence_match)
      const score = this.calculateModelScore(performance, task);
      
      return {
        model,
        score,
        performance,
        justification: this.generateJustification(performance, score)
      };
    });
    
    // Sort by score
    scoredModels.sort((a, b) => b.score - a.score);
    
    const best = scoredModels[0];
    
    // CASCADE v3: Log routing decision
    this.logRoutingDecision(task, 'local', best, scoredModels);
    
    return {
      confidence: best.score,
      recommendedModel: best.model,
      reason: 'local_model_selected',
      alternatives: scoredModels.slice(1, 3),
      performance: best.performance,
      justification: best.justification
    };
  }
  
  // TASK 1: CASCADE v3 Model Scoring System
  getModelPerformance(modelId, taskType) {
    if (!this.state.modelPerformanceTable.has(modelId)) {
      // Initialize model performance tracking
      this.state.modelPerformanceTable.set(modelId, {
        model_id: modelId,
        task_type: {},
        overall: {
          success_rate: 0.5,
          avg_latency: 1000,
          cost_per_call: 0.05,
          confidence_calibration_error: 0.3,
          total_calls: 0,
          successful_calls: 0
        }
      });
    }
    
    const modelData = this.state.modelPerformanceTable.get(modelId);
    
    // Get task-specific performance
    if (!modelData.task_type[taskType]) {
      modelData.task_type[taskType] = {
        success_rate: 0.5,
        avg_latency: 1000,
        cost_per_call: 0.05,
        confidence_calibration_error: 0.3,
        total_calls: 0,
        successful_calls: 0
      };
    }
    
    return modelData.task_type[taskType];
  }
  
  calculateModelScore(performance, _task) {
    // CASCADE v3: f(performance, cost, latency, confidence_match)
    const successRateWeight = 0.4;
    const latencyWeight = 0.2;
    const costWeight = 0.2;
    const confidenceWeight = 0.2;
    
    // Normalize metrics (lower is better for latency and cost)
    const normalizedLatency = Math.max(0, 1 - (performance.avg_latency / 5000)); // 5s max
    const normalizedCost = Math.max(0, 1 - (performance.cost_per_call / 0.50)); // $0.50 max
    const confidenceAccuracy = 1 - performance.confidence_calibration_error;
    
    const score = 
      (performance.success_rate * successRateWeight) +
      (normalizedLatency * latencyWeight) +
      (normalizedCost * costWeight) +
      (confidenceAccuracy * confidenceWeight);
    
    return Math.max(0, Math.min(1, score));
  }
  
  generateJustification(performance, _score) {
    const reasons = [];
    
    if (performance.success_rate > 0.8) {
      reasons.push('high_success_rate');
    }
    if (performance.avg_latency < 1000) {
      reasons.push('low_latency');
    }
    if (performance.cost_per_call < 0.05) {
      reasons.push('low_cost');
    }
    if (performance.confidence_calibration_error < 0.2) {
      reasons.push('well_calibrated');
    }
    
    return reasons.length > 0 ? reasons : ['baseline_performance'];
  }
  
  logRoutingDecision(task, strategy, bestModel, allModels) {
    const routingLog = {
      timestamp: Date.now(),
      task_type: task.type,
      strategy: strategy,
      selected_model: bestModel.model.id,
      selected_score: bestModel.score,
      available_models: allModels.map(m => ({ id: m.model.id, score: m.score })),
      justification: bestModel.justification
    };
    
    this.state.routingHistory.push(routingLog);
    
    // Keep history manageable
    if (this.state.routingHistory.length > 1000) {
      this.state.routingHistory = this.state.routingHistory.slice(-500);
    }
  }
  
  evaluateExternalModels(task, models, _context) {
    if (models.length === 0) {
      return { confidence: 0, recommendedModel: null, reason: 'no_external_models' };
    }
    
    // External models are higher cost but potentially higher quality
    const scoredModels = models.map(model => {
      const performance = this.state.modelPerformance.get(model.id) || {
        successRate: 0.7, // Assume external models are generally better
        avgLatency: 2000,
        avgCost: 0.20,
        taskTypePerformance: new Map()
      };
      
      const taskPerformance = performance.taskTypePerformance.get(task.type) || 0.7;
      const costPenalty = performance.avgCost > 0.15 ? 0.1 : 0;
      const overallScore = (performance.successRate * 0.3) + (taskPerformance * 0.5) + (0.2 - costPenalty);
      
      return {
        model,
        score: overallScore,
        successRate: performance.successRate,
        taskPerformance,
        costPenalty
      };
    });
    
    scoredModels.sort((a, b) => b.score - a.score);
    
    const best = scoredModels[0];
    
    return {
      confidence: best.score,
      recommendedModel: best.model,
      reason: 'external_model_selected',
      alternatives: scoredModels.slice(1, 3),
      performance: {
        successRate: best.successRate,
        taskPerformance: best.taskPerformance
      }
    };
  }
  
  authorizeDecision(strategy, recommendation, task, context) {
    const decision = {
      strategy,
      model: recommendation.recommendedModel,
      confidence: recommendation.confidence,
      authorized: true,
      reason: recommendation.reason,
      alternatives: recommendation.alternatives,
      timestamp: Date.now(),
      taskId: task.id
    };
    
    // Apply Global Constraint Enforcer governance
    const governance = this.globalConstraintEnforcer.enforceConstraints(decision, { type: task.type }, context);
    
    if (!governance.allowed) {
      logger.warn('Decision blocked by global constraints', { reason: governance.reason });
      
      return {
        ...decision,
        authorized: false,
        blocked: true,
        blockReason: governance.reason,
        governance
      };
    }
    
    // Apply governance overrides
    if (governance.overrides.length > 0) {
      logger.info('Governance overrides applied', { count: governance.overrides.length });
      
      for (const override of governance.overrides) {
        if (override.type === 'exploration' && override.override) {
          decision.model = { id: override.override };
          decision.strategy = 'forced_exploration';
          decision.reason = `exploration_enforced: ${override.reason}`;
        }
      }
    }
    
    // Apply governance penalties
    if (governance.penalties.length > 0) {
      logger.info('Governance penalties applied', { count: governance.penalties.length });
      decision.confidence = governance.finalDecision.confidence;
    }
    
    // Log decision for learning
    this.logDecision(decision, task, context);
    
    // Record model selection for stability tracking
    if (decision.model) {
      this.globalConstraintEnforcer.recordModelSelection(decision.model.id, task.id);
    }
    
    logger.info('Decision authorized', { strategy, modelId: decision.model?.id, confidence: decision.confidence.toFixed(3) });
    
    return {
      ...decision,
      governance
    };
  }
  
  /**
   * ACTION GATING
   */
  
  async gateAction(action, context = {}) {
    logger.info('Gating action', { actionType: action.type });
    
    // STEP 0: Reality Filter (CASCADE) - kills bad tasks before they're born
    const realityCheck = await this.realityFilter.filter(action);
    if (!realityCheck.approved) {
      logger.warn('CASCADE task killed', { reason: realityCheck.reason });
      await this.realityFilter.logKill(action, realityCheck.reason);
      
      return {
        allowed: false,
        reason: `CASCADE: ${realityCheck.reason}`,
        cascadeKilled: true
      };
    }
    
    // Step 1: Check basic permissions
    const permission = this.checkActionPermission(action.type);
    if (!permission.allowed) {
      return {
        allowed: false,
        reason: permission.reason,
        requiresApproval: true
      };
    }
    
    // Step 2: Assess risk
    const riskAssessment = this.assessActionRisk(action, context);
    this.state.riskAssessments.set(action.id, riskAssessment);
    
    // Step 3: Apply Global Constraint Enforcer governance
    const enrichedAction = {
      ...action,
      revenueImpact: riskAssessment.revenueImpact,
      riskScore: riskAssessment.score
    };
    
    const governance = this.globalConstraintEnforcer.enforceConstraints(
      { model: null, confidence: action.confidence || 0.8 },
      enrichedAction,
      context
    );
    
    if (!governance.allowed) {
      logger.warn('Action blocked by global constraints', { reason: governance.reason });
      
      return {
        allowed: false,
        reason: governance.reason,
        requiresApproval: true,
        riskAssessment,
        governance
      };
    }
    
    // Step 4: Check confidence threshold
    if (governance.finalDecision.confidence < this.config.minConfidenceForActions) {
      return {
        allowed: false,
        reason: `confidence too low: ${governance.finalDecision.confidence.toFixed(3)} < ${this.config.minConfidenceForActions}`,
        requiresApproval: true,
        riskAssessment,
        governance
      };
    }
    
    // Step 5: Check risk threshold
    if (riskAssessment.score > this.config.maxRiskForAutoActions) {
      return {
        allowed: false,
        reason: `risk too high: ${riskAssessment.score.toFixed(3)} > ${this.config.maxRiskForAutoActions}`,
        requiresApproval: true,
        riskAssessment,
        governance
      };
    }
    
    // Step 6: Check revenue impact
    if (riskAssessment.revenueImpact > this.config.maxRevenueImpactForAutoActions) {
      return {
        allowed: false,
        reason: `revenue impact too high: $${riskAssessment.revenueImpact}`,
        requiresApproval: true,
        riskAssessment,
        governance
      };
    }
    
    // Step 7: Check sandbox mode
    if (this.config.sandboxMode && permission.level === 'production') {
      return {
        allowed: false,
        reason: 'sandbox mode blocks production actions',
        requiresApproval: true,
        riskAssessment,
        governance
      };
    }
    
    // Step 8: Check human approval requirements
    if (this.config.requireHumanApprovalFor.includes(action.type)) {
      return {
        allowed: false,
        reason: `action type ${action.type} requires human approval`,
        requiresApproval: true,
        riskAssessment,
        governance
      };
    }
    
    // Record action for stability tracking
    this.globalConstraintEnforcer.recordAction(action.type, true, riskAssessment.revenueImpact);
    
    // Action approved
    return {
      allowed: true,
      reason: 'all checks passed',
      requiresApproval: false,
      riskAssessment,
      governance
    };
  }
  
  checkActionPermission(actionType) {
    const permission = this.state.actionPermissions.get(actionType) || {
      level: 'sandbox',
      allowed: true,
      reason: 'default_permission'
    };
    
    return permission;
  }
  
  // TASK 3: CASCADE v3 Action Gate (CRITICAL)
  assessActionRisk(action, context) {
    let riskScore = 0;
    let revenueImpact = 0;
    const riskFactors = [];
    
    // Base risk by action type
    const baseRisks = {
      'stripe_payment': 0.8,
      'deploy_production': 0.9,
      'send_email': 0.2,
      'update_database': 0.6,
      'launch_script': 0.7,
      'generate_offer': 0.3
    };
    
    riskScore += baseRisks[action.type] || 0.5;
    
    // Revenue impact assessment
    if (action.type === 'stripe_payment') {
      revenueImpact = action.params?.amount || 0;
    } else if (action.type === 'generate_offer') {
      revenueImpact = action.params?.pricing?.price || 0;
    }
    
    // CASCADE v3: Context-based risk adjustments
    if (context.tier === 'enterprise') {
      riskScore *= 0.8;
    } else if (context.tier === 'starter') {
      riskScore *= 1.2;
    }
    
    // Confidence-based risk adjustment
    if (action.confidence && action.confidence < this.config.minConfidenceForActions) {
      riskScore *= 1.3;
      riskFactors.push('low_confidence');
    }
    
    // Cost-based risk
    if (action.cost && action.cost > 0.5) {
      riskScore *= 1.2;
      riskFactors.push('high_cost');
    }
    
    // Cap risk score
    riskScore = Math.min(1.0, riskScore);
    
    // CASCADE v3: Determine action tier
    let actionTier;
    if (riskScore <= this.config.actionTiers.LOW_RISK.maxRisk) {
      actionTier = 'LOW_RISK';
    } else if (riskScore <= this.config.actionTiers.MEDIUM_RISK.maxRisk) {
      actionTier = 'MEDIUM_RISK';
    } else {
      actionTier = 'HIGH_RISK';
    }
    
    const tierConfig = this.config.actionTiers[actionTier];
    
    return {
      score: riskScore,
      revenueImpact,
      factors: riskFactors,
      level: actionTier,
      tier: actionTier,
      autoExecute: tierConfig.autoExecute,
      requiresApproval: tierConfig.requiresApproval,
      shouldLog: tierConfig.log || false
    };
  }
  
  /**
   * LEARNING ENFORCEMENT LOOP
   */
  
  // TASK 4: CASCADE v3 Feedback Injection Loop
  recordActionOutcome(action, outcome) {
    logger.info('Recording outcome for action', { actionId: action.id });
    
    // CASCADE v3: Create structured feedback packet
    const feedbackPacket = {
      task_type: action.type,
      model_used: action.model,
      expected_outcome: {
        success: action.confidence > 0.5,
        confidence: action.confidence,
        estimated_cost: action.cost
      },
      actual_outcome: {
        success: outcome.success,
        revenue_delta: outcome.revenue || 0,
        latency: outcome.latency || 0,
        error_sources: outcome.error ? [outcome.error] : []
      },
      success_boolean: outcome.success,
      revenue_delta: outcome.revenue || 0,
      error_sources: outcome.error ? [outcome.error] : [],
      timestamp: Date.now()
    };
    
    // CASCADE v3: Store feedback packet
    this.state.feedbackPackets.push(feedbackPacket);
    
    // Update model performance table
    this.updateModelPerformanceTable(feedbackPacket);
    
    // Update action permissions
    this.updateActionPermissions(feedbackPacket);
    
    // Calculate and track drift
    this.calculateDrift(feedbackPacket);
    
    // Update revenue influence
    this.updateRevenueInfluence(feedbackPacket);
    
    // Record performance for Global Constraint Enforcer
    if (feedbackPacket.model_used) {
      this.globalConstraintEnforcer.recordPerformance(
        feedbackPacket.model_used,
        feedbackPacket.task_type,
        feedbackPacket.success_boolean ? 1 : 0,
        feedbackPacket.expected_outcome.estimated_cost || 0,
        feedbackPacket.actual_outcome.latency
      );
    }
    
    // Record revenue for stability tracking
    if (feedbackPacket.revenue_delta > 0) {
      this.globalConstraintEnforcer.recordRevenue(feedbackPacket.revenue_delta, feedbackPacket.model_used);
    }
    
    // Store in learning history
    this.state.learningHistory.push(feedbackPacket);
    
    // Keep history manageable
    if (this.state.learningHistory.length > 10000) {
      this.state.learningHistory = this.state.learningHistory.slice(-5000);
    }
    
    // Trigger adaptation if enough data
    if (this.state.learningHistory.length % this.config.adaptationThreshold === 0) {
      this.triggerAdaptation();
    }
    
    // Emit learning event
    this.emit('learning_recorded', feedbackPacket);
  }
  
  // TASK 1: Update persistent model performance table
  updateModelPerformanceTable(feedbackPacket) {
    const modelId = feedbackPacket.model_used;
    const taskType = feedbackPacket.task_type;
    
    const performance = this.getModelPerformance(modelId, taskType);
    
    // Update counts
    performance.total_calls++;
    if (feedbackPacket.success_boolean) {
      performance.successful_calls++;
    }
    
    // Update success rate
    performance.success_rate = performance.successful_calls / performance.total_calls;
    
    // Update averages
    const newLatency = feedbackPacket.actual_outcome.latency;
    performance.avg_latency = (performance.avg_latency * (performance.total_calls - 1) + newLatency) / performance.total_calls;
    
    // Update confidence calibration error
    const actualSuccess = feedbackPacket.success_boolean;
    const confidenceError = Math.abs(feedbackPacket.expected_outcome.confidence - (actualSuccess ? 1 : 0));
    performance.confidence_calibration_error = (performance.confidence_calibration_error * (performance.total_calls - 1) + confidenceError) / performance.total_calls;
    
    // Update overall model performance
    const overallPerf = this.state.modelPerformanceTable.get(modelId).overall;
    overallPerf.total_calls = performance.total_calls;
    overallPerf.successful_calls = performance.successful_calls;
    overallPerf.success_rate = performance.success_rate;
    overallPerf.avg_latency = performance.avg_latency;
    overallPerf.confidence_calibration_error = performance.confidence_calibration_error;
  }
  
  calculateActualConfidence(action, outcome) {
    // Calculate what confidence should have been based on actual outcome
    if (outcome.success) {
      return Math.min(1.0, action.confidence + 0.2);
    } else {
      return Math.max(0.0, action.confidence - 0.3);
    }
  }
  
  updateModelPerformance(record) {
    const modelId = record.model;
    
    if (!modelId) return;
    
    let performance = this.state.modelPerformance.get(modelId);
    if (!performance) {
      performance = {
        successRate: 0.5,
        avgLatency: 1000,
        avgCost: 0.05,
        totalActions: 0,
        successfulActions: 0,
        taskTypePerformance: new Map(),
        lastUpdated: Date.now()
      };
      this.state.modelPerformance.set(modelId, performance);
    }
    
    // Update overall metrics
    performance.totalActions++;
    if (record.success) {
      performance.successfulActions++;
    }
    performance.successRate = performance.successfulActions / performance.totalActions;
    
    // Update averages
    performance.avgLatency = (performance.avgLatency * (performance.totalActions - 1) + record.latency) / performance.totalActions;
    performance.avgCost = (performance.avgCost * (performance.totalActions - 1) + record.cost) / performance.totalActions;
    
    // Update task-specific performance
    const taskType = record.actionType;
    let taskPerformance = performance.taskTypePerformance.get(taskType);
    if (!taskPerformance) {
      taskPerformance = { success: 0, total: 0 };
      performance.taskTypePerformance.set(taskType, taskPerformance);
    }
    
    taskPerformance.total++;
    if (record.success) {
      taskPerformance.success++;
    }
    
    const taskSuccessRate = taskPerformance.success / taskPerformance.total;
    performance.taskTypePerformance.set(taskType, taskSuccessRate);
    
    performance.lastUpdated = Date.now();
    
    logger.info('Updated model performance', { modelId, successRate: performance.successRate.toFixed(3) });
  }
  
  updateActionPermissions(record) {
    const actionType = record.actionType;
    
    // Adjust permissions based on success rate
    const recentActions = this.state.learningHistory.filter(r => 
      r.actionType === actionType && 
      Date.now() - r.timestamp < 3600000 // Last hour
    );
    
    if (recentActions.length >= 10) {
      const successRate = recentActions.filter(r => r.success).length / recentActions.length;
      
      let permission = this.state.actionPermissions.get(actionType);
      if (!permission) {
        permission = { level: 'sandbox', allowed: true, reason: 'default_permission' };
      }
      
      // Adjust permission level based on performance
      if (successRate > 0.9 && permission.level === 'sandbox') {
        permission.level = 'production';
        permission.reason = 'high_success_rate_promotion';
        logger.info('Promoted action to production level', { actionType });
      } else if (successRate < 0.5 && permission.level === 'production') {
        permission.level = 'sandbox';
        permission.reason = 'low_success_rate_demotion';
        logger.info('Demoted action to sandbox level', { actionType });
      }
      
      this.state.actionPermissions.set(actionType, permission);
    }
  }
  
  // TASK 5: CASCADE v3 Drift Redefinition (MAKE IT REAL)
  calculateDrift(feedbackPacket) {
    const taskType = feedbackPacket.task_type;
    
    // CASCADE v3: drift = |expected_outcome - actual_outcome| weighted by revenue impact
    const expectedSuccess = feedbackPacket.expected_outcome.success;
    const actualSuccess = feedbackPacket.success_boolean;
    const expectedConfidence = feedbackPacket.expected_outcome.confidence;
    
    // Calculate outcome difference
    const outcomeDifference = Math.abs((expectedSuccess ? 1 : 0) - (actualSuccess ? 1 : 0));
    const confidenceError = Math.abs(expectedConfidence - (actualSuccess ? 1 : 0));
    const latencyPenalty = feedbackPacket.actual_outcome.latency > 3000 ? 1 : 0; // 3s threshold
    
    // Weight by revenue impact
    const revenueWeight = Math.min(1, Math.abs(feedbackPacket.revenue_delta) / 100); // Normalize to $100
    
    // CASCADE v3: Weighted drift calculation
    const driftScore = 
      (outcomeDifference * this.config.driftWeighting.revenueImpact * revenueWeight) +
      (confidenceError * this.config.driftWeighting.confidenceError) +
      (latencyPenalty * this.config.driftWeighting.latencyPenalty);
    
    // Store drift score
    if (!this.state.driftScores.has(taskType)) {
      this.state.driftScores.set(taskType, []);
    }
    
    this.state.driftScores.get(taskType).push({
      timestamp: Date.now(),
      score: driftScore,
      revenue_weight: revenueWeight,
      feedback_id: feedbackPacket.task_type + '_' + Date.now()
    });
    
    // Check for drift triggers
    if (driftScore > 0.5) {
      this.handleDriftTrigger(taskType, driftScore, feedbackPacket);
    }
    
    return driftScore;
  }
  
  handleDriftTrigger(taskType, driftScore, feedbackPacket) {
    logger.warn('High drift detected', { taskType, driftScore: driftScore.toFixed(3) });
    
    const trigger = {
      timestamp: Date.now(),
      task_type: taskType,
      drift_score: driftScore,
      feedback_packet: feedbackPacket,
      actions_taken: []
    };
    
    // CASCADE v3: High drift triggers system adjustments
    if (driftScore > 0.7) {
      // Model reranking
      this.rerankModelsForTask(taskType);
      trigger.actions_taken.push('model_reranking');
      
      // Strategy adjustment
      this.adjustStrategyForTask(taskType);
      trigger.actions_taken.push('strategy_adjustment');
      
      // Escalation to external model
      this.enableEscalationForTask(taskType);
      trigger.actions_taken.push('escalation_enabled');
    } else if (driftScore > 0.5) {
      // Model reranking only
      this.rerankModelsForTask(taskType);
      trigger.actions_taken.push('model_reranking');
    }
    
    this.state.driftTriggers.push(trigger);
    
    // Emit drift trigger event
    this.emit('drift_triggered', trigger);
  }
  
  rerankModelsForTask(taskType) {
    logger.info('Reranking models for task', { taskType });
    
    // Get all models with performance data for this task
    const modelScores = [];
    
    for (const [modelId, modelData] of this.state.modelPerformanceTable) {
      if (modelData.task_type[taskType]) {
        const performance = modelData.task_type[taskType];
        const score = this.calculateModelScore(performance, { type: taskType });
        modelScores.push({ modelId, score, performance });
      }
    }
    
    // Sort by score
    modelScores.sort((a, b) => b.score - a.score);
    
    // Update rankings
    this.state.modelRankings.set(taskType, modelScores);
    
    logger.info('Updated rankings', { taskType, topModels: modelScores.slice(0, 3).map(m => `${m.modelId}(${m.score.toFixed(3)})`) });
  }
  
  adjustStrategyForTask(taskType) {
    logger.info('Adjusting strategy for task', { taskType });
    
    // Increase confidence threshold for this task type
    // This would be used by the orchestrator
    const adjustment = {
      task_type: taskType,
      adjustment_type: 'confidence_threshold_increase',
      old_threshold: this.config.minConfidenceForActions,
      new_threshold: Math.min(0.9, this.config.minConfidenceForActions + 0.1),
      reason: 'high_drift_detected'
    };
    
    this.emit('strategy_adjustment', adjustment);
  }
  
  enableEscalationForTask(taskType) {
    logger.info('Enabling escalation for task', { taskType });
    
    // Lower external justification threshold for this task type
    const adjustment = {
      task_type: taskType,
      adjustment_type: 'escalation_enabled',
      old_threshold: this.config.externalJustificationThreshold,
      new_threshold: Math.max(0.1, this.config.externalJustificationThreshold - 0.1),
      reason: 'critical_drift_detected'
    };
    
    this.emit('escalation_enabled', adjustment);
  }
  
  // TASK 6: CASCADE v3 Revenue Feedback Loop
  updateRevenueInfluence(feedbackPacket) {
    const revenueDelta = feedbackPacket.revenue_delta;
    
    if (revenueDelta > 0) {
      // Positive revenue influence
      const modelId = feedbackPacket.model_used;
      const taskType = feedbackPacket.task_type;
      
      // Increase model selection probability for revenue-generating tasks
      if (!this.state.revenueInfluence.has(modelId)) {
        this.state.revenueInfluence.set(modelId, {
          total_revenue: 0,
          task_types: new Map(),
          selection_boost: 0
        });
      }
      
      const influence = this.state.revenueInfluence.get(modelId);
      influence.total_revenue += revenueDelta;
      
      if (!influence.task_types.has(taskType)) {
        influence.task_types.set(taskType, 0);
      }
      influence.task_types.set(taskType, influence.task_types.get(taskType) + revenueDelta);
      
      // Calculate selection boost (logarithmic to prevent excessive bias)
      influence.selection_boost = Math.log(1 + influence.total_revenue) * 0.1;
      
      // Update system revenue alignment
      this.updateRevenueAlignment();
      
      logger.info('Revenue influence updated', { modelId, revenueDelta: revenueDelta.toFixed(2), selectionBoost: influence.selection_boost.toFixed(3) });
    }
  }
  
  updateRevenueAlignment() {
    let totalRevenue = 0;
    let totalActions = 0;
    
    for (const influence of this.state.revenueInfluence.values()) {
      totalRevenue += influence.total_revenue;
    }
    
    totalActions = this.state.learningHistory.length;
    
    // Calculate revenue alignment (revenue per action)
    this.state.revenueAlignment = totalActions > 0 ? totalRevenue / totalActions : 0;
  }
  
  // CASCADE v3: Enhanced adaptation with revenue influence
  triggerAdaptation() {
    if (!this.config.enableAdaptiveLearning) {
      return;
    }
    
    logger.info('Triggering CASCADE v3 adaptation cycle');
    
    const adaptations = [];
    
    // Adapt model weights based on performance + revenue influence
    for (const [modelId, modelData] of this.state.modelPerformanceTable) {
      if (modelData.overall.total_calls >= 10) {
        const baseWeight = modelData.overall.success_rate;
        
        // Add revenue influence
        const revenueInfluence = this.state.revenueInfluence.get(modelId);
        const revenueBoost = revenueInfluence ? revenueInfluence.selection_boost : 0;
        
        const targetWeight = Math.min(1.0, baseWeight + revenueBoost);
        const currentWeight = this.config.modelPerformanceWeights.get(modelId) || 0.5;
        
        // Gradual adaptation
        const newWeight = currentWeight + (targetWeight - currentWeight) * this.config.learningRate;
        this.config.modelPerformanceWeights.set(modelId, newWeight);
        
        adaptations.push({
          type: 'model_weight',
          modelId,
          oldWeight: currentWeight,
          newWeight,
          baseWeight,
          revenueBoost,
          reason: `cascade_v3_adaptation_${modelData.overall.success_rate.toFixed(3)}_revenue_${revenueBoost.toFixed(3)}`
        });
      }
    }
    
    // Store adaptation log
    const adaptationRecord = {
      timestamp: Date.now(),
      adaptations,
      trigger: 'cascade_v3_performance_threshold',
      systemState: this.getSystemState(),
      revenueAlignment: this.state.revenueAlignment
    };
    
    this.state.adaptationLog.push(adaptationRecord);
    
    // Keep log manageable
    if (this.state.adaptationLog.length > 100) {
      this.state.adaptationLog = this.state.adaptationLog.slice(-50);
    }
    
    // Emit adaptation event
    this.emit('adaptation_completed', adaptationRecord);
    
    logger.info('CASCADE v3 adaptation completed', { adjustments: adaptations.length, revenueAlignmentPerAction: this.state.revenueAlignment.toFixed(2) });
  }
  
  /**
   * FEEDBACK INJECTION LOOP
   */
  
  startFeedbackLoop() {
    const feedbackCycle = async () => {
      try {
        await this.runFeedbackCycle();
      } catch (error) {
        logger.error('Feedback cycle failed', { error });
      }
      
      // Schedule next cycle
      setTimeout(feedbackCycle, this.config.feedbackLoopInterval);
    };
    
    // Start feedback loop
    feedbackCycle();
    
    logger.info('Feedback loop started');
  }
  
  async runFeedbackCycle() {
    logger.info('Running feedback cycle');
    
    // Analyze recent performance
    const recentActions = this.state.learningHistory.filter(r => 
      Date.now() - r.timestamp < 3600000 // Last hour
    );
    
    if (recentActions.length < 5) {
      logger.info('Insufficient data for feedback cycle');
      return;
    }
    
    // Generate feedback insights
    const insights = this.generateFeedbackInsights(recentActions);
    
    // Apply feedback to system
    for (const insight of insights) {
      await this.applyFeedback(insight);
    }
    
    // Emit feedback event
    this.emit('feedback_cycle_completed', {
      insights,
      timestamp: Date.now()
    });
  }
  
  generateFeedbackInsights(actions) {
    const insights = [];
    
    // Model performance insights
    const modelGroups = this.groupBy(actions, 'model');
    for (const [modelId, modelActions] of modelGroups) {
      const successRate = modelActions.filter(a => a.success).length / modelActions.length;
      
      if (successRate < 0.6) {
        insights.push({
          type: 'model_degradation',
          target: modelId,
          severity: 'high',
          recommendation: 'reduce_usage',
          data: { successRate, sampleSize: modelActions.length }
        });
      } else if (successRate > 0.9) {
        insights.push({
          type: 'model_excellence',
          target: modelId,
          severity: 'low',
          recommendation: 'increase_usage',
          data: { successRate, sampleSize: modelActions.length }
        });
      }
    }
    
    // Action type insights
    const actionGroups = this.groupBy(actions, 'actionType');
    for (const [actionType, typeActions] of actionGroups) {
      const avgConfidence = typeActions.reduce((sum, a) => sum + a.confidence, 0) / typeActions.length;
      const actualSuccessRate = typeActions.filter(a => a.success).length / typeActions.length;
      
      if (Math.abs(avgConfidence - actualSuccessRate) > 0.3) {
        insights.push({
          type: 'confidence_miscalibration',
          target: actionType,
          severity: 'medium',
          recommendation: 'calibrate_confidence',
          data: { avgConfidence, actualSuccessRate, sampleSize: typeActions.length }
        });
      }
    }
    
    return insights;
  }
  
  async applyFeedback(insight) {
    logger.info('Applying feedback', { insightType: insight.type, target: insight.target });
    
    switch (insight.type) {
      case 'model_degradation': {
        // Reduce model weight
        const currentWeight = this.config.modelPerformanceWeights.get(insight.target) || 0.5;
        const newWeight = Math.max(0.1, currentWeight - 0.2);
        this.config.modelPerformanceWeights.set(insight.target, newWeight);
        break;
      }

      case 'model_excellence': {
        // Increase model weight
        const currentWeight = this.config.modelPerformanceWeights.get(insight.target) || 0.5;
        const newWeight = Math.min(1.0, currentWeight + 0.1);
        this.config.modelPerformanceWeights.set(insight.target, newWeight);
        break;
      }
        
      case 'confidence_miscalibration':
        // Adjust confidence threshold for this action type
        // This would need to be implemented in the orchestrator
        logger.info('Confidence miscalibration detected', { target: insight.target });
        break;
    }
  }
  
  /**
   * UTILITY METHODS
   */
  
  initializeModelTracking() {
    // Initialize with default weights for known models
    const defaultModels = [
      'gpt-4-local',
      'gpt-35-turbo',
      'local-llama',
      'local-classifier'
    ];
    
    for (const modelId of defaultModels) {
      this.config.modelPerformanceWeights.set(modelId, 0.7);
    }
  }
  
  initializeActionPermissions() {
    // Set default permissions for action types
    const defaultPermissions = {
      'send_email': { level: 'production', allowed: true, reason: 'low_risk' },
      'generate_offer': { level: 'production', allowed: true, reason: 'revenue_critical' },
      'stripe_payment': { level: 'sandbox', allowed: true, reason: 'high_risk' },
      'deploy_production': { level: 'sandbox', allowed: true, reason: 'critical_risk' },
      'update_database': { level: 'sandbox', allowed: true, reason: 'data_risk' },
      'launch_script': { level: 'sandbox', allowed: true, reason: 'execution_risk' }
    };
    
    for (const [actionType, permission] of Object.entries(defaultPermissions)) {
      this.state.actionPermissions.set(actionType, permission);
    }
  }
  
  logDecision(decision, _task, _context) {
    // This would be stored in memory system for analysis
    logger.info('Decision logged', { strategy: decision.strategy, modelId: decision.model?.id });
  }
  
  groupBy(items, key) {
    const groups = new Map();
    for (const item of items) {
      const value = item[key];
      if (!groups.has(value)) {
        groups.set(value, []);
      }
      groups.get(value).push(item);
    }
    return groups;
  }
  
  /**
   * STATUS AND MONITORING
   */
  
  // TASK 7: CASCADE v3 System Output Requirements
  generateSystemOutput(task, decision, action, outcome) {
    const output = {
      timestamp: Date.now(),
      cycle_id: `cycle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      
      // Model selected + why
      model_selection: {
        model: decision.model?.id || 'none',
        strategy: decision.strategy,
        confidence: decision.confidence,
        justification: decision.justification || [],
        alternatives: decision.alternatives?.map(alt => ({ model: alt.model?.id, score: alt.score })) || []
      },
      
      // Action taken + risk tier
      action_taken: {
        type: action?.type || 'none',
        risk_tier: action?.riskAssessment?.tier || 'none',
        risk_score: action?.riskAssessment?.score || 0,
        auto_execute: action?.gating?.allowed || false,
        requires_approval: action?.gating?.requiresApproval || false
      },
      
      // Outcome vs expectation
      outcome_comparison: {
        expected_success: decision.confidence > 0.5,
        actual_success: outcome?.success || false,
        confidence_accuracy: Math.abs(decision.confidence - (outcome?.success ? 1 : 0)),
        revenue_delta: outcome?.revenue || 0,
        latency: outcome?.latency || 0
      },
      
      // Drift score
      drift_score: this.calculateCurrentDrift(task.type),
      
      // System adjustment (if any)
      system_adjustment: this.getLatestAdjustment(task.type)
    };
    
    // Store system output
    this.state.systemOutputs.push(output);
    
    // Keep outputs manageable
    if (this.state.systemOutputs.length > 1000) {
      this.state.systemOutputs = this.state.systemOutputs.slice(-500);
    }
    
    // Emit system output
    this.emit('system_output', output);
    
    return output;
  }
  
  calculateCurrentDrift(taskType) {
    if (!this.state.driftScores.has(taskType)) {
      return 0;
    }
    
    const driftHistory = this.state.driftScores.get(taskType);
    if (driftHistory.length === 0) {
      return 0;
    }
    
    // Return the most recent drift score
    return driftHistory[driftHistory.length - 1].score;
  }
  
  getLatestAdjustment(taskType) {
    // Find the most recent adaptation for this task type
    for (let i = this.state.adaptationLog.length - 1; i >= 0; i--) {
      const adaptation = this.state.adaptationLog[i];
      for (const adj of adaptation.adaptations) {
        if (adj.reason && adj.reason.includes(taskType)) {
          return {
            type: adj.type,
            adjustment: adj.reason,
            timestamp: adaptation.timestamp
          };
        }
      }
    }
    
    return null;
  }
  
  getSystemState() {
    const globalConstraintsStatus = this.globalConstraintEnforcer.getSystemStatus();
    
    return {
      // CASCADE v3: Model performance table
      modelPerformanceTable: Object.fromEntries(
        Array.from(this.state.modelPerformanceTable.entries()).map(([id, data]) => [
          id,
          {
            overall: data.overall,
            task_types: Object.keys(data.task_type).length
          }
        ])
      ),
      
      // Adaptive routing
      routingHistory: this.state.routingHistory.length,
      modelRankings: Object.fromEntries(
        Array.from(this.state.modelRankings.entries()).map(([task, rankings]) => [
          task,
          rankings.map(r => ({ model: r.modelId, score: r.score }))
        ])
      ),
      
      // Action gate
      actionPermissions: Object.fromEntries(this.state.actionPermissions),
      actionExecutionLog: this.state.actionExecutionLog.length,
      
      // Feedback loop
      feedbackPackets: this.state.feedbackPackets.length,
      learningHistorySize: this.state.learningHistory.length,
      adaptationLogSize: this.state.adaptationLog.length,
      
      // Real drift tracking
      driftScores: Object.fromEntries(
        Array.from(this.state.driftScores.entries()).map(([task, scores]) => [
          task,
          {
            current_score: scores[scores.length - 1]?.score || 0,
            history_length: scores.length
          }
        ])
      ),
      driftTriggers: this.state.driftTriggers.length,
      
      // Revenue feedback loop
      revenueInfluence: Object.fromEntries(
        Array.from(this.state.revenueInfluence.entries()).map(([model, data]) => [
          model,
          {
            total_revenue: data.total_revenue,
            selection_boost: data.selection_boost,
            task_types: Object.keys(data.task_types).length
          }
        ])
      ),
      revenueAlignment: this.state.revenueAlignment,
      
      // System outputs
      systemOutputs: this.state.systemOutputs.length,
      
      // GLOBAL CONSTRAINT ENFORCER (The actual governance)
      globalConstraints: {
        stabilityScore: globalConstraintsStatus.stabilityMetrics.overallStabilityScore,
        explorationRate: globalConstraintsStatus.explorationState.currentRate,
        requiredExploration: globalConstraintsStatus.explorationState.requiredRate,
        volatilityScore: globalConstraintsStatus.stabilityMetrics.modelSelectionVariance,
        violations: globalConstraintsStatus.violations,
        longHorizonTracking: globalConstraintsStatus.longHorizonMetrics
      },
      
      config: this.config
    };
  }
  
  /**
   * Record task outcome for learning
   */
  async recordTaskOutcome(task, execution, outcome) {
    logger.info('Recording outcome for task', { taskId: task.id });
    
    // Record in Outcome Validator
    const outcomeRecord = await this.outcomeValidator.recordOutcome(task, execution, outcome);
    
    // Also record in our learning history
    this.state.learningHistory.push({
      actionId: task.id,
      actionType: task.type,
      success: outcome.success || false,
      confidence: task.confidence || 0.5,
      cost: execution.cost || 0,
      revenue: outcome.revenue || 0,
      timestamp: Date.now(),
      outcome: outcome
    });
    
    // Trigger adaptation if needed
    if (this.outcomeValidator.outcomeBuffer.length >= this.outcomeValidator.learningConfig.minSamples) {
      await this.outcomeValidator.adaptThresholds();
      
      // Update Reality Filter with new thresholds
      this.updateRealityFilterThresholds();
    }
    
    return outcomeRecord;
  }

  /**
   * Update Reality Filter with learned thresholds
   */
  updateRealityFilterThresholds() {
    const thresholds = this.outcomeValidator.getThresholds();
    
    // Update Reality Filter thresholds
    this.realityFilter.rules.leadSourceValidation.minConversionSignal = thresholds.leadSourceMinConversion;
    this.realityFilter.rules.outreachPersonalization.minScore = thresholds.outreachMinPersonalization;
    this.realityFilter.rules.productDemandValidation.minSignalCount = Math.ceil(thresholds.productMinDemandScore);
    this.realityFilter.rules.executionMargin.minMarginPercent = thresholds.executionMinMargin * 100;
    
    logger.info('Updated Reality Filter thresholds based on outcomes');
  }

  /**
   * Get adaptive system status
   */
  async getAdaptiveStatus() {
    const outcomeHealth = await this.outcomeValidator.getSystemHealth();
    const adaptationHistory = await this.outcomeValidator.getAdaptationHistory(7);
    const currentThresholds = this.outcomeValidator.getThresholds();
    
    return {
      health: outcomeHealth,
      thresholds: currentThresholds,
      recentAdaptations: adaptationHistory,
      nextAdaptation: new Date(this.outcomeValidator.lastAdaptation + this.outcomeValidator.adaptationInterval)
    };
  }

  getPerformanceReport() {
    const report = {
      totalActions: this.state.learningHistory.length,
      overallSuccessRate: 0,
      modelPerformance: {},
      actionTypePerformance: {},
      recentTrends: {
        lastHour: 0,
        lastDay: 0
      }
    };
    
    if (this.state.learningHistory.length > 0) {
      report.overallSuccessRate = this.state.learningHistory.filter(r => r.success).length / this.state.learningHistory.length;
    }
    
    // Model performance
    for (const [modelId, performance] of this.state.modelPerformance) {
      report.modelPerformance[modelId] = {
        successRate: performance.successRate,
        avgLatency: performance.avgLatency,
        avgCost: performance.avgCost,
        totalActions: performance.totalActions
      };
    }
    
    // Action type performance
    const actionGroups = this.groupBy(this.state.learningHistory, 'actionType');
    for (const [actionType, actions] of actionGroups) {
      const successRate = actions.filter(a => a.success).length / actions.length;
      report.actionTypePerformance[actionType] = {
        successRate,
        totalActions: actions.length,
        avgConfidence: actions.reduce((sum, a) => sum + a.confidence, 0) / actions.length
      };
    }
    
    // Recent trends
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;
    
    const recentHour = this.state.learningHistory.filter(r => r.timestamp > hourAgo);
    const recentDay = this.state.learningHistory.filter(r => r.timestamp > dayAgo);
    
    if (recentHour.length > 0) {
      report.recentTrends.lastHour = recentHour.filter(r => r.success).length / recentHour.length;
    }
    
    if (recentDay.length > 0) {
      report.recentTrends.lastDay = recentDay.filter(r => r.success).length / recentDay.length;
    }
    
    return report;
  }
  
  async reset() {
    // Reset control plane state
    this.state = {
      modelPerformance: new Map(),
      actionPermissions: new Map(),
      riskAssessments: new Map(),
      learningHistory: [],
      adaptationLog: []
    };
    
    // Reinitialize
    this.initializeModelTracking();
    this.initializeActionPermissions();
    
    logger.info('Reset completed');
  }
}

module.exports = HeidiControlPlane;
