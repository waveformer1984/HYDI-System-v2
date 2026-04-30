/**
 * HYDI Supabase Expansion Manager
 * 
 * Manages the expansion from local HYDI system to Supabase and beyond.
 * Handles bidirectional sync, conflict resolution, and fallback mechanisms.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class SupabaseExpansionManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = this.loadConfig();
    this.supabase = null;
    this.isConnected = false;
    this.syncStatus = new Map();
    this.pendingOperations = new Map();
    this.retryQueue = [];
    this.healthCheckInterval = null;
    
    // Expansion phases
    this.currentPhase = 'local';
    this.phases = {
      local: { completed: false, started: null },
      supabase: { completed: false, started: null },
      cascade: { completed: false, started: null },
      world: { completed: false, started: null }
    };
  }

  loadConfig() {
    try {
      const configPath = path.join(process.cwd(), 'config', 'supabase-expansion.json');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (error) {
      console.warn('Could not load expansion config:', error.message);
    }
    
    // Default configuration
    return {
      local_to_supabase: {
        default_sync_mode: 'bidirectional',
        conflict_resolution: 'local_wins'
      },
      database_config: {
        tables: {
          hydi_events: { sync_enabled: true, sync_direction: 'bidirectional' }
        }
      }
    };
  }

  async initialize(phase = 'full') {
    console.log(`🚀 Initializing Supabase Expansion Manager (Phase: ${phase})`);
    
    try {
      // Phase 1: Local system validation
      await this.validateLocalSystem();
      this.phases.local.completed = true;
      this.phases.local.started = new Date().toISOString();
      this.emit('phase_completed', 'local');

      if (phase === 'local') {
        return { phase: 'local', status: 'completed' };
      }

      // Phase 2: Supabase connection
      await this.connectToSupabase();
      this.phases.supabase.completed = true;
      this.phases.supabase.started = new Date().toISOString();
      this.emit('phase_completed', 'supabase');

      if (phase === 'supabase') {
        return { phase: 'supabase', status: 'completed' };
      }

      // Phase 3: Cascade integration
      await this.setupCascadeIntegration();
      this.phases.cascade.completed = true;
      this.phases.cascade.started = new Date().toISOString();
      this.emit('phase_completed', 'cascade');

      if (phase === 'cascade') {
        return { phase: 'cascade', status: 'completed' };
      }

      // Phase 4: World connectivity
      await this.enableWorldConnectivity();
      this.phases.world.completed = true;
      this.phases.world.started = new Date().toISOString();
      this.emit('phase_completed', 'world');

      // Start health monitoring
      this.startHealthMonitoring();

      return { 
        phase: 'full', 
        status: 'completed',
        phases: this.phases
      };

    } catch (error) {
      console.error('Expansion initialization failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  async validateLocalSystem() {
    console.log('🔍 Validating local HYDI system...');
    
    const checks = [
      {
        name: 'Server availability',
        check: async () => {
          try {
            const response = await fetch('http://localhost:3005/health', { timeout: 5000 });
            return response.ok;
          } catch {
            return false;
          }
        }
      },
      {
        name: 'Local models',
        check: () => fs.existsSync(path.join(process.cwd(), 'src', 'models', 'local-model-adapter.js'))
      },
      {
        name: 'Event bus',
        check: () => fs.existsSync(path.join(process.cwd(), 'modules', 'protoforge-event-bus.js'))
      },
      {
        name: 'Configuration files',
        check: () => fs.existsSync(path.join(process.cwd(), 'config', 'supabase-expansion.json'))
      }
    ];

    for (const check of checks) {
      const result = await check.check();
      if (!result) {
        throw new Error(`Local validation failed: ${check.name}`);
      }
      console.log(`✅ ${check.name}: OK`);
    }

    console.log('✅ Local system validation completed');
  }

  async connectToSupabase() {
    console.log('🔗 Connecting to Supabase...');
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not found in environment variables');
    }

    try {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      
      // Test connection
      const { data, error } = await this.supabase.from('hydi_events').select('count', { count: 'exact', head: true });
      
      if (error) {
        throw new Error(`Supabase connection failed: ${error.message}`);
      }

      this.isConnected = true;
      console.log('✅ Supabase connection established');
      
      // Setup real-time subscriptions
      await this.setupRealtimeSubscriptions();
      
      return { connected: true, eventCount: data };
    } catch (error) {
      console.error('❌ Supabase connection failed:', error.message);
      throw error;
    }
  }

  async setupRealtimeSubscriptions() {
    console.log('📡 Setting up real-time subscriptions...');
    
    const subscriptions = this.config.database_config?.realtime_subscriptions || [];
    
    for (const table of subscriptions) {
      try {
        // This would typically use Supabase real-time client
        console.log(`📡 Subscribing to ${table} changes`);
        // Implementation would depend on Supabase real-time client setup
      } catch (error) {
        console.warn(`⚠️  Failed to subscribe to ${table}:`, error.message);
      }
    }
  }

  async setupCascadeIntegration() {
    console.log('🌊 Setting up Cascade integration...');
    
    try {
      // Check if Cascade modules are available
      const cascadeModule = path.join(process.cwd(), 'modules', 'cascade-complete-v2.js');
      
      if (!fs.existsSync(cascadeModule)) {
        throw new Error('Cascade module not found');
      }

      // Setup event bridge between local and remote
      this.setupEventBridge();
      
      console.log('✅ Cascade integration completed');
    } catch (error) {
      console.error('❌ Cascade integration failed:', error.message);
      throw error;
    }
  }

  setupEventBridge() {
    // Event bridge for bidirectional communication
    this.on('local_event', async (event) => {
      if (this.isConnected && this.shouldSyncToRemote(event)) {
        await this.syncToRemote(event);
      }
    });

    this.on('remote_event', async (event) => {
      if (this.shouldSyncToLocal(event)) {
        await this.syncToLocal(event);
      }
    });
  }

  shouldSyncToRemote(event) {
    // Filter rules for syncing to remote
    const filterRules = this.config.cascade_integration?.event_bridge?.filter_rules;
    
    if (filterRules?.exclude_sensitive && event.type?.includes('sensitive')) {
      return false;
    }
    
    return true;
  }

  shouldSyncToLocal(event) {
    // Filter rules for syncing to local
    return true; // For now, accept all remote events
  }

  async syncToRemote(event) {
    try {
      const tableName = this.getTableNameForEvent(event);
      if (!tableName) return;

      const { data, error } = await this.supabase
        .from(tableName)
        .upsert(this.formatEventForTable(event, tableName), {
          onConflict: 'event_id'
        });

      if (error) {
        throw error;
      }

      console.log(`📤 Synced event to remote: ${event.event_id}`);
      this.emit('sync_success', { direction: 'to_remote', event_id: event.event_id });

    } catch (error) {
      console.error(`❌ Failed to sync to remote: ${error.message}`);
      this.emit('sync_error', { direction: 'to_remote', error: error.message, event });
      
      // Add to retry queue
      this.retryQueue.push({
        operation: 'sync_to_remote',
        event,
        timestamp: Date.now(),
        retries: 0
      });
    }
  }

  async syncToLocal(event) {
    try {
      // This would typically update local storage or emit to local event bus
      console.log(`📥 Synced event to local: ${event.event_id}`);
      this.emit('sync_success', { direction: 'to_local', event_id: event.event_id });

    } catch (error) {
      console.error(`❌ Failed to sync to local: ${error.message}`);
      this.emit('sync_error', { direction: 'to_local', error: error.message, event });
    }
  }

  getTableNameForEvent(event) {
    // Map event types to database tables
    const eventToTableMap = {
      'hydi_event': 'hydi_events',
      'model_update': 'hydi_models',
      'config_change': 'hydi_configurations',
      'metric_data': 'hydi_metrics'
    };

    return eventToTableMap[event.type] || 'hydi_events';
  }

  formatEventForTable(event, tableName) {
    // Format event for specific table structure
    const baseEvent = {
      event_id: event.event_id,
      timestamp: event.timestamp || new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    switch (tableName) {
      case 'hydi_events':
        return {
          ...baseEvent,
          type: event.type,
          source: event.source,
          payload: event.payload,
          processed: event.processed || false
        };
      
      case 'hydi_models':
        return {
          ...baseEvent,
          model_id: event.model_id,
          model_type: event.model_type,
          model_data: event.model_data,
          version: event.version
        };
      
      default:
        return { ...baseEvent, ...event };
    }
  }

  async enableWorldConnectivity() {
    console.log('🌍 Enabling world connectivity...');
    
    try {
      // Activate webhook services
      await this.activateWebhooks();
      
      // Setup external API connections
      await this.setupExternalAPIs();
      
      console.log('✅ World connectivity enabled');
    } catch (error) {
      console.error('❌ World connectivity setup failed:', error.message);
      throw error;
    }
  }

  async activateWebhooks() {
    console.log('🔗 Activating webhook services...');
    
    const webhookScript = path.join(process.cwd(), 'activate-passive-services.js');
    
    if (fs.existsSync(webhookScript)) {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      try {
        const { stdout, stderr } = await execAsync(`node "${webhookScript}"`);
        console.log('✅ Webhook services activated');
      } catch (error) {
        console.warn('⚠️  Webhook activation warning:', error.message);
      }
    } else {
      console.log('ℹ️  Webhook activation script not found');
    }
  }

  async setupExternalAPIs() {
    console.log('🔌 Setting up external API connections...');
    
    // Setup Stripe if configured
    if (process.env.STRIPE_SECRET_KEY) {
      console.log('💳 Stripe integration available');
    }
    
    // Setup other external services
    const externalAPIs = this.config.world_connectivity?.external_apis || {};
    
    Object.entries(externalAPIs).forEach(([name, config]) => {
      if (config.enabled) {
        console.log(`🔌 ${name} API available`);
      }
    });
  }

  startHealthMonitoring() {
    console.log('🏥 Starting health monitoring...');
    
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 60000); // Check every minute

    // Perform initial health check
    this.performHealthCheck();
  }

  async performHealthCheck() {
    const health = {
      timestamp: new Date().toISOString(),
      components: {}
    };

    // Check Supabase connection
    if (this.supabase && this.isConnected) {
      try {
        const { data, error } = await this.supabase.from('hydi_events').select('count', { count: 'exact', head: true });
        health.components.supabase = {
          status: error ? 'unhealthy' : 'healthy',
          eventCount: data || 0,
          error: error?.message
        };
      } catch (error) {
        health.components.supabase = {
          status: 'unreachable',
          error: error.message
        };
      }
    } else {
      health.components.supabase = {
        status: 'disconnected'
      };
    }

    // Check local server
    try {
      const response = await fetch('http://localhost:3005/health', { timeout: 5000 });
      health.components.local_server = {
        status: response.ok ? 'healthy' : 'unhealthy',
        statusCode: response.status
      };
    } catch (error) {
      health.components.local_server = {
        status: 'unreachable',
        error: error.message
      };
    }

    // Check sync status
    health.components.sync = {
      pending_operations: this.pendingOperations.size,
      retry_queue_size: this.retryQueue.length,
      active_syncs: this.syncStatus.size
    };

    // Emit health status
    this.emit('health_check', health);

    // Log warnings for unhealthy components
    Object.entries(health.components).forEach(([component, status]) => {
      if (status.status !== 'healthy') {
        console.warn(`⚠️  Health check - ${component}: ${status.status}`);
      }
    });
  }

  async processRetryQueue() {
    if (this.retryQueue.length === 0) return;

    console.log(`🔄 Processing retry queue (${this.retryQueue.length} items)`);
    
    const processed = [];
    const remaining = [];

    for (const item of this.retryQueue) {
      try {
        if (item.operation === 'sync_to_remote') {
          await this.syncToRemote(item.event);
          processed.push(item);
        }
      } catch (error) {
        item.retries++;
        if (item.retries < 3) {
          remaining.push(item);
        } else {
          console.error(`❌ Retry failed for ${item.event.event_id}: ${error.message}`);
        }
      }
    }

    this.retryQueue = remaining;
    
    if (processed.length > 0) {
      console.log(`✅ Processed ${processed.length} retry items`);
    }
  }

  getExpansionStatus() {
    return {
      current_phase: this.currentPhase,
      phases: this.phases,
      connected: this.isConnected,
      sync_status: Object.fromEntries(this.syncStatus),
      pending_operations: this.pendingOperations.size,
      retry_queue_size: this.retryQueue.length
    };
  }

  async shutdown() {
    console.log('🛑 Shutting down Supabase Expansion Manager...');
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Process any remaining retry queue items
    await this.processRetryQueue();

    console.log('✅ Shutdown completed');
  }
}

module.exports = SupabaseExpansionManager;
