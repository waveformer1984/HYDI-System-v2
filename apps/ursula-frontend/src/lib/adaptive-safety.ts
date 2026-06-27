/**
 * ADAPTIVE SAFETY CONTROLS
 * Intelligent, graded safety responses with signal quality
 * Replaces binary panic with proportional response
 */

export type SystemStatus = "RUNNING" | "DEGRADED" | "PAUSED" | "EMERGENCY";

export interface AdaptiveThresholds {
  degrade_threshold: number;      // 0.25 - Start degrading
  pause_threshold: number;       // 0.40 - Pause new tasks
  emergency_threshold: number;   // 0.60 - Emergency stop
  resume_threshold: number;       // 0.20 - Resume from pause
  decay_window_ms: number;        // 5 minutes - Historical window
}

export interface FailureSignature {
  signature: string;
  error_message: string;
  task_type: string;
  count: number;
  last_seen: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface StrategyPerformance {
  strategy: string;
  failure_signature: string;
  attempts: number;
  successes: number;
  success_rate: number;
  last_attempt: string;
  disabled_until?: string;
}

export interface IntelligentQuarantine {
  task_type: string;
  failure_signature: string;
  quarantined_at: string;
  expires_at: string;
  cooldown_minutes: number;
  severity: "TEMPORARY" | "EXTENDED" | "PERMANENT";
}

export interface AdaptiveMetrics {
  total_tasks: number;
  failure_rate: number;
  repair_failure_rate: number;
  window_size: number;
  failure_signatures: Map<string, FailureSignature>;
  strategy_performance: Map<string, StrategyPerformance>;
  quarantines: Map<string, IntelligentQuarantine>;
  last_updated: string;
}

/**
 * ADAPTIVE SAFETY CONTROLLER
 * Intelligent safety responses with signal quality
 */
export class AdaptiveSafetyController {
  private static instance: AdaptiveSafetyController;
  private system_status: SystemStatus = "RUNNING";
  private thresholds: AdaptiveThresholds;
  private metrics: AdaptiveMetrics;
  private failure_history: Array<any> = [];
  private signature_counts: Map<string, number> = new Map();
  private last_status_change?: string;
  private status_change_count: number = 0;

  private constructor() {
    this.thresholds = {
      degrade_threshold: 0.25,
      pause_threshold: 0.40,
      emergency_threshold: 0.60,
      resume_threshold: 0.20,
      decay_window_ms: 5 * 60 * 1000 // 5 minutes
    };

    this.metrics = {
      total_tasks: 0,
      failure_rate: 0,
      repair_failure_rate: 0,
      window_size: 50,
      failure_signatures: new Map(),
      strategy_performance: new Map(),
      quarantines: new Map(),
      last_updated: new Date().toISOString()
    };
  }

  static getInstance(): AdaptiveSafetyController {
    if (!AdaptiveSafetyController.instance) {
      AdaptiveSafetyController.instance = new AdaptiveSafetyController();
    }
    return AdaptiveSafetyController.instance;
  }

  /**
   * Register task execution with adaptive analysis
   */
  registerExecution(task: any, result: any): void {
    const execution = {
      task_id: task.task_id,
      task_type: task.type,
      status: result.status || task.status,
      error: result.error || task.error,
      timestamp: new Date().toISOString(),
      strategy: task.strategy,
      failure_signature: this.generateFailureSignature(result.error || "", task.type)
    };

    // Add to history
    this.failure_history.push(execution);

    // Apply time-based decay
    this.applyTimeDecay();

    // Update metrics
    this.updateAdaptiveMetrics();

    // Analyze patterns
    this.analyzeFailurePatterns(execution);

    // Track strategy performance
    this.trackStrategyPerformance(execution);

    // Check adaptive safety conditions
    this.checkAdaptiveConditions();

    // Update quarantines
    this.updateQuarantines();
  }

  /**
   * Generate failure signature for clustering
   */
  private generateFailureSignature(error: string, task_type: string): string {
    // Normalize error message
    const normalized_error = error
      .toLowerCase()
      .replace(/[0-9]+/g, 'N')  // Replace numbers
      .replace(/['"]/g, '')      // Remove quotes
      .replace(/\s+/g, '_')      // Normalize spaces
      .substring(0, 100);        // Limit length

    const signature = `${normalized_error}_${task_type}`;
    return this.hashString(signature);
  }

  /**
   * Simple hash function for signatures
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Apply time-based decay to failure history
   */
  private applyTimeDecay(): void {
    const cutoff = new Date(Date.now() - this.thresholds.decay_window_ms);
    
    // Remove old events
    this.failure_history = this.failure_history.filter(
      event => new Date(event.timestamp) > cutoff
    );

    // Maintain window size
    if (this.failure_history.length > this.metrics.window_size) {
      this.failure_history = this.failure_history.slice(-this.metrics.window_size);
    }
  }

  /**
   * Update adaptive metrics with signal quality
   */
  private updateAdaptiveMetrics(): void {
    const recent = this.failure_history.slice(-this.metrics.window_size);
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
   * Analyze failure patterns for intelligent response
   */
  private analyzeFailurePatterns(execution: any): void {
    if (execution.status === "failed" || execution.status === "hard_failed") {
      const signature = execution.failure_signature;
      
      // Update signature count
      this.signature_counts.set(signature, (this.signature_counts.get(signature) || 0) + 1);

      // Update or create failure signature record
      const existing = this.metrics.failure_signatures.get(signature);
      if (existing) {
        existing.count += 1;
        existing.last_seen = execution.timestamp;
        
        // Update severity based on frequency
        if (existing.count > 10) {
          existing.severity = "CRITICAL";
        } else if (existing.count > 5) {
          existing.severity = "HIGH";
        } else if (existing.count > 2) {
          existing.severity = "MEDIUM";
        }
      } else {
        this.metrics.failure_signatures.set(signature, {
          signature,
          error_message: execution.error || "Unknown",
          task_type: execution.task_type,
          count: 1,
          last_seen: execution.timestamp,
          severity: "LOW"
        });
      }

      // Check if quarantine is needed
      this.checkQuarantineNeed(execution);
    }
  }

  /**
   * Track strategy performance for learning
   */
  private trackStrategyPerformance(execution: any): void {
    if (!execution.strategy) return;

    const key = `${execution.strategy}_${execution.failure_signature}`;
    const existing = this.metrics.strategy_performance.get(key);

    if (existing) {
      existing.attempts += 1;
      if (execution.status === "completed") {
        existing.successes += 1;
      }
      existing.success_rate = existing.successes / existing.attempts;
      existing.last_attempt = execution.timestamp;

      // Disable strategy if success rate too low
      if (existing.attempts >= 5 && existing.success_rate < 0.3) {
        existing.disabled_until = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
      }
    } else {
      this.metrics.strategy_performance.set(key, {
        strategy: execution.strategy,
        failure_signature: execution.failure_signature,
        attempts: 1,
        successes: execution.status === "completed" ? 1 : 0,
        success_rate: execution.status === "completed" ? 1 : 0,
        last_attempt: execution.timestamp
      });
    }
  }

  /**
   * Check if quarantine is needed based on patterns
   */
  private checkQuarantineNeed(execution: any): void {
    const signature = execution.failure_signature;
    const failure_sig = this.metrics.failure_signatures.get(signature);
    
    if (!failure_sig) return;

    // Check if this signature is causing problems
    if (failure_sig.count >= 3 && failure_sig.severity !== "LOW") {
      const existing_quarantine = this.metrics.quarantines.get(execution.task_type);
      
      if (!existing_quarantine || new Date(existing_quarantine.expires_at) < new Date()) {
        // Calculate cooldown based on severity
        let cooldown_minutes = 10;
        let severity: "TEMPORARY" | "EXTENDED" | "PERMANENT" = "TEMPORARY";

        if (failure_sig.severity === "CRITICAL") {
          cooldown_minutes = 60;
          severity = "EXTENDED";
        } else if (failure_sig.severity === "HIGH") {
          cooldown_minutes = 30;
          severity = "EXTENDED";
        }

        this.metrics.quarantines.set(execution.task_type, {
          task_type: execution.task_type,
          failure_signature: signature,
          quarantined_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + cooldown_minutes * 60 * 1000).toISOString(),
          cooldown_minutes,
          severity
        });
      }
    }
  }

  /**
   * Update quarantines (expire old ones)
   */
  private updateQuarantines(): void {
    const now = new Date();
    for (const [task_type, quarantine] of this.metrics.quarantines) {
      if (new Date(quarantine.expires_at) < now) {
        this.metrics.quarantines.delete(task_type);
      }
    }
  }

  /**
   * Check adaptive safety conditions with graded response
   */
  private checkAdaptiveConditions(): void {
    const prevStatus = this.system_status;
    const failureRate = this.metrics.failure_rate;

    // Graded response based on failure rate
    if (failureRate > this.thresholds.emergency_threshold) {
      this.system_status = "EMERGENCY";
    } else if (failureRate > this.thresholds.pause_threshold) {
      this.system_status = "PAUSED";
    } else if (failureRate > this.thresholds.degrade_threshold) {
      this.system_status = "DEGRADED";
    } else if (failureRate < this.thresholds.resume_threshold && prevStatus !== "RUNNING") {
      // Resume conditions met
      this.system_status = "RUNNING";
    }

    // Track status changes
    if (prevStatus !== this.system_status) {
      this.last_status_change = new Date().toISOString();
      this.status_change_count += 1;
      
      console.log(`[ADAPTIVE-SAFETY] Status changed: ${prevStatus} -> ${this.system_status} (failure rate: ${failureRate.toFixed(3)})`);
    }
  }

  /**
   * Check if task is allowed with intelligent quarantine
   */
  canAcceptTask(task: any): { allowed: boolean; reason?: string } {
    // Check system status
    if (this.system_status === "EMERGENCY") {
      return { allowed: false, reason: "System in emergency mode" };
    }

    if (this.system_status === "PAUSED") {
      // Allow only fix tasks during pause
      if (task.type !== "fix") {
        return { allowed: false, reason: "System paused - only fix tasks allowed" };
      }
    }

    if (this.system_status === "DEGRADED") {
      // Allow only recovery tasks during degraded mode
      const allowed_types = ["fix", "diagnostic", "monitor"];
      if (!allowed_types.includes(task.type)) {
        return { allowed: false, reason: `System degraded - only ${allowed_types.join(", ")} tasks allowed` };
      }
    }

    // Check intelligent quarantine
    const quarantine = this.metrics.quarantines.get(task.type);
    if (quarantine && new Date(quarantine.expires_at) > new Date()) {
      return { 
        allowed: false, 
        reason: `Task type ${task.type} quarantined until ${quarantine.expires_at} (${quarantine.severity.toLowerCase()})` 
      };
    }

    // Check strategy performance for fix tasks
    if (task.type === "fix" && task.strategy && task.failure_signature) {
      const key = `${task.strategy}_${task.failure_signature}`;
      const strategy = this.metrics.strategy_performance.get(key);
      
      if (strategy && strategy.disabled_until && new Date(strategy.disabled_until) > new Date()) {
        return { 
          allowed: false, 
          reason: `Strategy ${task.strategy} disabled for this failure pattern until ${strategy.disabled_until}` 
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Get best strategy for failure signature
   */
  getBestStrategy(failure_signature: string): string | null {
    const strategies = Array.from(this.metrics.strategy_performance.values())
      .filter(sp => sp.failure_signature === failure_signature && sp.success_rate > 0.5)
      .sort((a, b) => b.success_rate - a.success_rate);

    return strategies.length > 0 ? strategies[0].strategy : null;
  }

  /**
   * Get system status with context
   */
  getSystemStatus(): SystemStatus {
    return this.system_status;
  }

  /**
   * Get adaptive metrics
   */
  getMetrics(): AdaptiveMetrics {
    return { ...this.metrics };
  }

  /**
   * Get failure patterns
   */
  getFailurePatterns(): FailureSignature[] {
    return Array.from(this.metrics.failure_signatures.values())
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get strategy performance
   */
  getStrategyPerformance(): StrategyPerformance[] {
    return Array.from(this.metrics.strategy_performance.values())
      .sort((a, b) => b.attempts - a.attempts);
  }

  /**
   * Update thresholds
   */
  updateThresholds(thresholds: Partial<AdaptiveThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Manual control with intelligence
   */
  pauseSystem(reason: string): void {
    this.system_status = "PAUSED";
    this.last_status_change = new Date().toISOString();
    console.log(`[ADAPTIVE-SAFETY] Manual pause: ${reason}`);
  }

  resumeSystem(): void {
    this.system_status = "RUNNING";
    this.last_status_change = new Date().toISOString();
    console.log("[ADAPTIVE-SAFETY] Manual resume");
  }

  setDegradedMode(): void {
    this.system_status = "DEGRADED";
    this.last_status_change = new Date().toISOString();
    console.log("[ADAPTIVE-SAFETY] Manual degraded mode");
  }

  /**
   * Get health summary with signal quality metrics
   */
  getHealthSummary(): any {
    return {
      system_status: this.system_status,
      metrics: this.metrics,
      thresholds: this.thresholds,
      failure_patterns: this.getFailurePatterns().slice(0, 5), // Top 5
      strategy_performance: this.getStrategyPerformance().slice(0, 5), // Top 5
      quarantined_count: this.metrics.quarantines.size,
      last_status_change: this.last_status_change,
      status_change_count: this.status_change_count,
      signal_quality: this.calculateSignalQuality()
    };
  }

  /**
   * Calculate signal quality score
   */
  private calculateSignalQuality(): number {
    let score = 100;

    // Penalize high failure rates
    score -= this.metrics.failure_rate * 100;

    // Penalize frequent status changes
    score -= this.status_change_count * 5;

    // Penalize many quarantines
    score -= this.metrics.quarantines.size * 10;

    // Penalize many failure patterns
    score -= this.metrics.failure_signatures.size * 2;

    return Math.max(0, Math.min(100, score));
  }
}
