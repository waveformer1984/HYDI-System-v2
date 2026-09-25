// CASCADE Adapters V2 - With confidence scoring
// All adapters include confidence score (0.0-1.0)

const { v4: uuidv4 } = require('uuid');

class BaseAdapter {
  constructor(sourceType) {
    this.sourceType = sourceType;
    this.stats = {
      eventsProcessed: 0,
      confidenceDistribution: {
        high: 0,    // >0.9
        medium: 0,  // 0.75-0.9
        low: 0,     // 0.5-0.75
        reject: 0   // <0.5
      }
    };
  }

  // Calculate confidence based on event completeness and source reliability.
  //
  // Completeness is judged on the event this adapter produced, not on raw
  // field names: each adapter reads its content from a different place
  // (system/local/user from `data` and named fields, vercel/supabase from
  // top-level fields), so checking the raw event for `payload` scored
  // well-formed events as empty and quarantined them. Source reliability is
  // the starting value and is applied once; it used to be both the base and
  // a multiplier, so a complete local event scored 0.85 * 0.85 = 0.72.
  calculateConfidence(rawEvent, normalized) {
    let confidence = this.getSourceReliability();

    // Deduct for missing fields
    const requiredFields = ['type', 'payload'];
    const missingFields = requiredFields.filter(field => !normalized[field]);
    confidence -= missingFields.length * 0.2;

    // Deduct for an empty payload: nothing the adapter could extract
    const values = Object.values(normalized.payload || {});
    if (!values.some(v => v !== undefined && v !== null && v !== '')) {
      confidence -= 0.3;
    }

    // Deduct for malformed data
    if (rawEvent.timestamp && !this.isValidTimestamp(rawEvent.timestamp)) {
      confidence -= 0.2;
    }

    // Ensure within bounds
    confidence = Math.max(0, Math.min(1, confidence));

    // Track distribution
    this.trackConfidence(confidence);

    return confidence;
  }

  // Attach adapter metadata and the confidence computed from the result.
  finalize(rawEvent, normalized) {
    return {
      ...normalized,
      confidence: this.calculateConfidence(rawEvent, normalized),
      adapter_version: 'v2'
    };
  }

  getSourceReliability() {
    const reliabilityMap = {
      'system': 1.0,    // Highest reliability
      'supabase': 0.95,
      'vercel': 0.9,
      'local': 0.85,
      'user': 0.7      // Lowest reliability
    };
    return reliabilityMap[this.sourceType] || 0.5;
  }

  isValidTimestamp(timestamp) {
    const date = new Date(timestamp);
    return !isNaN(date.getTime());
  }

  trackConfidence(confidence) {
    this.stats.eventsProcessed++;
    
    if (confidence > 0.9) {
      this.stats.confidenceDistribution.high++;
    } else if (confidence > 0.75) {
      this.stats.confidenceDistribution.medium++;
    } else if (confidence > 0.5) {
      this.stats.confidenceDistribution.low++;
    } else {
      this.stats.confidenceDistribution.reject++;
    }
  }

  normalize(rawEvent) {
    // Base normalization - must be implemented by subclasses
    throw new Error('normalize() must be implemented by subclass');
  }
}

class VercelAdapter extends BaseAdapter {
  constructor() {
    super('vercel');
  }

  normalize(rawEvent) {
    return this.finalize(rawEvent, {
      event_id: rawEvent.id || rawEvent.deployment_id || uuidv4(),
      source: 'vercel',
      type: this.mapVercelType(rawEvent.type),
      payload: {
        deployment_id: rawEvent.deployment_id,
        project: rawEvent.project,
        status: rawEvent.status,
        error: rawEvent.error,
        build_logs: rawEvent.buildLogs,
        region: rawEvent.region,
        ...rawEvent
      },
      timestamp: rawEvent.createdAt || new Date().toISOString()
    });
  }

  mapVercelType(vercelType) {
    const typeMap = {
      'deployment.error': 'error',
      'deployment.ready': 'info',
      'deployment.canceled': 'warning',
      'build.failed': 'error',
      'function.invocation.error': 'error',
      'function.invocation.timeout': 'error'
    };
    return typeMap[vercelType] || 'info';
  }
}

class LocalAdapter extends BaseAdapter {
  constructor() {
    super('local');
  }

  normalize(rawEvent) {
    return this.finalize(rawEvent, {
      event_id: rawEvent.id || uuidv4(),
      source: 'local',
      type: rawEvent.level || 'info',
      payload: {
        module: rawEvent.module,
        error: rawEvent.error,
        stack: rawEvent.stack,
        pid: rawEvent.pid,
        memory_usage: rawEvent.memoryUsage,
        ...rawEvent.data
      },
      timestamp: rawEvent.timestamp || new Date().toISOString()
    });
  }
}

class SupabaseAdapter extends BaseAdapter {
  constructor() {
    super('supabase');
  }

  normalize(rawEvent) {
    return this.finalize(rawEvent, {
      event_id: rawEvent.id || uuidv4(),
      source: 'supabase',
      type: this.mapSupabaseType(rawEvent.type),
      payload: {
        table: rawEvent.table,
        operation: rawEvent.operation,
        record: rawEvent.record,
        error: rawEvent.error,
        user_id: rawEvent.user_id,
        ...rawEvent
      },
      timestamp: rawEvent.timestamp || new Date().toISOString()
    });
  }

  mapSupabaseType(supabaseType) {
    const typeMap = {
      'postgres_error': 'error',
      'auth_error': 'error',
      'storage_error': 'error',
      'realtime_disconnect': 'warning',
      'rls_violation': 'error',
      'row_level_security_failed': 'error'
    };
    return typeMap[supabaseType] || 'info';
  }
}

class UserAdapter extends BaseAdapter {
  constructor() {
    super('user');
  }

  normalize(rawEvent) {
    return this.finalize(rawEvent, {
      event_id: rawEvent.id || uuidv4(),
      source: 'user',
      type: 'request', // All user events are requests
      payload: {
        action: rawEvent.action,
        parameters: rawEvent.parameters,
        user_id: rawEvent.user_id,
        session_id: rawEvent.session_id,
        ip_address: rawEvent.ipAddress,
        user_agent: rawEvent.userAgent,
        ...rawEvent.data
      },
      timestamp: rawEvent.timestamp || new Date().toISOString()
    });
  }
}

class SystemAdapter extends BaseAdapter {
  constructor() {
    super('system');
  }

  normalize(rawEvent) {
    return this.finalize(rawEvent, {
      event_id: rawEvent.id || uuidv4(),
      source: 'system',
      type: rawEvent.type || 'heartbeat',
      payload: {
        component: rawEvent.component,
        metric: rawEvent.metric,
        value: rawEvent.value,
        threshold: rawEvent.threshold,
        unit: rawEvent.unit,
        ...rawEvent.data
      },
      timestamp: rawEvent.timestamp || new Date().toISOString()
    });
  }
}

// Adapter factory
class AdapterFactory {
  static adapters = new Map();
  
  static getAdapter(sourceType) {
    if (!this.adapters.has(sourceType)) {
      switch (sourceType) {
        case 'vercel':
          this.adapters.set(sourceType, new VercelAdapter());
          break;
        case 'local':
          this.adapters.set(sourceType, new LocalAdapter());
          break;
        case 'supabase':
          this.adapters.set(sourceType, new SupabaseAdapter());
          break;
        case 'user':
          this.adapters.set(sourceType, new UserAdapter());
          break;
        case 'system':
          this.adapters.set(sourceType, new SystemAdapter());
          break;
        default:
          throw new Error(`Unknown adapter type: ${sourceType}`);
      }
    }
    
    return this.adapters.get(sourceType);
  }
  
  static getAllStats() {
    const allStats = {};
    this.adapters.forEach((adapter, type) => {
      allStats[type] = adapter.stats;
    });
    return allStats;
  }
}

module.exports = {
  AdapterFactory,
  BaseAdapter,
  VercelAdapter,
  LocalAdapter,
  SupabaseAdapter,
  UserAdapter,
  SystemAdapter
};
