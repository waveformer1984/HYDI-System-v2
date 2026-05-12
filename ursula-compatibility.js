// Ursula Compatibility Layer - Optional Connection
require('dotenv').config();

class UrsulaCompatibility {
  constructor() {
    this.connected = false;
    this.mode = 'offline';
    this.eventBus = null;
    this.status = {
      initialized: false,
      connectionAttempts: 0,
      lastAttempt: null,
      fallbackMode: false
    };
  }

  async initialize() {
    console.log('=== URSULA COMPATIBILITY INITIALIZATION ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Attempt connection to Ursula
      await this.attemptConnection();
      
      this.status.initialized = true;
      
      console.log('=== URSULA COMPATIBILITY INITIALIZATION COMPLETE ===');
      
      return this.status;
      
    } catch (error) {
      console.log(`Ursula compatibility initialization failed: ${error.message}`);
      throw error;
    }
  }

  async attemptConnection() {
    console.log('Attempting Ursula connection...');
    
    const http = require('http');
    
    const testConnection = () => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 3002,
          path: '/events/stream',
          method: 'GET',
          timeout: 5000
        });
        
        req.on('response', (res) => {
          resolve({ success: true, status: res.statusCode });
        });
        
        req.on('error', (error) => {
          reject(error);
        });
        
        req.on('timeout', () => {
          reject(new Error('Connection timeout'));
        });
        
        req.end();
      });
    };
    
    this.status.connectionAttempts++;
    this.status.lastAttempt = new Date().toISOString();
    
    try {
      const result = await testConnection();
      
      if (result.success && result.status === 200) {
        this.connected = true;
        this.mode = 'online';
        console.log('Ursula connection: ESTABLISHED');
        
        // Set up event stream
        await this.setupEventStream();
        
      } else {
        throw new Error(`Unexpected status: ${result.status}`);
      }
      
    } catch (error) {
      console.log(`Ursula connection failed: ${error.message}`);
      console.log('Falling back to local event bus');
      
      this.connected = false;
      this.mode = 'offline';
      this.status.fallbackMode = true;
      
      await this.setupLocalEventBus();
    }
  }

  async setupEventStream() {
    console.log('Setting up Ursula event stream...');
    
    // In a real implementation, this would establish SSE connection
    console.log('Event stream: SIMULATED (Ursula online mode)');
  }

  async setupLocalEventBus() {
    console.log('Setting up local event bus...');
    
    // Create local event bus for offline mode
    const { EventPipeline } = require('./event-pipeline');
    
    if (!this.eventBus) {
      this.eventBus = new EventPipeline();
      await this.eventBus.initialize();
    }
    
    console.log('Local event bus: ACTIVE');
    console.log('URSULA_OFFLINE_MODE: ENABLED');
  }

  async emitEvent(event) {
    console.log(`Emitting event: ${event.type} (mode: ${this.mode})`);
    
    if (this.connected && this.mode === 'online') {
      // Send to Ursula
      await this.sendToUrsula(event);
    } else {
      // Send to local event bus
      if (this.eventBus) {
        const result = await this.eventBus.emit(event);
        console.log(`Local event bus: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      }
    }
    
    return { success: true, mode: this.mode };
  }

  async sendToUrsula(event) {
    console.log(`Sending event to Ursula: ${event.event_id}`);
    
    // In a real implementation, this would send via SSE
    console.log('Event sent to Ursula: SIMULATED');
  }

  async subscribeToUrsula(handler) {
    console.log('Subscribing to Ursula events...');
    
    if (this.connected && this.mode === 'online') {
      // In a real implementation, this would subscribe to SSE stream
      console.log('Ursula subscription: SIMULATED');
      
      const id = 'ursula-subscriber-' + Date.now().toString();
      console.log(`Ursula subscriber: ${id}`);
      
      return id;
      
    } else {
      // Subscribe to local event bus
      if (this.eventBus) {
        const id = await this.eventBus.subscribe('ursula', handler);
        console.log(`Local event bus subscriber: ${id}`);
        return id;
      }
      
      throw new Error('No event bus available');
    }
  }

  async validateEventSchema(event) {
    console.log('Validating event schema...');
    
    const requiredFields = ['event_id', 'type', 'source', 'timestamp', 'payload'];
    const errors = [];
    
    for (const field of requiredFields) {
      if (!event[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    if (errors.length > 0) {
      console.log(`Event schema validation failed: ${errors.join(', ')}`);
      return { valid: false, errors };
    }
    
    console.log('Event schema validation: PASSED');
    
    return { valid: true };
  }

  async testEventFlow() {
    console.log('Testing event flow...');
    
    const testEvent = {
      event_id: 'ursula-test-' + Date.now().toString(),
      type: 'test',
      source: 'ursula_compatibility',
      timestamp: new Date().toISOString(),
      payload: { message: 'Test event from Ursula compatibility layer' }
    };
    
    console.log('Test event:', JSON.stringify(testEvent, null, 2));
    
    // Validate schema
    const validation = await this.validateEventSchema(testEvent);
    
    if (validation.valid) {
      // Emit event
      const result = await this.emitEvent(testEvent);
      console.log('Event emission:', result);
    }
    
    return validation;
  }

  async monitorConnection() {
    console.log('Monitoring connection...');
    
    if (this.mode === 'offline') {
      console.log('Attempting to reconnect to Ursula...');
      
      await this.attemptConnection();
      
      if (this.connected) {
        console.log('Ursula reconnection: SUCCESS');
      } else {
        console.log('Ursula reconnection: FAILED - staying in offline mode');
      }
    } else {
      console.log('Ursula connection: STABLE');
    }
  }

  getStatus() {
    return {
      ...this.status,
      connected: this.connected,
      mode: this.mode,
      eventBus: this.eventBus ? this.eventBus.getState() : null,
      timestamp: new Date().toISOString()
    };
  }

  getMode() {
    return this.mode;
  }

  isConnected() {
    return this.connected;
  }

  isOffline() {
    return this.mode === 'offline';
  }
}

// CLI interface
if (require.main === module) {
  const ursula = new UrsulaCompatibility();
  
  const command = process.argv[2] || 'initialize';
  
  (async () => {
    switch (command) {
      case 'initialize':
        await ursula.initialize();
        break;
        
      case 'test':
        await ursula.testEventFlow();
        break;
        
      case 'monitor':
        await ursula.monitorConnection();
        break;
        
      case 'status':
        const status = ursula.getStatus();
        console.log('Ursula Status:', JSON.stringify(status, null, 2));
        break;
        
      case 'emit':
        const testEvent = {
          event_id: 'ursula-test-' + Date.now().toString(),
          type: 'test',
          source: 'cli',
          timestamp: new Date().toISOString(),
          payload: { message: 'Test event from CLI' }
        };
        await ursula.emitEvent(testEvent);
        break;
        
      default:
        console.log('Usage: node ursula-compatibility.js [initialize|test|monitor|status|emit]');
    }
  })();
}

module.exports = { UrsulaCompatibility };
