// CASCADE Complete System
// Integrates all CASCADE components into a single operational unit

const CascadeCore = require('./cascade-core');
const CascadeEventIntake = require('./cascade-event-intake');
const CascadeEmissionLayer = require('./cascade-emission-layer');
const CascadeQuarantine = require('./cascade-quarantine');
const { EventEmitter } = require('events');

class CascadeComplete extends EventEmitter {
  constructor() {
    super();
    this.intake = new CascadeEventIntake();
    this.emission = new CascadeEmissionLayer();
    this.quarantine = new CascadeQuarantine();
    this.isRunning = false;
    this.stats = {
      start_time: null,
      events_processed: 0,
      events_rejected: 0,
      events_quarantined: 0,
      repair_manifests_generated: 0,
      uptime: 0
    };
    
    this.setupIntegrations();
  }

  setupIntegrations() {
    // Connect intake to emission
    this.intake.on('cascade_output', async (output) => {
      await this.emission.emit(output);
    });

    // Connect intake to quarantine
    this.intake.on('quarantined_signal', (quarantine) => {
      this.quarantine.quarantine(quarantine.event, quarantine.reason, quarantine);
    });

    // Handle quarantine release attempts
    this.quarantine.on('release_attempt', async (record) => {
      // Re-process the event
      const result = await this.intake.receive(record.event, record.event.source);
      
      if (result.status === 'processed') {
        // Event was successfully processed, remove from quarantine
        this.quarantine.quarantinedEvents.delete(record.event_id);
        this.emit('quarantine_resolved', record);
      } else {
        // Still failed, update retry schedule
        const policy = this.quarantine.retryPolicies.get(record.reason);
        record.next_retry = this.quarantine.calculateNextRetry(
          record.last_retry,
          policy,
          record.retry_count
        );
        record.status = 'quarantined';
      }
    });

    // Forward critical events
    this.intake.on('heartbeat', (heartbeat) => {
      this.emit('heartbeat', heartbeat);
    });

    this.intake.on('cascade_error', (error) => {
      this.emit('error', error);
    });

    // Track statistics
    this.intake.core.on('state_logged', (state) => {
      this.stats.events_processed = state.stats.processed;
      this.stats.events_rejected = state.stats.rejected;
      this.stats.events_quarantined = state.stats.quarantined;
      this.stats.repair_manifests_generated = state.stats.repair_manifests_generated;
    });

    // Emission tracking
    this.emission.on('emission_success', (success) => {
      this.emit('emission_success', success);
    });

    this.emission.on('emission_failed', (failure) => {
      this.emit('emission_failed', failure);
    });
  }

  // Start CASCADE system
  start() {
    if (this.isRunning) {
      return { status: 'already_running' };
    }

    this.isRunning = true;
    this.stats.start_time = new Date().toISOString();
    
    // Start intake layer (includes heartbeat)
    this.intake.start();
    
    // Start periodic retry processing
    this.retryInterval = setInterval(() => {
      this.processQuarantineRetries();
    }, 10000); // Every 10 seconds

    // Update uptime
    this.uptimeInterval = setInterval(() => {
      this.updateUptime();
    }, 1000);

    this.emit('cascade_started', {
      timestamp: this.stats.start_time,
      components: {
        intake: 'active',
        emission: 'active',
        quarantine: 'active'
      }
    });

    return { 
      status: 'started',
      start_time: this.stats.start_time
    };
  }

  // Stop CASCADE system
  stop() {
    if (!this.isRunning) {
      return { status: 'already_stopped' };
    }

    this.isRunning = false;
    
    // Stop intake layer
    this.intake.stop();
    
    // Stop periodic tasks
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
    
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }

    // Stop quarantine cleanup
    this.quarantine.stop();

    this.emit('cascade_stopped', {
      timestamp: new Date().toISOString(),
      final_stats: this.stats
    });

    return { 
      status: 'stopped',
      stop_time: new Date().toISOString()
    };
  }

  // Process events from external sources
  async processEvent(rawEvent, sourceType) {
    if (!this.isRunning) {
      return {
        error: 'CASCADE not running',
        status: 'rejected'
      };
    }

    return await this.intake.receive(rawEvent, sourceType);
  }

  // Process quarantine retries
  async processQuarantineRetries() {
    const readyEvents = this.quarantine.getEventsReadyForRetry();
    
    for (const record of readyEvents) {
      try {
        await this.quarantine.attemptRelease(record.event_id);
      } catch (error) {
        this.emit('retry_error', {
          event_id: record.event_id,
          error: error.message
        });
      }
    }
  }

  // Update uptime
  updateUptime() {
    if (this.stats.start_time) {
      const now = new Date();
      const start = new Date(this.stats.start_time);
      this.stats.uptime = Math.floor((now - start) / 1000);
    }
  }

  // Get comprehensive system status
  getStatus() {
    return {
      is_running: this.isRunning,
      stats: this.stats,
      intake_status: this.intake.getStatus(),
      emission_status: this.emission.getStats(),
      quarantine_status: this.quarantine.getStats(),
      system_health: this.calculateSystemHealth()
    };
  }

  // Calculate overall system health
  calculateSystemHealth() {
    if (!this.isRunning) return 'stopped';
    
    const total = this.stats.events_processed + this.stats.events_rejected;
    const rejectionRate = total > 0 ? (this.stats.events_rejected / total) * 100 : 0;
    const quarantineRate = total > 0 ? (this.stats.events_quarantined / total) * 100 : 0;
    
    if (rejectionRate > 50) return 'critical';
    if (rejectionRate > 20 || quarantineRate > 30) return 'degraded';
    if (rejectionRate > 5 || quarantineRate > 10) return 'warning';
    return 'healthy';
  }

  // Manual quarantine management
  getQuarantineReport(limit = 50) {
    return this.quarantine.getReport(limit);
  }

  manualReleaseFromQuarantine(eventId, approvedBy) {
    return this.quarantine.manualRelease(eventId, approvedBy);
  }

  // Configuration methods
  updateQuarantinePolicy(reason, policy) {
    this.quarantine.retryPolicies.set(reason, policy);
    this.emit('policy_updated', { reason, policy });
  }

  setMaxQuarantineSize(size) {
    this.quarantine.maxQuarantineSize = size;
    this.emit('config_updated', { maxQuarantineSize: size });
  }
}

// Export singleton instance
module.exports = new CascadeComplete();
