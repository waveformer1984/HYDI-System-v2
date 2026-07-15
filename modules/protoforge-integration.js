/**
 * ProtoForge Integration Layer
 * 
 * Connects Heidi Executive Orchestrator with the 15 specialized agents
 * through the event-driven communication system.
 * 
 * This is the central nervous system that:
 * - Initializes all agents
 * - Sets up communication channels
 * - Handles agent lifecycle
 * - Provides unified API
 * - Manages system-wide coordination
 */

const HeidiExecutiveOrchestrator = require('./heidi-executive-orchestrator');
const ProtoForgeEventSystem = require('./protoforge-event-system');
const { AgentFactory } = require('../agents/specialized/agent-factory');
const { ProcurementAgent, ConstructionAgent, FabricationAgent } = require('../agents/specialized/execution-agents');
const { FinanceAgent, FundingAgent, RevenueAgent } = require('../agents/specialized/business-agents');
const WorkflowAgent = require('../agents/specialized/workflow-agent');
const SecurityAgent = require('../agents/specialized/security-agent');

class ProtoForgeIntegration {
  constructor(config = {}) {
    this.config = {
      autonomyLevel: 2, // EXECUTE_WITH_APPROVAL
      enableHumanApproval: true,
      maxConcurrentTasks: 10,
      eventRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
      ...config
    };
    
    // Core components
    this.heidi = null;
    this.eventSystem = null;
    this.agents = new Map();
    
    // System state
    this.initialized = false;
    this.startTime = null;
    this.metrics = {
      tasksCompleted: 0,
      agentsActive: 0,
      eventsProcessed: 0,
      conflictsResolved: 0,
      humanApprovals: 0
    };
    
    console.log('[PROTOFORGE INTEGRATION] Initializing ProtoForge PAO system...');
  }
  
  /**
   * Initialize the entire ProtoForge system
   */
  async initialize() {
    if (this.initialized) {
      throw new Error('ProtoForge already initialized');
    }
    
    this.startTime = Date.now();
    
    try {
      console.log('[PROTOFORGE INTEGRATION] Phase 1: Initializing event system...');
      await this.initializeEventSystem();
      
      console.log('[PROTOFORGE INTEGRATION] Phase 2: Initializing Heidi Executive Orchestrator...');
      await this.initializeHeidi();
      
      console.log('[PROTOFORGE INTEGRATION] Phase 3: Initializing specialized agents...');
      await this.initializeAgents();
      
      console.log('[PROTOFORGE INTEGRATION] Phase 4: Setting up communication channels...');
      await this.setupCommunication();
      
      console.log('[PROTOFORGE INTEGRATION] Phase 5: Starting system monitoring...');
      await this.startMonitoring();
      
      this.initialized = true;
      
      console.log('[PROTOFORGE INTEGRATION] ProtoForge PAO system initialized successfully');
      console.log(`[PROTOFORGE INTEGRATION] Autonomy Level: ${this.getAutonomyLevelName()}`);
      console.log(`[PROTOFORGE INTEGRATION] Active Agents: ${this.agents.size}`);
      console.log(`[PROTOFORGE INTEGRATION] Startup Time: ${Date.now() - this.startTime}ms`);
      
      // Emit system ready event
      await this.eventSystem.publishSystemEvent('system_ready', {
        timestamp: Date.now(),
        agentCount: this.agents.size,
        autonomyLevel: this.config.autonomyLevel
      }, { priority: 'high' });
      
    } catch (error) {
      console.error('[PROTOFORGE INTEGRATION] Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Initialize the event system
   */
  async initializeEventSystem() {
    this.eventSystem = new ProtoForgeEventSystem({
      maxQueueSize: 10000,
      retentionPeriod: this.config.eventRetention,
      batchSize: 50,
      flushInterval: 500
    });
    
    // Set up event system event handlers
    this.eventSystem.on('event_published', (event) => {
      this.metrics.eventsProcessed++;
    });
    
    this.eventSystem.on('conflict_resolved', (resolution) => {
      this.metrics.conflictsResolved++;
    });
    
    this.eventSystem.on('agent_message', (message) => {
      this.handleAgentMessage(message);
    });
    
    this.eventSystem.on('conflict_escalation', (escalation) => {
      this.handleConflictEscalation(escalation);
    });
    
    console.log('[PROTOFORGE INTEGRATION] Event system initialized');
  }
  
  /**
   * Initialize Heidi Executive Orchestrator
   */
  async initializeHeidi() {
    this.heidi = new HeidiExecutiveOrchestrator({
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      autonomyLevel: this.config.autonomyLevel,
      escalationThreshold: 0.8
    });
    
    // Set up Heidi event handlers
    this.heidi.on('taskCompleted', (data) => {
      this.metrics.tasksCompleted++;
      this.handleTaskCompletion(data);
    });
    
    this.heidi.on('escalationRequired', (escalation) => {
      this.handleEscalationRequired(escalation);
    });
    
    this.heidi.on('autonomyLevelChanged', (data) => {
      this.config.autonomyLevel = data.level;
      console.log(`[PROTOFORGE INTEGRATION] Autonomy level changed to: ${data.name}`);
    });
    
    // Register Heidi with event system
    this.eventSystem.registerAgent('heidi_executive', {
      name: 'Heidi Executive Orchestrator',
      type: 'EXECUTIVE',
      layer: 'EXECUTIVE',
      capabilities: ['task_routing', 'conflict_resolution', 'strategic_planning', 'human_escalation']
    });
    
    console.log('[PROTOFORGE INTEGRATION] Heidi Executive Orchestrator initialized');
  }
  
  /**
   * Initialize all 15 specialized agents
   */
  async initializeAgents() {
    // Layer A: Strategic Agents
    const architectAgent = AgentFactory.createAgent('architect');
    const energySystemAgent = AgentFactory.createAgent('energy_system');
    const aiSystemsAgent = AgentFactory.createAgent('ai_systems');
    
    // Layer B: Execution Agents
    const procurementAgent = new ProcurementAgent();
    const constructionAgent = new ConstructionAgent();
    const fabricationAgent = new FabricationAgent();
    
    // Layer C: Business + Finance Agents
    const financeAgent = new FinanceAgent();
    const fundingAgent = new FundingAgent();
    const revenueAgent = new RevenueAgent();
    
    // Layer D: Outreach + Growth Agents (simplified for now)
    const outreachAgent = this.createOutreachAgent();
    const marketingAgent = this.createMarketingAgent();
    const communityAgent = this.createCommunityAgent();
    
    // Layer E: Operations Agents
    const facilityAgent = this.createFacilityAgent();
    const securityAgent = new SecurityAgent();
    const workflowAgent = new WorkflowAgent();
    
    // Register all agents
    const allAgents = [
      { agent: architectAgent, id: 'architect_agent' },
      { agent: energySystemAgent, id: 'energy_system_agent' },
      { agent: aiSystemsAgent, id: 'ai_systems_agent' },
      { agent: procurementAgent, id: 'procurement_agent' },
      { agent: constructionAgent, id: 'construction_agent' },
      { agent: fabricationAgent, id: 'fabrication_agent' },
      { agent: financeAgent, id: 'finance_agent' },
      { agent: fundingAgent, id: 'funding_agent' },
      { agent: revenueAgent, id: 'revenue_agent' },
      { agent: outreachAgent, id: 'outreach_agent' },
      { agent: marketingAgent, id: 'marketing_agent' },
      { agent: communityAgent, id: 'community_agent' },
      { agent: facilityAgent, id: 'facility_agent' },
      { agent: securityAgent, id: 'security_agent' },
      { agent: workflowAgent, id: 'workflow_agent' }
    ];
    
    for (const { agent, id } of allAgents) {
      // Register with event system
      this.eventSystem.registerAgent(id, {
        name: agent.name,
        type: agent.type,
        layer: agent.layer,
        capabilities: agent.capabilities
      });
      
      // Register with Heidi
      this.heidi.registerAgent(id, {
        name: agent.name,
        type: agent.type,
        capabilities: agent.capabilities,
        dependencies: agent.dependencies || [],
        priority: agent.priority || 3
      });
      
      // Store agent reference
      this.agents.set(id, agent);
      
      // Set up agent event handlers
      if (agent.on) {
        agent.on('status_change', (status) => {
          this.handleAgentStatusChange(id, status);
        });
      }
    }
    
    this.metrics.agentsActive = this.agents.size;
    
    console.log(`[PROTOFORGE INTEGRATION] Initialized ${this.agents.size} specialized agents`);
  }
  
  /**
   * Create simplified facility agent (still stub; can be promoted later)
   */
  createFacilityAgent() {
    return {
      name: 'Facility Agent',
      type: 'OPERATIONS',
      layer: 'E',
      capabilities: ['building_management', 'hvac_control', 'lighting_systems'],
      executeTask: async (task) => {
        return { success: true, result: `Facility task ${task.type} completed` };
      }
    };
  }

  /**
   * Set up communication channels between components
   */
  async setupCommunication() {
    // Heidi to Event System communication
    this.heidi.on('taskAssigned', async (data) => {
      await this.eventSystem.publishAgentEvent(data.agentId, 'task_assigned', {
        taskId: data.task.id,
        taskType: data.task.type,
        payload: data.task.payload
      });
    });
    
    // Event System to Agents communication
    this.eventSystem.on('agent_message', async (message) => {
      const agent = this.agents.get(message.agentId);
      if (agent && agent.executeTask) {
        try {
          const result = await agent.executeTask(message.envelope.event);
          
          // Publish result back to event system
          await this.eventSystem.publishAgentEvent(message.agentId, 'task_completed', {
            taskId: message.envelope.event.taskId,
            result,
            timestamp: Date.now()
          });
          
        } catch (error) {
          // Publish error back to event system
          await this.eventSystem.publishAgentEvent(message.agentId, 'task_failed', {
            taskId: message.envelope.event.taskId,
            error: error.message,
            timestamp: Date.now()
          }, { priority: 'high' });
        }
      }
    });
    
    console.log('[PROTOFORGE INTEGRATION] Communication channels established');
  }
  
  /**
   * Start system monitoring
   */
  async startMonitoring() {
    // System health monitoring
    setInterval(() => {
      this.checkSystemHealth();
    }, 30000); // Every 30 seconds
    
    // Metrics collection
    setInterval(() => {
      this.collectSystemMetrics();
    }, 10000); // Every 10 seconds
    
    console.log('[PROTOFORGE INTEGRATION] System monitoring started');
  }
  
  /**
   * Submit a task to the ProtoForge system
   */
  async submitTask(task) {
    if (!this.initialized) {
      throw new Error('ProtoForge not initialized');
    }
    
    console.log(`[PROTOFORGE INTEGRATION] Submitting task: ${task.type}`);
    
    // Submit to Heidi for routing
    const taskId = await this.heidi.submitTask(task);
    
    // Publish task submission event
    await this.eventSystem.publishSystemEvent('task_submitted', {
      taskId,
      taskType: task.type,
      submittedAt: Date.now()
    });
    
    return taskId;
  }
  
  /**
   * Get system status
   */
  getSystemStatus() {
    if (!this.initialized) {
      return { status: 'not_initialized' };
    }
    
    return {
      status: 'operational',
      uptime: Date.now() - this.startTime,
      autonomyLevel: this.getAutonomyLevelName(),
      heidi: this.heidi.getSystemStatus(),
      eventSystem: this.eventSystem.getSystemStatus(),
      agents: Array.from(this.agents.entries()).map(([id, agent]) => ({
        id,
        name: agent.name,
        type: agent.type,
        layer: agent.layer,
        status: 'active'
      })),
      metrics: this.metrics
    };
  }
  
  /**
   * Get autonomy level name
   */
  getAutonomyLevelName() {
    const levels = [
      'OBSERVE',
      'ASSIST',
      'EXECUTE_WITH_APPROVAL',
      'CONDITIONAL_AUTONOMY',
      'FULL_AUTONOMY'
    ];
    return levels[this.config.autonomyLevel] || 'UNKNOWN';
  }
  
  /**
   * Set autonomy level
   */
  setAutonomyLevel(level) {
    if (level < 0 || level > 4) {
      throw new Error('Autonomy level must be between 0 and 4');
    }
    
    this.config.autonomyLevel = level;
    this.heidi.setAutonomyLevel(level);
    
    console.log(`[PROTOFORGE INTEGRATION] Autonomy level set to: ${this.getAutonomyLevelName()}`);
  }
  
  /**
   * Handle task completion
   */
  handleTaskCompletion(data) {
    console.log(`[PROTOFORGE INTEGRATION] Task completed: ${data.task.id} by ${data.agent.name}`);
    
    // Publish completion event
    this.eventSystem.publishSystemEvent('task_completed', {
      taskId: data.task.id,
      agentId: data.agent.id,
      result: data.result,
      completedAt: Date.now()
    });
  }
  
  /**
   * Handle escalation required
   */
  handleEscalationRequired(escalation) {
    console.log(`[PROTOFORGE INTEGRATION] Escalation required: ${escalation.task.id}`);
    
    if (this.config.enableHumanApproval) {
      this.metrics.humanApprovals++;
      
      // In a real implementation, this would trigger a human approval workflow
      console.log(`[PROTOFORGE INTEGRATION] Human approval required for task: ${escalation.task.id}`);
      console.log(`[PROTOFORGE INTEGRATION] Recommendation: ${escalation.recommendation.action}`);
    }
  }
  
  /**
   * Handle agent message
   */
  handleAgentMessage(message) {
    // Log agent communication
    console.log(`[PROTOFORGE INTEGRATION] Agent message: ${message.agentName} -> ${message.envelope.topic}`);
  }
  
  /**
   * Handle conflict escalation
   */
  handleConflictEscalation(escalation) {
    console.log(`[PROTOFORGE INTEGRATION] Conflict escalation: ${escalation.conflict.type}`);
    
    // Publish conflict escalation event
    this.eventSystem.publishSystemEvent('conflict_escalation', {
      conflict: escalation.conflict,
      requiresHumanIntervention: escalation.requiresHumanIntervention,
      escalatedAt: Date.now()
    }, { priority: 'high' });
  }
  
  /**
   * Handle agent status change
   */
  handleAgentStatusChange(agentId, status) {
    console.log(`[PROTOFORGE INTEGRATION] Agent status change: ${agentId} -> ${status}`);
    
    // Update agent status in event system
    const currentStatus = this.eventSystem.agentStatus.get(agentId);
    this.eventSystem.agentStatus.set(agentId, status);
    
    // Publish status change event
    this.eventSystem.publishSystemEvent('agent_status_change', {
      agentId,
      previousStatus: currentStatus,
      newStatus: status,
      timestamp: Date.now()
    });
  }
  
  /**
   * Check system health
   */
  checkSystemHealth() {
    const health = {
      overall: 'healthy',
      heidi: this.heidi ? 'healthy' : 'unhealthy',
      eventSystem: this.eventSystem ? 'healthy' : 'unhealthy',
      agents: 'healthy',
      issues: []
    };
    
    // Check Heidi
    if (!this.heidi) {
      health.overall = 'unhealthy';
      health.issues.push('Heidi Executive Orchestrator not available');
    }
    
    // Check event system
    if (!this.eventSystem) {
      health.overall = 'unhealthy';
      health.issues.push('Event system not available');
    }
    
    // Check agent connectivity
    let activeAgents = 0;
    for (const [id, agent] of this.agents) {
      // In a real implementation, this would check agent heartbeats
      activeAgents++;
    }
    
    if (activeAgents < this.agents.size * 0.8) {
      health.agents = 'degraded';
      health.issues.push('Some agents not responding');
    }
    
    // Publish health status
    if (health.issues.length > 0) {
      this.eventSystem.publishSystemEvent('health_issue', {
        health,
        issues: health.issues,
        timestamp: Date.now()
      }, { priority: 'high' });
    }
    
    return health;
  }
  
  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    const metrics = {
      ...this.metrics,
      heidiMetrics: this.heidi ? this.heidi.metrics : null,
      eventSystemMetrics: this.eventSystem ? this.eventSystem.metrics : null,
      timestamp: Date.now()
    };
    
    // Publish metrics
    this.eventSystem.publishSystemEvent('system_metrics', metrics);
  }
  
  /**
   * Execute a ProtoForge scenario
   */
  async executeScenario(scenario) {
    console.log(`[PROTOFORGE INTEGRATION] Executing scenario: ${scenario.name}`);
    
    const results = [];
    
    for (const task of scenario.tasks) {
      try {
        const taskId = await this.submitTask(task);
        results.push({ taskId, status: 'submitted' });
        
        // Wait for task completion if specified
        if (task.waitForCompletion) {
          await this.waitForTaskCompletion(taskId, task.timeout || 30000);
        }
        
      } catch (error) {
        results.push({ task: task.type, status: 'failed', error: error.message });
      }
    }
    
    return {
      scenario: scenario.name,
      results,
      completedAt: Date.now()
    };
  }
  
  /**
   * Wait for task completion
   */
  async waitForTaskCompletion(taskId, timeout) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkCompletion = () => {
        // Check if task is completed
        const taskStatus = this.heidi.activeTasks.get(taskId);
        
        if (!taskStatus) {
          resolve(); // Task completed
          return;
        }
        
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Task ${taskId} timeout`));
          return;
        }
        
        setTimeout(checkCompletion, 1000);
      };
      
      checkCompletion();
    });
  }
  
  /**
   * Get detailed agent status
   */
  getAgentStatus(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    return {
      id: agentId,
      name: agent.name,
      type: agent.type,
      layer: agent.layer,
      capabilities: agent.capabilities,
      status: this.eventSystem.agentStatus.get(agentId),
      eventSystemStatus: this.eventSystem.agents.get(agentId),
      heidiStatus: this.heidi.agents.get(agentId)
    };
  }
  
  /**
   * Get system events
   */
  getEvents(options = {}) {
    if (!this.eventSystem) {
      return [];
    }
    
    if (options.topic) {
      return this.eventSystem.getTopicEvents(options.topic, options);
    }
    
    if (options.agentId) {
      return this.eventSystem.getAgentEvents(options.agentId, options);
    }
    
    // Get all recent events
    const allEvents = [];
    for (const topic of this.eventSystem.eventStreams.keys()) {
      const topicEvents = this.eventSystem.getTopicEvents(topic, { limit: 50 });
      allEvents.push(...topicEvents);
    }
    
    // Sort by timestamp (newest first) and limit
    allEvents.sort((a, b) => b.timestamp - a.timestamp);
    
    if (options.limit) {
      return allEvents.slice(0, options.limit);
    }
    
    return allEvents;
  }
  
  /**
   * Shutdown the ProtoForge system
   */
  async shutdown() {
    console.log('[PROTOFORGE INTEGRATION] Shutting down ProtoForge system...');
    
    try {
      // Shutdown event system first
      if (this.eventSystem) {
        await this.eventSystem.shutdown();
      }
      
      // Clear agent references
      this.agents.clear();
      
      // Clear Heidi
      this.heidi = null;
      this.eventSystem = null;
      
      this.initialized = false;
      
      console.log('[PROTOFORGE INTEGRATION] ProtoForge system shutdown complete');
      
    } catch (error) {
      console.error('[PROTOFORGE INTEGRATION] Shutdown error:', error);
      throw error;
    }
  }
}

module.exports = ProtoForgeIntegration;
