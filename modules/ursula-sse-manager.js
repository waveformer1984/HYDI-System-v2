// Simple SSE Manager for ProtoForge
// Actually implements the methods the server expects

const { EventEmitter } = require('events');

class UrsulaSSEManager extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // clientId -> response object
  }
  
  /**
   * Add a client connection
   */
  addClient(response, clientId = null) {
    const id = clientId || `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.clients.set(id, {
      id,
      response,
      connected_at: new Date()
    });
    
    console.log(`[URSULA] Client added: ${id}. Total clients: ${this.clients.size}`);
    return id;
  }
  
  /**
   * Remove a client connection
   */
  removeClient(clientId) {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      console.log(`[URSULA] Client removed: ${clientId}. Total clients: ${this.clients.size}`);
    }
  }
  
  /**
   * Check if we have subscribers
   */
  hasSubscribers() {
    return this.clients.size > 0;
  }
  
  /**
   * Get subscriber count
   */
  getSubscriberCount() {
    return this.clients.size;
  }
  
  /**
   * Broadcast to all clients
   */
  broadcast(event) {
    if (this.clients.size === 0) {
      console.log(`[URSULA] No subscribers - event not broadcast: ${event.type}`);
      return 0;
    }
    
    let sentCount = 0;
    const failedClients = [];
    
    for (const [clientId, client] of this.clients) {
      try {
        // Format as SSE
        const data = JSON.stringify(event);
        client.response.write(`event: ${event.type || 'message'}\n`);
        client.response.write(`data: ${data}\n\n`);
        sentCount++;
      } catch (error) {
        console.error(`[URSULA] Failed to send to client ${clientId}:`, error);
        failedClients.push(clientId);
      }
    }
    
    // Clean up failed clients
    failedClients.forEach(id => this.removeClient(id));
    
    console.log(`[URSULA] Broadcast "${event.type}" to ${sentCount} clients`);
    return sentCount;
  }
  
  /**
   * Send heartbeat to all clients
   */
  heartbeat() {
    this.broadcast({
      type: 'heartbeat',
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Get client stats
   */
  getStats() {
    return {
      total_clients: this.clients.size,
      clients: Array.from(this.clients.values()).map(c => ({
        id: c.id,
        connected_at: c.connected_at
      }))
    };
  }
}

// Export singleton
module.exports = new UrsulaSSEManager();
