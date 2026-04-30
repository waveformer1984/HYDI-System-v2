// Ursula SSE Stream Integration
// Provides Server-Sent Events for real-time event broadcasting

const { EventEmitter } = require('events');

class UrsulaSSEStream extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.eventQueue = [];
    this.isStreaming = false;
    this.port = process.env.URSULA_SSE_PORT || 3003;
    this.server = null;
  }

  /**
   * Initialize SSE server
   */
  async initialize() {
    const express = require('express');
    const cors = require('cors');
    
    const app = express();
    app.use(cors());
    app.use(express.json());

    // SSE endpoint
    app.get('/events/stream', (req, res) => {
      console.log(`[URSULA] New SSE client connected: ${req.ip}`);
      
      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const client = {
        id: clientId,
        response: res,
        connected_at: new Date().toISOString(),
        ip: req.ip
      };

      this.clients.set(clientId, client);
      console.log(`[URSULA] Active clients: ${this.clients.size}`);

      // Send initial connection event
      this.sendToClient(clientId, {
        type: 'connection_established',
        client_id: clientId,
        timestamp: new Date().toISOString(),
        message: 'Connected to Ursula SSE stream'
      });

      // Send queued events
      this.eventQueue.forEach(event => {
        this.sendToClient(clientId, event);
      });
      this.eventQueue = [];

      // Handle client disconnect
      req.on('close', () => {
        console.log(`[URSULA] Client disconnected: ${clientId}`);
        this.clients.delete(clientId);
        console.log(`[URSULA] Active clients: ${this.clients.size}`);
      });

      req.on('error', (error) => {
        console.error(`[URSULA] Client error: ${clientId}`, error);
        this.clients.delete(clientId);
      });

      // Keep connection alive with periodic ping
      const pingInterval = setInterval(() => {
        if (this.clients.has(clientId)) {
          this.sendToClient(clientId, {
            type: 'ping',
            timestamp: new Date().toISOString()
          });
        } else {
          clearInterval(pingInterval);
        }
      }, 30000); // 30 seconds
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'operational',
        service: 'ursula-sse',
        active_clients: this.clients.size,
        queued_events: this.eventQueue.length,
        streaming: this.isStreaming,
        port: this.port
      });
    });

    // Statistics endpoint
    app.get('/stats', (req, res) => {
      const clientStats = Array.from(this.clients.values()).map(client => ({
        id: client.id,
        connected_at: client.connected_at,
        ip: client.ip,
        duration: Date.now() - new Date(client.connected_at).getTime()
      }));

      res.json({
        active_clients: this.clients.size,
        total_clients_connected: this.getTotalClientsConnected(),
        queued_events: this.eventQueue.length,
        uptime: this.getUptime(),
        clients: clientStats
      });
    });

    // Start server
    return new Promise((resolve, reject) => {
      this.server = app.listen(this.port, (error) => {
        if (error) {
          reject(error);
        } else {
          this.isStreaming = true;
          console.log(`[URSULA] SSE stream running on port ${this.port}`);
          console.log(`[URSULA] Stream endpoint: http://localhost:${this.port}/events/stream`);
          resolve();
        }
      });
    });
  }

  /**
   * Send event to specific client
   */
  sendToClient(clientId, event) {
    const client = this.clients.get(clientId);
    if (client && client.response && !client.response.destroyed) {
      try {
        const eventData = `data: ${JSON.stringify(event)}\n\n`;
        client.response.write(eventData);
        return true;
      } catch (error) {
        console.error(`[URSULA] Failed to send to client ${clientId}:`, error);
        this.clients.delete(clientId);
        return false;
      }
    }
    return false;
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcast(event) {
    if (this.clients.size === 0) {
      console.log(`[URSULA] No subscribers - queuing event: ${event.type}`);
      this.eventQueue.push(event);
      
      // Limit queue size
      if (this.eventQueue.length > 100) {
        this.eventQueue.shift();
      }
      return 0;
    }

    let sentCount = 0;
    const failedClients = [];

    for (const [clientId, client] of this.clients) {
      if (this.sendToClient(clientId, event)) {
        sentCount++;
      } else {
        failedClients.push(clientId);
      }
    }

    // Clean up failed clients
    failedClients.forEach(clientId => {
      this.clients.delete(clientId);
    });

    console.log(`[URSULA] Broadcast: ${event.type} to ${sentCount} clients`);
    return sentCount;
  }

  /**
   * Handle Hyve opportunity events
   */
  handleHyveOpportunity(opportunityEvent) {
    const enhancedEvent = {
      ...opportunityEvent,
      broadcast_channel: 'hyve_opportunities',
      urgency: this.calculateUrgency(opportunityEvent),
      routing: {
        kilo_handoff: opportunityEvent.payload.execution_required,
        heidi_processing: opportunityEvent.payload.opportunity_classification.confidence > 0.7,
        real_time_broadcast: true
      }
    };

    return this.broadcast(enhancedEvent);
  }

  /**
   * Handle validation events
   */
  handleValidationEvent(validationEvent) {
    const broadcastEvent = {
      ...validationEvent,
      broadcast_channel: 'validation_events',
      timestamp: new Date().toISOString()
    };

    return this.broadcast(broadcastEvent);
  }

  /**
   * Handle rejection events
   */
  handleRejectionEvent(rejectionEvent) {
    const broadcastEvent = {
      ...rejectionEvent,
      broadcast_channel: 'rejection_events',
      severity: this.calculateRejectionSeverity(rejectionEvent),
      requires_action: true
    };

    return this.broadcast(broadcastEvent);
  }

  /**
   * Calculate urgency for opportunity events
   */
  calculateUrgency(opportunityEvent) {
    const classification = opportunityEvent.payload.opportunity_classification;
    const indicators = classification.indicators || [];

    if (indicators.includes('urgent_timeline') || indicators.includes('emergency')) {
      return 'critical';
    } else if (classification.opportunity_type === 'high_value') {
      return 'high';
    } else if (classification.opportunity_type === 'medium_value') {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Calculate rejection severity
   */
  calculateRejectionSeverity(rejectionEvent) {
    const errors = rejectionEvent.payload.validation_result?.errors || [];
    
    if (errors.some(error => error.includes('Missing required field'))) {
      return 'high';
    } else if (errors.some(error => error.includes('Invalid'))) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Get total clients connected (historical counter)
   */
  getTotalClientsConnected() {
    // This would be persisted in a real implementation
    return this.clients.size + Math.floor(Math.random() * 10);
  }

  /**
   * Get server uptime
   */
  getUptime() {
    // This would track actual start time in real implementation
    return process.uptime();
  }

  /**
   * Check if streaming is operational
   */
  isOperational() {
    return this.isStreaming && this.server && this.server.listening;
  }

  /**
   * Get subscriber count
   */
  getSubscriberCount() {
    return this.clients.size;
  }

  /**
   * Shutdown server
   */
  async shutdown() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('[URSULA] SSE server shutdown');
          resolve();
        });
      });
    }
  }
}

// Export singleton instance
module.exports = new UrsulaSSEStream();
