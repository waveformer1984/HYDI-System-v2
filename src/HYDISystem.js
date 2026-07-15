/**
 * HYDI SYSTEM - The Complete Integrated Architecture
 * 
 * 🧩 CORE ARCHITECTURE (STOP OVERCOMPLICATING IT)
 * 
 * 🔹 Layer 1: Interface (You ↔ Heidi)
 * - Chat UI (local or web)
 * - Command layer (structured prompts, not rambling)
 * - Voice optional later if you feel cinematic
 * 
 * 🔹 Layer 2: Orchestrator (The Brainstem) - HeidiOrchestrator.js
 * - Route tasks
 * - Decide model (local vs API)
 * - Enforce rules (no drift, no nonsense)
 * - Trigger actions
 * 
 * 🔹 Layer 3: Model Stack (Hybrid Intelligence) - HybridModelStack.js
 * - Local Models (Primary): Ollama/LM Studio
 * - External Models (Selective Use): High-stakes, complex reasoning, polish
 * 
 * 🔹 Layer 4: Memory System - HeidiMemorySystem.js
 * - Short-Term (Session): Current tasks, active goals
 * - Long-Term (Database): User profiles, decisions, outcomes, revenue events
 * - Reflective Memory: Heidi's "self-awareness"
 * 
 * 🔹 Layer 5: Action Layer - HeidiActionLayer.js
 * - Trigger Stripe payments
 * - Send emails
 * - Update DB
 * - Launch scripts
 * - Generate offers
 * - Deploy pages
 * 
 * 🔁 THE CORE LOOP - HeidiCoreLoop.js
 * This runs constantly: Observe→Evaluate→Decide→Act→Measure→Reflect→Adapt
 * 
 * 🧠 SELF-AWARENESS - HeidiSelfAwareness.js
 * - Task success rate
 * - Revenue per action
 * - Model accuracy
 * - Drift score
 * - Cost efficiency
 * 
 * 💰 REVENUE FIRST - HeidiRevenueEngine.js
 * - Stripe Integration
 * - Offer Engine
 * - Conversion Tracking
 */

const EventEmitter = require('events');
const path = require('path');
const HeidiOrchestrator = require('./orchestrator/HeidiOrchestrator');
const HybridModelStack = require('./models/HybridModelStack');
const HeidiMemorySystem = require('./memory/HeidiMemorySystem');
const HeidiActionLayer = require('./actions/HeidiActionLayer');
const HeidiCoreLoop = require('./core/HeidiCoreLoop');
const HYDIAutonomyManager = require('./hydi-v3');
const HeidiSelfAwareness = require('./awareness/HeidiSelfAwareness');
const HeidiRevenueEngine = require('./revenue/HeidiRevenueEngine');
const HeidiControlPlane = require('./control/HeidiControlPlane');
const DeepLifeArchitect = require('./awareness/DeepLifeArchitect');

class HYDISystem extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // System-wide settings
      enableRevenueMode: config.enableRevenueMode !== false,
      enableSelfAwareness: config.enableSelfAwareness !== false,
      enableAutoActions: config.enableAutoActions !== false,
      enableLifeFlowAnalysis: config.enableLifeFlowAnalysis !== false,
      
      // Loop settings
      loopInterval: config.loopInterval || 60000, // 1 minute
      observationInterval: config.observationInterval || 300000, // 5 minutes
      reflectionInterval: config.reflectionInterval || 900000, // 15 minutes
      
      // Model settings
      localFirst: config.localFirst !== false,
      confidenceThreshold: config.confidenceThreshold || 0.7,
      costThreshold: config.costThreshold || 0.10, // $0.10 per request
      
      // Revenue settings
      stripeSecretKey: config.stripeSecretKey || process.env.STRIPE_SECRET_KEY,
      enableAutoOffers: config.enableAutoOffers !== false,
      
      // Safety settings
      maxConcurrentTasks: config.maxConcurrentTasks || 10,
      enableCircuitBreaker: config.enableCircuitBreaker !== false,
      
      ...config
    };
    
    // System state
    this.isRunning = false;
    this.startTime = null;
    this.version = '3.0.0';
    
    // Initialize control plane first (it governs everything)
    this.controlPlane = new HeidiControlPlane({
      minConfidenceForActions: config.minConfidenceForActions || 0.8,
      maxRiskForAutoActions: config.maxRiskForAutoActions || 0.3,
      sandboxMode: config.sandboxMode !== false,
      enableAdaptiveLearning: config.enableAdaptiveLearning !== false
    });
    
    // Initialize all layers
    this.initializeLayers();
    
    // Wire up cross-layer communication
    this.setupLayerCommunication();
    
    // Start control plane feedback loop
    this.controlPlane.startFeedbackLoop();
    
    console.log('[HYDI SYSTEM] HYDI v3.0.0 initialized');
    console.log(`[HYDI SYSTEM] Revenue mode: ${this.config.enableRevenueMode ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[HYDI SYSTEM] Autonomy mode: ENABLED`);
    console.log(`[HYDI SYSTEM] Self-awareness: ${this.config.enableSelfAwareness ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[HYDI SYSTEM] Life-flow analysis: ${this.config.enableLifeFlowAnalysis ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[HYDI SYSTEM] Local-first: ${this.config.localFirst ? 'ENABLED' : 'DISABLED'}`);
  }
  
  initializeLayers() {
    console.log('[HYDI SYSTEM] Initializing layers...');
    
    // Layer 2: Orchestrator (The Brainstem)
    this.orchestrator = new HeidiOrchestrator({
      confidenceThreshold: this.config.confidenceThreshold,
      costThreshold: this.config.costThreshold,
      revenuePriority: this.config.enableRevenueMode
    });
    
    // Layer 3: Model Stack (Hybrid Intelligence)
    this.modelStack = new HybridModelStack({
      localFirst: this.config.localFirst,
      enableFailover: true,
      maxCostPerRequest: this.config.costThreshold
    });
    
    // Layer 4: Memory System
    this.memorySystem = new HeidiMemorySystem({
      reflectionInterval: this.config.reflectionInterval,
      enablePersistence: true
    });
    
    // Layer 5: Action Layer
    this.actionLayer = new HeidiActionLayer({
      enableRevenueActions: this.config.enableRevenueMode,
      enableScriptExecution: this.config.enableAutoActions
    });
    
    // Core Loop (connects all layers)
    this.coreLoop = new HeidiCoreLoop({
      loopInterval: this.config.loopInterval,
      observationInterval: this.config.observationInterval,
      reflectionInterval: this.config.reflectionInterval,
      enableRevenueMode: this.config.enableRevenueMode,
      enableAutoActions: this.config.enableAutoActions,
      actionConfidenceThreshold: this.config.confidenceThreshold
    });

    // V3 Autonomy Manager (reliability, mission planning, decision intelligence)
    this.autonomyManager = new HYDIAutonomyManager({
      coreLoop: this.coreLoop,
      orchestrator: this.orchestrator,
      memorySystem: this.memorySystem,
      actionLayer: this.actionLayer,
      modelStack: this.modelStack,
      config: {
        enableGracefulShutdown: false,
        enableMissionPlanning: this.config.enableAutoActions,
        enableDecisionIntelligence: true,
        enableReflection: true,
        enableSelfHealing: true,
        enableMemoryIntegrity: true,
        enableObservability: true,
        enableSecurity: true,
      }
    });

    // Self-Awareness (if enabled)
    if (this.config.enableSelfAwareness) {
      this.selfAwareness = new HeidiSelfAwareness({
        driftThreshold: 0.3,
        reflectionInterval: this.config.reflectionInterval,
        enableRevenueTracking: this.config.enableRevenueMode
      });
    }
    
    // Revenue Engine (if enabled)
    if (this.config.enableRevenueMode) {
      this.revenueEngine = new HeidiRevenueEngine({
        stripeSecretKey: this.config.stripeSecretKey,
        enableAutoOffers: this.config.enableAutoOffers,
        enableRevenueTracking: true
      });
    }
    
    // Deep Life Architect (if enabled)
    if (this.config.enableLifeFlowAnalysis) {
      this.deepLifeArchitect = new DeepLifeArchitect({
        dataPath: this.config.lifeFlowDataPath || path.join(process.cwd(), 'data', 'life-flow'),
        hardwareInterval: this.config.hardwareInterval || 5000,
        softwareInterval: this.config.softwareInterval || 10000,
        analysisInterval: this.config.analysisInterval || 60000,
        retentionDays: this.config.retentionDays || 30
      });
    }
    
    console.log('[HYDI SYSTEM] All layers initialized');
  }
  
  setupLayerCommunication() {
    console.log('[HYDI SYSTEM] Setting up layer communication...');
    
    // Core Loop → Other Layers
    this.coreLoop.on('loop_completed', (event) => {
      this.handleLoopCompleted(event);
    });
    
    this.coreLoop.on('loop_failed', (event) => {
      this.handleLoopFailed(event);
    });
    
    // Self-Awareness → System
    if (this.selfAwareness) {
      this.selfAwareness.on('high_drift', (event) => {
        this.handleHighDrift(event);
      });
      
      this.selfAwareness.on('reflection_completed', (reflection) => {
        this.handleReflectionCompleted(reflection);
      });
    }
    
    // Revenue Engine → System
    if (this.revenueEngine) {
      this.revenueEngine.on('revenue_updated', (event) => {
        this.handleRevenueUpdated(event);
      });
      
      this.revenueEngine.on('conversion_completed', (event) => {
        this.handleConversionCompleted(event);
      });
    }
    
    // Action Layer → System
    this.actionLayer.on('action_completed', (event) => {
      this.handleActionCompleted(event);
    });
    
    this.actionLayer.on('revenue_tracked', (event) => {
      this.handleRevenueTracked(event);
    });
    
    // Control Plane → System
    this.controlPlane.on('adaptation_completed', (event) => {
      this.handleAdaptationCompleted(event);
    });
    
    this.controlPlane.on('learning_recorded', (record) => {
      this.handleLearningRecorded(record);
    });
    
    // Memory System → System
    this.memorySystem.on('reflection_completed', (reflection) => {
      this.handleMemoryReflectionCompleted(reflection);
    });
    
    // Deep Life Architect → System
    if (this.deepLifeArchitect) {
      this.deepLifeArchitect.on('session_started', (event) => {
        this.handleLifeFlowSessionStarted(event);
      });
      
      this.deepLifeArchitect.on('session_ended', (event) => {
        this.handleLifeFlowSessionEnded(event);
      });
      
      this.deepLifeArchitect.on('analysis_completed', (analysis) => {
        this.handleLifeFlowAnalysisCompleted(analysis);
      });
    }
    
    console.log('[HYDI SYSTEM] Layer communication established');
  }
  
  /**
   * SYSTEM CONTROL
   */
  
  async start() {
    if (this.isRunning) {
      console.log('[HYDI SYSTEM] Already running');
      return;
    }
    
    console.log('[HYDI SYSTEM] Starting HYDI System...');
    this.startTime = Date.now();
    this.isRunning = true;
    
    try {
      // Start V3 autonomy layer (patches core loop before core loop starts)
      await this.autonomyManager.start();

      // Start core loop
      await this.coreLoop.start();
      
      // Start self-awareness if enabled
      if (this.selfAwareness) {
        // Self-awareness starts automatically in constructor
      }
      
      // Start revenue engine if enabled
      if (this.revenueEngine) {
        // Revenue engine starts automatically in constructor
      }
      
      // Emit system started
      this.emit('system_started', {
        version: this.version,
        startTime: this.startTime,
        config: this.config
      });
      
      console.log('[HYDI SYSTEM] HYDI System started successfully');
      console.log(`[HYDI SYSTEM] All layers operational`);
      
    } catch (error) {
      console.error('[HYDI SYSTEM] Failed to start:', error.message);
      this.isRunning = false;
      throw error;
    }
  }
  
  async stop() {
    if (!this.isRunning) {
      console.log('[HYDI SYSTEM] Not running');
      return;
    }
    
    console.log('[HYDI SYSTEM] Stopping HYDI System...');
    this.isRunning = false;
    
    try {
      // Stop core loop
      await this.coreLoop.stop();

      // Stop V3 autonomy layer and persist state
      await this.autonomyManager.stop();
      
      // Note: Other layers continue running in background for persistence
      
      // Emit system stopped
      this.emit('system_stopped', {
        version: this.version,
        startTime: this.startTime,
        stopTime: Date.now(),
        uptime: Date.now() - this.startTime
      });
      
      console.log('[HYDI SYSTEM] HYDI System stopped');
      
    } catch (error) {
      console.error('[HYDI SYSTEM] Failed to stop:', error.message);
      throw error;
    }
  }
  
  /**
   * MAIN INTERFACE - Process user requests
   */
  
  async processRequest(request, context = {}) {
    if (!this.isRunning) {
      throw new Error('HYDI System is not running');
    }
    
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    try {
      console.log(`[HYDI SYSTEM] Processing request: ${requestId} (${request.type})`);
      
      // Enrich request
      const enrichedRequest = {
        id: requestId,
        timestamp: new Date().toISOString(),
        ...request,
        context: {
          ...context,
          userId: context.userId || 'anonymous',
          sessionId: context.sessionId || 'default',
          tier: context.tier || 'starter'
        }
      };
      
      // Route to appropriate handler
      const result = await this.routeRequest(enrichedRequest);
      
      // Track in self-awareness
      if (this.selfAwareness) {
        this.selfAwareness.trackAction({
          id: requestId,
          type: request.type,
          success: result.success !== false,
          confidence: result.confidence || 0.8,
          latency: Date.now() - startTime,
          cost: result.cost || 0,
          revenue: result.revenue || 0,
          model: result.model,
          strategy: result.strategy,
          context: enrichedRequest.context,
          outcome: result
        });
      }
      
      // Store in memory
      this.memorySystem.storeTask(requestId, enrichedRequest);
      
      // Emit completion
      this.emit('request_completed', {
        requestId,
        request: enrichedRequest,
        result,
        duration: Date.now() - startTime
      });
      
      console.log(`[HYDI SYSTEM] Request completed: ${requestId} (${Date.now() - startTime}ms)`);
      
      return {
        success: true,
        requestId,
        result,
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      console.error(`[HYDI SYSTEM] Request failed: ${requestId} - ${error.message}`);
      
      // Track failure in self-awareness
      if (this.selfAwareness) {
        this.selfAwareness.trackAction({
          id: requestId,
          type: request.type,
          success: false,
          confidence: 0,
          latency: Date.now() - startTime,
          cost: 0,
          revenue: 0,
          error: error.message,
          context: context
        });
      }
      
      // Emit failure
      this.emit('request_failed', {
        requestId,
        request,
        error: error.message,
        duration: Date.now() - startTime
      });
      
      throw error;
    }
  }
  
  async routeRequest(request) {
    switch (request.type) {
      case 'chat':
      case 'question':
      case 'analysis':
        return await this.handleIntelligenceRequest(request);
        
      case 'revenue':
      case 'payment':
      case 'offer':
        return await this.handleRevenueRequest(request);
        
      case 'action':
      case 'deploy':
      case 'script':
        return await this.handleActionRequest(request);
        
      case 'system':
      case 'status':
      case 'health':
        return await this.handleSystemRequest(request);
        
      case 'life_flow':
      case 'telemetry':
        return await this.handleLifeFlowRequest(request);
        
      default:
        return await this.handleGeneralRequest(request);
    }
  }
  
  async handleIntelligenceRequest(request) {
    // Route decision through control plane
    const availableModels = this.modelStack.getAvailableModels();
    const decision = await this.controlPlane.routeDecision(request, availableModels, request.context);
    
    // Execute with control plane authorization
    const result = await this.modelStack.execute(request, {
      tier: request.context.tier,
      timeout: 30000,
      forceModel: decision.model,
      strategy: decision.strategy
    });
    
    // Record outcome with control plane
    this.controlPlane.recordActionOutcome({
      id: request.id,
      type: 'intelligence',
      model: result.model,
      strategy: decision.strategy,
      confidence: result.confidence || decision.confidence,
      cost: result.cost || 0
    }, {
      success: result.success !== false,
      latency: result.latency || 0,
      revenue: 0
    });
    
    return {
      ...result,
      type: 'intelligence',
      success: true,
      controlDecision: decision
    };
  }
  
  async handleRevenueRequest(request) {
    if (!this.revenueEngine) {
      throw new Error('Revenue engine is not enabled');
    }
    
    switch (request.subtype) {
      case 'generate_offer':
        return await this.revenueEngine.generateOffer(request.context);
        
      case 'create_checkout':
        return await this.actionLayer.executeAction('create_checkout', request.params, request.context);
        
      case 'stripe_payment':
        return await this.actionLayer.executeAction('stripe_payment', request.params, request.context);
        
      default:
        throw new Error(`Unknown revenue request subtype: ${request.subtype}`);
    }
  }
  
  async handleActionRequest(request) {
    // Gate action through control plane
    const action = {
      id: request.id,
      type: request.subtype,
      params: request.params,
      context: request.context,
      confidence: request.confidence || 0.8,
      cost: 0 // Will be estimated
    };
    
    const gating = await this.controlPlane.gateAction(action, request.context);
    
    if (!gating.allowed) {
      return {
        success: false,
        reason: gating.reason,
        requiresApproval: gating.requiresApproval,
        riskAssessment: gating.riskAssessment
      };
    }
    
    // Execute action
    let result;
    try {
      switch (request.subtype) {
        case 'send_email':
          result = await this.actionLayer.executeAction('send_email', request.params, request.context);
          break;
          
        case 'deploy_page':
          result = await this.actionLayer.executeAction('deploy_page', request.params, request.context);
          break;
          
        case 'launch_script':
          result = await this.actionLayer.executeAction('launch_script', request.params, request.context);
          break;
          
        case 'update_database':
          result = await this.actionLayer.executeAction('update_database', request.params, request.context);
          break;
          
        default:
          throw new Error(`Unknown action request subtype: ${request.subtype}`);
      }
      
      // Record successful outcome
      this.controlPlane.recordActionOutcome({
        id: request.id,
        type: request.subtype,
        model: 'action_layer',
        strategy: 'direct_execution',
        confidence: action.confidence,
        cost: result.cost || 0
      }, {
        success: true,
        latency: result.latency || 0,
        revenue: result.revenue || 0
      });
      
      return {
        ...result,
        success: true,
        controlGating: gating
      };
      
    } catch (error) {
      // Record failed outcome
      this.controlPlane.recordActionOutcome({
        id: request.id,
        type: request.subtype,
        model: 'action_layer',
        strategy: 'direct_execution',
        confidence: action.confidence,
        cost: 0
      }, {
        success: false,
        latency: 0,
        revenue: 0,
        error: error.message
      });
      
      throw error;
    }
  }
  
  async handleSystemRequest(request) {
    switch (request.subtype) {
      case 'status':
        return this.getSystemStatus();
        
      case 'health':
        return this.getHealthStatus();
        
      case 'metrics':
        return this.getSystemMetrics();
        
      case 'self_awareness':
        return this.getSelfAwarenessReport();
        
      case 'revenue_report':
        return this.getRevenueReport();
        
      default:
        throw new Error(`Unknown system request subtype: ${request.subtype}`);
    }
  }
  
  async handleLifeFlowRequest(request) {
    if (!this.deepLifeArchitect) {
      throw new Error('Deep Life Architect is not enabled');
    }
    
    switch (request.subtype) {
      case 'start_session':
        return await this.deepLifeArchitect.startSession(request.params.intent);
        
      case 'end_session':
        return await this.deepLifeArchitect.endSession();
        
      case 'get_status':
        return this.deepLifeArchitect.getStatus();
        
      case 'weekly_report':
        return await this.deepLifeArchitect.generateWeeklyReport();
        
      case 'real_time_analysis':
        const latestAnalysis = this.deepLifeArchitect.currentSession.analysis.slice(-1)[0];
        return latestAnalysis || { error: 'No analysis available' };
        
      case 'hardware_telemetry':
        const latestTelemetry = this.deepLifeArchitect.currentSession.hardwareData.slice(-1)[0];
        return latestTelemetry || { error: 'No telemetry data available' };
        
      case 'software_activity':
        const latestActivity = this.deepLifeArchitect.currentSession.softwareData.slice(-1)[0];
        return latestActivity || { error: 'No activity data available' };
        
      default:
        throw new Error(`Unknown life flow request subtype: ${request.subtype}`);
    }
  }
  
  async handleGeneralRequest(request) {
    // Default to intelligence processing
    return await this.handleIntelligenceRequest(request);
  }
  
  /**
   * EVENT HANDLERS
   */
  
  handleLoopCompleted(event) {
    console.log(`[HYDI SYSTEM] Loop completed: ${event.loopId}`);
    
    // Track loop in self-awareness
    if (this.selfAwareness) {
      this.selfAwareness.trackAction({
        id: event.loopId,
        type: 'core_loop',
        success: true,
        confidence: 0.9,
        latency: event.duration,
        cost: 0,
        revenue: 0,
        outcome: event.result
      });
    }
  }
  
  handleLoopFailed(event) {
    console.log(`[HYDI SYSTEM] Loop failed: ${event.loopId} - ${event.error}`);
    
    // Track failure in self-awareness
    if (this.selfAwareness) {
      this.selfAwareness.trackAction({
        id: event.loopId,
        type: 'core_loop',
        success: false,
        confidence: 0,
        latency: 0,
        cost: 0,
        revenue: 0,
        error: event.error
      });
    }
  }
  
  handleHighDrift(event) {
    console.warn(`[HYDI SYSTEM] High drift detected: ${event.score.toFixed(3)}`);
    
    // Take corrective action
    if (event.score > 0.5) {
      console.log('[HYDI SYSTEM] Taking emergency action due to high drift');
      
      // Reduce confidence threshold
      this.config.confidenceThreshold = Math.max(0.5, this.config.confidenceThreshold - 0.1);
      
      // Emit drift alert
      this.emit('high_drift_alert', event);
    }
  }
  
  handleReflectionCompleted(reflection) {
    console.log(`[HYDI SYSTEM] Reflection completed: ${reflection.id}`);
    
    // Apply adaptations if needed
    if (reflection.recommendations.length > 0) {
      console.log(`[HYDI SYSTEM] Applying ${reflection.recommendations.length} adaptations`);
      
      for (const recommendation of reflection.recommendations) {
        this.applyAdaptation(recommendation);
      }
    }
  }
  
  handleRevenueUpdated(event) {
    console.log(`[HYDI SYSTEM] Revenue updated: $${event.amount.toFixed(2)} (total: $${event.total.toFixed(2)})`);
    
    // Track revenue in self-awareness
    if (this.selfAwareness) {
      this.selfAwareness.trackAction({
        id: `revenue_${Date.now()}`,
        type: 'revenue',
        success: true,
        confidence: 1.0,
        latency: 0,
        cost: 0,
        revenue: event.amount,
        outcome: event
      });
    }
  }
  
  handleConversionCompleted(event) {
    console.log(`[HYDI SYSTEM] Conversion completed: ${event.sessionId} ($${event.amount})`);
    
    // Store conversion in memory
    this.memorySystem.storeRevenueEvent({
      id: event.sessionId,
      type: 'conversion',
      amount: event.amount,
      context: event.tracking
    });
  }
  
  handleActionCompleted(event) {
    console.log(`[HYDI SYSTEM] Action completed: ${event.actionId}`);
    
    // Track in self-awareness
    if (this.selfAwareness) {
      this.selfAwareness.trackAction({
        id: event.actionId,
        type: event.actionType,
        success: true,
        confidence: 0.8,
        latency: event.latency,
        cost: event.result.cost || 0,
        revenue: event.result.revenue || 0,
        outcome: event.result
      });
    }
  }
  
  handleRevenueTracked(event) {
    console.log(`[HYDI SYSTEM] Revenue tracked: $${event.amount.toFixed(2)}`);
  }
  
  handleMemoryReflectionCompleted(reflection) {
    console.log(`[HYDI SYSTEM] Memory reflection completed: ${reflection.id}`);
  }
  
  handleAdaptationCompleted(event) {
    console.log(`[HYDI SYSTEM] Control plane adaptation completed: ${event.adaptations.length} adjustments`);
    
    // Emit to other layers that adaptation occurred
    this.emit('system_adapted', event);
  }
  
  handleLearningRecorded(record) {
    console.log(`[HYDI SYSTEM] Learning recorded: ${record.actionType} (success: ${record.success})`);
    
    // Update self-awareness if available
    if (this.selfAwareness) {
      this.selfAwareness.trackAction({
        id: record.actionId,
        type: record.actionType,
        success: record.success,
        confidence: record.confidence,
        latency: record.latency,
        cost: record.cost,
        revenue: record.revenue,
        model: record.model,
        strategy: record.strategy
      });
    }
  }
  
  handleLifeFlowSessionStarted(event) {
    console.log(`[HYDI SYSTEM] Life-flow session started: ${event.sessionId} (${event.intent})`);
    
    // Store in memory system
    this.memorySystem.storeTask(event.sessionId, {
      type: 'life_flow_session',
      intent: event.intent,
      startTime: event.startTime,
      status: 'active'
    });
    
    // Emit for external monitoring
    this.emit('life_flow_session_started', event);
  }
  
  handleLifeFlowSessionEnded(event) {
    console.log(`[HYDI SYSTEM] Life-flow session ended: ${event.sessionId} (${event.duration}ms)`);
    
    // Store in memory system
    this.memorySystem.storeTask(event.sessionId, {
      type: 'life_flow_session',
      endTime: Date.now(),
      duration: event.duration,
      finalAnalysis: event.finalAnalysis,
      status: 'completed'
    });
    
    // Track in self-awareness
    if (this.selfAwareness) {
      this.selfAwareness.trackAction({
        id: event.sessionId,
        type: 'life_flow_session',
        success: event.finalAnalysis.efficiency > 0.6,
        confidence: 0.8,
        latency: event.duration,
        cost: 0,
        revenue: 0,
        outcome: event.finalAnalysis
      });
    }
    
    // Emit for external monitoring
    this.emit('life_flow_session_ended', event);
  }
  
  handleLifeFlowAnalysisCompleted(analysis) {
    console.log(`[HYDI SYSTEM] Life-flow analysis completed: efficiency ${analysis.efficiency.toFixed(3)}`);
    
    // Store analysis in memory
    this.memorySystem.storeTask(`analysis_${analysis.timestamp}`, {
      type: 'life_flow_analysis',
      analysis,
      timestamp: analysis.timestamp
    });
    
    // Check for high drift and alert
    if (analysis.intentAlignment.score < 0.4) {
      this.emit('life_flow_drift_alert', {
        timestamp: analysis.timestamp,
        intentAlignment: analysis.intentAlignment,
        efficiency: analysis.efficiency
      });
    }
    
    // Emit for real-time monitoring
    this.emit('life_flow_analysis', analysis);
  }
  
  /**
   * ADAPTATION ENGINE
   */
  
  applyAdaptation(recommendation) {
    console.log(`[HYDI SYSTEM] Applying adaptation: ${recommendation.action}`);
    
    switch (recommendation.action) {
      case 'reduce_confidence_threshold':
        this.config.confidenceThreshold = Math.max(0.5, this.config.confidenceThreshold - 0.1);
        break;
        
      case 'increase_confidence_threshold':
        this.config.confidenceThreshold = Math.min(0.9, this.config.confidenceThreshold + 0.1);
        break;
        
      case 'switch_primary_model':
        // This would update model stack preferences
        console.log(`[HYDI SYSTEM] Switching primary model to: ${recommendation.target}`);
        break;
        
      case 'reduce_external_usage':
        this.config.costThreshold = Math.max(0.01, this.config.costThreshold * 0.8);
        break;
        
      default:
        console.log(`[HYDI SYSTEM] Unknown adaptation: ${recommendation.action}`);
    }
  }
  
  /**
   * STATUS AND MONITORING
   */
  
  getSystemStatus() {
    return {
      version: this.version,
      running: this.isRunning,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      config: this.config,
      layers: {
        controlPlane: this.controlPlane.getSystemState(),
        orchestrator: this.orchestrator.getStatus(),
        modelStack: this.modelStack.getStatus(),
        memorySystem: this.memorySystem.getStatus(),
        actionLayer: this.actionLayer.getStatus(),
        coreLoop: this.coreLoop.getStatus(),
        selfAwareness: this.selfAwareness ? this.selfAwareness.getStatus() : null,
        revenueEngine: this.revenueEngine ? this.revenueEngine.getStatus() : null,
        deepLifeArchitect: this.deepLifeArchitect ? this.deepLifeArchitect.getStatus() : null
      }
    };
  }
  
  getHealthStatus() {
    const status = this.getSystemStatus();
    
    // Calculate overall health
    let healthScore = 1.0;
    let issues = [];
    
    // Check core loop
    if (status.layers.coreLoop.activeLoops > this.config.maxConcurrentTasks) {
      healthScore -= 0.2;
      issues.push('High concurrent loop count');
    }
    
    // Check self-awareness
    if (status.layers.selfAwareness && status.layers.selfAwareness.drift.score > 0.3) {
      healthScore -= 0.1;
      issues.push('High drift detected');
    }
    
    // Check revenue
    if (status.layers.revenueEngine && status.layers.revenueEngine.revenue.conversionRate < 0.1) {
      healthScore -= 0.1;
      issues.push('Low conversion rate');
    }
    
    return {
      overall: healthScore > 0.8 ? 'healthy' : healthScore > 0.6 ? 'degraded' : 'critical',
      score: healthScore,
      issues,
      layers: status.layers
    };
  }
  
  getSystemMetrics() {
    const controlPlaneReport = this.controlPlane.getPerformanceReport();
    
    const metrics = {
      requests: {
        total: controlPlaneReport.totalActions,
        successful: Math.round(controlPlaneReport.totalActions * controlPlaneReport.overallSuccessRate),
        failed: Math.round(controlPlaneReport.totalActions * (1 - controlPlaneReport.overallSuccessRate)),
        avgLatency: 0 // Would be calculated from control plane data
      },
      loops: {
        completed: this.coreLoop.metrics.loopsCompleted,
        failed: this.coreLoop.metrics.loopsFailed,
        avgTime: this.coreLoop.metrics.avgLoopTime
      },
      controlPlane: {
        modelPerformance: controlPlaneReport.modelPerformance,
        actionTypePerformance: controlPlaneReport.actionTypePerformance,
        recentTrends: controlPlaneReport.recentTrends
      },
      revenue: this.revenueEngine ? {
        total: this.revenueEngine.revenue.total,
        today: this.revenueEngine.revenue.today,
        conversionRate: this.revenueEngine.revenue.conversionRate
      } : null,
      selfAwareness: this.selfAwareness ? {
        drift: this.selfAwareness.metrics.drift.score,
        confidence: this.selfAwareness.selfAwarenessState.confidence,
        level: this.selfAwareness.selfAwarenessState.level
      } : null
    };
    
    return metrics;
  }
  
  getSelfAwarenessReport() {
    if (!this.selfAwareness) {
      return { error: 'Self-awareness is not enabled' };
    }
    
    return this.selfAwareness.getSelfAwarenessReport();
  }
  
  getRevenueReport() {
    if (!this.revenueEngine) {
      return { error: 'Revenue engine is not enabled' };
    }
    
    return this.revenueEngine.getRevenueReport();
  }
  
  /**
   * WEBHOOK HANDLERS
   */
  
  async handleWebhook(provider, event) {
    console.log(`[HYDI SYSTEM] Handling webhook: ${provider} - ${event.type}`);
    
    switch (provider) {
      case 'stripe':
        if (this.revenueEngine) {
          await this.revenueEngine.handleStripeWebhook(event);
        }
        break;
        
      default:
        console.log(`[HYDI SYSTEM] Unknown webhook provider: ${provider}`);
    }
  }
  
  /**
   * SYSTEM MAINTENANCE
   */
  
  async reset() {
    console.log('[HYDI SYSTEM] Resetting HYDI System...');
    
    // Reset control plane first
    await this.controlPlane.reset();
    
    // Reset all layers
    await this.coreLoop.reset();
    await this.orchestrator.reset();
    await this.modelStack.reset();
    await this.memorySystem.reset();
    await this.actionLayer.reset();
    
    if (this.selfAwareness) {
      await this.selfAwareness.reset();
    }
    
    if (this.revenueEngine) {
      await this.revenueEngine.reset();
    }
    
    if (this.deepLifeArchitect) {
      await this.deepLifeArchitect.reset();
    }
    
    console.log('[HYDI SYSTEM] Reset completed');
  }
  
  async shutdown() {
    console.log('[HYDI SYSTEM] Shutting down HYDI System...');
    
    await this.stop();
    
    console.log('[HYDI SYSTEM] Shutdown completed');
  }
}

module.exports = HYDISystem;
