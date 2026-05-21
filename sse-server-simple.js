// Simple SSE Server - Direct Local Server Setup
require('dotenv').config();

class SimpleSServer {
  constructor() {
    this.server = null;
    this.clients = [];
    this.eventsEmitted = 0;
  }

  async start() {
    console.log('=== STARTING SIMPLE SSE SERVER ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    const http = require('http');
    const url = require('url');
    
    this.server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      
      if (parsedUrl.pathname === '/events/stream') {
        console.log('SSE client connected');
        
        // Set SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control'
        });
        
        // Send initial comment
        res.write(': sse-server-started\n\n');
        
        // Store client
        this.clients.push(res);
        
        // Handle client disconnect
        res.on('close', () => {
          console.log('SSE client disconnected');
          const index = this.clients.indexOf(res);
          if (index > -1) {
            this.clients.splice(index, 1);
          }
        });
        
        // Keep connection alive with periodic comments
        const keepAliveInterval = setInterval(() => {
          if (this.clients.includes(res)) {
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
          server: 'simple-sse',
          timestamp: new Date().toISOString(),
          clientsConnected: this.clients.length,
          eventsEmitted: this.eventsEmitted
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
      this.server.listen(3002, (error) => {
        if (error) {
          console.log(`Failed to start SSE server: ${error.message}`);
          reject(error);
        } else {
          console.log('SSE server listening on port 3002');
          console.log('Endpoints:');
          console.log('  - SSE Stream: http://localhost:3002/events/stream');
          console.log('  - Health: http://localhost:3002/health');
          console.log('  - Emit Event: POST http://localhost:3002/emit');
          resolve();
        }
      });
    });
  }

  emitEvent(event) {
    const eventData = `data: ${JSON.stringify(event)}\n\n`;
    
    this.clients.forEach(client => {
      try {
        client.write(eventData);
        this.eventsEmitted++;
      } catch (error) {
        console.log(`Failed to send event to client: ${error.message}`);
        // Remove disconnected client
        const index = this.clients.indexOf(client);
        if (index > -1) {
          this.clients.splice(index, 1);
        }
      }
    });
    
    console.log(`Event emitted to ${this.clients.length} clients: ${event.event_id}`);
    return { success: true, clients: this.clients.length };
  }

  async testEventFlow() {
    console.log('Testing event flow...');
    
    const testEvent = {
      event_id: 'test-event-' + Date.now().toString(),
      type: 'test',
      source: 'sse-server',
      timestamp: new Date().toISOString(),
      payload: {
        message: 'Test event for SSE server verification',
        verification: true
      }
    };
    
    const result = this.emitEvent(testEvent);
    
    console.log(`Test event emitted: ${testEvent.event_id}`);
    console.log(`Clients connected: ${this.clients.length}`);
    console.log(`Events emitted: ${this.eventsEmitted}`);
    
    return {
      success: true,
      eventId: testEvent.event_id,
      clientsConnected: this.clients.length,
      eventsEmitted: this.eventsEmitted
    };
  }

  getStatus() {
    return {
      status: 'processing',
      port: 3002,
      clientsConnected: this.clients.length,
      eventsEmitted: this.eventsEmitted,
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    console.log('Shutting down SSE server...');
    
    // Close all client connections
    this.clients.forEach(client => {
      try {
        client.end();
      } catch (error) {
        console.log(`Error closing client connection: ${error.message}`);
      }
    });
    
    this.clients = [];
    
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('SSE server shutdown complete');
          resolve();
        });
      });
    }
  }
}

// CLI interface
if (require.main === module) {
  const server = new SimpleSServer();
  
  const command = process.argv[2] || 'start';
  
  (async () => {
    switch (command) {
      case 'start':
        await server.start();
        
        // Test event flow after starting
        setTimeout(async () => {
          await server.testEventFlow();
        }, 1000);
        
        console.log('\nSSE server is running. Press Ctrl+C to stop.');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
          console.log('\nShutting down...');
          await server.shutdown();
          process.exit(0);
        });
        
        // Keep process alive
        setInterval(() => {}, 10000);
        break;
        
      case 'test':
        await server.start();
        await server.testEventFlow();
        await server.shutdown();
        break;
        
      case 'status':
        const status = server.getStatus();
        console.log('SSE Server Status:', JSON.stringify(status, null, 2));
        break;
        
      default:
        console.log('Usage: node sse-server-simple.js [start|test|status]');
    }
  })();
}

module.exports = { SimpleSServer };
