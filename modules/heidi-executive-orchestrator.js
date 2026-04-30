/**
 * Heidi Executive Orchestrator - ProtoForge PAO Central Controller
 * 
 * The master decision engine that:
 * - Routes tasks to specialized agents
 * - Manages priority queues
 * - Resolves agent conflicts
 * - Makes strategic decisions
 * - Escalates high-risk decisions for human approval
 */

const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class HeidiExecutiveOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxConcurrentTasks: 10,
      conflictResolutionTimeout: 30000,
      escalationThreshold: 0.8,
      autonomyLevel: 2, // Default: EXECUTE_WITH_APPROVAL
      ...config
    };
    
    // Agent registry - all 15 specialized agents
    this.agents = new Map();
    this.agentStatus = new Map();
    
    // Task management
    this.taskQueue = [];
    this.activeTasks = new Map();
    this.completedTasks = [];
    
    // Priority system
    this.priorities = {
      CRITICAL: 1,
      HIGH: 2,
      MEDIUM: 3,
      LOW: 4,
      BACKGROUND: 5
    };
    
    // Conflict tracking
    this.conflicts = new Map();
    this.resolutionHistory = [];
    
    // Strategic planning
    this.strategicPlan = null;
    this.objectives = [];
    
    // Human approval queue
    this.approvalQueue = [];
    this.approvalHistory = [];
    
    // System metrics
    this.metrics = {
      tasksProcessed: 0,
      conflictsResolved: 0,
      escalations: 0,
      agentUptime: new Map(),
      decisionLatency: []
    };
    
    console.log('[HEIDI EXEC] Executive Orchestrator initialized');
    console.log(`[HEIDI EXEC] Autonomy Level: ${this.getAutonomyLevelName()}`);
    console.log(`[HEIDI EXEC] Max Concurrent Tasks: ${this.config.maxConcurrentTasks}`);
  }
  
  /**
   * Register a specialized agent
   */
  registerAgent(agentId, agentConfig) {
    const agent = {
      id: agentId,
      name: agentConfig.name,
      type: agentConfig.type, // STRATEGIC, EXECUTION, BUSINESS, OUTREACH, OPERATIONS
      capabilities: agentConfig.capabilities || [],
      dependencies: agentConfig.dependencies || [],
      priority: agentConfig.priority || this.priorities.MEDIUM,
      status: 'idle',
      lastHeartbeat: Date.now(),
      taskHistory: [],
      performance: {
        tasksCompleted: 0,
        averageCompletionTime: 0,
        successRate: 1.0
      }
    };
    
    this.agents.set(agentId, agent);
    this.agentStatus.set(agentId, 'idle');
    
    console.log(`[HEIDI EXEC] Agent registered: ${agent.name} (${agent.type})`);
    
    // Start heartbeat monitoring
    this.startAgentHeartbeat(agentId);
  }
  
  /**
   * Submit task to the orchestrator
   */
  async submitTask(task) {
    const taskId = uuidv4();
    
    const enrichedTask = {
      id: taskId,
      type: task.type,
      priority: task.priority || this.priorities.MEDIUM,
      payload: task.payload,
      requirements: task.requirements || [],
      constraints: task.constraints || [],
      submittedAt: Date.now(),
      status: 'queued',
      assignedAgent: null,
      dependencies: task.dependencies || [],
      escalationLevel: 0
    };
    
    // Add to queue with priority sorting
    this.taskQueue.push(enrichedTask);
    this.taskQueue.sort((a, b) => a.priority - b.priority);
    
    console.log(`[HEIDI EXEC] Task submitted: ${task.type} [${taskId.substring(0, 8)}]`);
    
    // Try to process immediately
    this.processTaskQueue();
    
    return taskId;
  }
  
  /**
   * Process the task queue and assign to agents
   */
  async processTaskQueue() {
    while (this.activeTasks.size < this.config.maxConcurrentTasks && this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      
      // Find best agent for this task
      const agentId = this.findBestAgent(task);
      
      if (agentId) {
        await this.assignTaskToAgent(task, agentId);
      } else {
        // No suitable agent available - put back in queue
        this.taskQueue.unshift(task);
        break;
      }
    }
  }
  
  /**
   * Find the best agent for a task based on capabilities and availability
   */
  findBestAgent(task) {
    let bestAgent = null;
    let bestScore = -1;
    
    for (const [agentId, agent] of this.agents) {
      if (agent.status !== 'idle') continue;
      
      // Check capability match
      const capabilityMatch = this.calculateCapabilityMatch(agent, task);
      if (capabilityMatch === 0) continue;
      
      // Check dependencies
      if (!this.checkDependencies(agent, task)) continue;
      
      // Calculate overall score
      const score = capabilityMatch * agent.performance.successRate;
      
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agentId;
      }
    }
    
    return bestAgent;
  }
  
  /**
   * Calculate how well an agent's capabilities match task requirements
   */
  calculateCapabilityMatch(agent, task) {
    if (!task.requirements || task.requirements.length === 0) {
      return 0.5; // Neutral score for no requirements
    }
    
    const matches = task.requirements.filter(req => 
      agent.capabilities.includes(req)
    ).length;
    
    return matches / task.requirements.length;
  }
  
  /**
   * Check if agent dependencies are satisfied
   */
  checkDependencies(agent, task) {
    return task.dependencies.every(dep => agent.dependencies.includes(dep));
  }
  
  /**
   * Assign task to agent and execute
   */
  async assignTaskToAgent(task, agentId) {
    const agent = this.agents.get(agentId);
    
    task.assignedAgent = agentId;
    task.status = 'assigned';
    task.assignedAt = Date.now();
    
    agent.status = 'busy';
    agent.currentTask = task;
    
    this.activeTasks.set(task.id, { task, agentId });
    
    console.log(`[HEIDI EXEC] Task ${task.id.substring(0, 8)} assigned to ${agent.name}`);
    
    try {
      // Execute task through agent
      const result = await this.executeAgentTask(agent, task);
      
      // Handle completion
      this.handleTaskCompletion(task, agent, result);
      
    } catch (error) {
      // Handle failure
      this.handleTaskFailure(task, agent, error);
    }
  }
  
  /**
   * Execute task through agent
   */
  async executeAgentTask(agent, task) {
    // This would interface with the actual agent implementation
    // For now, simulate execution
    
    const executionTime = Math.random() * 5000 + 1000; // 1-6 seconds
    await new Promise(resolve => setTimeout(resolve, executionTime));
    
    // Simulate success/failure based on agent performance
    const success = Math.random() < agent.performance.successRate;
    
    if (!success) {
      throw new Error(`Agent ${agent.name} failed to execute task`);
    }
    
    return {
      success: true,
      executionTime,
      output: `Task ${task.type} completed by ${agent.name}`,
      artifacts: []
    };
  }
  
  /**
   * Handle successful task completion
   */
  handleTaskCompletion(task, agent, result) {
    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;
    
    agent.status = 'idle';
    agent.currentTask = null;
    agent.taskHistory.push(task);
    agent.performance.tasksCompleted++;
    agent.performance.averageCompletionTime = 
      (agent.performance.averageCompletionTime * (agent.performance.tasksCompleted - 1) + result.executionTime) / 
      agent.performance.tasksCompleted;
    
    this.activeTasks.delete(task.id);
    this.completedTasks.push(task);
    this.metrics.tasksProcessed++;
    
    console.log(`[HEIDI EXEC] Task ${task.id.substring(0, 8)} completed by ${agent.name}`);
    
    // Emit event for other systems
    this.emit('taskCompleted', { task, agent, result });
    
    // Process next task in queue
    this.processTaskQueue();
  }
  
  /**
   * Handle task failure
   */
  async handleTaskFailure(task, agent, error) {
    task.status = 'failed';
    task.failedAt = Date.now();
    task.error = error.message;
    
    agent.status = 'idle';
    agent.currentTask = null;
    agent.taskHistory.push(task);
    agent.performance.successRate = Math.max(0.1, agent.performance.successRate - 0.1);
    
    this.activeTasks.delete(task.id);
    
    console.error(`[HEIDI EXEC] Task ${task.id.substring(0, 8)} failed: ${error.message}`);
    
    // Check if task should be escalated
    if (task.escalationLevel < 3) {
      task.escalationLevel++;
      task.status = 'queued';
      this.taskQueue.push(task);
      console.log(`[HEIDI EXEC] Task escalated to level ${task.escalationLevel}`);
    } else {
      // Max escalation reached - require human approval
      await this.escalateToHuman(task, agent, error);
    }
    
    // Process next task
    this.processTaskQueue();
  }
  
  /**
   * Escalate task to human for approval
   */
  async escalateToHuman(task, agent, error) {
    const escalation = {
      id: uuidv4(),
      taskId: task.id,
      task: task,
      agent: agent,
      error: error,
      escalatedAt: Date.now(),
      status: 'pending_approval',
      recommendation: this.generateEscalationRecommendation(task, agent, error)
    };
    
    this.approvalQueue.push(escalation);
    this.metrics.escalations++;
    
    console.log(`[HEIDI EXEC] Task ${task.id.substring(0, 8)} escalated for human approval`);
    
    this.emit('escalationRequired', escalation);
  }
  
  /**
   * Generate recommendation for escalated task
   */
  generateEscalationRecommendation(task, agent, error) {
    return {
      action: 'retry_with_different_agent',
      reason: `Agent ${agent.name} failed after ${task.escalationLevel} attempts`,
      alternativeAgents: this.findAlternativeAgents(task, agent.id),
      estimatedSuccess: 0.7
    };
  }
  
  /**
   * Find alternative agents for a task
   */
  findAlternativeAgents(task, excludeAgentId) {
    const alternatives = [];
    
    for (const [agentId, agent] of this.agents) {
      if (agentId === excludeAgentId) continue;
      if (agent.status !== 'idle') continue;
      
      const capabilityMatch = this.calculateCapabilityMatch(agent, task);
      if (capabilityMatch > 0.3) {
        alternatives.push({
          agentId,
          name: agent.name,
          matchScore: capabilityMatch,
          successRate: agent.performance.successRate
        });
      }
    }
    
    return alternatives.sort((a, b) => b.matchScore * b.successRate - a.matchScore * a.successRate);
  }
  
  /**
   * Handle human approval response
   */
  async handleHumanApproval(escalationId, approved, action) {
    const escalation = this.approvalQueue.find(e => e.id === escalationId);
    if (!escalation) return;
    
    escalation.status = approved ? 'approved' : 'rejected';
    escalation.approvedAt = Date.now();
    escalation.humanAction = action;
    
    this.approvalHistory.push(escalation);
    this.approvalQueue = this.approvalQueue.filter(e => e.id !== escalationId);
    
    if (approved) {
      // Execute human's chosen action
      await this.executeHumanAction(escalation, action);
    }
    
    this.emit('approvalProcessed', escalation);
  }
  
  /**
   * Execute action chosen by human
   */
  async executeHumanAction(escalation, action) {
    const { task } = escalation;
    
    switch (action) {
      case 'retry_with_different_agent':
        const alternativeAgent = this.findAlternativeAgents(task, task.assignedAgent)[0];
        if (alternativeAgent) {
          await this.assignTaskToAgent(task, alternativeAgent.agentId);
        }
        break;
      
      case 'modify_task':
        // Task modification logic here
        break;
      
      case 'cancel_task':
        task.status = 'cancelled';
        break;
      
      default:
        console.warn(`[HEIDI EXEC] Unknown human action: ${action}`);
    }
  }
  
  /**
   * Detect and resolve conflicts between agents
   */
  detectConflict(agent1Id, agent2Id, resource) {
    const conflictId = `${agent1Id}-${agent2Id}-${resource}`;
    
    if (this.conflicts.has(conflictId)) {
      return this.conflicts.get(conflictId);
    }
    
    const conflict = {
      id: conflictId,
      agents: [agent1Id, agent2Id],
      resource: resource,
      detectedAt: Date.now(),
      status: 'active',
      resolution: null
    };
    
    this.conflicts.set(conflictId, conflict);
    
    // Auto-resolve based on priorities
    this.resolveConflict(conflict);
    
    return conflict;
  }
  
  /**
   * Resolve conflict between agents
   */
  resolveConflict(conflict) {
    const [agent1Id, agent2Id] = conflict.agents;
    const agent1 = this.agents.get(agent1Id);
    const agent2 = this.agents.get(agent2Id);
    
    // Simple priority-based resolution
    const winner = agent1.priority <= agent2.priority ? agent1 : agent2;
    const loser = winner.id === agent1Id ? agent2 : agent1;
    
    conflict.resolution = {
      winner: winner.id,
      loser: loser.id,
      strategy: 'priority_based',
      resolvedAt: Date.now()
    };
    
    conflict.status = 'resolved';
    this.metrics.conflictsResolved++;
    
    console.log(`[HEIDI EXEC] Conflict resolved: ${winner.name} wins over ${loser.name}`);
    
    this.emit('conflictResolved', conflict);
  }
  
  /**
   * Set autonomy level
   */
  setAutonomyLevel(level) {
    if (level < 0 || level > 4) {
      throw new Error('Autonomy level must be between 0 and 4');
    }
    
    this.config.autonomyLevel = level;
    console.log(`[HEIDI EXEC] Autonomy level changed to: ${this.getAutonomyLevelName()}`);
    
    this.emit('autonomyLevelChanged', { level, name: this.getAutonomyLevelName() });
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
   * Start heartbeat monitoring for agent
   */
  startAgentHeartbeat(agentId) {
    setInterval(() => {
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.lastHeartbeat = Date.now();
        
        // Update uptime metrics
        if (!this.metrics.agentUptime.has(agentId)) {
          this.metrics.agentUptime.set(agentId, 0);
        }
        this.metrics.agentUptime.set(agentId, 
          this.metrics.agentUptime.get(agentId) + 1);
      }
    }, 1000); // 1 second heartbeat
  }
  
  /**
   * Get system status
   */
  getSystemStatus() {
    return {
      autonomyLevel: this.config.autonomyLevel,
      autonomyLevelName: this.getAutonomyLevelName(),
      agents: Array.from(this.agents.values()).map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        status: a.status,
        performance: a.performance
      })),
      tasks: {
        queued: this.taskQueue.length,
        active: this.activeTasks.size,
        completed: this.completedTasks.length
      },
      conflicts: {
        active: Array.from(this.conflicts.values()).filter(c => c.status === 'active').length,
        resolved: this.metrics.conflictsResolved
      },
      approvals: {
        pending: this.approvalQueue.length,
        processed: this.approvalHistory.length
      },
      metrics: this.metrics
    };
  }
}

module.exports = HeidiExecutiveOrchestrator;
