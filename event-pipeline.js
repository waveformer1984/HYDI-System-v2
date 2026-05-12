// Event Pipeline - ProtoForge Core Event System
require('dotenv').config();

class EventPipeline {
  constructor() {
    this.eventBus = new Map();
    this.subscribers = new Map();
    this.eventStream = [];
    this.state = {
      initialized: false,
      eventsEmitted: 0,
      eventsProcessed: 0,
      subscribers: 0,
      lastActivity: null
    };
  }

  async initialize() {
    console.log('=== EVENT PIPELINE INITIALIZATION ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Initialize event bus
      await this.initializeEventBus();
      
      // Set up default event handlers
      await this.setupDefaultHandlers();
      
      this.state.initialized = true;
      this.state.lastActivity = new Date().toISOString();
      
      console.log('=== EVENT PIPELINE INITIALIZATION COMPLETE ===');
      
      return this.state;
      
    } catch (error) {
      console.log(`Event pipeline initialization failed: ${error.message}`);
      throw error;
    }
  }

  async initializeEventBus() {
    console.log('Initializing event bus...');
    
    // Create event bus with default channels
    const channels = [
      'protoforge',
      'heidi',
      'system',
      'user',
      'error',
      'status'
    ];
    
    for (const channel of channels) {
      this.eventBus.set(channel, {
        name: channel,
        events: [],
        subscribers: 0,
        created: new Date().toISOString(),
        lastEvent: null
      });
    }
    
    console.log(`Event bus initialized with ${channels.length} channels`);
  }

  async setupDefaultHandlers() {
    console.log('Setting up default event handlers...');
    
    // Set up HEIDI handler
    this.subscribe('heidi', async (event) => {
      console.log(`HEIDI handler processing: ${event.type}`);
      
      // Process event through HEIDI if available
      if (global.heidi) {
        await global.heidi.observe(event);
      }
      
      return { processed: true, handled: true };
    });
    
    // Set up ProtoForge handler
    this.subscribe('protoforge', async (event) => {
      console.log(`ProtoForge handler processing: ${event.type}`);
      
      // Process ProtoForge specific events
      await this.processProtoForgeEvent(event);
      
      return { processed: true, handled: true };
    });
    
    // Set up system handler
    this.subscribe('system', async (event) => {
      console.log(`System handler processing: ${event.type}`);
      
      // Process system events
      await this.processSystemEvent(event);
      
      return { processed: true, handled: true };
    });
    
    console.log('Default handlers set up');
  }

  // Core Event Methods
  async emit(event) {
    console.log(`Emitting event: ${event.type} from ${event.source}`);
    
    // Validate event schema
    const validatedEvent = this.validateEvent(event);
    
    if (!validatedEvent.valid) {
      console.log(`Event validation failed: ${validatedEvent.errors.join(', ')}`);
      return { success: false, error: 'Event validation failed', event };
    }
    
    // Add timestamp if not present
    if (!validatedEvent.event.timestamp) {
      validatedEvent.event.timestamp = new Date().toISOString();
    }
    
    // Add to event stream
    this.eventStream.push(validatedEvent.event);
    
    // Add to channel
    const channel = validatedEvent.event.type.split('_')[0] || 'system';
    const busChannel = this.eventBus.get(channel);
    
    if (busChannel) {
      busChannel.events.push(validatedEvent.event);
      busChannel.lastEvent = validatedEvent.event;
      busChannel.lastActivity = new Date().toISOString();
    }
    
    // Notify subscribers
    const results = [];
    for (const [id, handler] of this.subscribers) {
      try {
        const result = await handler(validatedEvent.event);
        results.push({ id, result });
      } catch (error) {
        console.log(`Subscriber ${id} failed: ${error.message}`);
        results.push({ id, error: error.message });
      }
    }
    
    // Update state
    this.state.eventsEmitted++;
    this.state.lastActivity = new Date().toISOString();
    
    return {
      success: true,
      event: validatedEvent.event,
      channel,
      subscribers: results.length,
      results
    };
  }

  async subscribe(channel, handler) {
    console.log(`Subscribing to channel: ${channel}`);
    
    if (typeof handler === 'function') {
      // Direct handler subscription
      const id = 'handler-' + Date.now().toString();
      this.subscribers.set(id, handler);
      
      // Update channel subscriber count
      const busChannel = this.eventBus.get(channel);
      if (busChannel) {
        busChannel.subscribers++;
      }
      
      this.state.subscribers++;
      
      console.log(`Handler subscribed: ${id}`);
      return id;
      
    } else if (typeof handler === 'string') {
      // Channel subscription
      const channelId = 'channel-' + Date.now().toString();
      this.subscribers.set(channelId, {
        type: 'channel',
        channel,
        created: new Date().toISOString()
      });
      
      // Update channel subscriber count
      const busChannel = this.eventBus.get(channel);
      if (busChannel) {
        busChannel.subscribers++;
      }
      
      this.state.subscribers++;
      
      console.log(`Channel subscribed: ${channelId}`);
      return channelId;
    }
    
    throw new Error('Invalid handler type');
  }

  async unsubscribe(id) {
    console.log(`Unsubscribing: ${id}`);
    
    const subscriber = this.subscribers.get(id);
    
    if (subscriber) {
      // Update channel subscriber count
      if (subscriber.type === 'channel') {
        const busChannel = this.eventBus.get(subscriber.channel);
        if (busChannel) {
          busChannel.subscribers--;
        }
      }
      
      this.subscribers.delete(id);
      this.state.subscribers--;
      
      console.log(`Unsubscribed: ${id}`);
      return true;
    }
    
    return false;
  }

  validateEvent(event) {
    const errors = [];
    
    // Check required fields
    const requiredFields = ['event_id', 'type', 'source', 'timestamp', 'payload'];
    
    for (const field of requiredFields) {
      if (!event[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Validate event_id
    if (event.event_id && typeof event.event_id !== 'string') {
      errors.push('event_id must be a string');
    }
    
    // Validate type
    if (event.type && typeof event.type !== 'string') {
      errors.push('type must be a string');
    }
    
    // Validate source
    if (event.source && typeof event.source !== 'string') {
      errors.push('source must be a string');
    }
    
    // Validate timestamp
    if (event.timestamp && !Date.parse(event.timestamp)) {
      errors.push('timestamp must be a valid ISO date string');
    }
    
    // Validate payload
    if (event.payload && typeof event.payload !== 'object') {
      errors.push('payload must be an object');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      event
    };
  }

  async processProtoForgeEvent(event) {
    console.log(`Processing ProtoForge event: ${event.type}`);
    
    switch (event.type) {
      case 'protoforge_scan':
        return await this.processScanEvent(event);
        
      case 'protoforge_scrape':
        return await this.processScrapeEvent(event);
        
      case 'protoforge_score':
        return await this.processScoreEvent(event);
        
      case 'protoforge_recover':
        return await this.processRecoverEvent(event);
        
      default:
        console.log(`Unknown ProtoForge event type: ${event.type}`);
        return { processed: false, type: 'unknown' };
    }
  }

  async processSystemEvent(event) {
    console.log(`Processing system event: ${event.type}`);
    
    switch (event.type) {
      case 'system_status':
        return await this.processStatusEvent(event);
        
      case 'system_error':
        return await this.processErrorEvent(event);
        
      default:
        console.log(`Unknown system event type: ${event.type}`);
        return { processed: false, type: 'unknown' };
    }
  }

  async processScanEvent(event) {
    console.log(`Processing scan event: ${event.event_id}`);
    
    // In a real implementation, this would trigger the scanning module
    const result = {
      scanned: true,
      url: event.payload.url || 'unknown',
      results: [],
      timestamp: new Date().toISOString()
    };
    
    // Emit scan result
    await this.emit({
      event_id: 'scan-result-' + Date.now().toString(),
      type: 'protoforge_scan_result',
      source: 'event_pipeline',
      timestamp: new Date().toISOString(),
      payload: {
        originalEvent: event.event_id,
        result
      }
    });
    
    return { processed: true, result };
  }

  async processScrapeEvent(event) {
    console.log(`Processing scrape event: ${event.event_id}`);
    
    const result = {
      scraped: true,
      url: event.payload.url || 'unknown',
      data: {},
      timestamp: new Date().toISOString()
    };
    
    await this.emit({
      event_id: 'scrape-result-' + Date.now().toString(),
      type: 'protoforge_scrape_result',
      source: 'event_pipeline',
      timestamp: new Date().toISOString(),
      payload: {
        originalEvent: event.event_id,
        result
      }
    });
    
    return { processed: true, result };
  }

  async processScoreEvent(event) {
    console.log(`Processing score event: ${event.event_id}`);
    
    const result = {
      scored: true,
      asset: event.payload.asset || 'unknown',
      score: 0,
      timestamp: new Date().toISOString()
    };
    
    await this.emit({
      event_id: 'score-result-' + Date.now().toString(),
      type: 'protoforge_score_result',
      source: 'event_pipeline',
      timestamp: new Date().toISOString(),
      payload: {
        originalEvent: event.event_id,
        result
      }
    });
    
    return { processed: true, result };
  }

  async processRecoverEvent(event) {
    console.log(`Processing recover event: ${event.event_id}`);
    
    const result = {
      recovered: true,
      asset: event.payload.asset || 'unknown',
      recovered: [],
      timestamp: new Date().toISOString()
    };
    
    await this.emit({
      event_id: 'recover-result-' + Date.now().toString(),
      type: 'protoforge_recover_result',
      source: 'event_pipeline',
      timestamp: new Date().toISOString(),
      payload: {
        originalEvent: event.event_id,
        result
      }
    });
    
    return { processed: true, result };
  }

  async processStatusEvent(event) {
    console.log(`Processing status event: ${event.event_id}`);
    
    return { processed: true, status: event.payload };
  }

  async processErrorEvent(event) {
    console.log(`Processing error event: ${event.event_id}`);
    
    return { processed: true, error: event.payload };
  }

  // Getters
  getEventBus() {
    return this.eventBus;
  }
  
  getEventStream() {
    return this.eventStream;
  }
  
  getSubscribers() {
    return this.subscribers;
  }
  
  getState() {
    return {
      ...this.state,
      channels: this.eventBus.size,
      eventStreamSize: this.eventStream.length
    };
  }
}

// CLI interface
if (require.main === module) {
  const pipeline = new EventPipeline();
  
  const command = process.argv[2] || 'initialize';
  
  (async () => {
    switch (command) {
      case 'initialize':
        await pipeline.initialize();
        break;
        
      case 'emit':
        const testEvent = {
          event_id: 'test-' + Date.now().toString(),
          type: 'test',
          source: 'cli',
          timestamp: new Date().toISOString(),
          payload: { message: 'Test event from CLI' }
        };
        const result = await pipeline.emit(testEvent);
        console.log('Emit result:', JSON.stringify(result, null, 2));
        break;
        
      case 'subscribe':
        const channel = process.argv[3] || 'heidi';
        const id = await pipeline.subscribe(channel, async (event) => {
          console.log(`Subscriber received: ${event.type}`);
        });
        console.log(`Subscribed to ${channel} with ID: ${id}`);
        break;
        
      case 'status':
        const status = pipeline.getState();
        console.log('Event Pipeline Status:', JSON.stringify(status, null, 2));
        break;
        
      case 'events':
        const events = pipeline.getEventStream();
        console.log(`Event Stream (${events.length} events):`);
        events.slice(-5).forEach((event, index) => {
          console.log(`${index + 1}. ${event.event_id} (${event.type})`);
        });
        break;
        
      default:
        console.log('Usage: node event-pipeline.js [initialize|emit|subscribe|status|events]');
    }
  })();
}

module.exports = { EventPipeline };
