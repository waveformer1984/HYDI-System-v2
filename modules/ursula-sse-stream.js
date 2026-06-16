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
    this._totalClientsEver = 0; // fix #7: real counter instead of Math.random()
    this._startTime = null;
    this._pingIntervals = new Map(); // fix #9: track per-client intervals for cleanup
  }

  async initialize() {
    const express = require('express');
    const cors = require('cors');

    const app = express();
    app.use(cors());
    app.use(express.json());

    app.get('/events/stream', (req, res) => {
      console.log(`[URSULA] New SSE client connected: ${req.ip}`);

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
      this._totalClientsEver++; // fix #7
      console.log(`[URSULA] Active clients: ${this.clients.size}`);

      // Send connection confirmation
      this.sendToClient(clientId, {
        type: 'connection_established',
        client_id: clientId,
        timestamp: new Date().toISOString(),
        message: 'Connected to Ursula SSE stream'
      });

      // fix #8: send queued events without clearing the queue —
      // each new client gets its own copy; queue is capped at 100 entries
      for (const event of this.eventQueue) {
        this.sendToClient(clientId, event);
      }

      req.on('close', () => {
        console.log(`[URSULA] Client disconnected: ${clientId}`);
        this._clearClientPing(clientId); // fix #9
        this.clients.delete(clientId);
        console.log(`[URSULA] Active clients: ${this.clients.size}`);
      });

      req.on('error', (error) => {
        console.error(`[URSULA] Client error: ${clientId}`, error);
        this._clearClientPing(clientId); // fix #9
        this.clients.delete(clientId);
      });

      // fix #9: store interval handle so shutdown() can clear it
      const pingInterval = setInterval(() => {
        if (this.clients.has(clientId)) {
          this.sendToClient(clientId, { type: 'ping', timestamp: new Date().toISOString() });
        } else {
          this._clearClientPing(clientId);
        }
      }, 30000);
      this._pingIntervals.set(clientId, pingInterval);
    });

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

    app.get('/stats', (req, res) => {
      const clientStats = Array.from(this.clients.values()).map(client => ({
        id: client.id,
        connected_at: client.connected_at,
        ip: client.ip,
        duration: Date.now() - new Date(client.connected_at).getTime()
      }));
      res.json({
        active_clients: this.clients.size,
        total_clients_connected: this._totalClientsEver, // fix #7: real number
        queued_events: this.eventQueue.length,
        uptime: this.getUptime(),
        clients: clientStats
      });
    });

    return new Promise((resolve, reject) => {
      this.server = app.listen(this.port, (error) => {
        if (error) {
          reject(error);
        } else {
          this.isStreaming = true;
          this._startTime = Date.now();
          console.log(`[URSULA] SSE stream running on port ${this.port}`);
          console.log(`[URSULA] Stream endpoint: http://localhost:${this.port}/events/stream`);
          resolve();
        }
      });
    });
  }

  sendToClient(clientId, event) {
    const client = this.clients.get(clientId);
    if (client && client.response && !client.response.destroyed) {
      try {
        // fix #10: consistent SSE format — id + data only (matches UrsulaSSEManager)
        const eventData = `id: ${Date.now()}\ndata: ${JSON.stringify(event)}\n\n`;
        client.response.write(eventData);
        return true;
      } catch (error) {
        console.error(`[URSULA] Failed to send to client ${clientId}:`, error);
        this._clearClientPing(clientId);
        this.clients.delete(clientId);
        return false;
      }
    }
    return false;
  }

  broadcast(event) {
    if (this.clients.size === 0) {
      console.log(`[URSULA] No subscribers - queuing event: ${event.type}`);
      this.eventQueue.push(event);
      // fix #8: cap queue, don't clear on client connect
      if (this.eventQueue.length > 100) this.eventQueue.shift();
      return 0;
    }

    let sentCount = 0;
    const failedClients = [];

    for (const [clientId] of this.clients) {
      if (this.sendToClient(clientId, event)) {
        sentCount++;
      } else {
        failedClients.push(clientId);
      }
    }

    failedClients.forEach(clientId => {
      this._clearClientPing(clientId);
      this.clients.delete(clientId);
    });

    console.log(`[URSULA] Broadcast: ${event.type} to ${sentCount} clients`);
    return sentCount;
  }

  _clearClientPing(clientId) {
    // fix #9: clean up the per-client ping interval
    const interval = this._pingIntervals.get(clientId);
    if (interval) {
      clearInterval(interval);
      this._pingIntervals.delete(clientId);
    }
  }

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

  handleValidationEvent(validationEvent) {
    return this.broadcast({
      ...validationEvent,
      broadcast_channel: 'validation_events',
      timestamp: new Date().toISOString()
    });
  }

  handleRejectionEvent(rejectionEvent) {
    return this.broadcast({
      ...rejectionEvent,
      broadcast_channel: 'rejection_events',
      severity: this.calculateRejectionSeverity(rejectionEvent),
      requires_action: true
    });
  }

  calculateUrgency(opportunityEvent) {
    const classification = opportunityEvent.payload.opportunity_classification;
    const indicators = classification.indicators || [];
    if (indicators.includes('urgent_timeline') || indicators.includes('emergency')) return 'critical';
    if (classification.opportunity_type === 'high_value') return 'high';
    if (classification.opportunity_type === 'medium_value') return 'medium';
    return 'low';
  }

  calculateRejectionSeverity(rejectionEvent) {
    const errors = rejectionEvent.payload.validation_result?.errors || [];
    if (errors.some(e => e.includes('Missing required field'))) return 'high';
    if (errors.some(e => e.includes('Invalid'))) return 'medium';
    return 'low';
  }

  getTotalClientsConnected() {
    return this._totalClientsEver; // fix #7: real value
  }

  getUptime() {
    return this._startTime ? Math.floor((Date.now() - this._startTime) / 1000) : process.uptime();
  }

  isOperational() {
    return this.isStreaming && this.server && this.server.listening;
  }

  getSubscriberCount() {
    return this.clients.size;
  }

  async shutdown() {
    // fix #9: clear all ping intervals before closing
    for (const clientId of this._pingIntervals.keys()) {
      this._clearClientPing(clientId);
    }
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.isStreaming = false;
          console.log('[URSULA] SSE server shutdown');
          resolve();
        });
      });
    }
  }
}

module.exports = new UrsulaSSEStream();
