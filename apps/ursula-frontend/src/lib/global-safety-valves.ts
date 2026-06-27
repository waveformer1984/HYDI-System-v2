/**
 * GLOBAL SAFETY VALVES
 * System-wide circuit breakers and kill switches
 * Prevents cascading failures and systemic stupidity
 */

export type SystemStatus = "RUNNING" | "PAUSED" | "DEGRADED" | "EMERGENCY";

export interface GlobalMetrics {
  total_tasks: number;
  failure_rate: number;
  repair_failure_rate: number;
  window_size: number;
  last_updated: string;
}

export interface SafetyValveConfig {
  failure_rate_threshold: number;      // 0.4 = 40% failure rate
  repair_failure_threshold: number;    // 0.6 = 60% repair failure rate
  window_size: number;                // Last N tasks to evaluate
  quarantine_threshold: number;         // N failures before quarantine
  auto_pause_enabled: boolean;
  escalation_enabled: boolean;
}

export interface QuarantineEntry {
  task_type: string;
  failure_count: number;
  quarantine_reason: string;
  quarantined_at: string;
  expires_at?: string;
}

export interface SafetyAlert {
  alert_type: "SYSTEM_PAUSED" | "QUARANTINE" | "DEAD_LETTER" | "REPAIR_CASCADE";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  task_id?: string;
  task_type?: string;
  failure_rate?: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * GLOBAL SAFETY VALVES CONTROLLER
 * System-wide circuit breakers and safety controls
 */
export class GlobalSafetyValves {
  private static instance: GlobalSafetyValves;
  private system_status: SystemStatus = "RUNNING";
  private metrics: GlobalMetrics;
  private config: SafetyValveConfig;
  private quarantined_types: Map<string, QuarantineEntry> = new Map();
  private alert_handlers: Array<(alert: SafetyAlert) => void> = [];
  private task_history: Array<any> = [];
  private last_pause_reason?: string;

  private constructor() {
    this.config = {
      failure_rate_threshold: 0.4,
      repair_failure_threshold: 0.6,
      window_size: 50,
      quarantine_threshold: 3,
      auto_pause_enabled: true,
      escalation_enabled: true
    };

    this.metrics = {
      total_tasks: 0,
      failure_rate: 0,
      repair_failure_rate: 0,
      window_size: this.config.window_size,
      last_updated: new Date().toISOString()
    };
  }

  static getInstance(): GlobalSafetyValves {
    if (!GlobalSafetyValves.instance) {
      GlobalSafetyValves.instance = new GlobalSafetyValves();
    }
    return GlobalSafetyValves.instance;
  }

  /**
   * Register task execution for metrics tracking
   */
  registerTaskExecution(task: any, result: any): void {
    const task_record = {
      task_id: task.task_id,
      task_type: task.type,
      status: result.status || task.status,
      timestamp: new Date().toISOString(),
      failure_reason: result.error || task.error
    };

    // Add to history (maintain window size)
    this.task_history.push(task_record);
    if (this.task_history.length > this.config.window_size) {
      this.task_history.shift();
    }

    // Update metrics
    this.updateMetrics();
    
    // Check safety conditions
    this.checkSafetyConditions(task, result);
  }

  /**
   * Update global metrics
   */
  private updateMetrics(): void {
    const recent = this.task_history.slice(-this.config.window_size);
    const total = recent.length;
    
    if (total === 0) {
      this.metrics.failure_rate = 0;
      this.metrics.repair_failure_rate = 0;
      return;
    }

    // Calculate overall failure rate
    const failures = recent.filter(t => t.status === "failed" || t.status === "hard_failed");
    this.metrics.failure_rate = failures.length / total;

    // Calculate repair failure rate
    const repair_tasks = recent.filter(t => t.task_type === "fix");
    if (repair_tasks.length > 0) {
      const repair_failures = repair_tasks.filter(t => t.status === "failed");
      this.metrics.repair_failure_rate = repair_failures.length / repair_tasks.length;
    } else {
      this.metrics.repair_failure_rate = 0;
    }

    this.metrics.total_tasks = total;
    this.metrics.last_updated = new Date().toISOString();
  }

  /**
   * Check all safety conditions and trigger actions
   */
  private checkSafetyConditions(task: any, result: any): void {
    // 1. Global failure rate circuit breaker
    if (this.metrics.failure_rate > this.config.failure_rate_threshold) {
      this.triggerGlobalPause("High failure rate detected", {
        failure_rate: this.metrics.failure_rate,
        threshold: this.config.failure_rate_threshold
      });
    }

    // 2. Repair failure cascade detection
    if (this.metrics.repair_failure_rate > this.config.repair_failure_threshold) {
      this.triggerGlobalPause("Repair system ineffective", {
        repair_failure_rate: this.metrics.repair_failure_rate,
        threshold: this.config.repair_failure_threshold
      });
    }

    // 3. Task type quarantine
    if (result.status === "failed" || result.status === "hard_failed") {
      this.checkTaskTypeQuarantine(task.type, result.error || "Unknown failure");
    }

    // 4. Dead letter escalation
    if (task.status === "hard_failed") {
      this.sendDeadLetterAlert(task);
    }
  }

  /**
   * Check if task type should be quarantined
   */
  private checkTaskTypeQuarantine(task_type: string, failure_reason: string): void {
    const entry = this.quarantined_types.get(task_type);
    
    if (entry) {
      // Increment failure count
      entry.failure_count++;
      
      // Check if should extend quarantine
      if (entry.failure_count >= this.config.quarantine_threshold * 2) {
        this.extendQuarantine(task_type, failure_reason);
      }
    } else {
      // Check failure pattern for this task type
      const recent_failures = this.task_history
        .filter(t => t.task_type === task_type && t.status === "failed")
        .slice(-this.config.quarantine_threshold);

      if (recent_failures.length >= this.config.quarantine_threshold) {
        this.quarantineTaskType(task_type, `Repeated failures: ${failure_reason}`);
      }
    }
  }

  /**
   * Quarantine a task type
   */
  private quarantineTaskType(task_type: string, reason: string): void {
    const entry: QuarantineEntry = {
      task_type,
      failure_count: this.config.quarantine_threshold,
      quarantine_reason: reason,
      quarantined_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString() // 1 hour
    };

    this.quarantined_types.set(task_type, entry);

    this.sendAlert({
      alert_type: "QUARANTINE",
      severity: "HIGH",
      message: `Task type ${task_type} quarantined due to repeated failures`,
      task_type,
      timestamp: new Date().toISOString(),
      metadata: { reason, failure_count: entry.failure_count }
    });
  }

  /**
   * Extend quarantine for a task type
   */
  private extendQuarantine(task_type: string, reason: string): void {
    const entry = this.quarantined_types.get(task_type);
    if (entry) {
      entry.failure_count++;
      entry.expires_at = new Date(Date.now() + 7200000).toISOString(); // 2 hours

      this.sendAlert({
        alert_type: "QUARANTINE",
        severity: "CRITICAL",
        message: `Quarantine extended for ${task_type} - continued failures`,
        task_type,
        timestamp: new Date().toISOString(),
        metadata: { reason, failure_count: entry.failure_count }
      });
    }
  }

  /**
   * Trigger global system pause
   */
  private triggerGlobalPause(reason: string, metadata?: any): void {
    if (!this.config.auto_pause_enabled) return;

    this.system_status = "PAUSED";
    this.last_pause_reason = reason;

    this.sendAlert({
      alert_type: "SYSTEM_PAUSED",
      severity: "CRITICAL",
      message: `System paused: ${reason}`,
      timestamp: new Date().toISOString(),
      metadata
    });
  }

  /**
   * Send dead letter alert
   */
  private sendDeadLetterAlert(task: any): void {
    if (!this.config.escalation_enabled) return;

    this.sendAlert({
      alert_type: "DEAD_LETTER",
      severity: "HIGH",
      message: `Task ${task.task_id} reached dead letter queue`,
      task_id: task.task_id,
      task_type: task.type,
      timestamp: new Date().toISOString(),
      metadata: {
        failure_reason: task.error,
        attempts: task.retry_count || 0
      }
    });
  }

  /**
   * Send safety alert
   */
  private sendAlert(alert: SafetyAlert): void {
    // Log alert
    console.error(`[SAFETY-VALVE] ${alert.alert_type}: ${alert.message}`, alert);

    // Notify registered handlers
    this.alert_handlers.forEach(handler => {
      try {
        handler(alert);
      } catch (error) {
        console.error("[SAFETY-VALVE] Alert handler failed:", error);
      }
    });
  }

  /**
   * Check if system can accept new tasks
   */
  canAcceptTask(task: any): { allowed: boolean; reason?: string } {
    // Check system status
    if (this.system_status === "PAUSED") {
      return { allowed: false, reason: `System paused: ${this.last_pause_reason}` };
    }

    if (this.system_status === "EMERGENCY") {
      return { allowed: false, reason: "System in emergency mode" };
    }

    // Check degraded mode restrictions
    if (this.system_status === "DEGRADED") {
      const allowed_types = ["fix", "diagnostic", "monitor"];
      if (!allowed_types.includes(task.type)) {
        return { allowed: false, reason: "System degraded - only recovery tasks allowed" };
      }
    }

    // Check quarantine
    if (this.isTaskTypeQuarantined(task.type)) {
      const entry = this.quarantined_types.get(task.type);
      return { 
        allowed: false, 
        reason: `Task type ${task.type} quarantined: ${entry?.quarantine_reason}` 
      };
    }

    return { allowed: true };
  }

  /**
   * Check if task type is quarantined
   */
  isTaskTypeQuarantined(task_type: string): boolean {
    const entry = this.quarantined_types.get(task_type);
    if (!entry) return false;

    // Check if quarantine expired
    if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
      this.quarantined_types.delete(task_type);
      return false;
    }

    return true;
  }

  /**
   * Get current system status
   */
  getSystemStatus(): SystemStatus {
    return this.system_status;
  }

  /**
   * Get current metrics
   */
  getMetrics(): GlobalMetrics {
    return { ...this.metrics };
  }

  /**
   * Get quarantined task types
   */
  getQuarantinedTypes(): Map<string, QuarantineEntry> {
    return new Map(this.quarantined_types);
  }

  /**
   * Manual control methods
   */
  pauseSystem(reason: string): void {
    this.triggerGlobalPause(reason || "Manual pause");
  }

  resumeSystem(): void {
    this.system_status = "RUNNING";
    this.last_pause_reason = undefined;
    
    this.sendAlert({
      alert_type: "SYSTEM_PAUSED",
      severity: "LOW",
      message: "System resumed - manual intervention",
      timestamp: new Date().toISOString()
    });
  }

  setDegradedMode(): void {
    this.system_status = "DEGRADED";
    
    this.sendAlert({
      alert_type: "SYSTEM_PAUSED",
      severity: "MEDIUM",
      message: "System entered degraded mode - only recovery tasks allowed",
      timestamp: new Date().toISOString()
    });
  }

  setEmergencyMode(): void {
    this.system_status = "EMERGENCY";
    
    this.sendAlert({
      alert_type: "SYSTEM_PAUSED",
      severity: "CRITICAL",
      message: "System entered emergency mode - all operations suspended",
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Register alert handler (for webhooks, emails, etc.)
   */
  registerAlertHandler(handler: (alert: SafetyAlert) => void): void {
    this.alert_handlers.push(handler);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SafetyValveConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Clear expired quarantines
   */
  clearExpiredQuarantines(): void {
    const now = new Date();
    for (const [task_type, entry] of this.quarantined_types) {
      if (entry.expires_at && new Date(entry.expires_at) < now) {
        this.quarantined_types.delete(task_type);
        
        this.sendAlert({
          alert_type: "QUARANTINE",
          severity: "LOW",
          message: `Quarantine expired for ${task_type}`,
          task_type,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Get system health summary
   */
  getHealthSummary(): any {
    return {
      system_status: this.system_status,
      metrics: this.metrics,
      quarantined_count: this.quarantined_types.size,
      last_pause_reason: this.last_pause_reason,
      config: this.config,
      task_history_size: this.task_history.length
    };
  }
}
