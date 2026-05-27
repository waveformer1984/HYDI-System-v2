/**
 * HEIDI CORE LOOP - The Continuous Cycle
 * This runs constantly: Observe→Evaluate→Decide→Act→Measure→Reflect→Adapt
 * 
 * 🔥 Example Loop (Revenue Mode):
 * Observe: No sales in last 24h
 * Evaluate: Traffic exists but no conversions  
 * Decide: Landing page weak
 * Act: Generate new version (local draft → API polish), Deploy variant
 * Measure: Conversion rate
 * Reflect: Compare expected vs actual
 * Adapt: Keep / kill / iterate
 */

const EventEmitter = require('events');
const HeidiOrchestrator = require('../orchestrator/HeidiOrchestrator');
const HybridModelStack = require('../models/HybridModelStack');
const HeidiMemorySystem = require('../memory/HeidiMemorySystem');
const HeidiActionLayer = require('../actions/HeidiActionLayer');
const selfHealing = require('../healing/SelfHealingService');
const redisStream = require('../queue/RedisStreamBroker');

class HeidiCoreLoop extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Loop timing
      loopInterval: config.loopInterval || 60000, // 1 minute default
      observationInterval: config.observationInterval || 300000, // 5 minutes
      reflectionInterval: config.reflectionInterval || 900000, // 15 minutes
      
      // Loop controls
      enableAutoActions: config.enableAutoActions !== false,
      maxConcurrentLoops: config.maxConcurrentLoops || 5,
      enableRevenueMode: config.enableRevenueMode !== false,
      
      // Thresholds
      actionConfidenceThreshold: config.actionConfidenceThreshold || 0.7,
      adaptationThreshold: config.adaptationThreshold || 0.3,
      
      ...config
    };
    
    // Initialize all layers
    this.orchestrator = new HeidiOrchestrator({
      confidenceThreshold: this.config.actionConfidenceThreshold,
      revenuePriority: this.config.enableRevenueMode
    });
    
    this.modelStack = new HybridModelStack({
      localFirst: true,
      enableFailover: true
    });
    
    this.memorySystem = new HeidiMemorySystem({
      reflectionInterval: this.config.reflectionInterval
    });
    
    this.actionLayer = new HeidiActionLayer({
      enableRevenueActions: this.config.enableRevenueMode,
      enableScriptExecution: true
    });
    
    // Loop state
    this.isRunning = false;
    this.activeLoops = new Map();
    this.loopHistory = [];
    this.lastObservation = 0;
    this.lastReflection = 0;
    
    // Performance metrics
    this.metrics = {
      loopsCompleted: 0,
      loopsFailed: 0,
      avgLoopTime: 0,
      observations: 0,
      actions: 0,
      adaptations: 0,
      revenueGenerated: 0
    };
    
    // Wire up event listeners
    this.setupEventListeners();
    
    console.log('[CORE LOOP] Heidi Core Loop initialized');
    console.log(`[CORE LOOP] Loop interval: ${this.config.loopInterval}ms`);
    console.log(`[CORE LOOP] Revenue mode: ${this.config.enableRevenueMode ? 'ENABLED' : 'DISABLED'}`);
  }
  
  setupEventListeners() {
    // Listen to orchestrator events
    this.orchestrator.on('task_completed', (event) => {
      this.handleTaskCompleted(event);
    });
    
    this.orchestrator.on('task_failed', (event) => {
      this.handleTaskFailed(event);
    });
    
    // Listen to memory system events
    this.memorySystem.on('reflection_completed', (reflection) => {
      this.handleReflectionCompleted(reflection);
    });
    
    this.memorySystem.on('drift_updated', (drift) => {
      this.handleDriftUpdated(drift);
    });
    
    // Listen to action layer events
    this.actionLayer.on('action_completed', (event) => {
      this.handleActionCompleted(event);
    });
    
    this.actionLayer.on('revenue_tracked', (revenue) => {
      this.handleRevenueTracked(revenue);
    });
    
    // Listen to model stack events
    this.modelStack.on('inference_completed', (event) => {
      this.handleInferenceCompleted(event);
    });
  }
  
  /**
   * START THE CORE LOOP
   */
  async start() {
    if (this.isRunning) {
      console.log('[CORE LOOP] Already running');
      return;
    }
    
    console.log('[CORE LOOP] Starting Heidi Core Loop...');
    this.isRunning = true;
    
    // Start the main loop
    this.startMainLoop();
    
    // Start observation cycle
    this.startObservationCycle();
    
    // Start reflection cycle
    this.startReflectionCycle();
    
    // Emit start event
    this.emit('loop_started', { timestamp: Date.now() });
    
    console.log('[CORE LOOP] Heidi Core Loop started');
  }
  
  /**
   * STOP THE CORE LOOP
   */
  async stop() {
    if (!this.isRunning) {
      console.log('[CORE LOOP] Not running');
      return;
    }
    
    console.log('[CORE LOOP] Stopping Heidi Core Loop...');
    this.isRunning = false;
    
    // Wait for active loops to complete
    while (this.activeLoops.size > 0) {
      console.log(`[CORE LOOP] Waiting for ${this.activeLoops.size} active loops to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Emit stop event
    this.emit('loop_stopped', { timestamp: Date.now() });
    
    console.log('[CORE LOOP] Heidi Core Loop stopped');
  }
  
  /**
   * MAIN LOOP - Continuous execution
   */
  startMainLoop() {
    const mainLoop = async () => {
      if (!this.isRunning) return;
      
      try {
        // Check concurrent loop limit
        if (this.activeLoops.size >= this.config.maxConcurrentLoops) {
          console.log(`[CORE LOOP] Max concurrent loops reached (${this.activeLoops.size})`);
          setTimeout(mainLoop, this.config.loopInterval);
          return;
        }
        
        // Generate a loop task or process existing tasks
        const task = await this.generateLoopTask();
        
        if (task) {
          // Execute the loop
          await this.executeLoop(task);
        }
        
      } catch (error) {
        console.error('[CORE LOOP] Main loop error:', error.message);
        this.metrics.loopsFailed++;
      }
      
      // Schedule next iteration
      setTimeout(mainLoop, this.config.loopInterval);
    };
    
    // Start the loop
    mainLoop();
  }
  
  /**
   * OBSERVATION CYCLE - Monitor system state
   */
  startObservationCycle() {
    const observationCycle = async () => {
      if (!this.isRunning) return;
      
      try {
        console.log('[CORE LOOP] Running observation cycle...');
        
        const observation = await this.observe();
        
        // Store observation in memory
        this.memorySystem.storeContext(`observation_${Date.now()}`, observation);
        
        // Check if immediate action is needed
        const urgentTasks = await this.identifyUrgentTasks(observation);
        
        for (const task of urgentTasks) {
          console.log(`[CORE LOOP] Urgent task identified: ${task.type}`);
          await this.executeLoop(task);
        }
        
        this.metrics.observations++;
        this.lastObservation = Date.now();
        
      } catch (error) {
        console.error('[CORE LOOP] Observation cycle error:', error.message);
      }
      
      // Schedule next observation
      setTimeout(observationCycle, this.config.observationInterval);
    };
    
    // Start observation cycle
    observationCycle();
  }
  
  /**
   * REFLECTION CYCLE - Deep analysis and adaptation
   */
  startReflectionCycle() {
    const reflectionCycle = async () => {
      if (!this.isRunning) return;
      
      try {
        console.log('[CORE LOOP] Running reflection cycle...');
        
        const reflection = await this.memorySystem.runReflection();
        
        // Apply adaptations if needed
        if (reflection.recommendations.length > 0) {
          await this.applyAdaptations(reflection.recommendations);
        }
        
        this.lastReflection = Date.now();
        
      } catch (error) {
        console.error('[CORE LOOP] Reflection cycle error:', error.message);
      }
      
      // Schedule next reflection
      setTimeout(reflectionCycle, this.config.reflectionInterval);
    };
    
    // Start reflection cycle
    reflectionCycle();
  }
  
  /**
   * EXECUTE A FULL LOOP CYCLE
   */
  async executeLoop(task) {
    const loopId = `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    try {
      console.log(`[CORE LOOP] Executing loop ${loopId}: ${task.type}`);
      
      // Track active loop
      this.activeLoops.set(loopId, {
        task,
        startTime,
        status: 'running'
      });
      
      // Execute the full Heidi loop
      const result = await this.executeHeidiLoop(task, loopId);
      
      // Update metrics
      const loopTime = Date.now() - startTime;
      this.updateMetrics(result, loopTime);
      
      // Store in history
      this.loopHistory.push({
        id: loopId,
        task,
        result,
        duration: loopTime,
        timestamp: new Date().toISOString()
      });
      
      // Keep history manageable
      if (this.loopHistory.length > 1000) {
        this.loopHistory = this.loopHistory.slice(-500);
      }
      
      // Emit completion
      this.emit('loop_completed', {
        loopId,
        task,
        result,
        duration: loopTime
      });
      
      console.log(`[CORE LOOP] Loop completed: ${loopId} (${loopTime}ms)`);
      
      return result;
      
    } catch (error) {
      console.error(`[CORE LOOP] Loop failed: ${loopId} - ${error.message}`);
      
      this.metrics.loopsFailed++;
      
      // Store failure in memory
      this.memorySystem.storeWhatFailed(loopId, task, error.message, {
        type: task.type,
        priority: task.priority || 'normal'
      });
      
      // Publish failure to Redis stream for downstream consumers
      redisStream.publish('hydi:task-failures', {
        loopId, task, error: error.message, timestamp: new Date().toISOString(),
      }).catch(() => {});
      
      // Self-healing: ask Claude for a corrective retry task
      selfHealing.healFromCrash(task, error.message, loopId).then(heal => {
        if (heal?.should_retry && heal.corrected_task) {
          console.log(`[SELF-HEAL] Scheduling corrective retry for ${loopId}`);
          setTimeout(() => this.executeLoop(heal.corrected_task).catch(() => {}), 5000);
        }
      }).catch(() => {});
      
      // Emit failure
      this.emit('loop_failed', {
        loopId,
        task,
        error: error.message
      });
      
      throw error;
      
    } finally {
      // Clean up active loop
      this.activeLoops.delete(loopId);
    }
  }
  
  /**
   * THE HEIDI LOOP IMPLEMENTATION
   */
  async executeHeidiLoop(task, loopId) {
    console.log(`[HEIDI LOOP] Starting ${task.type} loop: ${loopId}`);
    
    // 1. OBSERVE - Capture current state
    const observation = await this.observeForTask(task, loopId);
    
    // 2. EVALUATE - Assess situation and options
    const evaluation = await this.evaluateTask(task, observation, loopId);
    
    // 3. DECIDE - Choose action and approach
    const decision = await this.makeDecision(task, observation, evaluation, loopId);
    
    // 4. ACT - Execute the decision
    const action = await this.takeAction(task, decision, loopId);
    
    // 5. MEASURE - Quantify results
    const measurement = await this.measureResults(task, action, loopId);
    
    // 6. REFLECT - Analyze performance
    const reflection = await this.reflectOnLoop(task, observation, decision, measurement, loopId);
    
    // 7. ADAPT - Update strategy based on reflection
    const adaptation = await this.adaptStrategy(task, reflection, loopId);
    
    const result = {
      loopId,
      task: task.type,
      observation,
      evaluation,
      decision,
      action,
      measurement,
      reflection,
      adaptation,
      timestamp: new Date().toISOString()
    };
    
    // Store loop result in memory
    this.memorySystem.storeSession(loopId, result, 'loops');
    
    console.log(`[HEIDI LOOP] Completed ${task.type} loop: ${loopId}`);
    
    return result;
  }
  
  /**
   * LOOP STEP IMPLEMENTATIONS
   */
  
  // 1. OBSERVE
  async observe() {
    const observation = {
      timestamp: Date.now(),
      system: {
        cpu: this.getCPUUsage(),
        memory: this.getMemoryUsage(),
        activeLoops: this.activeLoops.size,
        modelHealth: this.modelStack.getStatus(),
        actionLayer: this.actionLayer.getStatus()
      },
      business: {
        recentRevenue: await this.getRecentRevenue(),
        activeUsers: await this.getActiveUsers(),
        conversionRate: await this.getConversionRate(),
        systemLoad: this.getSystemLoad()
      },
      environment: {
        timeOfDay: new Date().getHours(),
        dayOfWeek: new Date().getDay(),
        recentErrors: this.getRecentErrors(),
        externalFactors: await this.getExternalFactors()
      }
    };
    
    return observation;
  }
  
  async observeForTask(task, loopId) {
    const generalObservation = await this.observe();
    
    // Add task-specific observations
    const taskSpecific = {
      taskType: task.type,
      taskPriority: task.priority || 'normal',
      taskContext: task.context || {},
      relevantHistory: await this.getRelevantHistory(task),
      availableResources: await this.getAvailableResources(task)
    };
    
    return {
      ...generalObservation,
      taskSpecific
    };
  }
  
  // 2. EVALUATE
  async evaluateTask(task, observation, loopId) {
    const evaluation = {
      confidence: this.calculateTaskConfidence(task, observation),
      risk: this.calculateTaskRisk(task, observation),
      opportunity: this.identifyOpportunity(task, observation),
      urgency: this.assessUrgency(task, observation),
      feasibility: this.assessFeasibility(task, observation),
      recommendation: this.generateRecommendation(task, observation),
      shouldProceed: false
    };
    
    // Determine if should proceed
    evaluation.shouldProceed = 
      evaluation.confidence >= this.config.actionConfidenceThreshold &&
      evaluation.risk < 0.8 &&
      evaluation.feasibility > 0.6;
    
    return evaluation;
  }
  
  // 3. DECIDE
  async makeDecision(task, observation, evaluation, loopId) {
    if (!evaluation.shouldProceed) {
      return {
        action: 'reject',
        reason: evaluation.confidence < this.config.actionConfidenceThreshold ? 'low_confidence' : 'high_risk',
        strategy: 'none',
        confidence: evaluation.confidence
      };
    }
    
    // Use orchestrator to make decision
    const orchestratorDecision = await this.orchestrator.processTask({
      ...task,
      observation,
      evaluation,
      loopId
    });
    
    return {
      action: 'proceed',
      strategy: orchestratorDecision.decision?.strategy || 'local',
      model: orchestratorDecision.decision?.model,
      reasoning: orchestratorDecision.decision?.reasoning,
      confidence: evaluation.confidence,
      fallback: orchestratorDecision.decision?.fallback
    };
  }
  
  // 4. ACT
  async takeAction(task, decision, loopId) {
    if (decision.action === 'reject') {
      return {
        status: 'rejected',
        reason: decision.reason,
        result: null
      };
    }
    
    try {
      let result;
      
      // Execute based on task type and decision
      if (task.type === 'revenue' || task.type === 'payment') {
        result = await this.executeRevenueAction(task, decision, loopId);
      } else if (task.type === 'communication') {
        result = await this.executeCommunicationAction(task, decision, loopId);
      } else if (task.type === 'analysis') {
        result = await this.executeAnalysisAction(task, decision, loopId);
      } else if (task.type === 'optimization') {
        result = await this.executeOptimizationAction(task, decision, loopId);
      } else {
        result = await this.executeGeneralAction(task, decision, loopId);
      }
      
      this.metrics.actions++;
      
      return {
        status: 'completed',
        result,
        strategy: decision.strategy,
        model: decision.model,
        success: true
      };
      
    } catch (error) {
      console.error(`[CORE LOOP] Action failed for ${loopId}:`, error.message);
      
      return {
        status: 'failed',
        error: error.message,
        strategy: decision.strategy,
        success: false
      };
    }
  }
  
  // 5. MEASURE
  async measureResults(task, action, loopId) {
    const measurement = {
      success: action.success,
      latency: action.latency || 0,
      quality: this.assessActionQuality(action),
      impact: await this.assessActionImpact(task, action),
      userSatisfaction: this.predictUserSatisfaction(task, action),
      businessValue: this.calculateBusinessValue(task, action)
    };
    
    // Revenue-specific measurements
    if (task.type === 'revenue') {
      measurement.revenueGenerated = action.result?.revenue || 0;
      measurement.conversionRate = await this.measureConversionImpact(action);
    }
    
    return measurement;
  }
  
  // 6. REFLECT
  async reflectOnLoop(task, observation, decision, measurement, loopId) {
    const reflection = {
      whatWorked: measurement.success ? [decision.strategy, decision.model] : [],
      whatFailed: measurement.success ? [] : [decision.strategy, decision.model],
      confidenceVsReality: this.compareConfidenceVsReality(decision.confidence, measurement),
      patternsDetected: this.detectPatterns(task, observation, measurement),
      lessonsLearned: this.extractLessons(task, observation, decision, measurement),
      shouldRepeat: this.shouldRepeatStrategy(task, measurement),
      shouldAvoid: this.shouldAvoidStrategy(task, measurement)
    };
    
    // Store in reflective memory
    if (measurement.success) {
      this.memorySystem.storeWhatWorked(loopId, decision, measurement);
    } else {
      this.memorySystem.storeWhatFailed(loopId, decision, measurement.error || 'Unknown error', {
        type: task.type,
        confidence: decision.confidence
      });
    }
    
    // Track confidence vs reality
    this.memorySystem.trackConfidenceVsReality(loopId, decision.confidence, measurement);
    
    return reflection;
  }
  
  // 7. ADAPT
  async adaptStrategy(task, reflection, loopId) {
    const adaptations = [];
    
    // Generate adaptations based on reflection
    if (reflection.shouldAvoid.length > 0) {
      adaptations.push({
        type: 'strategy_avoidance',
        target: reflection.shouldAvoid[0],
        reason: 'Poor performance detected',
        priority: 'high'
      });
    }
    
    if (reflection.shouldRepeat && reflection.shouldRepeat.length > 0) {
      adaptations.push({
        type: 'strategy_preference',
        target: reflection.shouldRepeat[0],
        reason: 'Good performance detected',
        priority: 'medium'
      });
    }
    
    if (reflection.confidenceVsReality.accuracy < 0.7) {
      adaptations.push({
        type: 'confidence_calibration',
        adjustment: 'lower_threshold',
        reason: 'Overconfidence detected',
        priority: 'high'
      });
    }
    
    // Apply adaptations
    for (const adaptation of adaptations) {
      await this.applyAdaptation(adaptation);
      this.memorySystem.storeAdaptation(adaptation);
    }
    
    this.metrics.adaptations += adaptations.length;
    
    return {
      adaptations,
      adapted: adaptations.length > 0,
      newDriftScore: this.memorySystem.reflectiveMemory.driftScore
    };
  }
  
  /**
   * ACTION EXECUTION METHODS
   */
  
  async executeRevenueAction(task, decision, loopId) {
    if (!this.config.enableAutoActions) {
      throw new Error('Auto actions are disabled');
    }
    
    switch (task.subtype) {
      case 'generate_offer':
        return await this.actionLayer.executeAction('generate_offer', task.params, { loopId });
      case 'create_checkout':
        return await this.actionLayer.executeAction('create_checkout', task.params, { loopId });
      case 'send_payment':
        return await this.actionLayer.executeAction('stripe_payment', task.params, { loopId });
      default:
        throw new Error(`Unknown revenue action: ${task.subtype}`);
    }
  }
  
  async executeCommunicationAction(task, decision, loopId) {
    switch (task.subtype) {
      case 'send_email':
        return await this.actionLayer.executeAction('send_email', task.params, { loopId });
      case 'send_webhook':
        return await this.actionLayer.executeAction('send_webhook', task.params, { loopId });
      default:
        throw new Error(`Unknown communication action: ${task.subtype}`);
    }
  }
  
  async executeAnalysisAction(task, decision, loopId) {
    // Use model stack for analysis
    const result = await this.modelStack.execute(task, {
      strategy: decision.strategy,
      forceModel: decision.model
    });
    
    return { result };
  }
  
  async executeOptimizationAction(task, decision, loopId) {
    // Combine analysis and action for optimization
    const analysis = await this.modelStack.execute(task, {
      strategy: decision.strategy,
      forceModel: decision.model
    });
    
    // If optimization suggests actions, execute them
    if (analysis.result?.actions && this.config.enableAutoActions) {
      for (const action of analysis.result.actions) {
        await this.actionLayer.executeAction(action.type, action.params, { loopId });
      }
    }
    
    return { result: analysis };
  }
  
  async executeGeneralAction(task, decision, loopId) {
    // Use model stack for general tasks
    return await this.modelStack.execute(task, {
      strategy: decision.strategy,
      forceModel: decision.model
    });
  }
  
  /**
   * UTILITY METHODS
   */
  
  async generateLoopTask() {
    // Check for pending tasks in memory
    const pendingTasks = await this.getPendingTasks();
    
    if (pendingTasks.length > 0) {
      return pendingTasks[0];
    }
    
    // Generate observation-based tasks
    if (Date.now() - this.lastObservation > this.config.observationInterval) {
      return {
        type: 'observation',
        priority: 'low',
        context: { automated: true }
      };
    }
    
    // Generate revenue tasks if enabled
    if (this.config.enableRevenueMode) {
      const revenueTask = await this.generateRevenueTask();
      if (revenueTask) return revenueTask;
    }
    
    return null;
  }
  
  async identifyUrgentTasks(observation) {
    const urgent = [];
    
    // Check for critical system issues
    if (observation.system.cpu > 0.9 || observation.system.memory > 0.9) {
      urgent.push({
        type: 'optimization',
        subtype: 'system_health',
        priority: 'critical',
        context: { observation }
      });
    }
    
    // Check for revenue issues
    if (this.config.enableRevenueMode && observation.business.recentRevenue < 0.1) {
      urgent.push({
        type: 'revenue',
        subtype: 'generate_offer',
        priority: 'high',
        context: { observation }
      });
    }
    
    return urgent;
  }
  
  async applyAdaptations(recommendations) {
    for (const rec of recommendations) {
      await this.applyAdaptation(rec);
    }
  }
  
  async applyAdaptation(adaptation) {
    console.log(`[CORE LOOP] Applying adaptation: ${adaptation.type}`);
    
    switch (adaptation.type) {
      case 'strategy_avoidance':
        // Update orchestrator preferences
        this.orchestrator.config.avoidStrategies = this.orchestrator.config.avoidStrategies || [];
        this.orchestrator.config.avoidStrategies.push(adaptation.target);
        break;
        
      case 'strategy_preference':
        // Update orchestrator preferences
        this.orchestrator.config.preferStrategies = this.orchestrator.config.preferStrategies || [];
        this.orchestrator.config.preferStrategies.push(adaptation.target);
        break;
        
      case 'confidence_calibration':
        // Adjust confidence threshold
        if (adaptation.adjustment === 'lower_threshold') {
          this.config.actionConfidenceThreshold = Math.max(0.5, this.config.actionConfidenceThreshold - 0.1);
        }
        break;
        
      default:
        console.log(`[CORE LOOP] Unknown adaptation type: ${adaptation.type}`);
    }
  }
  
  /**
   * EVENT HANDLERS
   */
  
  handleTaskCompleted(event) {
    console.log(`[CORE LOOP] Task completed: ${event.task.id}`);
  }
  
  handleTaskFailed(event) {
    console.log(`[CORE LOOP] Task failed: ${event.task.id} - ${event.error}`);
  }
  
  handleReflectionCompleted(reflection) {
    console.log(`[CORE LOOP] Reflection completed: ${reflection.id}`);
  }
  
  handleDriftUpdated(drift) {
    console.log(`[CORE LOOP] Drift updated: ${drift.score.toFixed(3)}`);
  }
  
  handleActionCompleted(event) {
    console.log(`[CORE LOOP] Action completed: ${event.actionId}`);
  }
  
  handleRevenueTracked(revenue) {
    this.metrics.revenueGenerated += revenue.amount;
    console.log(`[CORE LOOP] Revenue tracked: $${revenue.amount.toFixed(2)}`);
  }
  
  handleInferenceCompleted(event) {
    console.log(`[CORE LOOP] Inference completed: ${event.requestId}`);
  }
  
  /**
   * STATUS AND MONITORING
   */
  
  getStatus() {
    return {
      running: this.isRunning,
      activeLoops: this.activeLoops.size,
      metrics: { ...this.metrics },
      lastObservation: new Date(this.lastObservation).toISOString(),
      lastReflection: new Date(this.lastReflection).toISOString(),
      config: this.config
    };
  }
  
  getLoopHistory(limit = 50) {
    return this.loopHistory.slice(-limit);
  }

  // ── Metrics update ─────────────────────────────────────────────────────────
  updateMetrics(result, loopTime) {
    this.metrics.loopsCompleted++;
    const n = this.metrics.loopsCompleted;
    this.metrics.avgLoopTime = ((this.metrics.avgLoopTime * (n - 1)) + loopTime) / n;
  }

  // ── System observation helpers ─────────────────────────────────────────────
  getCPUUsage() {
    // Rough estimate using process.cpuUsage(); falls back to 0.5 if unavailable
    try {
      const usage = process.cpuUsage();
      return Math.min(1, (usage.user + usage.system) / 1e9 / 10);
    } catch {
      return 0.5;
    }
  }

  getMemoryUsage() {
    try {
      const { heapUsed, heapTotal } = process.memoryUsage();
      return heapTotal > 0 ? heapUsed / heapTotal : 0.5;
    } catch {
      return 0.5;
    }
  }

  // ── Task queue ─────────────────────────────────────────────────────────────
  async getPendingTasks() {
    return [];
  }

  async generateRevenueTask() {
    return null;
  }

  // ── Evaluation helpers (used in evaluateTask) ──────────────────────────────
  calculateTaskConfidence(task, observation) {
    // Base confidence on task type and system health
    const systemOk = (observation?.system?.cpu || 0) < 0.9 &&
                     (observation?.system?.memory || 0) < 0.9;
    return systemOk ? 0.75 : 0.4;
  }

  calculateTaskRisk(task, observation) {
    const cpuLoad = observation?.system?.cpu || 0;
    const memLoad = observation?.system?.memory || 0;
    return Math.min(0.95, (cpuLoad + memLoad) / 2);
  }

  identifyOpportunity(task, observation) {
    const revenue = observation?.business?.recentRevenue || 0;
    return revenue < 1 ? 0.8 : 0.4;
  }

  assessUrgency(task, observation) {
    return task?.priority === 'critical' ? 0.9 :
           task?.priority === 'high'     ? 0.7 : 0.4;
  }

  assessFeasibility(task, observation) {
    const systemOk = (observation?.system?.cpu || 0) < 0.95;
    return systemOk ? 0.85 : 0.3;
  }

  generateRecommendation(task, observation) {
    const cpu = observation?.system?.cpu || 0;
    if (cpu > 0.9) return 'hold';
    if (task?.priority === 'critical') return 'proceed_immediately';
    return 'proceed';
  }

  // ── Measurement helpers (used in measureResults) ───────────────────────────
  assessActionQuality(action) {
    return action?.success ? 0.85 : 0.3;
  }

  async assessActionImpact(task, action) {
    return action?.success ? 0.7 : 0.2;
  }

  predictUserSatisfaction(task, action) {
    return action?.success ? 0.8 : 0.2;
  }

  calculateBusinessValue(task, action) {
    return action?.result?.revenue || 0;
  }

  async measureConversionImpact(action) {
    return action?.result?.converted ? 1.0 : 0.0;
  }

  // ── Reflection helpers (used in reflectOnLoop) ─────────────────────────────
  compareConfidenceVsReality(confidence, measurement) {
    const actual = measurement?.success ? 1 : 0;
    const accuracy = 1 - Math.abs((confidence || 0.5) - actual);
    return { confidence, actual, accuracy };
  }

  detectPatterns(task, observation, measurement) {
    return [];
  }

  extractLessons(task, observation, decision, measurement) {
    return [];
  }

  shouldRepeatStrategy(task, measurement) {
    return measurement?.success && measurement?.strategy
      ? [measurement.strategy]
      : [];
  }

  shouldAvoidStrategy(task, measurement) {
    return !measurement?.success && measurement?.strategy
      ? [measurement.strategy]
      : [];
  }

  async reset() {
    // Stop the loop
    await this.stop();
    
    // Reset metrics
    this.metrics = {
      loopsCompleted: 0,
      loopsFailed: 0,
      avgLoopTime: 0,
      observations: 0,
      actions: 0,
      adaptations: 0,
      revenueGenerated: 0
    };
    
    // Clear history
    this.loopHistory = [];
    
    // Reset subsystems
    await this.orchestrator.reset();
    await this.modelStack.reset();
    await this.memorySystem.reset();
    await this.actionLayer.reset();
    
    console.log('[CORE LOOP] Reset completed');
  }
}

module.exports = HeidiCoreLoop;
