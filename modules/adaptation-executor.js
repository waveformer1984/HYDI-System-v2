/**
 * Adaptation Executor - Makes Heidi's insights actionable
 * Processes adaptation queue and executes safe adaptations automatically
 */

const EventEmitter = require('events');
const { supabase } = require('../src/database');

class AdaptationExecutor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.processing = false;
    this.queue = [];
    this.confidenceThreshold = options.confidenceThreshold || 0.7;
    this.autoExecuteSafe = options.autoExecuteSafe !== false;
    this.executionLog = [];
    
    // Safety boundaries - never execute these without human approval
    this.restrictedActions = [
      'delete_data',
      'modify_production_config',
      'change_payment_settings',
      'modify_security_policies',
      'delete_user_accounts'
    ];
    
    // Safe actions that can be auto-executed
    this.safeActions = [
      'enable_caching',
      'adjust_alert_thresholds',
      'simplify_interface',
      'implement_error_recovery',
      'optimize_query',
      'enable_compression',
      'adjust_rate_limits',
      'update_monitoring_config'
    ];
  }

  /**
   * Queue an adaptation for execution
   */
  async queueAdaptation(insight) {
    if (!insight.next_action) {
      console.log('[ADAPTATION] No action specified, skipping');
      return;
    }

    if (insight.confidence < this.confidenceThreshold) {
      console.log(`[ADAPTATION] Confidence ${insight.confidence} below threshold ${this.confidenceThreshold}, escalating`);
      await this.escalateToHuman(insight, 'low_confidence');
      return;
    }

    const action = insight.next_action;
    
    // Check if action is safe for auto-execution
    const isSafe = this.isActionSafe(action);
    
    const adaptationItem = {
      id: `adapt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      insight_id: insight.correlation_id,
      action_type: action.type,
      config: action.config,
      confidence: insight.confidence,
      auto_safe: isSafe && this.autoExecuteSafe,
      status: 'queued',
      created_at: new Date().toISOString()
    };

    this.queue.push(adaptationItem);
    
    // Persist to database
    await this.persistAdaptation(adaptationItem);
    
    this.emit('adaptation_queued', adaptationItem);
    console.log(`[ADAPTATION] Queued: ${action.type} (safe: ${isSafe}, auto: ${adaptationItem.auto_safe})`);
    
    // Process queue if not already processing
    if (!this.processing) {
      await this.processQueue();
    }
  }

  /**
   * Check if an action is safe for auto-execution
   */
  isActionSafe(action) {
    // Check if action type is in restricted list
    if (this.restrictedActions.includes(action.type)) {
      return false;
    }
    
    // Check if action requires explicit approval
    if (action.requires_approval === true) {
      return false;
    }
    
    // Check if action is in safe list
    return this.safeActions.includes(action.type);
  }

  /**
   * Process the adaptation queue
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    console.log(`[ADAPTATION] Processing queue (${this.queue.length} items)`);

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      
      try {
        if (item.auto_safe) {
          await this.executeAdaptation(item);
        } else {
          await this.escalateToHuman(item, 'unsafe_action');
        }
      } catch (error) {
        console.error(`[ADAPTATION] Error processing ${item.id}:`, error.message);
        item.status = 'failed';
        item.error = error.message;
        await this.updateAdaptationStatus(item);
        this.emit('adaptation_failed', { item, error });
      }
    }

    this.processing = false;
    console.log('[ADAPTATION] Queue processing complete');
  }

  /**
   * Execute a safe adaptation
   */
  async executeAdaptation(item) {
    console.log(`[ADAPTATION] Executing: ${item.action_type}`);
    
    const startTime = Date.now();
    let result;

    switch (item.action_type) {
      case 'enable_caching':
        result = await this.executeEnableCaching(item.config);
        break;
      case 'adjust_alert_thresholds':
        result = await this.executeAdjustThresholds(item.config);
        break;
      case 'simplify_interface':
        result = await this.executeSimplifyInterface(item.config);
        break;
      case 'implement_error_recovery':
        result = await this.executeErrorRecovery(item.config);
        break;
      case 'optimize_query':
        result = await this.executeOptimizeQuery(item.config);
        break;
      case 'enable_compression':
        result = await this.executeEnableCompression(item.config);
        break;
      case 'adjust_rate_limits':
        result = await this.executeAdjustRateLimits(item.config);
        break;
      case 'update_monitoring_config':
        result = await this.executeUpdateMonitoring(item.config);
        break;
      default:
        throw new Error(`Unknown action type: ${item.action_type}`);
    }

    item.status = 'completed';
    item.execution_time_ms = Date.now() - startTime;
    item.result = result;
    item.executed_at = new Date().toISOString();
    
    await this.updateAdaptationStatus(item);
    
    this.executionLog.push(item);
    
    this.emit('adaptation_executed', item);
    console.log(`[ADAPTATION] ✓ Completed: ${item.action_type} in ${item.execution_time_ms}ms`);
  }

  /**
   * Escalate to human for approval
   */
  async escalateToHuman(item, reason) {
    item.status = 'escalated';
    item.escalation_reason = reason;
    
    await this.updateAdaptationStatus(item);
    
    // Log escalation event
    await this.logEvent('adaptation.escalated', {
      adaptation_id: item.id,
      action_type: item.action_type,
      reason: reason,
      confidence: item.confidence
    });
    
    this.emit('adaptation_escalated', item);
    console.log(`[ADAPTATION] ⚠ Escalated to human: ${item.action_type} (${reason})`);
  }

  // Action implementations
  async executeEnableCaching(config) {
    console.log(`[ADAPTATION] Enabling cache with TTL ${config.cache_ttl}s for ${config.cache_key}`);
    // Implementation would enable caching in the system
    return { cache_enabled: true, ttl: config.cache_ttl, key: config.cache_key };
  }

  async executeAdjustThresholds(config) {
    console.log(`[ADAPTATION] Adjusting threshold to ${config.new_threshold}`);
    // Implementation would update alert thresholds
    return { threshold_updated: true, new_value: config.new_threshold };
  }

  async executeSimplifyInterface(config) {
    console.log(`[ADAPTATION] Simplifying interface for ${config.target}`);
    // Implementation would simplify UI components
    return { interface_simplified: true, target: config.target };
  }

  async executeErrorRecovery(config) {
    console.log(`[ADAPTATION] Implementing error recovery for ${config.error_type}`);
    // Implementation would add error handling
    return { recovery_implemented: true, error_type: config.error_type };
  }

  async executeOptimizeQuery(config) {
    console.log(`[ADAPTATION] Optimizing queries`);
    // Implementation would optimize database queries
    return { queries_optimized: true };
  }

  async executeEnableCompression(config) {
    console.log(`[ADAPTATION] Enabling compression`);
    // Implementation would enable response compression
    return { compression_enabled: true };
  }

  async executeAdjustRateLimits(config) {
    console.log(`[ADAPTATION] Adjusting rate limits`);
    // Implementation would update rate limiting
    return { rate_limits_adjusted: true };
  }

  async executeUpdateMonitoring(config) {
    console.log(`[ADAPTATION] Updating monitoring config`);
    // Implementation would update monitoring settings
    return { monitoring_updated: true };
  }

  /**
   * Persist adaptation to database
   */
  async persistAdaptation(item) {
    try {
      const { error } = await supabase
        .from('heidi_adaptation_queue')
        .insert({
          id: item.id,
          insight_id: item.insight_id,
          action_type: item.action_type,
          config: item.config,
          confidence: item.confidence,
          auto_safe: item.auto_safe,
          status: item.status,
          created_at: item.created_at
        });
      
      if (error) throw error;
    } catch (err) {
      console.error('[ADAPTATION] Failed to persist:', err.message);
    }
  }

  /**
   * Update adaptation status in database
   */
  async updateAdaptationStatus(item) {
    try {
      const { error } = await supabase
        .from('heidi_adaptation_queue')
        .update({
          status: item.status,
          result: item.result,
          error: item.error,
          execution_time_ms: item.execution_time_ms,
          executed_at: item.executed_at,
          escalation_reason: item.escalation_reason
        })
        .eq('id', item.id);
      
      if (error) throw error;
    } catch (err) {
      console.error('[ADAPTATION] Failed to update status:', err.message);
    }
  }

  /**
   * Log event to Heidi event stream
   */
  async logEvent(eventType, payload) {
    try {
      await supabase.functions.invoke('heidi-ingest-event', {
        body: {
          actor: 'adaptation-executor',
          event_type: eventType,
          correlation_id: payload.adaptation_id || payload.insight_id || crypto.randomUUID(),
          payload: payload,
          occurred_at: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('[ADAPTATION] Failed to log event:', error.message);
    }
  }

  /**
   * Get execution statistics
   */
  getStats() {
    const total = this.executionLog.length;
    const completed = this.executionLog.filter(i => i.status === 'completed').length;
    const escalated = this.executionLog.filter(i => i.status === 'escalated').length;
    const failed = this.executionLog.filter(i => i.status === 'failed').length;
    
    const avgExecutionTime = total > 0 
      ? this.executionLog.reduce((sum, i) => sum + (i.execution_time_ms || 0), 0) / total 
      : 0;

    return {
      total_adaptations: total,
      completed: completed,
      escalated: escalated,
      failed: failed,
      success_rate: total > 0 ? (completed / total * 100).toFixed(1) + '%' : '0%',
      avg_execution_time_ms: Math.round(avgExecutionTime),
      queue_length: this.queue.length
    };
  }
}

module.exports = AdaptationExecutor;
