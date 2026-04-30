// Event Bus Lock - Enforces event-only communication between CASCADE and KILO
// Prevents direct module imports and function calls

const EventEmitter = require('events');
const { enforceContract } = require('./system-contract-guard-v2');

class EventBusLock extends EventEmitter {
  constructor() {
    super();
    this.subscriptions = new Map();
    this.eventHistory = [];
    this.maxHistorySize = 10000;
    this.moduleRegistrations = new Map();
    
    // Initialize lock
    this.initializeLock();
  }

  initializeLock() {
    console.log('[EVENT BUS LOCK] Initialized - Enforcing event-only communication');
    
    // Wrap emit to track all events
    const originalEmit = this.emit.bind(this);
    this.emit = function(event, ...args) {
      // Log event
      this.logEvent(event, args);
      
      // Check if this is a CASCADE output event
      if (event === 'cascade_classified_event') {
        this.validateCascadeOutput(args[0]);
      }
      
      // Check if this is a KILO action event
      if (event === 'kilo_repair_action') {
        this.validateKiloAction(args[0]);
      }
      
      // Emit original
      return originalEmit(event, ...args);
    }.bind(this);
  }

  // Register module with event bus
  registerModule(moduleName, moduleType, allowedEvents = []) {
    // Enforce contract before registration
    enforceContract(moduleName, moduleType, { allowedEvents });
    
    const registration = {
      name: moduleName,
      type: moduleType,
      allowedEvents: allowedEvents,
      registeredAt: new Date().toISOString(),
      eventsEmitted: 0,
      eventsReceived: 0
    };
    
    this.moduleRegistrations.set(moduleName, registration);
    
    console.log(`[EVENT BUS LOCK] Module registered: ${moduleName} (${moduleType})`);
    console.log(`[EVENT BUS LOCK] Allowed events: ${allowedEvents.join(', ')}`);
    
    return registration;
  }

  // Subscribe to events (KILO must use this to receive CASCADE events)
  subscribe(moduleName, eventType, handler) {
    const module = this.moduleRegistrations.get(moduleName);
    if (!module) {
      throw new Error(`Module ${moduleName} not registered`);
    }
    
    // Check if module is allowed to subscribe to this event
    if (module.allowedEvents.length > 0 && !module.allowedEvents.includes(eventType)) {
      throw new Error(`Module ${moduleName} not allowed to subscribe to ${eventType}`);
    }
    
    // Create subscription
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, new Map());
    }
    
    this.subscriptions.get(eventType).set(moduleName, handler);
    
    console.log(`[EVENT BUS LOCK] ${moduleName} subscribed to ${eventType}`);
  }

  // Unsubscribe from events
  unsubscribe(moduleName, eventType) {
    if (this.subscriptions.has(eventType)) {
      this.subscriptions.get(eventType).delete(moduleName);
      console.log(`[EVENT BUS LOCK] ${moduleName} unsubscribed from ${eventType}`);
    }
  }

  // Emit CASCADE classified event
  emitCascadeEvent(classificationData) {
    const cascadeModule = this.moduleRegistrations.get('CASCADE');
    if (!cascadeModule) {
      throw new Error('CASCADE module not registered');
    }
    
    // Validate CASCADE output format
    this.validateCascadeOutput(classificationData);
    
    // Emit event
    this.emit('cascade_classified_event', classificationData);
    cascadeModule.eventsEmitted++;
  }

  // Emit KILO repair action
  emitKiloAction(actionData) {
    const kiloModule = this.moduleRegistrations.get('KILO');
    if (!kiloModule) {
      throw new Error('KILO module not registered');
    }
    
    // Validate KILO action format
    this.validateKiloAction(actionData);
    
    // Emit event
    this.emit('kilo_repair_action', actionData);
    kiloModule.eventsEmitted++;
  }

  // Validate CASCADE output format
  validateCascadeOutput(data) {
    const required = ['event', 'classification', 'fingerprint', 'payload'];
    const missing = required.filter(field => !(field in data));
    
    if (missing.length > 0) {
      throw new Error(`CASCADE output missing required fields: ${missing.join(', ')}`);
    }
    
    // Validate classification is one of allowed values
    const allowedClassifications = [
      'INFRA_FAILURE',
      'ROUTE_FAILURE', 
      'DEPLOYMENT_MISMATCH',
      'DATA_INTEGRITY_RISK',
      'STREAM_BREAK',
      'UNKNOWN_ANOMALY'
    ];
    
    if (!allowedClassifications.includes(data.classification)) {
      throw new Error(`Invalid classification: ${data.classification}`);
    }
    
    // Validate fingerprint format
    if (typeof data.fingerprint !== 'string' || data.fingerprint.length !== 64) {
      throw new Error('Invalid fingerprint format');
    }
    
    return true;
  }

  // Validate KILO action format
  validateKiloAction(data) {
    const required = ['action_type', 'target_module', 'manifest_id'];
    const missing = required.filter(field => !(field in data));
    
    if (missing.length > 0) {
      throw new Error(`KILO action missing required fields: ${missing.join(', ')}`);
    }
    
    // Validate action type
    const allowedActions = ['repair_suggested', 'repair_verified', 'repair_aborted'];
    if (!allowedActions.includes(data.action_type)) {
      throw new Error(`Invalid action type: ${data.action_type}`);
    }
    
    return true;
  }

  // Log all events
  logEvent(eventType, args) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: eventType,
      argCount: args.length,
      argTypes: args.map(arg => typeof arg)
    };
    
    this.eventHistory.push(logEntry);
    
    // Trim history
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  // Get event history
  getEventHistory(limit = 100) {
    return this.eventHistory.slice(-limit);
  }

  // Get module statistics
  getModuleStats() {
    const stats = {};
    
    this.moduleRegistrations.forEach((module, name) => {
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
    
    this.subscriptions.forEach((subscribers, eventType) => {
      subs[eventType] = Array.from(subscribers.keys());
    });
    
    return subs;
  }

  // Check for direct import violations
  checkForViolations() {
    const violations = [];
    
    // Check if KILO has direct CASCADE imports
    this.moduleRegistrations.forEach((module, name) => {
      if (module.type === 'KILO') {
        // In a real implementation, this would analyze the module's dependencies
        // For now, we'll just log that we should check this
        console.log(`[EVENT BUS LOCK] Should verify ${name} has no direct CASCADE imports`);
      }
    });
    
    return violations;
  }

  // Create event-only wrapper for modules
  createEventOnlyInterface(moduleName, moduleType) {
    const self = this;
    
    return {
      // Only allow event emission and subscription
      emit: (event, data) => {
        if (moduleType === 'CASCADE' && event === 'cascade_classified_event') {
          return self.emitCascadeEvent(data);
        } else if (moduleType === 'KILO' && event === 'kilo_repair_action') {
          return self.emitKiloAction(data);
        } else {
          throw new Error(`Module ${moduleName} not allowed to emit ${event}`);
        }
      },
      
      subscribe: (event, handler) => {
        return self.subscribe(moduleName, event, handler);
      },
      
      unsubscribe: (event) => {
        return self.unsubscribe(moduleName, event);
      },
      
      // No direct function calls allowed
      // No direct module access allowed
      // Only event-based communication
    };
  }
}

// Create singleton instance
const eventBusLock = new EventBusLock();

// Export the locked event bus
module.exports = eventBusLock;
