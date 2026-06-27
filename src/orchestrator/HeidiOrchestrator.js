/**
 * HEIDI ORCHESTRATOR - Layer 2: The Brainstem
 * CASCADE v2 Evolution - Simple, ruthless, effective
 * 
 * Core responsibilities:
 * - Route tasks
 * - Decide model (local vs API)  
 * - Enforce rules (no drift, no nonsense)
 * - Trigger actions
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const LocalModelAdapter = require('../models/local-model-adapter');
const OllamaClient = require('../../heidi-core/brain/ollama-client');
const { supabase } = require('../database');

class HeidiOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      confidenceThreshold: config.confidenceThreshold || 0.7,
      costThreshold: config.costThreshold || 0.10, // $0.10 per request
      maxRetries: config.maxRetries || 2,
      timeoutMs: config.timeoutMs || 8000,
      revenuePriority: config.revenuePriority !== false, // Default to true
      ...config
    };
    
    // Initialize components
    this.localModels = new LocalModelAdapter();
    this.ollamaClient = new OllamaClient();
    
    // Task routing logic
    this.taskRouter = {
      // Revenue tasks get highest priority
      revenue: (task) => this.handleRevenueTask(task),
      
      // Critical system tasks  
      critical: (task) => this.handleCriticalTask(task),
      
      // Standard tasks
      standard: (task) => this.handleStandardTask(task),
      
      // Reflection and planning (local only)
      reflection: (task) => this.handleReflectionTask(task),
      
      // Code and technical tasks
      technical: (task) => this.handleTechnicalTask(task)
    };
    
    // Model selection strategy
    this.modelStrategy = {
      // Local first, always
      local: {
        reasoning: ['gpt-4-local', 'gpt-35-turbo'],
        general: ['local-llama', 'gpt-35-turbo'], 
        fast: ['local-classifier', 'rule-engine'],
        code: ['code-specialist', 'code-parser'],
        security: ['security-scanner', 'bug-finder'],
        database: ['db-specialist'],
        analytics: ['predictive-model', 'pricing-engine']
      },
      
      // External only when necessary
      external: {
        high_stakes: ['gpt-4', 'claude-3-opus'],
        complex_reasoning: ['gpt-4-turbo'],
        polish: ['gpt-4-turbo', 'claude-3-sonnet']
      }
    };
    
    // Performance tracking
    this.metrics = {
      tasksProcessed: 0,
      tasksSuccessful: 0,
      tasksFailed: 0,
      avgLatency: 0,
      totalCost: 0,
      modelUsage: {},
      revenueGenerated: 0
    };
    
    // Drift detection
    this.driftScore = 0;
    this.lastDriftCheck = Date.now();
    this.confidenceHistory = [];
    
    console.log('[ORCHESTRATOR] Heidi Orchestrator initialized');
    console.log('[ORCHESTRATOR] Revenue priority:', this.config.revenuePriority ? 'ENABLED' : 'DISABLED');
    console.log('[ORCHESTRATOR] Confidence threshold:', this.config.confidenceThreshold);
  }
  
  /**
   * MAIN ENTRY POINT - Process a task through the Heidi loop
   */
  async processTask(task) {
    const taskId = uuidv4();
    const startTime = Date.now();
    
    try {
      console.log(`[ORCHESTRATOR] Processing task ${taskId}: ${task.type}`);
      
      // Enrich task with metadata
      task = {
        id: taskId,
        timestamp: new Date().toISOString(),
        ...task,
        metadata: {
          priority: this.calculatePriority(task),
          estimatedCost: this.estimateCost(task),
          routing: this.determineRouting(task)
        }
      };
      
      // Execute the Heidi loop
      const result = await this.executeHeidiLoop(task);
      
      // Update metrics
      this.updateMetrics(result, Date.now() - startTime);
      
      // Emit completion
      this.emit('task_completed', { taskId, result, task });
      
      return result;
      
    } catch (error) {
      console.error(`[ORCHESTRATOR] Task ${taskId} failed:`, error.message);
      
      this.metrics.tasksFailed++;
      
      this.emit('task_failed', { taskId, error, task });
      
      throw error;
    }
  }
  
  /**
   * THE HEIDI LOOP - Observe→Evaluate→Decide→Act→Measure→Reflect→Adapt
   */
  async executeHeidiLoop(task) {
    const loopId = `loop_${Date.now()}`;
    
    console.log(`[HEIDI LOOP] Starting loop ${loopId} for task ${task.id}`);
    
    // 1. OBSERVE - Capture current state
    const observation = await this.observe(task);
    
    // 2. EVALUATE - Assess situation and options
    const evaluation = await this.evaluate(task, observation);
    
    // 3. DECIDE - Choose action and model
    const decision = await this.decide(task, observation, evaluation);
    
    // 4. ACT - Execute the decision
    const action = await this.act(task, decision);
    
    // 5. MEASURE - Quantify results
    const measurement = await this.measure(task, action);
    
    // 6. REFLECT - Analyze performance
    const reflection = await this.reflect(task, observation, decision, measurement);
    
    // 7. ADAPT - Update strategy based on reflection
    const adaptation = await this.adapt(task, reflection);
    
    const result = {
      loopId,
      task: task.id,
      observation,
      evaluation,
      decision,
      action,
      measurement,
      reflection,
      adaptation,
      timestamp: new Date().toISOString()
    };
    
    console.log(`[HEIDI LOOP] Completed loop ${loopId} in ${Date.now() - parseInt(loopId.split('_')[1])}ms`);
    
    return result;
  }
  
  /**
   * 1. OBSERVE - Capture current state and context
   */
  async observe(task) {
    return {
      systemState: {
        modelHealth: this.localModels.getModelStatus(),
        currentLoad: this.getCurrentLoad(),
        recentFailures: this.getRecentFailures()
      },
      taskContext: {
        type: task.type,
        priority: task.metadata.priority,
        complexity: this.assessComplexity(task),
        revenueImpact: this.assessRevenueImpact(task)
      },
      environmental: {
        timestamp: new Date().toISOString(),
        resourceAvailability: this.getResourceAvailability()
      }
    };
  }
  
  /**
   * 2. EVALUATE - Assess situation and confidence
   */
  async evaluate(task, observation) {
    const confidence = this.calculateConfidence(task, observation);
    const risk = this.calculateRisk(task, observation);
    const cost = task.metadata.estimatedCost;
    
    // Store confidence for drift detection
    this.confidenceHistory.push({
      timestamp: Date.now(),
      taskId: task.id,
      confidence,
      expected: confidence > this.config.confidenceThreshold
    });
    
    return {
      confidence,
      risk,
      cost,
      recommendation: this.generateRecommendation(confidence, risk, cost),
      shouldProceed: confidence >= this.config.confidenceThreshold && cost <= this.config.costThreshold
    };
  }
  
  /**
   * 3. DECIDE - Choose model and approach
   */
  async decide(task, observation, evaluation) {
    if (!evaluation.shouldProceed) {
      return {
        action: 'reject',
        reason: evaluation.confidence < this.config.confidenceThreshold ? 'low_confidence' : 'high_cost',
        model: null,
        strategy: 'none'
      };
    }
    
    // Route task based on type and priority
    const router = this.taskRouter[task.metadata.routing] || this.taskRouter.standard;
    
    const decision = await router.call(this, task);
    
    return {
      action: 'proceed',
      model: decision.model,
      strategy: decision.strategy,
      reasoning: decision.reasoning,
      fallback: decision.fallback
    };
  }
  
  /**
   * 4. ACT - Execute the decision
   */
  async act(task, decision) {
    if (decision.action === 'reject') {
      return {
        status: 'rejected',
        reason: decision.reason,
        result: null
      };
    }
    
    const startTime = Date.now();
    
    try {
      let result;
      
      // Execute based on strategy
      if (decision.strategy === 'local') {
        result = await this.executeLocalModel(decision.model, task);
      } else if (decision.strategy === 'external') {
        result = await this.executeExternalModel(decision.model, task);
      } else if (decision.strategy === 'hybrid') {
        result = await this.executeHybridModel(decision.model, task);
      } else {
        throw new Error(`Unknown strategy: ${decision.strategy}`);
      }
      
      return {
        status: 'completed',
        result,
        model: decision.model,
        strategy: decision.strategy,
        latency: Date.now() - startTime,
        success: true
      };
      
    } catch (error) {
      // Try fallback if available
      if (decision.fallback) {
        console.log(`[ORCHESTRATOR] Primary model failed, trying fallback: ${decision.fallback}`);
        
        try {
          const fallbackResult = await this.executeLocalModel(decision.fallback, task);
          
          return {
            status: 'completed_with_fallback',
            result: fallbackResult,
            model: decision.fallback,
            strategy: 'local_fallback',
            latency: Date.now() - startTime,
            success: true,
            originalError: error.message
          };
        } catch (fallbackError) {
          console.error(`[ORCHESTRATOR] Fallback also failed:`, fallbackError.message);
        }
      }
      
      return {
        status: 'failed',
        error: error.message,
        model: decision.model,
        strategy: decision.strategy,
        latency: Date.now() - startTime,
        success: false
      };
    }
  }
  
  /**
   * 5. MEASURE - Quantify results and impact
   */
  async measure(task, action) {
    const measurement = {
      taskSuccess: action.success,
      latency: action.latency,
      cost: this.calculateActualCost(task, action),
      quality: this.assessOutputQuality(action.result),
      userSatisfaction: this.predictUserSatisfaction(task, action.result)
    };
    
    // Revenue-specific metrics
    if (task.type === 'revenue') {
      measurement.revenueImpact = this.calculateRevenueImpact(task, action.result);
      measurement.conversionProbability = this.estimateConversionProbability(action.result);
    }
    
    return measurement;
  }
  
  /**
   * 6. REFLECT - Analyze performance and patterns
   */
  async reflect(task, observation, decision, measurement) {
    const reflection = {
      whatWorked: measurement.taskSuccess ? [decision.strategy, decision.model] : [],
      whatFailed: measurement.taskSuccess ? [] : [decision.strategy, decision.model],
      confidenceVsReality: this.compareConfidenceVsReality(task, measurement),
      patternForming: this.detectPatterns(task, measurement),
      shouldChange: this.shouldChangeStrategy(measurement)
    };
    
    // Update drift score
    this.updateDriftScore(reflection.confidenceVsReality);
    
    return reflection;
  }
  
  /**
   * 7. ADAPT - Update strategy based on reflection
   */
  async adapt(task, reflection) {
    const adaptations = [];
    
    if (reflection.shouldChange.model) {
      adaptations.push({
        type: 'model_preference',
        change: `Reduce preference for ${task.model}`,
        reason: 'Poor performance on this task type'
      });
    }
    
    if (reflection.shouldChange.strategy) {
      adaptations.push({
        type: 'strategy_adjustment',
        change: 'Adjust confidence threshold',
        reason: 'Systematic over/under confidence detected'
      });
    }
    
    if (reflection.shouldChange.routing) {
      adaptations.push({
        type: 'routing_update',
        change: 'Update task routing logic',
        reason: 'Pattern detected in task failures'
      });
    }
    
    // Apply adaptations
    for (const adaptation of adaptations) {
      this.applyAdaptation(adaptation);
    }
    
    return {
      adaptations,
      adapted: adaptations.length > 0,
      newDriftScore: this.driftScore
    };
  }
  
  /**
   * TASK HANDLERS - Specialized routing logic
   */
  async handleRevenueTask(task) {
    console.log('[ORCHESTRATOR] Revenue task - highest priority');
    
    return {
      model: 'gpt-4-local', // Best local model for revenue
      strategy: 'local',
      fallback: 'gpt-35-turbo',
      reasoning: 'Revenue tasks get best local model with fallback'
    };
  }
  
  async handleCriticalTask(task) {
    console.log('[ORCHESTRATOR] Critical task - high reliability');
    
    return {
      model: 'gpt-4-local',
      strategy: 'hybrid', // Try local, verify with external if needed
      fallback: 'local-llama',
      reasoning: 'Critical tasks use hybrid strategy for maximum reliability'
    };
  }
  
  async handleStandardTask(task) {
    console.log('[ORCHESTRATOR] Standard task - cost effective');
    
    return {
      model: 'gpt-35-turbo',
      strategy: 'local',
      fallback: 'local-llama',
      reasoning: 'Standard tasks use cost-effective local models'
    };
  }
  
  async handleReflectionTask(task) {
    console.log('[ORCHESTRATOR] Reflection task - local only');
    
    return {
      model: 'local-llama',
      strategy: 'local',
      fallback: null,
      reasoning: 'Reflection tasks stay local for privacy and speed'
    };
  }
  
  async handleTechnicalTask(task) {
    console.log('[ORCHESTRATOR] Technical task - specialist models');
    
    return {
      model: 'code-specialist',
      strategy: 'local',
      fallback: 'gpt-4-local',
      reasoning: 'Technical tasks use specialist models with general fallback'
    };
  }
  
  /**
   * MODEL EXECUTION - Local and external model execution
   */
  async executeLocalModel(modelId, task) {
    try {
      const input = this.prepareModelInput(task);
      const result = await this.localModels.execute(modelId, input, {
        tier: task.tier || 'pro',
        timeout: this.config.timeoutMs
      });
      
      // Track model usage
      this.metrics.modelUsage[modelId] = (this.metrics.modelUsage[modelId] || 0) + 1;
      
      return result;
      
    } catch (error) {
      console.error(`[ORCHESTRATOR] Local model ${modelId} failed:`, error.message);
      throw error;
    }
  }
  
  async executeExternalModel(modelId, task) {
    // TODO: Implement external model execution (OpenAI, Claude, etc.)
    // For now, fallback to local
    console.log(`[ORCHESTRATOR] External model ${modelId} not implemented, falling back to local`);
    return this.executeLocalModel('gpt-4-local', task);
  }
  
  async executeHybridModel(modelId, task) {
    // Execute local first, then validate/enhance with external if needed
    const localResult = await this.executeLocalModel(modelId, task);
    
    // If confidence is low, try external enhancement
    if (localResult.confidence < 0.8) {
      console.log('[ORCHESTRATOR] Low confidence from local model, enhancing with external');
      // TODO: Implement external enhancement
    }
    
    return localResult;
  }
  
  /**
   * UTILITY METHODS
   */
  calculatePriority(task) {
    if (this.config.revenuePriority && task.type === 'revenue') return 'critical';
    if (task.type === 'critical') return 'critical';
    if (task.type === 'reflection') return 'low';
    return 'normal';
  }
  
  estimateCost(task) {
    // Simple cost estimation based on task complexity
    const baseCost = 0.01; // $0.01 base
    const complexityMultiplier = this.assessComplexity(task);
    return baseCost * complexityMultiplier;
  }
  
  assessComplexity(task) {
    if (!task.input) return 1;
    
    const textLength = typeof task.input === 'string' ? task.input.length : JSON.stringify(task.input).length;
    
    if (textLength > 5000) return 3;
    if (textLength > 1000) return 2;
    return 1;
  }
  
  assessRevenueImpact(task) {
    if (task.type === 'revenue') return 'high';
    if (task.type === 'marketing') return 'medium';
    return 'low';
  }
  
  determineRouting(task) {
    const routing = {
      'revenue': 'revenue',
      'payment': 'revenue',
      'critical': 'critical',
      'security': 'critical',
      'reflection': 'reflection',
      'planning': 'reflection',
      'code': 'technical',
      'database': 'technical',
      'debug': 'technical'
    };
    
    return routing[task.type] || 'standard';
  }
  
  calculateConfidence(task, observation) {
    // Base confidence on model health and task complexity
    let confidence = 0.8; // Start at 80%
    
    // Adjust based on system state
    if (observation.systemState.currentLoad > 0.8) confidence -= 0.1;
    if (observation.systemState.recentFailures > 3) confidence -= 0.2;
    
    // Adjust based on task complexity
    if (observation.taskContext.complexity > 2) confidence -= 0.1;
    
    return Math.max(0.1, Math.min(0.99, confidence));
  }
  
  calculateRisk(task, observation) {
    let risk = 0.1; // Base 10% risk
    
    if (task.type === 'revenue') risk += 0.1;
    if (task.type === 'critical') risk += 0.2;
    if (observation.systemState.currentLoad > 0.9) risk += 0.2;
    
    return Math.max(0.0, Math.min(1.0, risk));
  }
  
  generateRecommendation(confidence, risk, cost) {
    if (confidence < this.config.confidenceThreshold) {
      return 'reject_low_confidence';
    }
    if (cost > this.config.costThreshold) {
      return 'reject_high_cost';
    }
    if (risk > 0.5) {
      return 'proceed_with_caution';
    }
    return 'proceed';
  }
  
  prepareModelInput(task) {
    return {
      task: task.type,
      instruction: task.instruction || task.input,
      context: task.context || {},
      options: task.options || {}
    };
  }
  
  updateMetrics(result, latency) {
    this.metrics.tasksProcessed++;
    
    if (result.action.success) {
      this.metrics.tasksSuccessful++;
      this.metrics.totalCost += result.measurement.cost;
      
      if (result.task.type === 'revenue' && result.measurement.revenueImpact > 0) {
        this.metrics.revenueGenerated += result.measurement.revenueImpact;
      }
    } else {
      this.metrics.tasksFailed++;
    }
    
    // Update average latency
    this.metrics.avgLatency = (this.metrics.avgLatency * (this.metrics.tasksProcessed - 1) + latency) / this.metrics.tasksProcessed;
  }
  
  updateDriftScore(confidenceVsReality) {
    if (confidenceVsReality.accuracy < 0.7) {
      this.driftScore += 0.1;
    } else {
      this.driftScore = Math.max(0, this.driftScore - 0.05);
    }
    
    this.lastDriftCheck = Date.now();
  }
  
  /**
   * STATUS AND MONITORING
   */
  getStatus() {
    return {
      metrics: { ...this.metrics },
      drift: {
        score: this.driftScore,
        lastCheck: new Date(this.lastDriftCheck).toISOString(),
        status: this.driftScore > 0.3 ? 'high' : this.driftScore > 0.1 ? 'medium' : 'low'
      },
      models: this.localModels.getModelStatus(),
      config: this.config
    };
  }
  
  async reset() {
    this.metrics = {
      tasksProcessed: 0,
      tasksSuccessful: 0,
      tasksFailed: 0,
      avgLatency: 0,
      totalCost: 0,
      modelUsage: {},
      revenueGenerated: 0
    };
    
    this.driftScore = 0;
    this.confidenceHistory = [];

    console.log('[ORCHESTRATOR] Reset completed');
  }

  // ── Telemetry / scoring helpers ────────────────────────────────────────────
  // Neutral, type-correct defaults so the autonomous loop runs without crashing.
  // Replace with real logic (analytics, cost model, satisfaction prediction) later.
  getCurrentLoad() {
    return 0.3;
  }

  getRecentFailures() {
    return [];
  }

  getResourceAvailability() {
    return { cpu: 1, memory: 1, models: 1 };
  }

  calculateActualCost(task, action) {
    return action?.cost || 0;
  }

  assessOutputQuality(result) {
    return result ? 0.7 : 0;
  }

  predictUserSatisfaction(task, result) {
    return result ? 0.7 : 0;
  }

  calculateRevenueImpact(task, result) {
    return 0;
  }

  estimateConversionProbability(result) {
    return 0;
  }

  compareConfidenceVsReality(task, measurement) {
    return 0;
  }

  detectPatterns(task, measurement) {
    return [];
  }

  shouldChangeStrategy(measurement) {
    return false;
  }

  applyAdaptation(adaptation) {
    // no-op until adaptation execution is implemented
    return adaptation;
  }
}

module.exports = HeidiOrchestrator;
