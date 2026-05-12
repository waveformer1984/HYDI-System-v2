// Event Stream Restoration - Real SSE Connectivity
require('dotenv').config();

class EventStreamRestoration {
  constructor() {
    this.sseServer = null;
    this.connectionStatus = 'disconnected';
    this.connectionAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 1000; // Start with 1 second
    this.eventsEmitted = 0;
    this.eventPipeline = null;
  }

  async restoreEventStream() {
    console.log('=== RESTORING REAL EVENT STREAM CONNECTIVITY ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Attempt SSE connection
      await this.attemptSSEConnection();
      
      // Phase 2: If failed, retry with exponential backoff
      if (this.connectionStatus !== 'connected') {
        console.log('Initial connection failed, proceeding with retry and fallback...');
        await this.retryWithBackoff();
      }
      
      // Phase 3: If still failing, spin up local SSE server
      if (this.connectionStatus !== 'connected') {
        await this.spinUpLocalServer();
      }
      
      // Phase 4: Verify event flow
      await this.verifyEventFlow();
      
      console.log('=== EVENT STREAM RESTORATION COMPLETE ===');
      
      return {
        status: this.connectionStatus,
        eventsEmitted: this.eventsEmitted,
        serverType: this.connectionStatus === 'connected' ? 'external' : 'local'
      };
      
    } catch (error) {
      console.log(`Event stream restoration failed: ${error.message}`);
      throw error;
    }
  }

  async attemptSSEConnection() {
    console.log('Phase 1: Attempting SSE connection to localhost:3002/events/stream');
    
    const http = require('http');
    
    const testConnection = () => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 3002,
          path: '/events/stream',
          method: 'GET',
          timeout: 5000,
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
          }
        });
        
        req.on('response', (res) => {
          console.log(`SSE connection response: ${res.statusCode}`);
          
          if (res.statusCode === 200) {
            this.connectionStatus = 'connected';
            console.log('SSE connection: SUCCESS');
            resolve({ success: true, status: res.statusCode });
          } else {
            console.log(`SSE connection: FAILED - Status ${res.statusCode}`);
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
        
        req.on('error', (error) => {
          console.log(`SSE connection error: ${error.message}`);
          reject(error);
        });
        
        req.on('timeout', () => {
          console.log('SSE connection: TIMEOUT');
          reject(new Error('Connection timeout'));
        });
        
        req.end();
      });
    };
    
    this.connectionAttempts++;
    
    try {
      const result = await testConnection();
      console.log('SSE connection test completed successfully');
      return result;
      
    } catch (error) {
      this.connectionStatus = 'failed';
      console.log(`SSE connection failed: ${error.message}`);
      throw error;
    }
  }

  async retryWithBackoff() {
    console.log('Phase 2: Retrying with exponential backoff');
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const delay = this.retryDelay * Math.pow(2, attempt - 1);
      
      console.log(`Retry attempt ${attempt}/${this.maxRetries} after ${delay}ms delay`);
      
      await this.sleep(delay);
      
      try {
        await this.attemptSSEConnection();
        
        if (this.connectionStatus === 'connected') {
          console.log(`SSE connection restored on attempt ${attempt}`);
          return;
        }
        
      } catch (error) {
        console.log(`Retry ${attempt} failed: ${error.message}`);
        
        if (attempt === this.maxRetries) {
          console.log('All retry attempts exhausted');
          throw new Error('SSE connection could not be restored after retries');
        }
      }
    }
  }

  async spinUpLocalServer() {
    console.log('Phase 3: Spinning up local SSE server on port 3002');
    
    try {
      // Check if port is in use
      const portAvailable = await this.checkPortAvailable(3002);
      
      if (!portAvailable) {
        console.log('Port 3002 is in use, attempting to kill existing process...');
        await this.killPortProcess(3002);
        await this.sleep(2000); // Wait for process to die
      }
      
      // Start local SSE server
      await this.startLocalSSEServer();
      
      this.connectionStatus = 'local_server';
      console.log('Local SSE server started successfully');
      
    } catch (error) {
      console.log(`Failed to start local SSE server: ${error.message}`);
      throw error;
    }
  }

  async checkPortAvailable(port) {
    const net = require('net');
    
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => {
          resolve(true); // Port is available
        });
      });
      
      server.on('error', () => {
        resolve(false); // Port is in use
      });
    });
  }

  async killPortProcess(port) {
    const { exec } = require('child_process');
    
    return new Promise((resolve, reject) => {
      // Try to find and kill process using the port
      exec(`netstat -ano | findstr :${port}`, (error, stdout, stderr) => {
        if (error) {
          console.log(`Could not check port ${port}: ${error.message}`);
          resolve(false);
          return;
        }
        
        const lines = stdout.split('\n');
        const targetLine = lines.find(line => line.includes(`:${port}`));
        
        if (targetLine) {
          const parts = targetLine.trim().split(/\s+/);
          const pid = parts[1];
          
          if (pid && !isNaN(pid)) {
            console.log(`Found process ${pid} on port ${port}, attempting to kill...`);
            
            exec(`taskkill /PID ${pid} /F`, (killError) => {
              if (killError) {
                console.log(`Failed to kill process ${pid}: ${killError.message}`);
                resolve(false);
              } else {
                console.log(`Successfully killed process ${pid}`);
                resolve(true);
              }
            });
          } else {
            console.log('Could not extract PID from netstat output');
            resolve(false);
          }
        } else {
          console.log(`No process found on port ${port}`);
          resolve(true);
        }
      });
    });
  }

  async startLocalSSEServer() {
    const http = require('http');
    const url = require('url');
    
    this.sseServer = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      
      if (parsedUrl.pathname === '/events/stream') {
        console.log('SSE client connected to local server');
        
        // Set SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        
        // Send initial comment
        res.write(': local-sse-server-started\n\n');
        
        // Keep connection alive with periodic comments
        const keepAliveInterval = setInterval(() => {
          res.write(': keep-alive\n\n');
        }, 30000);
        
        // Store connection for event emission
        this.sseConnection = res;
        this.sseKeepAliveInterval = keepAliveInterval;
        
        // Handle client disconnect
        res.on('close', () => {
          console.log('SSE client disconnected from local server');
          clearInterval(keepAliveInterval);
          this.sseConnection = null;
        });
        
      } else {
        // Health check endpoint
        if (parsedUrl.pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'healthy',
            server: 'local-sse',
            timestamp: new Date().toISOString(),
            eventsEmitted: this.eventsEmitted
          }));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      }
    });
    
    return new Promise((resolve, reject) => {
      this.sseServer.listen(3002, (error) => {
        if (error) {
          console.log(`Failed to start local SSE server: ${error.message}`);
          reject(error);
        } else {
          console.log('Local SSE server listening on port 3002');
          resolve();
        }
      });
    });
  }

  async verifyEventFlow() {
    console.log('Phase 4: Verifying event flow');
    
    // Connect to event pipeline
    const { EventPipeline } = require('./event-pipeline');
    this.eventPipeline = new EventPipeline();
    await this.eventPipeline.initialize();
    
    // Emit test event
    const testEvent = {
      event_id: 'test-event-' + Date.now().toString(),
      type: 'test',
      source: 'event_stream_restoration',
      timestamp: new Date().toISOString(),
      payload: {
        message: 'Test event for event stream verification',
        verification: true
      }
    };
    
    console.log('Emitting test event...');
    
    try {
      const result = await this.eventPipeline.emit(testEvent);
      this.eventsEmitted++;
      
      console.log(`Test event emitted successfully: ${result.success}`);
      console.log(`Event ID: ${testEvent.event_id}`);
      
      // Wait a moment for event processing
      await this.sleep(1000);
      
      // Verify event was received (check event stream)
      const eventStream = this.eventPipeline.getEventStream();
      const foundEvent = eventStream.find(e => e.event_id === testEvent.event_id);
      
      if (foundEvent) {
        console.log('Event flow verification: SUCCESS');
        console.log('Events are flowing in real-time');
        
        return {
          success: true,
          eventId: testEvent.event_id,
          eventsInStream: eventStream.length
        };
        
      } else {
        console.log('Event flow verification: FAILED');
        console.log('Test event not found in event stream');
        
        return {
          success: false,
          error: 'Test event not found in event stream',
          eventId: testEvent.event_id
        };
      }
      
    } catch (error) {
      console.log(`Event flow verification failed: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        eventId: testEvent.event_id
      };
    }
  }

  async emitEvent(event) {
    if (this.sseConnection) {
      const eventData = `data: ${JSON.stringify(event)}\n\n`;
      
      try {
        this.sseConnection.write(eventData);
        this.eventsEmitted++;
        
        console.log(`Event emitted to SSE stream: ${event.event_id}`);
        return { success: true, emitted: true };
        
      } catch (error) {
        console.log(`Failed to emit event to SSE stream: ${error.message}`);
        return { success: false, error: error.message, emitted: false };
      }
      
    } else {
      console.log('No SSE connection available for event emission');
      return { success: false, error: 'No SSE connection', emitted: false };
    }
  }

  async getStatus() {
    return {
      connectionStatus: this.connectionStatus,
      connectionAttempts: this.connectionAttempts,
      eventsEmitted: this.eventsEmitted,
      serverType: this.connectionStatus === 'connected' ? 'external' : 'local',
      serverRunning: !!this.sseServer,
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    console.log('Shutting down event stream restoration...');
    
    if (this.sseKeepAliveInterval) {
      clearInterval(this.sseKeepAliveInterval);
      this.sseKeepAliveInterval = null;
    }
    
    if (this.sseConnection) {
      this.sseConnection.end();
      this.sseConnection = null;
    }
    
    if (this.sseServer) {
      return new Promise((resolve) => {
        this.sseServer.close(() => {
          console.log('Local SSE server shutdown complete');
          resolve();
        });
      });
    }
    
    console.log('Event stream restoration shutdown complete');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
if (require.main === module) {
  const restoration = new EventStreamRestoration();
  
  const command = process.argv[2] || 'restore';
  
  (async () => {
    switch (command) {
      case 'restore':
        await restoration.restoreEventStream();
        
        // Keep server running if local
        if (restoration.connectionStatus === 'local_server') {
          console.log('\nLocal SSE server is running. Press Ctrl+C to stop.');
          
          process.on('SIGINT', async () => {
            console.log('\nShutting down...');
            await restoration.shutdown();
            process.exit(0);
          });
          
          // Keep process alive
          setInterval(() => {}, 10000);
        }
        break;
        
      case 'status':
        const status = await restoration.getStatus();
        console.log('Event Stream Status:', JSON.stringify(status, null, 2));
        break;
        
      case 'verify':
        await restoration.restoreEventStream();
        break;
        
      case 'emit':
        const testEvent = {
          event_id: 'manual-test-' + Date.now().toString(),
          type: 'manual_test',
          source: 'cli',
          timestamp: new Date().toISOString(),
          payload: { message: 'Manual test event' }
        };
        
        await restoration.emitEvent(testEvent);
        break;
        
      default:
        console.log('Usage: node event-stream-restoration.js [restore|status|verify|emit]');
    }
  })();
}

module.exports = { EventStreamRestoration };
