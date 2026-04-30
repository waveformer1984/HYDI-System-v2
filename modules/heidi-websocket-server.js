/**
 * Heidi WebSocket Server
 * Real-time communication for Heidi mobile chat
 */

const WebSocket = require('ws');
const { HeidiLocalHandler } = require('../api/local-model');

class HeidiWebSocketServer {
  constructor(server, options = {}) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws/heidi'
    });
    
    this.clients = new Map();
    this.heidiHandler = new HeidiLocalHandler({
      baseURL: process.env.LOCAL_MODEL_URL || 'http://localhost:11434',
      model: process.env.LOCAL_MODEL_NAME || 'llama2',
      provider: process.env.LOCAL_MODEL_PROVIDER || 'ollama'
    });
    
    this.healthPollInterval = options.healthPollInterval || 30000;
    this.reconnectInterval = options.reconnectInterval || 5000;
    
    this.initialize();
  }

  async initialize() {
    console.log('[Heidi WS] Starting WebSocket server...');
    
    // Initialize Heidi handler
    try {
      await this.heidiHandler.initialize();
    } catch (error) {
      console.error('[Heidi WS] Failed to initialize local models:', error);
    }
    
    // Set up WebSocket handlers
    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleError.bind(this));
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    console.log('[Heidi WS] WebSocket server ready');
  }

  handleConnection(ws, req) {
    const clientId = this.generateClientId();
    const clientInfo = {
      id: clientId,
      ws,
      connected: new Date(),
      lastActivity: new Date(),
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.socket.remoteAddress
    };
    
    this.clients.set(clientId, clientInfo);
    console.log(`[Heidi WS] Client connected: ${clientId}`);
    
    // Send welcome message
    this.sendToClient(clientId, {
      type: 'system',
      message: 'Connected to Heidi WebSocket server',
      clientId,
      timestamp: new Date().toISOString()
    });
    
    // Set up message handlers
    ws.on('message', (data) => this.handleMessage(clientId, data));
    ws.on('close', () => this.handleDisconnection(clientId));
    ws.on('error', (error) => this.handleClientError(clientId, error));
    
    // Send initial health status
    this.sendHealthUpdate(clientId);
  }

  handleMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    client.lastActivity = new Date();
    
    try {
      const message = JSON.parse(data);
      this.processMessage(clientId, message);
    } catch (error) {
      console.error(`[Heidi WS] Invalid message from ${clientId}:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        message: 'Invalid message format',
        timestamp: new Date().toISOString()
      });
    }
  }

  async processMessage(clientId, message) {
    const { type, content, model, action } = message;
    
    switch (type) {
      case 'message':
        await this.handleChatMessage(clientId, content, model);
        break;
        
      case 'ping':
        this.sendToClient(clientId, {
          type: 'pong',
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'status':
        await this.sendStatus(clientId);
        break;
        
      case 'models':
        await this.sendModels(clientId);
        break;
        
      case 'switch_model':
        await this.switchModel(clientId, model);
        break;
        
      default:
        this.sendToClient(clientId, {
          type: 'error',
          message: `Unknown message type: ${type}`,
          timestamp: new Date().toISOString()
        });
    }
  }

  async handleChatMessage(clientId, content, modelName) {
    // Switch model if requested
    if (modelName && modelName !== this.heidiHandler.client.model) {
      try {
        await this.heidiHandler.switchModel(modelName);
      } catch (error) {
        this.sendToClient(clientId, {
          type: 'error',
          message: `Failed to switch to model ${modelName}: ${error.message}`,
          timestamp: new Date().toISOString()
        });
        return;
      }
    }
    
    // Send typing indicator
    this.sendToClient(clientId, {
      type: 'typing',
      sender: 'heidi',
      timestamp: new Date().toISOString()
    });
    
    try {
      const response = await this.heidiHandler.handleMessage(content);
      
      this.sendToClient(clientId, {
        type: 'message',
        sender: 'heidi',
        content: response.text,
        model: response.model,
        provider: response.provider,
        healthContext: response.healthContext,
        usage: response.usage,
        fallback: response.fallback,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`[Heidi WS] Chat error for ${clientId}:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        message: 'Sorry, I had trouble processing that message. Please try again.',
        timestamp: new Date().toISOString()
      });
    }
  }

  async sendStatus(clientId) {
    try {
      const available = await this.heidiHandler.client.isAvailable();
      const models = available ? await this.heidiHandler.client.getModels() : [];
      
      this.sendToClient(clientId, {
        type: 'status',
        initialized: true,
        available,
        currentModel: this.heidiHandler.client.model,
        provider: this.heidiHandler.client.provider,
        availableModels: models,
        connectedClients: this.clients.size,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'status',
        initialized: false,
        available: false,
        error: error.message,
        connectedClients: this.clients.size,
        timestamp: new Date().toISOString()
      });
    }
  }

  async sendModels(clientId) {
    try {
      const models = await this.heidiHandler.client.getModels();
      
      this.sendToClient(clientId, {
        type: 'models',
        models,
        current: this.heidiHandler.client.model,
        provider: this.heidiHandler.client.provider,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'error',
        message: `Failed to get models: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  async switchModel(clientId, modelName) {
    try {
      await this.heidiHandler.switchModel(modelName);
      
      this.sendToClient(clientId, {
        type: 'model_switched',
        model: modelName,
        message: `Switched to model: ${modelName}`,
        timestamp: new Date().toISOString()
      });
      
      // Broadcast to all clients
      this.broadcast({
        type: 'system',
        message: `Heidi switched to model: ${modelName}`,
        timestamp: new Date().toISOString()
      }, clientId);
      
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'error',
        message: `Failed to switch model: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  sendToClient(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      client.ws.send(JSON.stringify(data));
    } catch (error) {
      console.error(`[Heidi WS] Failed to send to ${clientId}:`, error);
      this.handleDisconnection(clientId);
    }
  }

  broadcast(data, excludeClientId = null) {
    const message = JSON.stringify(data);
    
    this.clients.forEach((client, clientId) => {
      if (clientId === excludeClientId) return;
      if (client.ws.readyState !== WebSocket.OPEN) return;
      
      try {
        client.ws.send(message);
      } catch (error) {
        console.error(`[Heidi WS] Broadcast failed to ${clientId}:`, error);
      }
    });
  }

  handleDisconnection(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      console.log(`[Heidi WS] Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
    }
  }

  handleClientError(clientId, error) {
    console.error(`[Heidi WS] Client error ${clientId}:`, error);
    this.handleDisconnection(clientId);
  }

  handleError(error) {
    console.error('[Heidi WS] WebSocket server error:', error);
  }

  generateClientId() {
    return `heidi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Health monitoring
   */
  startHealthMonitoring() {
    // Poll health status and broadcast updates
    setInterval(async () => {
      try {
        const health = await this.getHealthStatus();
        this.broadcast({
          type: 'health_update',
          health,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('[Heidi WS] Health monitoring error:', error);
      }
    }, this.healthPollInterval);
  }

  async getHealthStatus() {
    try {
      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/system_dashboard?select=*`, {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return data[0] || null;
      }
    } catch (error) {
      console.error('[Heidi WS] Failed to get health status:', error);
    }
    
    return null;
  }

  sendHealthUpdate(clientId) {
    this.getHealthStatus().then(health => {
      if (health) {
        this.sendToClient(clientId, {
          type: 'health_update',
          health,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  /**
   * Get server stats
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      model: this.heidiHandler.client.model,
      provider: this.heidiHandler.client.provider,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = HeidiWebSocketServer;
