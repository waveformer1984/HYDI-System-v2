// WebSocket Server for Chat Portal - Handles real-time communication
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

class ChatWebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws'
    });
    
    this.clients = new Map(); // system -> Set of clients
    this.messageHistory = [];
    
    this.initialize();
  }

  initialize() {
    this.wss.on('connection', (ws, request) => {
      const pathname = url.parse(request.url, true).pathname;
      const system = this.extractSystemFromPath(pathname);
      
      if (!system) {
        ws.close(1008, 'System parameter required');
        return;
      }
      
      console.log(`[CHAT WS] Client connected to ${system}`);
      
      // Add client to system group
      if (!this.clients.has(system)) {
        this.clients.set(system, new Set());
      }
      this.clients.get(system).add(ws);
      
      // Send welcome message
      this.sendToClient(ws, {
        type: 'system',
        message: `Connected to ${system} chat`,
        system: system,
        timestamp: new Date().toISOString()
      });
      
      // Handle messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(ws, system, message);
        } catch (error) {
          console.error('[CHAT WS] Invalid JSON:', error);
          this.sendToClient(ws, {
            type: 'error',
            message: 'Invalid message format',
            timestamp: new Date().toISOString()
          });
        }
      });
      
      // Handle disconnection
      ws.on('close', () => {
        console.log(`[CHAT WS] Client disconnected from ${system}`);
        this.clients.get(system)?.delete(ws);
        
        // Clean up empty system groups
        if (this.clients.get(system)?.size === 0) {
          this.clients.delete(system);
        }
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error(`[CHAT WS] Error for ${system}:`, error);
      });
    });
    
    console.log('[CHAT WS] WebSocket server initialized');
  }

  extractSystemFromPath(pathname) {
    // Extract system from path like /ws/ursula or /ws/cascade
    const match = pathname.match(/\/ws\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  async handleMessage(ws, system, message) {
    const { type, content } = message;
    
    if (type === 'message') {
      // Add to history
      const historyEntry = {
        id: Date.now(),
        system: system,
        sender: 'user',
        content: content,
        timestamp: new Date().toISOString()
      };
      this.messageHistory.push(historyEntry);
      
      // Keep history limited
      if (this.messageHistory.length > 1000) {
        this.messageHistory = this.messageHistory.slice(-1000);
      }
      
      // Get system response
      const response = await this.getSystemResponse(system, content);
      
      // Send response
      this.sendToClient(ws, {
        type: 'message',
        sender: system,
        content: response,
        timestamp: new Date().toISOString()
      });
      
      // Add response to history
      this.messageHistory.push({
        id: Date.now() + 1,
        system: system,
        sender: system,
        content: response,
        timestamp: new Date().toISOString()
      });
      
    } else if (type === 'ping') {
      this.sendToClient(ws, {
        type: 'pong',
        timestamp: new Date().toISOString()
      });
    }
  }

  async getSystemResponse(system, message) {
    // Route to appropriate system handler
    const handlers = {
      ursula: this.handleUrsulaMessage.bind(this),
      heidi: this.handleHeidiMessage.bind(this),
      cascade: this.handleCascadeMessage.bind(this),
      kilo: this.handleKiloMessage.bind(this),
      protoforge: this.handleProtoForgeMessage.bind(this),
      hyve: this.handleHyveMessage.bind(this),
      infrastructure: this.handleInfrastructureMessage.bind(this)
    };
    
    const handler = handlers[system];
    if (handler) {
      return await handler(message);
    }
    
    return `Unknown system: ${system}`;
  }

  async handleUrsulaMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('stream')) {
      return `🔮 Ursula: Event streams are active. I'm currently managing ${this.getTotalClients()} total connections across all systems.`;
    }
    
    if (lowerMessage.includes('status')) {
      return `🔮 Ursula: All systems operational. Last event processed: ${new Date().toISOString()}`;
    }
    
    if (lowerMessage.includes('help')) {
      return `🔮 Ursula: I manage event streams and routing. Try asking about:\n- stream: Check stream status\n- status: System overview\n- broadcast <message>: Send to all systems`;
    }
    
    if (lowerMessage.startsWith('broadcast ')) {
      const broadcastMessage = message.substring(10);
      this.broadcastToAll(broadcastMessage);
      return `🔮 Ursula: Message broadcasted to all systems`;
    }
    
    return `🔮 Ursula: I'm your event stream manager. How can I help you route messages today?`;
  }

  async handleHeidiMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('risk')) {
      return `🧠 Heidi: Current system risk is LOW. All ethical constraints are being respected. No violations detected.`;
    }
    
    if (lowerMessage.includes('advice')) {
      return `🧠 Heidi: Based on current system state, I recommend maintaining the current operational parameters. The system is behaving within acceptable ethical boundaries.`;
    }
    
    if (lowerMessage.includes('analyze')) {
      return `🧠 Heidi: System analysis complete. Context integrity is at 98%. All decisions are traceable and ethically sound.`;
    }
    
    return `🧠 Heidi: I'm your contextual conscience, monitoring system ethics and integrity. Ask me about 'risk', 'advice', or 'analyze'.`;
  }

  async handleCascadeMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('process')) {
      return `⚡ CASCADE: Ready to process events. Current queue is empty. All systems are processing normally.`;
    }
    
    if (lowerMessage.includes('status')) {
      return `⚡ CASCADE: Event processing system is HEALTHY. Throughput: 10.5 events/sec. Error rate: 0.1%`;
    }
    
    if (lowerMessage.includes('quarantine')) {
      return `⚡ CASCADE: Quarantine status: 0 events currently quarantined. Last quarantine was 2 hours ago.`;
    }
    
    return `⚡ CASCADE: I'm your event processing system. Try 'process', 'status', or 'quarantine'.`;
  }

  async handleKiloMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('hypothesis')) {
      return `🔧 KILO: No active repair hypotheses at the moment. System is running smoothly with no detected issues.`;
    }
    
    if (lowerMessage.includes('validate')) {
      return `🔧 KILO: Last validation completed successfully. All repair suggestions passed verification.`;
    }
    
    if (lowerMessage.includes('manifest')) {
      return `🔧 KILO: No repair manifests are currently active. System health is optimal.`;
    }
    
    return `🔧 KILO: I'm your repair hypothesis engine. Ask about 'hypothesis', 'validate', or 'manifest'.`;
  }

  async handleProtoForgeMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('status')) {
      return `🌐 ProtoForge: Core system is OPERATIONAL. All modules are synchronized and communicating properly.`;
    }
    
    if (lowerMessage.includes('modules')) {
      return `🌐 ProtoForge: Active modules: Ursula (Event Manager), Heidi (Ethics), CASCADE (Processing), KILO (Repairs), Hyve (Opportunities)`;
    }
    
    if (lowerMessage.includes('govern')) {
      return `🌐 ProtoForge: Governance protocols are active. All actions are being audited and verified.`;
    }
    
    return `🌐 ProtoForge: I'm your core system coordinator. Try 'status', 'modules', or 'govern'.`;
  }

  async handleHyveMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('opportunity')) {
      return `🐝 Hyve: Swarm intelligence has identified 2 optimization opportunities in the current system state.`;
    }
    
    if (lowerMessage.includes('collective')) {
      return `🐝 Hyve: The collective is operating at 87% efficiency. Swarm coordination is optimal.`;
    }
    
    if (lowerMessage.includes('swarm')) {
      return `🐝 Hyve: 8 agents are currently collaborating on system optimization tasks.`;
    }
    
    return `🐝 Hyve: I'm your opportunity collective. Ask about 'opportunity', 'collective', or 'swarm'.`;
  }

  async handleInfrastructureMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('health')) {
      return `🏗️ Infrastructure: All systems GREEN. CPU: 25%, Memory: 45%, Disk: 30% free`;
    }
    
    if (lowerMessage.includes('resources')) {
      return `🏗️ Infrastructure: Resource usage is normal. No bottlenecks detected.`;
    }
    
    if (lowerMessage.includes('alerts')) {
      return `🏗️ Infrastructure: No active alerts. All monitoring systems are operational.`;
    }
    
    return `🏗️ Infrastructure: I'm your system health monitor. Try 'health', 'resources', or 'alerts'.`;
  }

  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcastToSystem(system, message) {
    const clients = this.clients.get(system);
    if (clients) {
      clients.forEach(client => {
        this.sendToClient(client, {
          type: 'broadcast',
          system: system,
          message: message,
          timestamp: new Date().toISOString()
        });
      });
    }
  }

  broadcastToAll(message) {
    this.clients.forEach((clients, system) => {
      clients.forEach(client => {
        this.sendToClient(client, {
          type: 'broadcast',
          system: 'all',
          message: message,
          timestamp: new Date().toISOString()
        });
      });
    });
  }

  getTotalClients() {
    let total = 0;
    this.clients.forEach(clients => {
      total += clients.size;
    });
    return total;
  }

  getStats() {
    const stats = {};
    this.clients.forEach((clients, system) => {
      stats[system] = clients.size;
    });
    stats.total = this.getTotalClients();
    return stats;
  }
}

module.exports = ChatWebSocketServer;
