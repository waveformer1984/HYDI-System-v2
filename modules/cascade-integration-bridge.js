/**
 * Cascade Integration Bridge
 * 
 * Provides bidirectional communication between HYDI local system and Cascade (external AI agent).
 * Handles message routing, event translation, and protocol adaptation.
 */

const EventEmitter = require('events');
const fetch = require('node-fetch');

class CascadeIntegrationBridge extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      cascade_endpoint: config.cascade_endpoint || 'http://localhost:8080',
      local_endpoint: config.local_endpoint || 'http://localhost:3005',
      api_key: config.api_key || process.env.CASCADE_API_KEY,
      timeout: config.timeout || 30000,
      retry_attempts: config.retry_attempts || 3,
      retry_delay: config.retry_delay || 1000,
      ...config
    };
    
    this.isConnected = false;
    this.messageQueue = [];
    this.eventSubscriptions = new Map();
    this.messageHistory = new Map();
    this.healthCheckInterval = null;
    this.requestCounter = 0;
    
    // Protocol adapters
    this.adapters = {
      hydi_to_cascade: new EventAdapter('hydi', 'cascade'),
      cascade_to_hydi: new EventAdapter('cascade', 'hydi')
    };
  }

  async initialize() {
    console.log('🌊 Initializing Cascade Integration Bridge...');
    
    try {
      // Test Cascade connectivity
      await this.testCascadeConnection();
      
      // Setup event subscriptions
      this.setupEventSubscriptions();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Process message queue
      this.startMessageProcessor();
      
      this.isConnected = true;
      console.log('✅ Cascade Integration Bridge initialized');
      
      this.emit('bridge_ready', { status: 'connected' });
      return { status: 'connected', endpoint: this.config.cascade_endpoint };
      
    } catch (error) {
      console.error('❌ Cascade bridge initialization failed:', error.message);
      this.emit('bridge_error', error);
      throw error;
    }
  }

  async testCascadeConnection() {
    try {
      const healthEndpoint = `${this.config.cascade_endpoint}/health`;
      const response = await fetch(healthEndpoint, { 
        timeout: this.config.timeout,
        headers: this.getHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`Cascade health check failed: ${response.status}`);
      }
      
      const health = await response.json();
      console.log('✅ Cascade connection verified:', health.status);
      
      return health;
    } catch (error) {
      throw new Error(`Cannot reach Cascade: ${error.message}`);
    }
  }

  setupEventSubscriptions() {
    // Subscribe to local HYDI events
    this.subscribeToLocalEvents();
    
    // Setup Cascade webhook endpoint if available
    this.setupCascadeWebhook();
  }

  subscribeToLocalEvents() {
    // Subscribe to key local events that should be forwarded to Cascade
    const localEvents = [
      'hydi.event.processed',
      'hydi.model.inference',
      'hydi.system.alert',
      'hydi.decision.made',
      'hydi.opportunity.detected'
    ];

    localEvents.forEach(eventType => {
      this.eventSubscriptions.set(eventType, {
        direction: 'to_cascade',
        enabled: true,
        filter: this.createEventFilter(eventType)
      });
    });

    console.log(`📡 Subscribed to ${localEvents.length} local event types`);
  }

  createEventFilter(eventType) {
    return (event) => {
      // Basic filtering logic
      if (event.priority === 'low' && Math.random() > 0.1) {
        return false; // Only send 10% of low priority events
      }
      
      // Filter out sensitive data
      if (event.type?.includes('sensitive') || event.payload?.contains_sensitive) {
        return false;
      }
      
      return true;
    };
  }

  setupCascadeWebhook() {
    // This would setup a webhook endpoint to receive events from Cascade
    console.log('🪝 Cascade webhook endpoint ready');
  }

  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 60000); // Check every minute

    // Initial health check
    this.performHealthCheck();
  }

  async performHealthCheck() {
    const health = {
      timestamp: new Date().toISOString(),
      bridge_status: this.isConnected ? 'connected' : 'disconnected',
      cascade_status: 'unknown',
      message_queue_size: this.messageQueue.length,
      active_subscriptions: this.eventSubscriptions.size
    };

    try {
      const cascadeHealth = await this.testCascadeConnection();
      health.cascade_status = 'connected';
      health.cascade_details = cascadeHealth;
    } catch (error) {
      health.cascade_status = 'disconnected';
      health.cascade_error = error.message;
    }

    this.emit('health_check', health);

    if (health.cascade_status === 'disconnected') {
      console.warn('⚠️  Cascade health check failed');
    }
  }

  startMessageProcessor() {
    // Process message queue every 5 seconds
    setInterval(() => {
      this.processMessageQueue();
    }, 5000);
  }

  async processMessageQueue() {
    if (this.messageQueue.length === 0) return;

    const messages = this.messageQueue.splice(0, 10); // Process up to 10 messages at a time
    
    for (const message of messages) {
      try {
        await this.sendMessage(message);
      } catch (error) {
        console.error(`Failed to send message to Cascade: ${error.message}`);
        
        // Re-queue with retry count
        message.retry_count = (message.retry_count || 0) + 1;
        if (message.retry_count < this.config.retry_attempts) {
          this.messageQueue.push(message);
        } else {
          console.error(`Message failed after ${message.retry_count} retries:`, message.id);
        }
      }
    }
  }

  async sendEventToCascade(event) {
    const cascadeEvent = this.adapters.hydi_to_cascade.adapt(event);
    
    const message = {
      id: this.generateMessageId(),
      type: 'event',
      direction: 'to_cascade',
      timestamp: new Date().toISOString(),
      payload: cascadeEvent,
      original_event: event
    };

    this.messageQueue.push(message);
    this.emit('event_queued', { event_id: event.id, message_id: message.id });
  }

  async sendMessage(message) {
    const endpoint = `${this.config.cascade_endpoint}/api/events`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_key}`,
        ...this.getHeaders()
      },
      body: JSON.stringify(message.payload),
      timeout: this.config.timeout
    });

    if (!response.ok) {
      throw new Error(`Cascade API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    // Store message in history
    this.messageHistory.set(message.id, {
      ...message,
      sent_at: new Date().toISOString(),
      result: result,
      status: 'sent'
    });

    this.emit('message_sent', { message_id: message.id, result });
    
    return result;
  }

  async receiveEventFromCascade(cascadeEvent) {
    try {
      const localEvent = this.adapters.cascade_to_hydi.adapt(cascadeEvent);
      
      // Emit to local event bus
      this.emit('cascade_event', localEvent);
      
      console.log(`📥 Received event from Cascade: ${cascadeEvent.type}`);
      
      return localEvent;
    } catch (error) {
      console.error(`Failed to process Cascade event: ${error.message}`);
      throw error;
    }
  }

  async sendCommandToCascade(command) {
    const cascadeCommand = this.adapters.hydi_to_cascade.adaptCommand(command);
    
    const message = {
      id: this.generateMessageId(),
      type: 'command',
      direction: 'to_cascade',
      timestamp: new Date().toISOString(),
      payload: cascadeCommand,
      original_command: command
    };

    this.messageQueue.push(message);
    return message.id;
  }

  async queryCascade(query) {
    const endpoint = `${this.config.cascade_endpoint}/api/query`;
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.api_key}`,
          ...this.getHeaders()
        },
        body: JSON.stringify(query),
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`Cascade query failed: ${response.status}`);
      }

      const result = await response.json();
      this.emit('query_completed', { query, result });
      
      return result;
    } catch (error) {
      this.emit('query_error', { query, error: error.message });
      throw error;
    }
  }

  getHeaders() {
    return {
      'User-Agent': 'HYDI-Cascade-Bridge/1.0',
      'X-Request-ID': this.generateMessageId(),
      'X-Timestamp': new Date().toISOString()
    };
  }

  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Event handling methods
  onLocalEvent(event) {
    const subscription = this.eventSubscriptions.get(event.type);
    
    if (subscription && subscription.enabled && subscription.filter(event)) {
      this.sendEventToCascade(event);
    }
  }

  onCascadeEvent(event) {
    this.receiveEventFromCascade(event);
  }

  // Configuration methods
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('🔧 Cascade bridge configuration updated');
  }

  addEventSubscription(eventType, options = {}) {
    this.eventSubscriptions.set(eventType, {
      direction: options.direction || 'to_cascade',
      enabled: options.enabled !== false,
      filter: options.filter || (() => true)
    });
  }

  removeEventSubscription(eventType) {
    this.eventSubscriptions.delete(eventType);
  }

  // Status and monitoring methods
  getStatus() {
    return {
      connected: this.isConnected,
      cascade_endpoint: this.config.cascade_endpoint,
      message_queue_size: this.messageQueue.length,
      active_subscriptions: this.eventSubscriptions.size,
      message_history_size: this.messageHistory.size,
      uptime: process.uptime()
    };
  }

  getMessageHistory(limit = 100) {
    const history = Array.from(this.messageHistory.values());
    return history
      .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))
      .slice(0, limit);
  }

  getEventSubscriptions() {
    return Array.from(this.eventSubscriptions.entries()).map(([type, config]) => ({
      event_type: type,
      ...config
    }));
  }

  async flushQueue() {
    console.log(`🔄 Flushing message queue (${this.messageQueue.length} messages)`);
    
    while (this.messageQueue.length > 0) {
      await this.processMessageQueue();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between batches
    }
    
    console.log('✅ Message queue flushed');
  }

  async shutdown() {
    console.log('🛑 Shutting down Cascade Integration Bridge...');
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Flush remaining messages
    await this.flushQueue();
    
    this.isConnected = false;
    console.log('✅ Cascade bridge shutdown completed');
  }
}

// Event Adapter class for protocol translation
class EventAdapter {
  constructor(sourceSystem, targetSystem) {
    this.source = sourceSystem;
    this.target = targetSystem;
  }

  adapt(event) {
    const adapted = {
      id: event.id || event.event_id,
      type: this.translateEventType(event.type),
      timestamp: event.timestamp || new Date().toISOString(),
      source: this.source,
      payload: this.adaptPayload(event.payload || event),
      metadata: {
        original_type: event.type,
        priority: event.priority || 'medium',
        source_system: this.source
      }
    };

    return adapted;
  }

  adaptCommand(command) {
    return {
      id: command.id || this.generateId(),
      type: 'command',
      command: command.type || command.command,
      parameters: command.parameters || {},
      timestamp: new Date().toISOString(),
      source: this.source,
      metadata: {
        original_command: command,
        source_system: this.source
      }
    };
  }

  translateEventType(originalType) {
    const translations = {
      'hydi.event.processed': 'system.event_processed',
      'hydi.model.inference': 'ai.model_inference',
      'hydi.system.alert': 'system.alert',
      'hydi.decision.made': 'decision.executed',
      'hydi.opportunity.detected': 'business.opportunity'
    };

    return translations[originalType] || originalType;
  }

  adaptPayload(payload) {
    // Remove sensitive fields and adapt structure
    const adapted = { ...payload };
    
    // Remove sensitive data
    if (adapted.api_key) delete adapted.api_key;
    if (adapted.password) delete adapted.password;
    if (adapted.secret) delete adapted.secret;
    
    // Adapt field names
    if (adapted.event_id) {
      adapted.id = adapted.event_id;
      delete adapted.event_id;
    }

    return adapted;
  }

  generateId() {
    return `${this.target}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = CascadeIntegrationBridge;
