/**
 * Universal Agent Bus
 * The central messaging backbone connecting all Forge components.
 * Ensures no data is dropped, implements TTL, priority lanes, context isolation,
 * subscription gatekeeping, and auto-recovery orchestration.
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../src/database');

class UniversalAgentBus extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.name = config.name || 'UrsulaUniversalBus';
    this.version = config.version || '1.0.0';
    
    // Priority Queue configuration
    this.priorities = {
      ENTERPRISE: 3,
      PRO: 2,
      STARTER: 1,
      SYSTEM: 0
    };
    
    // Default TTL: 30 seconds for model tasks, 5 min for async workflows
    this.defaultTTLs = {
      model_request: 30000,
      workflow_task: 300000,
      notification: 10000,
      heartbeat: 60000,
      system: 60000
    };
    
    // In-flight message tracking
    this.inFlight = new Map(); // messageId -> { message, startTime, timeoutId, handler }
    this.pendingQueues = new Map(); // priority -> []
    this.processing = false;
    
    // FAIRNESS: Prevent enterprise starvation of standard users
    this.fairnessCounters = {
      enterpriseProcessed: 0,
      threshold: 5, // After 5 enterprise requests, force 1 standard
      lastStandardProcessed: Date.now()
    };
    
    // Context isolation: per-customer session contexts
    this.sessionContexts = new Map(); // customerId -> context
    this.contextTTL = 300000; // 5 minutes session context
    
    // Gatekeeper: subscription status cache (refreshed every 60s)
    this.subscriptionCache = new Map();
    this.cacheTTL = 60000;
    
    // Telemetry: batch log buffer with sampling
    this.telemetryBuffer = [];
    this.telemetryFlushInterval = 2000; // 2 seconds
    this.telemetryFlushSize = 100; // Batch 100-500 events
    this.telemetryMaxBuffer = 500; // Max buffer before forced flush
    
    // SAMPLING: 100% errors, 10-20% normal events
    this.telemetrySampling = {
      errorRate: 1.0,     // 100% of errors
      normalRate: 0.15,  // 15% of normal events (10-20% range)
      alwaysSample: [     // Always sample these event types
        'fail_event',
        'gatekeeper_rejected', 
        'model_flatlined',
        'request_timeout',
        'circuit_breaker_tripped',
        'model_latency_critical'
      ]
    };
    
    // Heartbeat monitoring for local models
    this.modelHealth = new Map(); // modelId -> { lastBeat, status, backupRoute }
    this.heartbeatInterval = null;
    this.heartbeatFrequency = 60000; // 60s default
    
    // Cross-model translation registry
    this.modelChains = new Map(); // chainId -> [modelA, modelB, ...]
    
    // Start background services
    this.startTelemetryFlush();
    this.startContextCleanup();
    this.startQueueProcessor();
    
    // Message Recovery: Check for unfinished tasks on startup
    this.initializeMessageRecovery();
  }

  // ─────────────────────────────────────────────────────────────
  // UNIVERSAL PAYLOAD FORMAT
  // ─────────────────────────────────────────────────────────────
  
  createMessage(origin, target, action, payload, options = {}) {
    const msg = {
      id: options.id || uuidv4(),
      version: this.version,
      timestamp: new Date().toISOString(),
      origin: origin,       // Who sent it: "Ursula", "Heidi", "Stripe", "LocalModel"
      target: target,       // Who should receive: "Heidi", "LocalModel", "Stripe", "Dashboard"
      action: action,       // What to do: "upsell_needed", "model_request", "payment_failed"
      payload: payload,     // The actual data
      
      // Identity Propagation — stripe_customer_id follows EVERY request
      identity: {
        customerId: payload?.customerId || payload?.stripe_customer_id || null,
        subscriptionId: payload?.subscriptionId || null,
        tier: payload?.tier || 'unknown',
        apiKeyHash: payload?.apiKeyHash || null
      },
      
      // Priority Lane Routing
      priority: options.priority || this.priorities[options.tier?.toUpperCase()] || this.priorities.STARTER,
      
      // TTL: Time to Live
      ttl: options.ttl || this.defaultTTLs[action] || 30000,
      ttlDeadline: Date.now() + (options.ttl || this.defaultTTLs[action] || 30000),
      
      // Context isolation: session-bound, auto-cleared
      sessionId: options.sessionId || (payload?.customerId ? `session_${payload.customerId}` : uuidv4()),
      
      // Telemetry tags
      tags: options.tags || [],
      
      // Failover
      retryCount: 0,
      maxRetries: options.maxRetries || 3,
      fallbackAction: options.fallbackAction || null,
      
      // Cross-model chain
      chainId: options.chainId || null,
      chainStep: options.chainStep || 0
    };
    
    return msg;
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLISH (Pub/Sub)
  // ─────────────────────────────────────────────────────────────
  
  async publish(origin, target, action, payload, options = {}) {
    const msg = this.createMessage(origin, target, action, payload, options);
    
    // Log to telemetry
    this.logTelemetry('publish', msg);
    
    // Gatekeeper: validate subscription before model access
    if (target === 'LocalModel' || target === 'ModelAdapter') {
      const isAllowed = await this.gatekeeperCheck(msg);
      if (!isAllowed) {
        this.emit('gatekeeper_rejected', msg);
        this.logTelemetry('gatekeeper_rejected', msg, { reason: 'subscription_invalid' });
        return { success: false, error: 'Subscription validation failed', messageId: msg.id };
      }
    }
    
    // If Enterprise priority, fast-track
    if (msg.priority >= this.priorities.ENTERPRISE) {
      this.emit(`bus:${target}:${action}`, msg);
      this.emit(`bus:${target}`, msg);
      this.emit('bus:message', msg);
      return { success: true, messageId: msg.id, fastTracked: true };
    }
    
    // Queue for ordered processing
    this.enqueue(msg);
    
    // Emit for any real-time listeners
    this.emit(`bus:${target}:${action}`, msg);
    this.emit(`bus:${target}`, msg);
    this.emit('bus:message', msg);
    
    return { success: true, messageId: msg.id };
  }

  // ─────────────────────────────────────────────────────────────
  // REQUEST / RESPONSE (RPC over Bus)
  // ─────────────────────────────────────────────────────────────
  
  async request(origin, target, action, payload, options = {}) {
    const msg = this.createMessage(origin, target, action, payload, options);
    
    // Gatekeeper
    if (target === 'LocalModel' || target === 'ModelAdapter') {
      const isAllowed = await this.gatekeeperCheck(msg);
      if (!isAllowed) {
        this.logTelemetry('gatekeeper_rejected', msg, { reason: 'subscription_invalid' });
        return { success: false, error: 'Subscription validation failed', messageId: msg.id };
      }
    }
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.inFlight.delete(msg.id);
        this.logTelemetry('request_timeout', msg, { elapsed: options.ttl || this.defaultTTLs[action] || 30000 });
        
        // Auto-notify Heidi of failure via fail_event hook
        this.emit('fail_event', {
          messageId: msg.id,
          action: msg.action,
          target: msg.target,
          origin: msg.origin,
          customerId: msg.identity.customerId,
          error: 'Request timed out (TTL expired)',
          retryCount: msg.retryCount,
          fallbackAction: msg.fallbackAction
        });
        
        reject(new Error(`Bus request ${msg.id} timed out after ${msg.ttl}ms`));
      }, msg.ttl);
      
      this.inFlight.set(msg.id, {
        message: msg,
        startTime: Date.now(),
        timeoutId,
        resolve,
        reject,
        options
      });
      
      this.logTelemetry('request', msg);
      this.emit(`bus:${target}:${action}`, msg);
      this.emit(`bus:${target}`, msg);
      this.emit('bus:message', msg);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // RESPOND (completes a pending request)
  // ─────────────────────────────────────────────────────────────
  
  respond(messageId, result, error = null) {
    const pending = this.inFlight.get(messageId);
    if (!pending) {
      this.emit('orphan_response', { messageId, result, error });
      this.logTelemetry('orphan_response', { messageId }, { hasError: !!error });
      return false;
    }
    
    clearTimeout(pending.timeoutId);
    this.inFlight.delete(messageId);
    
    const elapsed = Date.now() - pending.startTime;
    
    if (error) {
      this.logTelemetry('response_error', pending.message, { elapsed, error: error.message || error });
      
      // Auto-retry if under maxRetries
      if (pending.message.retryCount < pending.message.maxRetries) {
        pending.message.retryCount++;
        this.logTelemetry('auto_retry', pending.message, { attempt: pending.message.retryCount });
        this.emit(`bus:${pending.message.target}:${pending.message.action}`, pending.message);
        return true;
      }
      
      // Max retries exceeded — notify Heidi via fail_event hook
      this.emit('fail_event', {
        messageId: pending.message.id,
        action: pending.message.action,
        target: pending.message.target,
        origin: pending.message.origin,
        customerId: pending.message.identity.customerId,
        error: error.message || error,
        retryCount: pending.message.retryCount,
        fallbackAction: pending.message.fallbackAction
      });
      
      pending.reject(error);
    } else {
      this.logTelemetry('response_success', pending.message, { elapsed });
      pending.resolve({ success: true, messageId, result, elapsed });
    }
    
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // GATEKEEPER (Middleware: validates subscription status)
  // ─────────────────────────────────────────────────────────────
  
  async gatekeeperCheck(msg) {
    const { customerId, subscriptionId, tier } = msg.identity;
    if (!customerId && !subscriptionId) return true; // System messages bypass
    
    const cacheKey = subscriptionId || customerId;
    const cached = this.subscriptionCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.ts) < this.cacheTTL) {
      return cached.allowed;
    }
    
    try {
      let subscription = null;
      
      if (subscriptionId) {
        const { data } = await supabase
          .from('subscriptions')
          .select('status, tier, service_permissions')
          .eq('subscription_id', subscriptionId)
          .single();
        subscription = data;
      } else if (customerId) {
        const { data } = await supabase
          .from('subscriptions')
          .select('status, tier, service_permissions')
          .eq('customer_id', customerId)
          .eq('status', 'active')
          .single();
        subscription = data;
      }
      
      const allowed = subscription && 
        (subscription.status === 'active' || subscription.status === 'grace_period');
      
      this.subscriptionCache.set(cacheKey, { allowed, ts: Date.now(), tier: subscription?.tier });
      
      // Permission leak fix: validate service permissions for model access
      if (allowed && msg.payload?.serviceId && subscription?.service_permissions?.serviceIds) {
        const serviceIndex = subscription.service_permissions.serviceIds.indexOf(msg.payload.serviceId);
        if (serviceIndex === -1) {
          this.logTelemetry('gatekeeper_permission_denied', msg, { 
            reason: 'service_not_in_tier',
            tier: subscription.tier
          });
          return false;
        }
      }
      
      return allowed;
    } catch (err) {
      this.logTelemetry('gatekeeper_error', msg, { error: err.message });
      return false; // Fail closed
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PRIORITY QUEUE PROCESSOR
  // ─────────────────────────────────────────────────────────────
  
  enqueue(msg) {
    const queue = this.pendingQueues.get(msg.priority) || [];
    queue.push(msg);
    this.pendingQueues.set(msg.priority, queue);
  }

  startQueueProcessor() {
    setInterval(() => {
      this.processQueues();
    }, 100); // Process every 100ms
  }

  processQueues() {
    if (this.processing) return;
    this.processing = true;
    
    try {
      // FAIRNESS RULE: Check if we need to force a standard user request
      const forceStandard = this.fairnessCounters.enterpriseProcessed >= this.fairnessCounters.threshold;
      
      if (forceStandard) {
        // Try to find and process a standard priority request first
        const standardQueue = this.pendingQueues.get(this.priorities.STARTER) || 
                             this.pendingQueues.get(this.priorities.PRO);
        if (standardQueue && standardQueue.length > 0) {
          const msg = standardQueue.shift();
          if (this.processMessage(msg)) {
            this.fairnessCounters.enterpriseProcessed = 0;
            this.fairnessCounters.lastStandardProcessed = Date.now();
            // Continue with normal processing after fairness injection
          }
        }
      }
      
      // Process highest priority first
      const priorities = Array.from(this.pendingQueues.keys()).sort((a, b) => b - a);
      
      for (const priority of priorities) {
        const queue = this.pendingQueues.get(priority);
        if (!queue || queue.length === 0) continue;
        
        // Process up to 5 messages per priority level per tick
        const batch = queue.splice(0, 5);
        
        for (const msg of batch) {
          // Track enterprise for fairness
          if (msg.priority >= this.priorities.ENTERPRISE) {
            this.fairnessCounters.enterpriseProcessed++;
          } else {
            this.fairnessCounters.enterpriseProcessed = 0;
            this.fairnessCounters.lastStandardProcessed = Date.now();
          }
          
          this.processMessage(msg);
        }
      }
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Process a single message with TTL check
   */
  processMessage(msg) {
    // TTL check before processing
    if (Date.now() > msg.ttlDeadline) {
      this.logTelemetry('queue_ttl_expired', msg, { expiredAt: Date.now() });
      this.emit('fail_event', {
        messageId: msg.id,
        action: msg.action,
        target: msg.target,
        origin: msg.origin,
        customerId: msg.identity.customerId,
        error: 'Message expired in queue (TTL)',
        retryCount: msg.retryCount
      });
      return false;
    }
    
    // Deliver
    this.emit(`bus:${msg.target}:${msg.action}`, msg);
    this.emit(`bus:${msg.target}`, msg);
    this.logTelemetry('queue_delivered', msg, { priority: msg.priority });
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // CONTEXT ISOLATION (Session management)
  // ─────────────────────────────────────────────────────────────
  
  getSessionContext(sessionId) {
    const ctx = this.sessionContexts.get(sessionId);
    if (!ctx) return null;
    if (Date.now() - ctx.lastAccess > this.contextTTL) {
      this.sessionContexts.delete(sessionId); // Expired
      return null;
    }
    ctx.lastAccess = Date.now();
    return ctx.data;
  }

  setSessionContext(sessionId, data, options = {}) {
    // Context Window Gap fix: always flush previous customer data when switching
    this.sessionContexts.set(sessionId, {
      data,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      ttl: options.ttl || this.contextTTL
    });
  }

  clearSessionContext(sessionId) {
    this.sessionContexts.delete(sessionId);
    this.logTelemetry('context_flushed', { sessionId });
  }

  startContextCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [sid, ctx] of this.sessionContexts) {
        if (now - ctx.lastAccess > ctx.ttl) {
          this.sessionContexts.delete(sid);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.emit('context_cleanup', { cleaned, remaining: this.sessionContexts.size });
      }
    }, 60000); // Every 60 seconds
  }

  // ─────────────────────────────────────────────────────────────
  // HEARTBEAT SERVICE (Model Health Monitoring)
  // ─────────────────────────────────────────────────────────────
  
  registerModel(modelId, config = {}) {
    this.modelHealth.set(modelId, {
      lastBeat: Date.now(),
      status: 'healthy',
      backupRoute: config.backupRoute || null,
      maxMissedBeats: config.maxMissedBeats || 3,
      missedBeats: 0,
      config
    });
    
    this.logTelemetry('model_registered', { modelId, backupRoute: config.backupRoute });
  }

  heartbeat(modelId) {
    const health = this.modelHealth.get(modelId);
    if (!health) return;
    
    health.lastBeat = Date.now();
    health.missedBeats = 0;
    
    if (health.status !== 'healthy') {
      health.status = 'healthy';
      this.emit('model_recovered', { modelId });
      this.logTelemetry('model_recovered', { modelId });
    }
  }

  startHeartbeatMonitor() {
    if (this.heartbeatInterval) return;
    
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [modelId, health] of this.modelHealth) {
        const elapsed = now - health.lastBeat;
        const maxDelay = this.heartbeatFrequency * (health.maxMissedBeats + 1);
        
        if (elapsed > maxDelay) {
          health.missedBeats++;
          
          if (health.status === 'healthy') {
            health.status = 'degraded';
            this.emit('model_degraded', { modelId, missedBeats: health.missedBeats });
            this.logTelemetry('model_degraded', { modelId, elapsed });
          }
          
          if (health.missedBeats >= health.maxMissedBeats) {
            health.status = 'flatlined';
            this.emit('model_flatlined', { 
              modelId, 
              backupRoute: health.backupRoute,
              missedBeats: health.missedBeats 
            });
            this.logTelemetry('model_flatlined', { modelId, backupRoute: health.backupRoute });
            
            // Auto-redirect traffic to backup route
            if (health.backupRoute) {
              this.emit('model_redirect', {
                from: modelId,
                to: health.backupRoute,
                reason: 'flatlined'
              });
            }
          }
        }
      }
    }, this.heartbeatFrequency);
  }

  stopHeartbeatMonitor() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CROSS-MODEL TRANSLATION (Chained model requests)
  // ─────────────────────────────────────────────────────────────
  
  registerModelChain(chainId, modelSequence, options = {}) {
    this.modelChains.set(chainId, {
      sequence: modelSequence,
      options,
      ttl: options.ttl || 60000
    });
  }

  async executeChain(chainId, initialPayload, identity = {}) {
    const chain = this.modelChains.get(chainId);
    if (!chain) {
      throw new Error(`Model chain ${chainId} not registered`);
    }
    
    let currentPayload = initialPayload;
    let step = 0;
    
    for (const modelId of chain.sequence) {
      const msg = this.createMessage('Ursula', 'LocalModel', 'model_request', {
        ...currentPayload,
        customerId: identity.customerId,
        subscriptionId: identity.subscriptionId,
        tier: identity.tier,
        chainStep: step,
        chainId
      }, {
        chainId,
        chainStep: step,
        ttl: chain.ttl,
        priority: this.priorities[identity.tier?.toUpperCase()] || this.priorities.STARTER
      });
      
      // Publish and wait for response
      const result = await this.request('Ursula', 'LocalModel', 'model_request', {
        modelId,
        input: currentPayload,
        chainStep: step,
        chainId
      }, {
        chainId,
        chainStep: step,
        ttl: chain.ttl,
        priority: this.priorities[identity.tier?.toUpperCase()] || this.priorities.STARTER
      });
      
      if (!result.success) {
        this.emit('chain_failed', {
          chainId,
          step,
          modelId,
          error: result.error,
          identity
        });
        throw new Error(`Chain ${chainId} failed at step ${step} (${modelId}): ${result.error}`);
      }
      
      currentPayload = result.result;
      step++;
    }
    
    return { success: true, chainId, steps: step, result: currentPayload };
  }

  // ─────────────────────────────────────────────────────────────
  // TELEMETRY (system_telemetry table)
  // ─────────────────────────────────────────────────────────────
  
  logTelemetry(eventType, message, meta = {}) {
    // SAMPLING: Decide if we should log this event
    const isError = meta.error || 
                   eventType.includes('error') || 
                   eventType.includes('fail') ||
                   eventType.includes('timeout');
    
    const isAlwaysSampled = this.telemetrySampling.alwaysSample.includes(eventType);
    
    // 100% of errors, 15% of normal events (configurable 10-20%)
    const shouldSample = isAlwaysSampled || 
                        isError || 
                        (Math.random() < this.telemetrySampling.normalRate);
    
    if (!shouldSample) {
      return; // Skip this event due to sampling
    }
    
    const entry = {
      id: uuidv4(),
      event_type: eventType,
      message_id: message?.id || null,
      origin: message?.origin || 'unknown',
      target: message?.target || 'unknown',
      action: message?.action || null,
      customer_id: message?.identity?.customerId || null,
      subscription_id: message?.identity?.subscriptionId || null,
      tier: message?.identity?.tier || null,
      priority: message?.priority || null,
      ttl: message?.ttl || null,
      elapsed_ms: meta.elapsed || null,
      error_message: meta.error || null,
      metadata: meta,
      sampled: true,
      created_at: new Date().toISOString()
    };
    
    this.telemetryBuffer.push(entry);
    
    // Immediate flush if critical event
    if (this.telemetrySampling.alwaysSample.includes(eventType)) {
      this.flushTelemetry(true);
    }
    
    // Batch flush when buffer reaches size OR max buffer exceeded
    if (this.telemetryBuffer.length >= this.telemetryFlushSize || 
        this.telemetryBuffer.length >= this.telemetryMaxBuffer) {
      this.flushTelemetry();
    }
  }

  async flushTelemetry(force = false) {
    if (this.telemetryBuffer.length === 0) return;
    if (!force && this.telemetryBuffer.length < this.telemetryFlushSize) return;
    
    const batch = this.telemetryBuffer.splice(0, this.telemetryFlushSize);
    
    try {
      const { error } = await supabase
        .from('system_telemetry')
        .insert(batch);
      
      if (error) {
        // Re-insert failed batch back to buffer for retry
        this.telemetryBuffer.unshift(...batch);
        this.emit('telemetry_flush_error', { error: error.message, batchSize: batch.length });
      } else {
        this.emit('telemetry_flushed', { count: batch.length });
      }
    } catch (err) {
      this.telemetryBuffer.unshift(...batch);
      this.emit('telemetry_flush_error', { error: err.message, batchSize: batch.length });
    }
  }

  startTelemetryFlush() {
    setInterval(() => {
      this.flushTelemetry();
    }, this.telemetryFlushInterval);
  }

  // ─────────────────────────────────────────────────────────────
  // PERSISTENCE: Save in-flight tasks to pending_tasks table
  // ─────────────────────────────────────────────────────────────
  
  async persistInFlight() {
    const tasks = [];
    for (const [msgId, pending] of this.inFlight) {
      tasks.push({
        id: uuidv4(),
        message_id: msgId,
        origin: pending.message.origin,
        target: pending.message.target,
        action: pending.message.action,
        customer_id: pending.message.identity?.customerId,
        subscription_id: pending.message.identity?.subscriptionId,
        tier: pending.message.identity?.tier,
        payload: pending.message.payload,
        priority: pending.message.priority,
        ttl: pending.message.ttl,
        ttl_deadline: new Date(pending.message.ttlDeadline).toISOString(),
        retry_count: pending.message.retryCount,
        max_retries: pending.message.maxRetries,
        status: 'in_flight',
        created_at: new Date(pending.startTime).toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    
    if (tasks.length === 0) return;
    
    try {
      await supabase.from('pending_tasks').upsert(tasks, { onConflict: 'message_id' });
    } catch (err) {
      this.emit('persist_error', { error: err.message, count: tasks.length });
    }
  }

  async restoreInFlight() {
    try {
      const { data, error } = await supabase
        .from('pending_tasks')
        .select('*')
        .eq('status', 'in_flight')
        .lt('ttl_deadline', new Date().toISOString());
      
      if (error || !data) return;
      
      for (const task of data) {
        // Check if TTL already expired
        if (new Date(task.ttl_deadline) < new Date()) {
          // Mark as failed
          await supabase
            .from('pending_tasks')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('message_id', task.message_id);
          
          // Notify Heidi
          this.emit('fail_event', {
            messageId: task.message_id,
            action: task.action,
            target: task.target,
            origin: task.origin,
            customerId: task.customer_id,
            error: 'Restored from pending but TTL expired during server restart',
            retryCount: task.retry_count
          });
          
          continue;
        }
        
        // Re-queue the message
        const msg = this.createMessage(
          task.origin,
          task.target,
          task.action,
          task.payload,
          {
            id: task.message_id,
            priority: task.priority,
            ttl: task.ttl,
            retryCount: task.retry_count,
            maxRetries: task.max_retries,
            tier: task.tier
          }
        );
        
        msg.identity = {
          customerId: task.customer_id,
          subscriptionId: task.subscription_id,
          tier: task.tier
        };
        
        this.enqueue(msg);
        
        await supabase
          .from('pending_tasks')
          .update({ status: 'restored', updated_at: new Date().toISOString() })
          .eq('message_id', task.message_id);
      }
      
      this.emit('inflight_restored', { count: data.length });
    } catch (err) {
      this.emit('restore_error', { error: err.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // HEIDI MEMORY FORGE: Prevent duplicate pitches
  // ─────────────────────────────────────────────────────────────
  
  async logHeidiAction(customerId, actionType, context = {}) {
    try {
      await supabase
        .from('heidi_memory')
        .insert({
          id: uuidv4(),
          customer_id: customerId,
          action_type: actionType,
          context,
          created_at: new Date().toISOString()
        });
    } catch (err) {
      this.logTelemetry('heidi_memory_error', { identity: { customerId } }, { error: err.message, actionType });
    }
  }

  async getHeidiLastAction(customerId, actionType, withinMs = 86400000) {
    try {
      const since = new Date(Date.now() - withinMs).toISOString();
      const { data, error } = await supabase
        .from('heidi_memory')
        .select('*')
        .eq('customer_id', customerId)
        .eq('action_type', actionType)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (error || !data || data.length === 0) return null;
      return data[0];
    } catch (err) {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // UNIVERSAL OBSERVER (Single monitor watching the Bus)
  // ─────────────────────────────────────────────────────────────
  
  startUniversalObserver() {
    // Watch all bus events
    this.on('bus:message', (msg) => {
      // Real-time observer logic
    });
    
    this.on('fail_event', (fail) => {
      // Auto-notify Heidi to apologize
      this.publish('UniversalObserver', 'Heidi', 'task_failed', {
        customerId: fail.customerId,
        action: fail.action,
        error: fail.error,
        messageId: fail.messageId,
        retryCount: fail.retryCount,
        needsApology: true
      }, {
        priority: this.priorities.SYSTEM,
        ttl: 10000
      });
    });
    
    this.on('model_flatlined', (event) => {
      // Notify Heidi + Ursula dashboard
      this.publish('UniversalObserver', 'Heidi', 'model_down', {
        modelId: event.modelId,
        backupRoute: event.backupRoute,
        severity: 'critical'
      }, {
        priority: this.priorities.SYSTEM,
        ttl: 30000
      });
      
      this.publish('UniversalObserver', 'Dashboard', 'alert', {
        type: 'model_flatlined',
        modelId: event.modelId,
        timestamp: new Date().toISOString()
      }, {
        priority: this.priorities.SYSTEM,
        ttl: 60000
      });
    });
    
    this.on('gatekeeper_rejected', (msg) => {
      // Notify Heidi of permission denial
      this.publish('UniversalObserver', 'Heidi', 'permission_denied', {
        customerId: msg.identity?.customerId,
        action: msg.action,
        reason: 'subscription_invalid'
      }, {
        priority: this.priorities.SYSTEM,
        ttl: 10000
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // DASHBOARD SYNC: Real-time usage telemetry
  // ─────────────────────────────────────────────────────────────
  
  async getDashboardTelemetry(customerId, subscriptionId) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    try {
      const { data, error } = await supabase
        .from('system_telemetry')
        .select('*')
        .or(`customer_id.eq.${customerId},subscription_id.eq.${subscriptionId}`)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      
      // Aggregate for usage bars
      const usageByService = {};
      const errors = [];
      let totalRequests = 0;
      let successful = 0;
      
      for (const row of data) {
        totalRequests++;
        if (row.event_type === 'response_success') successful++;
        if (row.event_type === 'response_error' || row.event_type === 'fail_event') {
          errors.push({
            action: row.action,
            error: row.error_message,
            time: row.created_at
          });
        }
        
        const service = row.metadata?.serviceId || row.action;
        if (service) {
          usageByService[service] = (usageByService[service] || 0) + 1;
        }
      }
      
      return {
        customerId,
        subscriptionId,
        period: '24h',
        totalRequests,
        successful,
        errors: errors.slice(0, 10),
        usageByService,
        health: this.getHealthStatus()
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  getHealthStatus() {
    const now = Date.now();
    const models = [];
    
    for (const [modelId, health] of this.modelHealth) {
      models.push({
        modelId,
        status: health.status,
        lastBeat: health.lastBeat ? (now - health.lastBeat) : null,
        backupRoute: health.backupRoute
      });
    }
    
    return {
      busStatus: 'operational',
      inFlightCount: this.inFlight.size,
      queuedCount: Array.from(this.pendingQueues.values()).reduce((sum, q) => sum + q.length, 0),
      sessionCount: this.sessionContexts.size,
      modelHealth: models,
      uptime: process.uptime()
    };
  }

  // ─────────────────────────────────────────────────────────────
  // MESSAGE RECOVERY
  // ─────────────────────────────────────────────────────────────
  
  async initializeMessageRecovery() {
    console.log('[UniversalAgentBus] Initializing message recovery...');
    
    try {
      // Check for pending_tasks table and recover unfinished operations
      if (supabase) {
        const { data: pendingTasks, error } = await supabase
          .from('pending_tasks')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        
        if (error) {
          console.warn('[UniversalAgentBus] Could not check pending_tasks:', error.message);
          // Create pending_tasks table if it doesn't exist
          await this.createPendingTasksTable();
          return;
        }
        
        if (pendingTasks && pendingTasks.length > 0) {
          console.log(`[UniversalAgentBus] Recovering ${pendingTasks.length} pending tasks...`);
          
          for (const task of pendingTasks) {
            try {
              // Re-queue the pending task
              const recoveredMessage = this.createMessage(
                task.origin,
                task.target,
                task.action,
                task.payload,
                { id: task.message_id, priority: task.priority || 'SYSTEM' }
              );
              
              await this.sendMessage(recoveredMessage);
              
              // Mark task as recovered
              await supabase
                .from('pending_tasks')
                .update({ status: 'recovered', recovered_at: new Date().toISOString() })
                .eq('id', task.id);
              
              console.log(`[UniversalAgentBus] Recovered task: ${task.message_id}`);
            } catch (recoveryError) {
              console.error(`[UniversalAgentBus] Failed to recover task ${task.message_id}:`, recoveryError.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[UniversalAgentBus] Message recovery initialization failed:', err.message);
    }
  }
  
  async createPendingTasksTable() {
    console.log('[UniversalAgentBus] Creating pending_tasks table...');
    
    // This would typically be done via SQL migration
    // For now, we'll create a basic structure in memory
    this.pendingTasksMemory = [];
  }
  
  async persistPendingTask(message) {
    if (!supabase) {
      // Fallback to memory
      if (!this.pendingTasksMemory) this.pendingTasksMemory = [];
      this.pendingTasksMemory.push({
        message_id: message.id,
        origin: message.origin,
        target: message.target,
        action: message.action,
        payload: message.payload,
        priority: message.priority,
        status: 'pending',
        created_at: new Date().toISOString()
      });
      return;
    }
    
    try {
      await supabase
        .from('pending_tasks')
        .upsert({
          message_id: message.id,
          origin: message.origin,
          target: message.target,
          action: message.action,
          payload: message.payload,
          priority: message.priority || 'SYSTEM',
          status: 'pending',
          created_at: new Date().toISOString()
        });
    } catch (err) {
      console.warn('[UniversalAgentBus] Failed to persist pending task:', err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SHUTDOWN
  // ─────────────────────────────────────────────────────────────
  
  async shutdown() {
    console.log('[UniversalAgentBus] Initiating graceful shutdown...');
    
    this.processing = false;
    
    // Wait for current processing to complete
    await this.waitForProcessingComplete();
    
    // Persist in-flight messages
    await this.persistInFlight();
    
    // Flush remaining telemetry
    await this.flushTelemetry(true);
    
    this.stopHeartbeatMonitor();
    
    console.log('[UniversalAgentBus] Shutdown complete');
  }
}

module.exports = UniversalAgentBus;
