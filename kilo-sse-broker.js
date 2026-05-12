// Kilo SSE Broker - Real-time Event Flow to Ursula
require('dotenv').config();

class KiloSSEBroker {
  constructor() {
    this.sseServer = null;
    this.clients = new Set();
    this.eventChannels = new Map();
    this.connectionStatus = 'disconnected';
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 1000;
    this.stats = {
      eventsEmitted: 0,
      clientsConnected: 0,
      lastEventTime: null,
      startTime: new Date().toISOString()
    };
    this.eventPipeline = null;
  }

  async establishEventFlow() {
    console.log('=== ESTABLISHING VERIFIED REAL-TIME EVENT FLOW TO URSULA ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Connection Test
      const connectionResult = await this.testConnection();
      
      if (connectionResult.success) {
        console.log('SUCCESS: Connected to external SSE server');
        this.connectionStatus = 'external';
      } else {
        console.log(`FAILURE: Connection failed - ${connectionResult.reason}`);
        
        // Phase 2: Retry with exponential backoff
        const retryResult = await this.retryWithBackoff();
        
        if (retryResult.success) {
          console.log('SUCCESS: Connected after retries');
          this.connectionStatus = 'external';
        } else {
          console.log('FAILURE: All retries exhausted');
          
          // Phase 3: Spin up local SSE broker
          await this.spinUpLocalBroker();
          this.connectionStatus = 'local';
        }
      }
      
      // Phase 4: Event Flow Verification
      const verificationResult = await this.verifyEventFlow();
      
      console.log('=== EVENT FLOW ESTABLISHMENT COMPLETE ===');
      
      return {
        connectionStatus: this.connectionStatus,
        eventsEmitted: this.stats.eventsEmitted,
        clientsConnected: this.stats.clientsConnected,
        verification: verificationResult,
        ursulaStatus: this.connectionStatus === 'external' ? 'REAL_TIME_SYNC' : 'LOCAL_BROKER'
      };
      
    } catch (error) {
      console.log(`Event flow establishment failed: ${error.message}`);
      throw error;
    }
  }

  async testConnection() {
    console.log('Phase 1: Testing SSE connection to http://localhost:3002/events/stream');
    
    const http = require('http');
    
    return new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3002,
        path: '/events/stream',
        method: 'GET',
        timeout: 5000
      });
      
      req.on('response', (res) => {
        if (res.statusCode === 200) {
          console.log('SUCCESS: External SSE server responded with 200');
          resolve({ success: true, reason: 'Connected' });
        } else {
          console.log(`FAILURE: External SSE server responded with ${res.statusCode}`);
          resolve({ success: false, reason: `INVALID_RESPONSE: ${res.statusCode}` });
        }
        res.destroy();
      });
      
      req.on('error', (error) => {
        if (error.code === 'ECONNREFUSED') {
          console.log('FAILURE: Connection refused - no server on port 3002');
          resolve({ success: false, reason: 'ECONNREFUSED' });
        } else if (error.code === 'ETIMEDOUT') {
          console.log('FAILURE: Connection timeout');
          resolve({ success: false, reason: 'TIMEOUT' });
        } else {
          console.log(`FAILURE: Connection error - ${error.message}`);
          resolve({ success: false, reason: `CONNECTION_ERROR: ${error.message}` });
        }
      });
      
      req.on('timeout', () => {
        console.log('FAILURE: Connection timeout');
        req.destroy();
        resolve({ success: false, reason: 'TIMEOUT' });
      });
      
      req.end();
    });
  }

  async retryWithBackoff() {
    console.log('Phase 2: Retrying with exponential backoff...');
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const delay = this.retryDelay * Math.pow(2, attempt - 1);
      console.log(`Retry attempt ${attempt}/${this.maxRetries} after ${delay}ms delay`);
      
      // Wait for delay
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Test connection
      const result = await this.testConnection();
      
      if (result.success) {
        console.log(`SUCCESS: Retry ${attempt} succeeded`);
        return { success: true, attempt };
      } else {
        console.log(`FAILURE: Retry ${attempt} failed - ${result.reason}`);
      }
    }
    
    console.log('FAILURE: All retry attempts exhausted');
    return { success: false, reason: 'ALL_RETRIES_EXHAUSTED' };
  }

  async spinUpLocalBroker() {
    console.log('Phase 3: Spinning up local SSE broker on port 3002...');
    
    const http = require('http');
    const url = require('url');
    
    // Initialize event channels
    this.eventChannels.set('protoforge', new Set());
    this.eventChannels.set('heidi', new Set());
    this.eventChannels.set('system', new Set());
    this.eventChannels.set('error', new Set());
    this.eventChannels.set('status', new Set());
    
    this.sseServer = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      
      if (parsedUrl.pathname === '/events/stream') {
        console.log('SSE client connected to local broker');
        
        // Set SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control'
        });
        
        // Send initial comment
        res.write(': local-sse-broker-started\n\n');
        
        // Store client
        this.clients.add(res);
        this.stats.clientsConnected = this.clients.size;
        
        // Handle client disconnect
        res.on('close', () => {
          console.log('SSE client disconnected');
          this.clients.delete(res);
          this.stats.clientsConnected = this.clients.size;
        });
        
        // Keep connection alive with periodic comments
        const keepAliveInterval = setInterval(() => {
          if (this.clients.has(res)) {
            res.write(': keep-alive\n\n');
          } else {
            clearInterval(keepAliveInterval);
          }
        }, 30000);
        
      } else if (parsedUrl.pathname === '/health') {
        // Health check endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          server: 'local-sse-broker',
          timestamp: new Date().toISOString(),
          clientsConnected: this.stats.clientsConnected,
          eventsEmitted: this.stats.eventsEmitted,
          channels: Array.from(this.eventChannels.keys())
        }));
        
      } else if (parsedUrl.pathname === '/emit') {
        // Manual event emission endpoint
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          
          req.on('end', () => {
            try {
              const event = JSON.parse(body);
              this.emitEvent(event);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, eventId: event.event_id }));
            } catch (error) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: error.message }));
            }
          });
        } else {
          res.writeHead(405);
          res.end('Method not allowed');
        }
        
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    
    return new Promise((resolve, reject) => {
      this.sseServer.listen(3002, (error) => {
        if (error) {
          console.log(`Failed to start local SSE broker: ${error.message}`);
          reject(error);
        } else {
          console.log('SUCCESS: Local SSE broker listening on port 3002');
          console.log('Channels available: protoforge, heidi, system, error, status');
          resolve();
        }
      });
    });
  }

  async verifyEventFlow() {
    console.log('Phase 4: Event Flow Verification...');
    
    // Connect to event pipeline
    const { EventPipeline } = require('./event-pipeline');
    this.eventPipeline = new EventPipeline();
    await this.eventPipeline.initialize();
    
    // Emit test event
    const testEvent = {
      event_id: 'test-sse-' + Date.now().toString(),
      type: 'verification',
      source: 'kilo',
      timestamp: new Date().toISOString(),
      payload: {
        message: 'SSE verification',
        broker: this.connectionStatus,
        timestamp: Date.now()
      }
    };
    
    console.log('Emitting test event...');
    const emitResult = this.emitEvent(testEvent);
    
    // Wait for event to propagate
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify event appears in stream
    const verificationResult = {
      eventEmitted: emitResult.success,
      eventId: testEvent.event_id,
      clientsConnected: this.stats.clientsConnected,
      eventsEmitted: this.stats.eventsEmitted,
      observable: this.stats.clientsConnected > 0
    };
    
    if (verificationResult.eventEmitted && verificationResult.clientsConnected > 0) {
      console.log('SUCCESS: Event flow verification passed');
      console.log(`- Test event: ${testEvent.event_id}`);
      console.log(`- Clients connected: ${verificationResult.clientsConnected}`);
      console.log(`- Events emitted: ${verificationResult.eventsEmitted}`);
    } else {
      console.log('FAILURE: Event flow verification failed');
      console.log(`- Event emitted: ${verificationResult.eventEmitted}`);
      console.log(`- Clients connected: ${verificationResult.clientsConnected}`);
    }
    
    return verificationResult;
  }

  emitEvent(event) {
    console.log(`Emitting event: ${event.event_id} (${event.type})`);
    
    // Validate event
    const validationResult = this.validateEvent(event);
    if (!validationResult.valid) {
      console.log(`Event validation failed: ${validationResult.errors.join(', ')}`);
      return { success: false, errors: validationResult.errors };
    }
    
    // Emit to SSE clients
    const eventData = `data: ${JSON.stringify(event)}\n\n`;
    let clientsReached = 0;
    
    this.clients.forEach(client => {
      try {
        client.write(eventData);
        clientsReached++;
      } catch (error) {
        console.log(`Failed to send event to client: ${error.message}`);
        // Remove disconnected client
        this.clients.delete(client);
      }
    });
    
    // Update stats
    this.stats.eventsEmitted++;
    this.stats.lastEventTime = new Date().toISOString();
    
    // Add to event channel
    if (this.eventChannels.has(event.type)) {
      this.eventChannels.get(event.type).add(event);
    }
    
    // Emit through event pipeline
    if (this.eventPipeline) {
      this.eventPipeline.emit(event).catch(error => {
        console.log(`Event pipeline emit failed: ${error.message}`);
      });
    }
    
    console.log(`Event emitted to ${clientsReached} SSE clients`);
    
    return { 
      success: true, 
      clientsReached,
      eventId: event.event_id 
    };
  }

  validateEvent(event) {
    const errors = [];
    
    // Check required fields
    if (!event.event_id) errors.push('Missing event_id');
    if (!event.type) errors.push('Missing type');
    if (!event.source) errors.push('Missing source');
    if (!event.timestamp) errors.push('Missing timestamp');
    if (!event.payload) errors.push('Missing payload');
    
    // Validate timestamp format
    if (event.timestamp) {
      const timestamp = new Date(event.timestamp);
      if (isNaN(timestamp.getTime())) {
        errors.push('Invalid timestamp format');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  getStatus() {
    return {
      connectionStatus: this.connectionStatus,
      clientsConnected: this.stats.clientsConnected,
      eventsEmitted: this.stats.eventsEmitted,
      lastEventTime: this.stats.lastEventTime,
      channels: Array.from(this.eventChannels.keys()),
      uptime: Date.now() - new Date(this.stats.startTime).getTime(),
      ursulaStatus: this.connectionStatus === 'external' ? 'REAL_TIME_SYNC' : 'LOCAL_BROKER'
    };
  }

  async shutdown() {
    console.log('Shutting down Kilo SSE Broker...');
    
    // Close all client connections
    this.clients.forEach(client => {
      try {
        client.end();
      } catch (error) {
        console.log(`Error closing client connection: ${error.message}`);
      }
    });
    
    this.clients.clear();
    
    if (this.sseServer) {
      return new Promise((resolve) => {
        this.sseServer.close(() => {
          console.log('Kilo SSE Broker shutdown complete');
          resolve();
        });
      });
    }
  }
}

// CLI interface
if (require.main === module) {
  const broker = new KiloSSEBroker();
  
  const command = process.argv[2] || 'establish';
  
  (async () => {
    switch (command) {
      case 'establish':
        await broker.establishEventFlow();
        
        // Keep server running if local
        if (broker.connectionStatus === 'local') {
          console.log('\nLocal SSE broker is running. Press Ctrl+C to stop.');
          
          process.on('SIGINT', async () => {
            console.log('\nShutting down...');
            await broker.shutdown();
            process.exit(0);
          });
          
          // Keep process alive
          setInterval(() => {}, 10000);
        }
        break;
        
      case 'test':
        const testResult = await broker.testConnection();
        console.log('Connection test result:', testResult);
        break;
        
      case 'status':
        const status = broker.getStatus();
        console.log('SSE Broker Status:', JSON.stringify(status, null, 2));
        break;
        
      default:
        console.log('Usage: node kilo-sse-broker.js [establish|test|status]');
    }
  })();
}

module.exports = { KiloSSEBroker };
