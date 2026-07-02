// CASCADE Event Intake Layer
// Normalizes all incoming signals into the standard CASCADE format

const { EventEmitter } = require('events');
const CascadeCore = require('./cascade-core');

class CascadeEventIntake extends EventEmitter {
  constructor() {
    super();
    this.core = new CascadeCore();
    this.sources = {
      'vercel': new VercelIntakeAdapter(),
      'local': new LocalIntakeAdapter(),
      'supabase': new SupabaseIntakeAdapter(),
      'user': new UserIntakeAdapter(),
      'system': new SystemIntakeAdapter()
    };
    
    this.setupCoreListeners();
  }

  setupCoreListeners() {
    // Forward all core events
    this.core.on('cascade_output', (output) => {
      this.emit('cascade_output', output);
    });

    this.core.on('heartbeat', (heartbeat) => {
      this.emit('heartbeat', heartbeat);
    });

    this.core.on('event_quarantined', (quarantine) => {
      this.emit('quarantined_signal', quarantine);
    });

    this.core.on('cascade_error', (error) => {
      this.emit('cascade_error', error);
    });

    this.core.on('state_logged', (state) => {
      this.emit('state_logged', state);
    });
  }

  // Main intake method - routes to appropriate adapter
  async receive(rawEvent, sourceType) {
    const adapter = this.sources[sourceType];
    
    if (!adapter) {
      return {
        event: 'cascade_event_rejected',
        reason: 'unknown_source',
        action: 'discard'
      };
    }

    // Normalize through source-specific adapter
    const normalized = adapter.normalize(rawEvent);
    
    if (!normalized) {
      return {
        event: 'cascade_event_rejected',
        reason: 'normalization_failed',
        action: 'discard'
      };
    }

    // Process through core CASCADE
    return await this.core.processEvent(normalized);
  }

  // Start the heartbeat system
  start() {
    this.core.startHeartbeat();
    this.emit('cascade_started', { timestamp: new Date().toISOString() });
  }

  // Stop the system
  stop() {
    this.core.stopHeartbeat();
    this.emit('cascade_stopped', { timestamp: new Date().toISOString() });
  }

  // Get system status
  getStatus() {
    return this.core.getStatus();
  }
}

// Source-specific adapters
class VercelIntakeAdapter {
  normalize(rawEvent) {
    // Vercel-specific normalization
    return {
      event_id: rawEvent.id || rawEvent.deployment_id,
      source: 'vercel',
      type: this.mapVercelType(rawEvent.type),
      payload: {
        deployment_id: rawEvent.deployment_id,
        project: rawEvent.project,
        status: rawEvent.status,
        error: rawEvent.error,
        build_logs: rawEvent.buildLogs,
        ...rawEvent
      },
      timestamp: rawEvent.createdAt || new Date().toISOString()
    };
  }

  mapVercelType(vercelType) {
    const typeMap = {
      'deployment.error': 'error',
      'deployment.ready': 'info',
      'build.failed': 'error',
      'function.invocation.error': 'error'
    };
    return typeMap[vercelType] || 'info';
  }
}

class LocalIntakeAdapter {
  normalize(rawEvent) {
    // Local system event normalization
    return {
      event_id: rawEvent.id,
      source: 'local',
      type: rawEvent.level || 'info', // error | warning | info
      payload: {
        module: rawEvent.module,
        error: rawEvent.error,
        stack: rawEvent.stack,
        ...rawEvent.data
      },
      timestamp: rawEvent.timestamp || new Date().toISOString()
    };
  }
}

class SupabaseIntakeAdapter {
  normalize(rawEvent) {
    // Supabase event normalization
    return {
      event_id: rawEvent.id,
      source: 'supabase',
      type: this.mapSupabaseType(rawEvent.type),
      payload: {
        table: rawEvent.table,
        operation: rawEvent.operation,
        record: rawEvent.record,
        error: rawEvent.error,
        ...rawEvent
      },
      timestamp: rawEvent.timestamp || new Date().toISOString()
    };
  }

  mapSupabaseType(supabaseType) {
    const typeMap = {
      'postgres_error': 'error',
      'auth_error': 'error',
      'storage_error': 'error',
      'realtime_disconnect': 'warning'
    };
    return typeMap[supabaseType] || 'info';
  }
}

class UserIntakeAdapter {
  normalize(rawEvent) {
    // User-generated event normalization
    return {
      event_id: rawEvent.id,
      source: 'user',
      type: 'request', // All user events are requests
      payload: {
        action: rawEvent.action,
        parameters: rawEvent.parameters,
        user_id: rawEvent.user_id,
        ...rawEvent.data
      },
      timestamp: rawEvent.timestamp || new Date().toISOString()
    };
  }
}

class SystemIntakeAdapter {
  normalize(rawEvent) {
    // System-generated event normalization
    return {
      event_id: rawEvent.id,
      source: 'system',
      type: rawEvent.type || 'heartbeat',
      payload: {
        component: rawEvent.component,
        metric: rawEvent.metric,
        value: rawEvent.value,
        threshold: rawEvent.threshold,
        ...rawEvent.data
      },
      timestamp: rawEvent.timestamp || new Date().toISOString()
    };
  }
}

module.exports = CascadeEventIntake;
