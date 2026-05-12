// HEIDI Core - Operational Intelligence Layer
require('dotenv').config();

class HeidiCore {
  constructor() {
    this.systemMap = null;
    this.knowledgeBase = null;
    this.eventBus = new Map();
    this.subscribers = new Map();
    this.state = {
      initialized: false,
      connected: false,
      processing: false,
      lastActivity: null,
      eventCount: 0,
      responseCount: 0
    };
    
    this.interfaces = {
      process: this.process.bind(this),
      respond: this.respond.bind(this),
      observe: this.observe.bind(this),
      emit: this.emit.bind(this),
      subscribe: this.subscribe.bind(this),
      status: this.status.bind(this)
    };
  }

  async initialize() {
    console.log('=== HEIDI CORE INITIALIZATION ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Load system map
      await this.loadSystemMap();
      
      // Initialize knowledge base
      await this.initializeKnowledgeBase();
      
      // Initialize event bus
      await this.initializeEventBus();
      
      // Connect to services
      await this.connectToServices();
      
      this.state.initialized = true;
      this.state.lastActivity = new Date().toISOString();
      
      console.log('=== HEIDI CORE INITIALIZATION COMPLETE ===');
      
      return this.state;
      
    } catch (error) {
      console.log(`HEIDI Core initialization failed: ${error.message}`);
      throw error;
    }
  }

  async loadSystemMap() {
    console.log('Loading system map...');
    
    const fs = require('fs');
    const path = require('path');
    
    const mapPath = path.join(process.cwd(), 'system-map.json');
    
    if (fs.existsSync(mapPath)) {
      const mapData = fs.readFileSync(mapPath, 'utf8');
      this.systemMap = JSON.parse(mapData);
      
      console.log(`System map loaded: ${this.systemMap.summary.totalModules} modules, ${this.systemMap.summary.totalServices} services`);
      
    } else {
      console.log('System map not found, running discovery...');
      
      const { SystemDiscovery } = require('./system-discovery');
      const discovery = new SystemDiscovery();
      
      this.systemMap = await discovery.discoverSystem();
      await discovery.saveSystemMap();
    }
  }

  async initializeKnowledgeBase() {
    console.log('Initializing knowledge base...');
    
    const { CascadeNode } = require('./cascade-node-simple');
    const cascade = new CascadeNode();
    
    // Initialize cascade if not already done
    if (!cascade.getStatus().initialized) {
      await cascade.initialize();
    }
    
    this.knowledgeBase = cascade.getKnowledgeBase();
    
    console.log(`Knowledge base initialized: ${this.knowledgeBase.size} entries`);
  }

  async initializeEventBus() {
    console.log('Initializing event bus...');
    
    this.eventBus.set('heidi', {
      name: 'heidi',
      type: 'core',
      events: [],
      subscribers: 0,
      created: new Date().toISOString()
    });
    
    console.log('Event bus initialized');
  }

  async connectToServices() {
    console.log('Connecting to services...');
    
    // Connect to Cascade Node
    try {
      const { CascadeNode } = require('./cascade-node-simple');
      const cascade = new CascadeNode();
      
      this.cascade = cascade;
      this.state.connected = true;
      
      console.log('Connected to Cascade Node');
      
    } catch (error) {
      console.log(`Failed to connect to Cascade Node: ${error.message}`);
    }
  }

  // Core Interface Methods
  async process(input) {
    console.log(`HEIDI processing: "${input}"`);
    
    this.state.processing = true;
    this.state.lastActivity = new Date().toISOString();
    
    try {
      // Parse input
      const parsed = this.parseInput(input);
      
      // Process based on type
      let result = null;
      
      switch (parsed.type) {
        case 'query':
          result = await this.processQuery(parsed.content);
          break;
          
        case 'command':
          result = await this.processCommand(parsed.content);
          break;
          
        case 'status':
          result = await this.processStatus(parsed.content);
          break;
          
        default:
          result = await this.processGeneral(parsed.content);
      }
      
      this.state.processing = false;
      this.state.responseCount++;
      
      return result;
      
    } catch (error) {
      this.state.processing = false;
      console.log(`Processing failed: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        type: 'error',
        timestamp: new Date().toISOString()
      };
    }
  }

  async respond(message) {
    console.log(`HEIDI responding: "${message}"`);
    
    const response = {
      message,
      source: 'heidi',
      timestamp: new Date().toISOString(),
      type: 'response'
    };
    
    // Emit response as event
    await this.emit({
      event_id: 'heidi-response-' + Date.now().toString(),
      type: 'heidi_response',
      source: 'heidi',
      timestamp: new Date().toISOString(),
      payload: response
    });
    
    return response;
  }

  async observe(event) {
    console.log(`HEIDI observing: ${event.type} from ${event.source}`);
    
    this.state.lastActivity = new Date().toISOString();
    this.state.eventCount++;
    
    // Store observation
    const observation = {
      event,
      observed: new Date().toISOString(),
      processed: false
    };
    
    // Add to event bus
    const busEvents = this.eventBus.get('heidi') || { events: [] };
    busEvents.events.push(observation);
    this.eventBus.set('heidi', busEvents);
    
    // Process observation
    await this.processObservation(observation);
    
    return observation;
  }

  async emit(event) {
    console.log(`HEIDI emitting: ${event.type}`);
    
    // Add to event bus
    const busEvents = this.eventBus.get('heidi') || { events: [] };
    busEvents.events.push({
      event,
      emitted: new Date().toISOString(),
      subscribers: this.subscribers.size
    });
    this.eventBus.set('heidi', busEvents);
    
    // Notify subscribers
    for (const [id, handler] of this.subscribers) {
      try {
        await handler(event);
      } catch (error) {
        console.log(`Subscriber ${id} failed: ${error.message}`);
      }
    }
    
    this.state.eventCount++;
    this.state.lastActivity = new Date().toISOString();
    
    return event;
  }

  async subscribe(handler) {
    const id = 'subscriber-' + Date.now().toString();
    
    this.subscribers.set(id, handler);
    
    console.log(`HEIDI subscriber added: ${id}`);
    
    return id;
  }

  getStatus() {
    return this.state;
  }

  async status() {
    return {
      ...this.state,
      systemMap: this.systemMap ? this.systemMap.summary : null,
      knowledgeBase: this.knowledgeBase ? this.knowledgeBase.size : 0,
      eventBus: this.eventBus.size,
      subscribers: this.subscribers.size,
      timestamp: new Date().toISOString()
    };
  }

  // Processing Methods
  parseInput(input) {
    const lowerInput = input.toLowerCase().trim();
    
    // Detect query patterns
    if (lowerInput.startsWith('what') || lowerInput.startsWith('how') || lowerInput.startsWith('where') || lowerInput.startsWith('tell me')) {
      return { type: 'query', content: input };
    }
    
    // Detect command patterns
    if (lowerInput.startsWith('run') || lowerInput.startsWith('start') || lowerInput.startsWith('stop') || lowerInput.startsWith('create')) {
      return { type: 'command', content: input };
    }
    
    // Detect status patterns
    if (lowerInput.includes('status') || lowerInput.includes('health') || lowerInput.includes('how are you')) {
      return { type: 'status', content: input };
    }
    
    // Default to general
    return { type: 'general', content: input };
  }

  async processQuery(content) {
    console.log(`Processing query: ${content}`);
    
    // Query knowledge base
    const results = await this.queryKnowledgeBase(content);
    
    return {
      success: true,
      type: 'query_response',
      query: content,
      results,
      timestamp: new Date().toISOString()
    };
  }

  async processCommand(content) {
    console.log(`Processing command: ${content}`);
    
    // Parse command
    const command = content.toLowerCase().trim();
    
    let result = null;
    
    if (command.includes('scan')) {
      result = await this.executeScanCommand(command);
    } else if (command.includes('discover')) {
      result = await this.executeDiscoverCommand(command);
    } else if (command.includes('status')) {
      result = await this.executeStatusCommand(command);
    } else {
      result = {
        success: false,
        error: 'Unknown command',
        command: content,
        timestamp: new Date().toISOString()
      };
    }
    
    return result;
  }

  async processStatus(content) {
    console.log(`Processing status: ${content}`);
    
    const status = await this.status();
    
    return {
      success: true,
      type: 'status_response',
      status,
      timestamp: new Date().toISOString()
    };
  }

  async processGeneral(content) {
    console.log(`Processing general: ${content}`);
    
    // Try to find relevant information
    const results = await this.queryKnowledgeBase(content);
    
    return {
      success: true,
      type: 'general_response',
      content,
      results,
      timestamp: new Date().toISOString()
    };
  }

  async processObservation(observation) {
    console.log(`Processing observation: ${observation.event.type}`);
    
    // Add to processing queue
    // In a real implementation, this would trigger appropriate handlers
    observation.processed = true;
    
    return observation;
  }

  // Command Execution Methods
  async executeScanCommand(command) {
    console.log(`Executing scan command: ${command}`);
    
    if (this.systemMap && this.systemMap.modules) {
      const modules = Object.keys(this.systemMap.modules);
      
      return {
        success: true,
        command: 'scan',
        result: `Found ${modules.length} modules: ${modules.join(', ')}`,
        modules,
        timestamp: new Date().toISOString()
      };
    }
    
    return {
      success: false,
      error: 'No modules found',
      command,
      timestamp: new Date().toISOString()
    };
  }

  async executeDiscoverCommand(command) {
    console.log(`Executing discover command: ${command}`);
    
    if (this.systemMap) {
      return {
        success: true,
        command: 'discover',
        result: 'System discovered',
        summary: this.systemMap.summary,
        timestamp: new Date().toISOString()
      };
    }
    
    return {
      success: false,
      error: 'System map not available',
      command,
      timestamp: new Date().toISOString()
    };
  }

  async executeStatusCommand(command) {
    console.log(`Executing status command: ${command}`);
    
    const status = await this.status();
    
    return {
      success: true,
      command: 'status',
      result: 'Status retrieved',
      status,
      timestamp: new Date().toISOString()
    };
  }

  async queryKnowledgeBase(query) {
    if (!this.knowledgeBase) {
      return [];
    }
    
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const [name, data] of this.knowledgeBase.entries()) {
      const content = data.content.toLowerCase();
      
      if (content.includes(queryLower)) {
        results.push({
          name,
          content: data.content,
          preview: data.preview,
          metadata: data.metadata,
          relevance: this.calculateRelevance(queryLower, content)
        });
      }
    }
    
    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);
    
    return results;
  }

  calculateRelevance(query, content) {
    const queryWords = query.split(' ').filter(word => word.length > 0);
    const contentWords = content.toLowerCase().split(' ').filter(word => word.length > 0);
    
    let score = 0;
    for (const queryWord of queryWords) {
      if (contentWords.includes(queryWord)) {
        score += 1;
      }
    }
    
    return score / Math.max(queryWords.length, 1);
  }
}

// CLI interface
if (require.main === module) {
  const heidi = new HeidiCore();
  
  const command = process.argv[2] || 'initialize';
  
  (async () => {
    switch (command) {
      case 'initialize':
        await heidi.initialize();
        break;
        
      case 'process':
        const input = process.argv[3] || 'hello';
        const result = await heidi.process(input);
        console.log('Result:', JSON.stringify(result, null, 2));
        break;
        
      case 'respond':
        const message = process.argv[3] || 'Hello from HEIDI';
        await heidi.respond(message);
        break;
        
      case 'observe':
        const testEvent = {
          event_id: 'test-' + Date.now().toString(),
          type: 'test',
          source: 'cli',
          timestamp: new Date().toISOString(),
          payload: { message: 'Test event' }
        };
        await heidi.observe(testEvent);
        break;
        
      case 'status':
        const status = await heidi.status();
        console.log('Status:', JSON.stringify(status, null, 2));
        break;
        
      default:
        console.log('Usage: node heidi-core.js [initialize|process|respond|observe|status]');
    }
  })();
}

module.exports = { HeidiCore };
