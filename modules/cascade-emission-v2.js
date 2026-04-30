// CASCADE Emission Layer V2 - With acknowledgment tracking
// Requires acknowledgment from all targets with retry counters

const EventEmitter = require('events');

class CascadeEmissionV2 extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.emissionQueue = [];
    this.isProcessing = false;
    
    // Tracking for acknowledgments
    this.emissionTracking = new Map(); // event_id -> tracking info
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2
    };
    
    // Statistics
    this.stats = {
      totalEmissions: 0,
      successfulEmissions: 0,
      failedEmissions: 0,
      pendingEmissions: 0,
      acknowledgmentsReceived: 0,
      acknowledgmentsPending: 0
    };
    
    this.initializeConnections();
    this.startRetryProcessor();
  }

  initializeConnections() {
    // Register target systems with acknowledgment capability
    this.connections.set('ursula', new UrsulaConnectionV2());
    this.connections.set('dashboard', new DashboardConnectionV2());
    this.connections.set('backend', new BackendConnectionV2());
    this.connections.set('hyve', new HyveConnectionV2());
  }

  // Main emission method with tracking
  async emit(output) {
    // Validate output format
    if (!this.validateOutput(output)) {
      this.emit('emission_error', {
        error: 'Invalid output format',
        output: output
      });
      return false;
    }

    // Create tracking record
    const trackingId = this.createTrackingRecord(output);
    
    // Add to queue
    this.emissionQueue.push({
      trackingId: trackingId,
      output: output,
      queued_at: new Date().toISOString(),
      retryCount: 0
    });

    this.stats.totalEmissions++;
    this.stats.pendingEmissions++;

    // Process queue
    if (!this.isProcessing) {
      this.processQueue();
    }

    return trackingId;
  }

  // Create tracking record for emission
  createTrackingRecord(output) {
    const trackingId = `${output.event_id}_${Date.now()}`;
    
    this.emissionTracking.set(trackingId, {
      event_id: output.event_id,
      target_system: output.target_system,
      status: 'pending',
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_attempt: null,
      acknowledgments: {},
      failures: []
    });
    
    return trackingId;
  }

  // Process emission queue
  async processQueue() {
    this.isProcessing = true;

    while (this.emissionQueue.length > 0) {
      const item = this.emissionQueue.shift();
      
      try {
        const result = await this.deliverWithAck(item);
        
        if (result.acknowledged) {
          this.handleSuccess(item, result);
        } else {
          this.handleFailure(item, result);
        }
      } catch (error) {
        this.handleCriticalFailure(item, error);
      }
    }

    this.isProcessing = false;
  }

  // Deliver with acknowledgment tracking
  async deliverWithAck(item) {
    const connection = this.connections.get(item.output.target_system);
    
    if (!connection) {
      throw new Error(`No connection to target system: ${item.output.target_system}`);
    }

    // Update tracking
    const tracking = this.emissionTracking.get(item.trackingId);
    if (tracking) {
      tracking.last_attempt = new Date().toISOString();
      tracking.retry_count = item.retryCount;
    }

    // Attempt delivery
    const deliveryResult = await connection.sendWithAck(item.output);
    
    // Update tracking with result
    if (tracking) {
      if (deliveryResult.acknowledged) {
        tracking.status = 'acknowledged';
        tracking.acknowledged_at = deliveryResult.timestamp;
        tracking.acknowledgments[item.output.target_system] = deliveryResult;
      } else {
        tracking.failures.push({
          target: item.output.target_system,
          error: deliveryResult.error || 'No acknowledgment received',
          timestamp: new Date().toISOString()
        });
      }
    }

    return deliveryResult;
  }

  // Handle successful emission
  handleSuccess(item, result) {
    this.stats.successfulEmissions++;
    this.stats.pendingEmissions--;
    this.stats.acknowledgmentsReceived++;
    
    this.emit('emission_success', {
      tracking_id: item.trackingId,
      event_id: item.output.event_id,
      target_system: item.output.target_system,
      acknowledged: true,
      timestamp: result.timestamp
    });
  }

  // Handle emission failure
  handleFailure(item, result) {
    const maxRetries = this.retryConfig.maxRetries;
    
    if (item.retryCount < maxRetries) {
      // Retry with exponential backoff
      const delay = this.calculateRetryDelay(item.retryCount);
      
      setTimeout(() => {
        item.retryCount++;
        this.emissionQueue.unshift(item); // Put back at front
        if (!this.isProcessing) {
          this.processQueue();
        }
      }, delay);
      
      this.emit('emission_retry', {
        tracking_id: item.trackingId,
        event_id: item.output.event_id,
        target_system: item.output.target_system,
        retry_count: item.retryCount,
        next_retry_in: delay,
        reason: result.error || 'No acknowledgment'
      });
    } else {
      // Max retries exceeded
      this.stats.failedEmissions++;
      this.stats.pendingEmissions--;
      
      const tracking = this.emissionTracking.get(item.trackingId);
      if (tracking) {
        tracking.status = 'failed';
        tracking.failed_at = new Date().toISOString();
      }
      
      this.emit('emission_failed', {
        tracking_id: item.trackingId,
        event_id: item.output.event_id,
        target_system: item.output.target_system,
        retry_count: item.retryCount,
        reason: result.error || 'Max retries exceeded',
        final_failure: true
      });
    }
  }

  // Handle critical failure
  handleCriticalFailure(item, error) {
    this.stats.failedEmissions++;
    this.stats.pendingEmissions--;
    
    const tracking = this.emissionTracking.get(item.trackingId);
    if (tracking) {
      tracking.status = 'critical_failure';
      tracking.error = error.message;
      tracking.failed_at = new Date().toISOString();
    }
    
    this.emit('emission_critical_failure', {
      tracking_id: item.trackingId,
      event_id: item.output.event_id,
      target_system: item.output.target_system,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }

  // Calculate retry delay with exponential backoff
  calculateRetryDelay(retryCount) {
    let delay = this.retryConfig.baseDelay;
    
    // Exponential backoff
    delay = delay * Math.pow(this.retryConfig.backoffMultiplier, retryCount);
    
    // Add jitter
    const jitter = delay * 0.1;
    delay = delay + (Math.random() * jitter * 2 - jitter);
    
    // Cap at max delay
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  // Start retry processor
  startRetryProcessor() {
    // Clean up old tracking records periodically
    setInterval(() => {
      this.cleanupOldTracking();
    }, 60000); // Every minute
  }

  // Clean up old tracking records
  cleanupOldTracking() {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    let cleaned = 0;
    
    this.emissionTracking.forEach((tracking, trackingId) => {
      const trackingTime = new Date(tracking.created_at).getTime();
      if (trackingTime < cutoff && (tracking.status === 'acknowledged' || tracking.status === 'failed')) {
        this.emissionTracking.delete(trackingId);
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      console.log(`[EMISSION] Cleaned up ${cleaned} old tracking records`);
    }
  }

  // Validate output format
  validateOutput(output) {
    if (!output.event) return false;
    if (!output.type) return false;
    if (!output.target_system) return false;
    if (!output.payload) return false;
    
    return true;
  }

  // Get emission statistics
  getStats() {
    // Update pending acknowledgments
    this.stats.acknowledgmentsPending = Array.from(this.emissionTracking.values())
      .filter(t => t.status === 'pending').length;
    
    return {
      ...this.stats,
      queue_length: this.emissionQueue.length,
      is_processing: this.isProcessing,
      active_connections: Array.from(this.connections.keys()),
      connection_status: this.getConnectionStatuses(),
      success_rate: this.stats.totalEmissions > 0 
        ? (this.stats.successfulEmissions / this.stats.totalEmissions * 100).toFixed(2) + '%'
        : '0%',
      failure_rate: this.stats.totalEmissions > 0
        ? (this.stats.failedEmissions / this.stats.totalEmissions * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  // Get detailed tracking report
  getTrackingReport(eventId = null) {
    let trackings = Array.from(this.emissionTracking.entries());
    
    if (eventId) {
      trackings = trackings.filter(([id, tracking]) => tracking.event_id === eventId);
    }
    
    return trackings.map(([trackingId, tracking]) => ({
      tracking_id: trackingId,
      event_id: tracking.event_id,
      target_system: tracking.target_system,
      status: tracking.status,
      created_at: tracking.created_at,
      retry_count: tracking.retry_count,
      acknowledged_at: tracking.acknowledged_at,
      failures: tracking.failures
    }));
  }

  // Get connection statuses
  getConnectionStatuses() {
    const statuses = {};
    this.connections.forEach((connection, name) => {
      statuses[name] = connection.getStatus();
    });
    return statuses;
  }
}

// Connection implementations V2 with acknowledgment support
class UrsulaConnectionV2 {
  constructor() {
    this.status = 'disconnected';
    this.lastPing = null;
    this.ackTimeout = 5000; // 5 seconds
  }

  async sendWithAck(output) {
    this.status = 'sending';
    
    // Simulate network send with acknowledgment
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Simulate acknowledgment (90% success rate)
    if (Math.random() < 0.9) {
      this.status = 'connected';
      this.lastPing = new Date().toISOString();
      
      return {
        delivered: true,
        acknowledged: true,
        timestamp: this.lastPing,
        response_time: 50
      };
    } else {
      // Simulate failed acknowledgment
      return {
        delivered: true,
        acknowledged: false,
        error: 'Acknowledgment timeout',
        timestamp: new Date().toISOString()
      };
    }
  }

  getStatus() {
    return {
      status: this.status,
      last_ping: this.lastPing,
      ack_timeout: this.ackTimeout
    };
  }
}

class DashboardConnectionV2 {
  constructor() {
    this.status = 'disconnected';
    this.eventsSent = 0;
    this.ackTimeout = 2000; // 2 seconds
  }

  async sendWithAck(output) {
    this.status = 'sending';
    
    // Simulate dashboard update with acknowledgment
    await new Promise(resolve => setTimeout(resolve, 30));
    
    // Dashboard always acknowledges quickly
    this.status = 'connected';
    this.eventsSent++;
    
    return {
      delivered: true,
      acknowledged: true,
      timestamp: new Date().toISOString(),
      events_sent: this.eventsSent,
      response_time: 30
    };
  }

  getStatus() {
    return {
      status: this.status,
      events_sent: this.eventsSent,
      ack_timeout: this.ackTimeout
    };
  }
}

class BackendConnectionV2 {
  constructor() {
    this.status = 'disconnected';
    this.commandsExecuted = 0;
    this.ackTimeout = 10000; // 10 seconds
  }

  async sendWithAck(output) {
    this.status = 'executing';
    
    // Simulate command execution with acknowledgment
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Backend acknowledges after execution
    this.status = 'connected';
    this.commandsExecuted++;
    
    return {
      delivered: true,
      acknowledged: true,
      timestamp: new Date().toISOString(),
      command: output.payload.action,
      commands_executed: this.commandsExecuted,
      response_time: 100
    };
  }

  getStatus() {
    return {
      status: this.status,
      commands_executed: this.commandsExecuted,
      ack_timeout: this.ackTimeout
    };
  }
}

class HyveConnectionV2 {
  constructor() {
    this.status = 'disconnected';
    this.opportunitiesForwarded = 0;
    this.ackTimeout = 3000; // 3 seconds
  }

  async sendWithAck(output) {
    this.status = 'forwarding';
    
    // Simulate forwarding with acknowledgment
    await new Promise(resolve => setTimeout(resolve, 75));
    
    // Hyve acknowledges after forwarding
    this.status = 'connected';
    this.opportunitiesForwarded++;
    
    return {
      delivered: true,
      acknowledged: true,
      timestamp: new Date().toISOString(),
      opportunity_type: output.classification,
      opportunities_forwarded: this.opportunitiesForwarded,
      response_time: 75
    };
  }

  getStatus() {
    return {
      status: this.status,
      opportunities_forwarded: this.opportunitiesForwarded,
      ack_timeout: this.ackTimeout
    };
  }
}

module.exports = CascadeEmissionV2;
