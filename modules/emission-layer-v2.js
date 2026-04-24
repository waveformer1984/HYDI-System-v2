// Emission Layer V2 - Outward Communication Only
// Emits structured actions to UI, APIs, SSE
// NO logic, NO classification, NO repair logic

const protoforgePolicyV2 = require('./protoforge-policy-v2');
const { EventEmitter } = require('events');

class EmissionLayerV2 extends EventEmitter {
  constructor() {
    super();
    
    // Emission channels
    this.channels = {
      sse: null,          // Server-Sent Events
      api: null,          // API responses
      websocket: null,    // WebSocket connections
      logs: null          // Log files
    };
    
    // Emission queue
    this.emissionQueue = [];
    this.emitting = false;
    
    // Statistics
    this.stats = {
      totalEmitted: 0,
      emissionsByChannel: new Map(),
      emissionsByType: new Map(),
      failedEmissions: 0
    };
    
    console.log('[EMISSION V2] Initialized - Outward communication ONLY');
    console.log('[EMISSION V2] RULE: No logic, no classification, no repair logic');
  }

  // Register emission channel
  registerChannel(name, handler) {
    this.channels[name] = handler;
    console.log(`[EMISSION V2] Registered channel: ${name}`);
  }

  // Emit approved action from ProtoForge
  async emitAction(action) {
    try {
      // Create emission payload
      const emission = {
        emission_id: `emission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        action_id: action.action_id,
        type: 'structured_action',
        payload: {
          classification: action.classification,
          priority: action.priority,
          suggested_fixes: action.suggested_fixes,
          investigation_steps: action.investigation_steps,
          event_id: action.event_id,
          confidence: action.confidence
        },
        timestamp: Date.now(),
        iso_timestamp: new Date().toISOString(),
        channels: ['sse', 'api', 'logs']
      };
      
      // Add to queue
      this.emissionQueue.push(emission);
      
      // Process queue
      if (!this.emitting) {
        this.processQueue();
      }
      
      return emission;
      
    } catch (error) {
      console.error('[EMISSION V2] Error creating emission:', error);
      return null;
    }
  }

  // Process emission queue
  async processQueue() {
    if (this.emitting || this.emissionQueue.length === 0) {
      return;
    }
    
    this.emitting = true;
    
    while (this.emissionQueue.length > 0) {
      const emission = this.emissionQueue.shift();
      await this.sendToChannels(emission);
    }
    
    this.emitting = false;
  }

  // Send emission to all registered channels
  async sendToChannels(emission) {
    const results = [];
    
    for (const channelName of emission.channels) {
      const channel = this.channels[channelName];
      
      if (channel) {
        try {
          await channel(emission);
          results.push({ channel: channelName, success: true });
          
          // Update statistics
          this.stats.emissionsByChannel.set(
            channelName,
            (this.stats.emissionsByChannel.get(channelName) || 0) + 1
          );
          
        } catch (error) {
          console.error(`[EMISSION V2] Channel ${channelName} failed:`, error);
          results.push({ channel: channelName, success: false, error: error.message });
          this.stats.failedEmissions++;
        }
      }
    }
    
    // Update total
    this.stats.totalEmitted++;
    this.stats.emissionsByType.set(
      emission.type,
      (this.stats.emissionsByType.get(emission.type) || 0) + 1
    );
    
    // Emit completion event
    this.emit('emission_complete', {
      emission_id: emission.emission_id,
      results: results,
      timestamp: new Date().toISOString()
    });
    
    console.log(`[EMISSION V2] Emitted: ${emission.emission_id} to ${results.filter(r => r.success).length}/${results.length} channels`);
  }

  // Create SSE channel handler
  static createSSEChannel(sseManager) {
    return async (emission) => {
      if (sseManager && typeof sseManager.broadcast === 'function') {
        sseManager.broadcast({
          type: 'action_emitted',
          emission_id: emission.emission_id,
          action: emission.payload,
          timestamp: emission.iso_timestamp
        });
      }
    };
  }

  // Create API response channel handler
  static createAPIChannel(responses) {
    return async (emission) => {
      // Store for API responses
      responses.set(emission.emission_id, emission);
      
      // Clean old responses (keep last 100)
      if (responses.size > 100) {
        const oldestKey = responses.keys().next().value;
        responses.delete(oldestKey);
      }
    };
  }

  // Create log channel handler
  static createLogChannel(logPath) {
    const fs = require('fs').promises;
    
    return async (emission) => {
      const logEntry = {
        timestamp: emission.iso_timestamp,
        emission_id: emission.emission_id,
        type: emission.type,
        action_id: emission.action_id,
        classification: emission.payload.classification,
        priority: emission.payload.priority
      };
      
      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(logPath, logLine, 'utf8');
    };
  }

  // Create WebSocket channel handler
  static createWebSocketChannel(wsServer) {
    return async (emission) => {
      if (wsServer && typeof wsServer.broadcast === 'function') {
        wsServer.broadcast({
          type: 'emission',
          data: emission
        });
      }
    };
  }

  // Emit system status
  async emitSystemStatus(status) {
    const emission = {
      emission_id: `status_${Date.now()}`,
      type: 'system_status',
      payload: status,
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      channels: ['sse', 'api']
    };
    
    this.emissionQueue.push(emission);
    
    if (!this.emitting) {
      this.processQueue();
    }
  }

  // Emit notification
  async emitNotification(notification) {
    const emission = {
      emission_id: `notif_${Date.now()}`,
      type: 'notification',
      payload: notification,
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      channels: ['sse', 'websocket']
    };
    
    this.emissionQueue.push(emission);
    
    if (!this.emitting) {
      this.processQueue();
    }
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      emissionsByChannel: Object.fromEntries(this.stats.emissionsByChannel),
      emissionsByType: Object.fromEntries(this.stats.emissionsByType),
      queueLength: this.emissionQueue.length,
      isEmitting: this.emitting
    };
  }

  // Get queue status
  getQueueStatus() {
    return {
      length: this.emissionQueue.length,
      isProcessing: this.emitting,
      nextEmission: this.emissionQueue[0] || null
    };
  }

  // Clear queue
  clearQueue() {
    this.emissionQueue = [];
    console.log('[EMISSION V2] Queue cleared');
  }

  // Get info
  getInfo() {
    return {
      type: 'EMISSION_LAYER_V2',
      description: 'Outward communication ONLY',
      rules: [
        'NO logic processing',
        'NO classification',
        'NO repair logic',
        'EMIT to channels only',
        'STRUCTURED output format'
      ],
      registeredChannels: Object.keys(this.channels).filter(k => this.channels[k] !== null),
      stats: this.getStats()
    };
  }
}

// Create singleton
const emissionLayerV2 = new EmissionLayerV2();

// Listen for approved actions from ProtoForge
protoforgePolicyV2.on('action_approved', (action) => {
  emissionLayerV2.emitAction(action);
});

module.exports = emissionLayerV2;
