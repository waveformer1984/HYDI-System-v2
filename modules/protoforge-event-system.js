/**
 * ProtoForge Event System - Multi-Agent Communication Backbone
 * 
 * Event-driven system that enables the 15 specialized agents to communicate:
 * - Kafka/Redis Streams style event bus
 * - Structured message format
 * - Priority queuing
 * - Conflict resolution
 * - Message persistence
 * - Performance monitoring
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class ProtoForgeEventSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxQueueSize: 10000,
      retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
      batchSize: 100,
      flushInterval: 1000, // 1 second
      ...config
    };
    
    // Event storage
    this.eventStreams = new Map(); // topic -> events
    this.agentSubscriptions = new Map(); // agentId -> subscriptions
    this.messageQueue = []; // priority queue
    this.deadLetterQueue = [];
    
    // Agent registry
    this.agents = new Map();
    this.agentStatus = new Map();
    
    // Performance metrics
    this.metrics = {
      eventsPublished: 0,
      eventsProcessed: 0,
      eventsFailed: 0,
      averageLatency: 0,
      throughput: 0,
      queueDepth: 0,
      deadLetterCount: 0
    };
    
    // Conflict tracking
    this.conflicts = new Map();
    this.resolutionHistory = [];
    
    // Start background processing
    this.startEventProcessor();
    this.startMetricsCollector();
    this.startCleanupTask();
    
    console.log('[PROTOFORGE EVENT SYSTEM] Initialized');
    console.log(`[PROTOFORGE EVENT SYSTEM] Config: maxQueue=${this.config.maxQueueSize}, retention=${this.config.retentionPeriod}ms`);
  }
  
  /**
   * Register an agent with the event system
   */
  registerAgent(agentId, agentConfig) {
    const agent = {
      id: agentId,
      name: agentConfig.name,
      type: agentConfig.type,
      layer: agentConfig.layer,
      capabilities: agentConfig.capabilities || [],
      subscriptions: new Set(),
      lastHeartbeat: Date.now(),
      messageCount: 0,
      errorCount: 0
    };
    
    this.agents.set(agentId, agent);
    this.agentStatus.set(agentId, 'active');
    
    console.log(`[EVENT SYSTEM] Agent registered: ${agent.name} (${agent.type})`);
    
    // Set up default subscriptions based on agent type
    this.setupDefaultSubscriptions(agentId);
  }
  
  /**
   * Set up default subscriptions for an agent based on its type
   */
  setupDefaultSubscriptions(agentId) {
    const agent = this.agents.get(agentId);
    
    const defaultSubscriptions = {
      STRATEGIC: [
        'system.strategy.request',
        'system.strategy.update',
        'system.architecture.change',
        'system.resource.allocation'
      ],
      EXECUTION: [
        'system.execution.request',
        'system.execution.status',
        'system.resource.availability',
        'system.timeline.update'
      ],
      BUSINESS: [
        'system.budget.update',
        'system.revenue.report',
        'system.funding.opportunity',
        'system.financial.forecast'
      ],
      OUTREACH: [
        'system.partnership.request',
        'system.marketing.campaign',
        'system.community.update',
        'system.brand.milestone'
      ],
      OPERATIONS: [
        'system.operations.status',
        'system.facility.alert',
        'system.security.incident',
        'system.workflow.optimization'
      ]
    };
    
    const subscriptions = defaultSubscriptions[agent.type] || ['system.general'];
    
    subscriptions.forEach(topic => {
      this.subscribe(agentId, topic);
    });
  }
  
  /**
   * Subscribe an agent to a topic
   */
  subscribe(agentId, topic) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    // Create topic stream if it doesn't exist
    if (!this.eventStreams.has(topic)) {
      this.eventStreams.set(topic, []);
    }
    
    // Add subscription
    agent.subscriptions.add(topic);
    
    // Update subscription registry
    if (!this.agentSubscriptions.has(topic)) {
      this.agentSubscriptions.set(topic, new Set());
    }
    this.agentSubscriptions.get(topic).add(agentId);
    
    console.log(`[EVENT SYSTEM] ${agent.name} subscribed to: ${topic}`);
  }
  
  /**
   * Publish an event to the system
   */
  async publish(topic, event, options = {}) {
    const eventId = uuidv4();
    const timestamp = Date.now();
    
    const envelope = {
      id: eventId,
      topic,
      event,
      priority: options.priority || 'normal',
      timestamp,
      publisher: options.publisher || 'system',
      correlationId: options.correlationId || null,
      retryCount: 0,
      maxRetries: options.maxRetries || 3,
      ttl: options.ttl || (24 * 60 * 60 * 1000), // 24 hours default
      metadata: options.metadata || {}
    };
    
    // Validate event structure
    if (!this.validateEvent(envelope)) {
      throw new Error('Invalid event structure');
    }
    
    // Add to appropriate stream
    if (!this.eventStreams.has(topic)) {
      this.eventStreams.set(topic, []);
    }
    
    this.eventStreams.get(topic).push(envelope);
    
    // Add to priority queue
    this.addToQueue(envelope);
    
    // Update metrics
    this.metrics.eventsPublished++;
    this.metrics.queueDepth = this.messageQueue.length;
    
    // Emit event for immediate processing
    this.emit('event_published', envelope);
    
    console.log(`[EVENT SYSTEM] Published: ${topic} [${eventId.substring(0, 8)}] from ${envelope.publisher}`);
    
    return eventId;
  }
  
  /**
   * Validate event structure
   */
  validateEvent(envelope) {
    const required = ['id', 'topic', 'event', 'timestamp', 'priority'];
    
    for (const field of required) {
      if (!(field in envelope)) {
        return false;
      }
    }
    
    // Validate priority
    const validPriorities = ['low', 'normal', 'high', 'critical'];
    if (!validPriorities.includes(envelope.priority)) {
      return false;
    }
    
    // Validate topic format
    if (typeof envelope.topic !== 'string' || envelope.topic.length === 0) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Add event to priority queue
   */
  addToQueue(envelope) {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const priority = priorityOrder[envelope.priority] || 2;
    
    // Find insertion point based on priority and timestamp
    let insertIndex = this.messageQueue.length;
    
    for (let i = 0; i < this.messageQueue.length; i++) {
      const itemPriority = priorityOrder[this.messageQueue[i].priority] || 2;
      
      if (priority < itemPriority || 
          (priority === itemPriority && envelope.timestamp < this.messageQueue[i].timestamp)) {
        insertIndex = i;
        break;
      }
    }
    
    this.messageQueue.splice(insertIndex, 0, envelope);
    
    // Check queue size limit
    if (this.messageQueue.length > this.config.maxQueueSize) {
      // Remove oldest low priority events
      const removed = this.messageQueue.splice(this.config.maxQueueSize);
      this.deadLetterQueue.push(...removed);
      this.metrics.deadLetterCount += removed.length;
    }
  }
  
  /**
   * Start background event processor
   */
  startEventProcessor() {
    setInterval(() => {
      this.processBatch();
    }, this.config.flushInterval);
  }
  
  /**
   * Process a batch of events
   */
  async processBatch() {
    if (this.messageQueue.length === 0) return;
    
    const batchSize = Math.min(this.config.batchSize, this.messageQueue.length);
    const batch = this.messageQueue.splice(0, batchSize);
    
    const processingPromises = batch.map(envelope => this.processEvent(envelope));
    
    try {
      const results = await Promise.allSettled(processingPromises);
      
      results.forEach((result, index) => {
        const envelope = batch[index];
        
        if (result.status === 'rejected') {
          this.handleProcessingFailure(envelope, result.reason);
        } else {
          this.metrics.eventsProcessed++;
        }
      });
      
      this.metrics.queueDepth = this.messageQueue.length;
      
    } catch (error) {
      console.error('[EVENT SYSTEM] Batch processing error:', error);
    }
  }
  
  /**
   * Process a single event
   */
  async processEvent(envelope) {
    const startTime = Date.now();
    
    try {
      // Check TTL
      if (Date.now() - envelope.timestamp > envelope.ttl) {
        throw new Error('Event expired');
      }
      
      // Find subscribers
      const subscribers = this.agentSubscriptions.get(envelope.topic) || new Set();
      
      if (subscribers.size === 0) {
        console.warn(`[EVENT SYSTEM] No subscribers for topic: ${envelope.topic}`);
        return;
      }
      
      // Check for conflicts
      const conflict = this.detectConflict(envelope);
      if (conflict) {
        await this.resolveConflict(conflict);
      }
      
      // Deliver to subscribers
      const deliveryPromises = [];
      
      for (const agentId of subscribers) {
        const agent = this.agents.get(agentId);
        
        if (agent && this.agentStatus.get(agentId) === 'active') {
          deliveryPromises.push(this.deliverToAgent(agent, envelope));
        }
      }
      
      await Promise.allSettled(deliveryPromises);
      
      // Update latency metrics
      const latency = Date.now() - startTime;
      this.updateLatencyMetrics(latency);
      
      console.log(`[EVENT SYSTEM] Processed: ${envelope.topic} [${envelope.id.substring(0, 8)}] in ${latency}ms`);
      
    } catch (error) {
      console.error(`[EVENT SYSTEM] Processing failed: ${envelope.id}`, error);
      throw error;
    }
  }
  
  /**
   * Deliver event to a specific agent
   */
  async deliverToAgent(agent, envelope) {
    try {
      // Update agent metrics
      agent.messageCount++;
      agent.lastHeartbeat = Date.now();
      
      // Emit event to agent
      this.emit('agent_message', {
        agentId: agent.id,
        agentName: agent.name,
        envelope
      });
      
      // In a real implementation, this would call the agent's message handler
      // For now, we just emit the event
      
    } catch (error) {
      agent.errorCount++;
      console.error(`[EVENT SYSTEM] Delivery failed to ${agent.name}:`, error);
      throw error;
    }
  }
  
  /**
   * Detect conflicts between events
   */
  detectConflict(envelope) {
    // Check for resource conflicts
    if (envelope.event.resource) {
      const resourceKey = `${envelope.event.resource}_${envelope.event.action}`;
      
      if (this.conflicts.has(resourceKey)) {
        return {
          type: 'resource_conflict',
          resource: envelope.event.resource,
          action: envelope.event.action,
          events: [this.conflicts.get(resourceKey), envelope],
          timestamp: Date.now()
        };
      }
      
      this.conflicts.set(resourceKey, envelope);
      
      // Auto-clear conflict after timeout
      setTimeout(() => {
        this.conflicts.delete(resourceKey);
      }, 30000); // 30 seconds
    }
    
    return null;
  }
  
  /**
   * Resolve conflicts between events
   */
  async resolveConflict(conflict) {
    const resolution = {
      id: uuidv4(),
      conflict,
      strategy: this.selectResolutionStrategy(conflict),
      resolved: false,
      timestamp: Date.now()
    };
    
    switch (resolution.strategy) {
      case 'priority_based':
        resolution.resolved = this.resolveByPriority(conflict);
        break;
      
      case 'timestamp_based':
        resolution.resolved = this.resolveByTimestamp(conflict);
        break;
      
      case 'escalate':
        await this.escalateConflict(conflict);
        resolution.resolved = true;
        break;
    }
    
    this.resolutionHistory.push(resolution);
    
    console.log(`[EVENT SYSTEM] Conflict resolved: ${conflict.type} using ${resolution.strategy}`);
    
    this.emit('conflict_resolved', resolution);
  }
  
  /**
   * Select conflict resolution strategy
   */
  selectResolutionStrategy(conflict) {
    const priorities = conflict.events.map(e => e.priority);
    const hasCritical = priorities.includes('critical');
    const hasHigh = priorities.includes('high');
    
    if (hasCritical && hasHigh) {
      return 'priority_based';
    }
    
    if (conflict.events.length > 2) {
      return 'escalate';
    }
    
    return 'timestamp_based';
  }
  
  /**
   * Resolve conflict by priority
   */
  resolveByPriority(conflict) {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    
    conflict.events.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] || 2;
      const bPriority = priorityOrder[b.priority] || 2;
      return aPriority - bPriority;
    });
    
    // Keep the highest priority event, reject others
    const winner = conflict.events[0];
    const losers = conflict.events.slice(1);
    
    losers.forEach(loser => {
      this.moveToDeadLetter(loser, 'conflict_resolution');
    });
    
    return true;
  }
  
  /**
   * Resolve conflict by timestamp (first come, first served)
   */
  resolveByTimestamp(conflict) {
    conflict.events.sort((a, b) => a.timestamp - b.timestamp);
    
    // Keep the earliest event, reject others
    const winner = conflict.events[0];
    const losers = conflict.events.slice(1);
    
    losers.forEach(loser => {
      this.moveToDeadLetter(loser, 'conflict_resolution');
    });
    
    return true;
  }
  
  /**
   * Escalate conflict for human resolution
   */
  async escalateConflict(conflict) {
    this.emit('conflict_escalation', {
      conflict,
      requiresHumanIntervention: true,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle processing failure
   */
  handleProcessingFailure(envelope, error) {
    envelope.retryCount++;
    
    if (envelope.retryCount < envelope.maxRetries) {
      // Retry with exponential backoff
      const delay = Math.pow(2, envelope.retryCount) * 1000;
      
      setTimeout(() => {
        this.addToQueue(envelope);
      }, delay);
      
      console.log(`[EVENT SYSTEM] Retrying event: ${envelope.id} (attempt ${envelope.retryCount})`);
      
    } else {
      // Move to dead letter queue
      this.moveToDeadLetter(envelope, error.message);
      this.metrics.eventsFailed++;
    }
  }
  
  /**
   * Move event to dead letter queue
   */
  moveToDeadLetter(envelope, reason) {
    const deadLetter = {
      ...envelope,
      deadLetterReason: reason,
      deadLetterTimestamp: Date.now()
    };
    
    this.deadLetterQueue.push(deadLetter);
    this.metrics.deadLetterCount++;
    
    console.warn(`[EVENT SYSTEM] Event moved to dead letter: ${envelope.id} - ${reason}`);
  }
  
  /**
   * Update latency metrics
   */
  updateLatencyMetrics(latency) {
    const alpha = 0.1; // Exponential moving average factor
    this.metrics.averageLatency = this.metrics.averageLatency * (1 - alpha) + latency * alpha;
  }
  
  /**
   * Start metrics collector
   */
  startMetricsCollector() {
    setInterval(() => {
      this.collectMetrics();
    }, 10000); // Every 10 seconds
  }
  
  /**
   * Collect system metrics
   */
  collectMetrics() {
    const now = Date.now();
    const timeWindow = 10000; // 10 seconds
    
    // Calculate throughput
    const recentEvents = this.getRecentEvents(timeWindow);
    this.metrics.throughput = recentEvents.length / (timeWindow / 1000); // events per second
    
    // Update queue depth
    this.metrics.queueDepth = this.messageQueue.length;
    
    // Emit metrics
    this.emit('metrics', this.metrics);
  }
  
  /**
   * Get recent events
   */
  getRecentEvents(timeWindow) {
    const cutoff = Date.now() - timeWindow;
    const recent = [];
    
    for (const stream of this.eventStreams.values()) {
      recent.push(...stream.filter(event => event.timestamp >= cutoff));
    }
    
    return recent;
  }
  
  /**
   * Start cleanup task
   */
  startCleanupTask() {
    setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
  }
  
  /**
   * Cleanup old events and dead letters
   */
  cleanup() {
    const cutoff = Date.now() - this.config.retentionPeriod;
    let cleaned = 0;
    
    // Clean event streams
    for (const [topic, stream] of this.eventStreams.entries()) {
      const originalLength = stream.length;
      this.eventStreams.set(topic, stream.filter(event => event.timestamp >= cutoff));
      cleaned += originalLength - stream.length;
    }
    
    // Clean dead letter queue
    const originalDeadLength = this.deadLetterQueue.length;
    this.deadLetterQueue = this.deadLetterQueue.filter(event => event.deadLetterTimestamp >= cutoff);
    cleaned += originalDeadLength - this.deadLetterQueue.length;
    
    if (cleaned > 0) {
      console.log(`[EVENT SYSTEM] Cleaned up ${cleaned} old events`);
    }
  }
  
  /**
   * Get system status
   */
  getSystemStatus() {
    return {
      agents: Array.from(this.agents.values()).map(agent => ({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        status: this.agentStatus.get(agent.id),
        subscriptions: Array.from(agent.subscriptions),
        messageCount: agent.messageCount,
        errorCount: agent.errorCount,
        lastHeartbeat: agent.lastHeartbeat
      })),
      topics: Array.from(this.eventStreams.keys()).map(topic => ({
        name: topic,
        eventCount: this.eventStreams.get(topic).length,
        subscriberCount: this.agentSubscriptions.get(topic)?.size || 0
      })),
      queue: {
        depth: this.messageQueue.length,
        maxSize: this.config.maxQueueSize,
        oldestEvent: this.messageQueue.length > 0 ? this.messageQueue[0].timestamp : null
      },
      deadLetterQueue: {
        count: this.deadLetterQueue.length,
        recentReasons: this.getRecentDeadLetterReasons()
      },
      conflicts: {
        active: this.conflicts.size,
        resolved: this.resolutionHistory.length,
        recentResolutions: this.resolutionHistory.slice(-10)
      },
      metrics: this.metrics
    };
  }
  
  /**
   * Get recent dead letter reasons
   */
  getRecentDeadLetterReasons() {
    const recent = this.deadLetterQueue.slice(-10);
    const reasons = {};
    
    recent.forEach(event => {
      const reason = event.deadLetterReason || 'unknown';
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
    
    return reasons;
  }
  
  /**
   * Get events for a specific topic
   */
  getTopicEvents(topic, options = {}) {
    const stream = this.eventStreams.get(topic) || [];
    let events = [...stream];
    
    // Apply filters
    if (options.since) {
      events = events.filter(event => event.timestamp >= options.since);
    }
    
    if (options.until) {
      events = events.filter(event => event.timestamp <= options.until);
    }
    
    if (options.priority) {
      events = events.filter(event => event.priority === options.priority);
    }
    
    if (options.publisher) {
      events = events.filter(event => event.publisher === options.publisher);
    }
    
    // Sort by timestamp (newest first)
    events.sort((a, b) => b.timestamp - a.timestamp);
    
    // Limit results
    if (options.limit) {
      events = events.slice(0, options.limit);
    }
    
    return events;
  }
  
  /**
   * Get agent-specific events
   */
  getAgentEvents(agentId, options = {}) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    const allEvents = [];
    
    // Get events from all subscribed topics
    for (const topic of agent.subscriptions) {
      const topicEvents = this.getTopicEvents(topic, options);
      allEvents.push(...topicEvents);
    }
    
    // Sort by timestamp (newest first)
    allEvents.sort((a, b) => b.timestamp - a.timestamp);
    
    // Limit results
    if (options.limit) {
      return allEvents.slice(0, options.limit);
    }
    
    return allEvents;
  }
  
  /**
   * Publish a system event
   */
  publishSystemEvent(eventType, payload, options = {}) {
    const topic = `system.${eventType}`;
    
    return this.publish(topic, payload, {
      ...options,
      publisher: 'system',
      priority: options.priority || 'normal'
    });
  }
  
  /**
   * Publish an agent event
   */
  publishAgentEvent(agentId, eventType, payload, options = {}) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    const topic = `agent.${agent.type.toLowerCase()}.${eventType}`;
    
    return this.publish(topic, payload, {
      ...options,
      publisher: agent.name,
      priority: options.priority || 'normal'
    });
  }
  
  /**
   * Create a correlation group for related events
   */
  createCorrelationGroup(events) {
    const correlationId = uuidv4();
    
    const publishPromises = events.map(({ topic, event, options }) => 
      this.publish(topic, event, {
        ...options,
        correlationId
      })
    );
    
    return Promise.all(publishPromises);
  }
  
  /**
   * Shutdown the event system
   */
  async shutdown() {
    console.log('[EVENT SYSTEM] Shutting down...');
    
    // Process remaining events
    while (this.messageQueue.length > 0) {
      await this.processBatch();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Emit shutdown event
    await this.publishSystemEvent('shutdown', {
      timestamp: Date.now(),
      metrics: this.metrics
    }, { priority: 'high' });
    
    console.log('[EVENT SYSTEM] Shutdown complete');
  }
}

module.exports = ProtoForgeEventSystem;
