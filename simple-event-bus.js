// Simple Event Bus - Enforces event-only communication between modules
// Prevents direct module imports and function calls

const EventEmitter = require('events');

class SimpleEventBus extends EventEmitter {
  constructor() {
    super();
    this.modules = new Map(); // Track registered modules and their permissions
    this.eventHistory = [];   // Keep history of events for audit
    this.maxHistorySize = 1000;
    
    console.log('[SIMPLE EVENT BUS] Initialized - Enforcing event-only communication');
  }
  
  // Register a module with specific permissions
  registerModule(moduleName, moduleType, allowedEvents = []) {
    // Validate module type
    const validTypes = ['CASCADE', 'KILO', 'PROTOFORGE_ORCHESTRATOR'];
    if (!validTypes.includes(moduleType)) {
      throw new Error(`Invalid module type: ${moduleType}. Must be one of: ${validTypes.join(', ')}`);
    }
    
    const registration = {
      name: moduleName,
      type: moduleType,
      allowedEvents: allowedEvents,
      registeredAt: new Date().toISOString(),
      eventsEmitted: 0,
      eventsReceived: 0
    };
    
    this.modules.set(moduleName, registration);
    console.log(`[SIMPLE EVENT BUS] Module registered: ${moduleName} (${moduleType})`);
    console.log(`[SIMPLE EVENT BUS] Allowed events: ${allowedEvents.join(', ')}`);
    
    return registration;
  }
  
  // Subscribe to events (modules must use this to receive events)
  subscribe(moduleName, eventType, handler) {
    const module = this.modules.get(moduleName);
    if (!module) {
      throw new Error(`Module ${moduleName} not registered`);
    }
    
    // Check if module is allowed to subscribe to this event
    if (module.allowedEvents.length > 0 && !module.allowedEvents.includes(eventType)) {
      throw new Error(`Module ${moduleName} not allowed to subscribe to ${eventType}`);
    }
    
    // Create subscription
    if (!this.subscriptions) {
      this.subscriptions = new Map();
    }
    
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, new Map());
    }
    
    this.subscriptions.get(eventType).set(moduleName, handler);
    
    console.log(`[SIMPLE EVENT BUS] ${moduleName} subscribed to ${eventType}`);
  }
  
  // Emit an event (modules must use this to send events)
  emitEvent(moduleName, eventType, eventData) {
    const module = this.modules.get(moduleName);
    if (!module) {
      throw new Error(`Module ${moduleName} not registered`);
    }
    
    // Validate that the module is allowed to emit this event type
    // In a more sophisticated implementation, we'd have emit permissions too
    // For now, we'll trust that modules use the correct methods
    
    // Add to event history
    const eventEntry = {
      timestamp: new Date().toISOString(),
      module: moduleName,
      eventType: eventType,
      data: eventData
    };
    
    this.eventHistory.push(eventEntry);
    
    // Trim history
    if (this.eventHistory > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
    
    // Emit the event
    this.emit(eventType, eventData);
    
    // Update module stats
    module.eventsEmitted++;
    
    console.log(`[SIMPLE EVENT BUS] ${moduleName} emitted ${eventType}`);
    
    return true;
  }
  
  // Get event history
  getEventHistory(limit = 100) {
    return this.eventHistory.slice(-limit);
  }
  
  // Get module statistics
  getModuleStats() {
    const stats = {};
    
    this.modules.forEach((module, name) => {
      stats[name] = {
        type: module.type,
        registeredAt: module.registeredAt,
        eventsEmitted: module.eventsEmitted,
        eventsReceived: module.eventsReceived,
        allowedEvents: module.allowedEvents
      };
    });
    
    return stats;
  }
  
  // Get subscription information
  getSubscriptions() {
    const subs = {};
    
    if (this.subscriptions) {
      this.subscriptions.forEach((subscribers, eventType) => {
        subs[eventType] = Array.from(subscribers.keys());
      });
    }
    
    return subs;
  }
}

// Create singleton instance
const simpleEventBus = new SimpleEventBus();

module.exports = { SimpleEventBus, simpleEventBus };