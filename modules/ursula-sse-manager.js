// Ursula SSE Manager for ProtoForge
// Embedded (in-process) SSE manager — used inside Next.js API routes

const { EventEmitter } = require('events');

class UrsulaSSEManager extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // clientId -> { id, response, connected_at }
  }

  addClient(response, clientId = null) {
    const id = clientId || `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.clients.set(id, { id, response, connected_at: new Date() });
    console.log(`[URSULA] Client added: ${id}. Total: ${this.clients.size}`);
    return id;
  }

  removeClient(clientId) {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      console.log(`[URSULA] Client removed: ${clientId}. Total: ${this.clients.size}`);
    }
  }

  hasSubscribers() {
    return this.clients.size > 0;
  }

  getSubscriberCount() {
    return this.clients.size;
  }

  broadcast(event) {
    if (this.clients.size === 0) {
      console.log(`[URSULA] No subscribers - event not broadcast: ${event.type}`);
      return 0;
    }

    let sentCount = 0;
    const failedClients = [];

    for (const [clientId, client] of this.clients) {
      try {
        // fix #10: consistent SSE format — id + data only, matching ursula-sse-stream.js
        // (removed the separate `event: type\n` line that caused shape inconsistency)
        const data = JSON.stringify(event);
        client.response.write(`id: ${Date.now()}\ndata: ${data}\n\n`);
        sentCount++;
      } catch (error) {
        console.error(`[URSULA] Failed to send to client ${clientId}:`, error);
        failedClients.push(clientId);
      }
    }

    failedClients.forEach(id => this.removeClient(id));
    console.log(`[URSULA] Broadcast "${event.type}" to ${sentCount} clients`);
    return sentCount;
  }

  heartbeat() {
    this.broadcast({ type: 'heartbeat', timestamp: new Date().toISOString() });
  }

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

module.exports = new UrsulaSSEManager();
