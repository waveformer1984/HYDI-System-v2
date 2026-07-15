/**
 * LEARNING FILTER - CLEAN VERSION
 * Filters and compresses learning signals before Heidi updates
 */

import { HeidiStatusTracker, LearningSignal } from './heidi-status';
import { GlobalSafetyValves } from './global-safety-valves';
import { learnFromFailure } from './heidi-loop-engine';

export interface FilteredLearning {
  allowed_signals: LearningSignal[];
  blocked_signals: LearningSignal[];
  learning_blocked: boolean;
  block_reason?: string;
  compression_ratio: number;
}

export interface LearningConstraints {
  require_system_running: boolean;
  min_signal_strength: number;
  max_failure_variance: number;
  block_high_risk_strategies: boolean;
  require_stable_performance: boolean;
  learning_rate_modifier: number;
}

/**
 * LEARNING FILTER
 * Controls what Heidi can learn from and when
 */
export class LearningFilter {
  private static instance: LearningFilter;
  private constraints: LearningConstraints;
  private heidiStatus: HeidiStatusTracker;
  private safetyValves: GlobalSafetyValves;

  private constructor() {
    this.heidiStatus = HeidiStatusTracker.getInstance();
    this.safetyValves = GlobalSafetyValves.getInstance();
    
    this.constraints = {
      require_system_running: true,
      min_signal_strength: 0.3,
      max_failure_variance: 0.5,
      block_high_risk_strategies: true,
      require_stable_performance: true,
      learning_rate_modifier: 1.0
    };
  }

  static getInstance(): LearningFilter {
    if (!LearningFilter.instance) {
      LearningFilter.instance = new LearningFilter();
    }
    return LearningFilter.instance;
  }

  /**
   * Filter learning signals before Heidi can learn from them
   */
  filterLearningSignals(signals: LearningSignal[]): FilteredLearning {
    const filtered: FilteredLearning = {
      allowed_signals: [],
      blocked_signals: [],
      learning_blocked: false,
      compression_ratio: 0
    };

    // Check if learning should be blocked entirely
    const blockCheck = this.checkLearningBlock();
    if (blockCheck.blocked) {
      filtered.learning_blocked = true;
      filtered.block_reason = blockCheck.reason;
      filtered.blocked_signals = signals;
      return filtered;
    }

    // Filter individual signals
    for (const signal of signals) {
      if (this.shouldAllowSignal(signal)) {
        filtered.allowed_signals.push(this.compressSignal(signal));
      } else {
        filtered.blocked_signals.push(signal);
      }
    }

    // Calculate compression ratio
    filtered.compression_ratio = signals.length > 0 ? 
      filtered.allowed_signals.length / signals.length : 0;

    return filtered;
  }

  /**
   * Check if learning should be blocked entirely
   */
  private checkLearningBlock(): { blocked: boolean; reason?: string } {
    // Block if system not running
    if (this.constraints.require_system_running) {
      const systemStatus = this.safetyValves.getSystemStatus();
      if (systemStatus !== "RUNNING") {
        return { blocked: true, reason: `System status is ${systemStatus}` };
      }
    }

    // Block if Heidi status is too low
    const heidiStatus = this.heidiStatus.getStatus();
    if (heidiStatus.learning_blocked) {
      return { blocked: true, reason: "Heidi learning blocked by status" };
    }

    if (heidiStatus.confidence < 0.3) {
      return { blocked: true, reason: `Heidi confidence too low: ${heidiStatus.confidence.toFixed(2)}` };
    }

    return { blocked: false };
  }

  /**
   * Check if individual signal should be allowed
   */
  private shouldAllowSignal(signal: LearningSignal): boolean {
    // Block weak signals
    if (signal.signal_strength < this.constraints.min_signal_strength) {
      return false;
    }

    // Block learning from system not running
    if (this.constraints.require_system_running && signal.system_status !== "RUNNING") {
      return false;
    }

    // Block high-risk strategies
    if (this.constraints.block_high_risk_strategies) {
      const strategyPerf = this.heidiStatus.getStrategyRecommendations();
      if (strategyPerf.bad.includes(signal.strategy)) {
        return false;
      }
    }

    // Prioritize rejection and quarantine signals
    if (signal.signal_type === "success" && signal.signal_strength < 0.7) {
      return false; // Only allow strong success signals
    }

    return true;
  }

  /**
   * Compress signal to reduce noise
   */
  private compressSignal(signal: LearningSignal): LearningSignal {
    const compressed = { ...signal };

    // Reduce signal strength for noisy signals
    if (signal.signal_type === "success" && signal.signal_strength > 0.8) {
      compressed.signal_strength = 0.8; // Cap success signals
    }

    // Amplify important failure signals
    if (signal.signal_type === "rejection" || signal.signal_type === "quarantine") {
      compressed.signal_strength = Math.min(1.0, signal.signal_strength * 1.2);
    }

    // Apply learning rate modifier
    compressed.signal_strength *= this.constraints.learning_rate_modifier;

    return compressed;
  }

  /**
   * Create learning signal from execution result
   */
  createSignalFromExecution(
    task: any, 
    result: any, 
    strategy: string,
    failureSignature?: string
  ): LearningSignal {
    let signalType: "success" | "failure" | "rejection" | "quarantine" = "failure";
    let signalStrength = 0.5;

    if (result.status === "completed") {
      signalType = "success";
      signalStrength = 0.7;
    } else if (result.status === "rejected") {
      signalType = "rejection";
      signalStrength = 0.8;
    } else if (result.status === "quarantined") {
      signalType = "quarantine";
      signalStrength = 0.9;
    } else if (result.status === "failed") {
      signalType = "failure";
      signalStrength = 0.6;
    }

    // Adjust strength based on execution time
    if (result.execution_time_ms) {
      if (result.execution_time_ms < 5000) {
        signalStrength += 0.1; // Fast execution is good
      } else if (result.execution_time_ms > 60000) {
        signalStrength -= 0.2; // Slow execution is bad
      }
    }

    return {
      signal_type: signalType,
      strategy,
      intent_id: task.intent_id,
      failure_signature: failureSignature,
      system_status: this.safetyValves.getSystemStatus(),
      timestamp: new Date().toISOString(),
      signal_strength: Math.max(0, Math.min(1, signalStrength))
    };
  }

  /**
   * Process learning signals and update Heidi
   */
  async processLearning(signals: LearningSignal[]): Promise<{
    processed: number;
    blocked: number;
    heidi_updated: boolean;
  }> {
    // Filter signals
    const filtered = this.filterLearningSignals(signals);

    // Update Heidi with allowed signals
    let heidiUpdated = false;
    for (const signal of filtered.allowed_signals) {
      this.heidiStatus.recordLearningSignal(signal);
      heidiUpdated = true;
      
      // Use centralized learning engine for failures
      if (signal.signal_type === "failure" && signal.failure_signature) {
        const failureType = this.mapSignatureToFailureType(signal.failure_signature);
        learnFromFailure({
          type: failureType,
          intent_id: signal.intent_id || "unknown",
          severity: signal.signal_strength,
          context: signal
        });
      }
    }

    return {
      processed: filtered.allowed_signals.length,
      blocked: filtered.blocked_signals.length,
      heidi_updated: heidiUpdated
    };
  }

  /**
   * Map failure signature to failure type
   */
  private mapSignatureToFailureType(signature: string): "timeout" | "overload" | "resource_limit" | "security_violation" | "policy_breach" {
    if (signature.includes("timeout")) return "timeout";
    if (signature.includes("overload") || signature.includes("cpu")) return "overload";
    if (signature.includes("resource")) return "resource_limit";
    if (signature.includes("security")) return "security_violation";
    if (signature.includes("policy")) return "policy_breach";
    return "resource_limit"; // default
  }

  /**
   * Update learning constraints
   */
  updateConstraints(constraints: Partial<LearningConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  /**
   * Get current constraints
   */
  getConstraints(): LearningConstraints {
    return { ...this.constraints };
  }

  /**
   * Get learning statistics
   */
  getStatistics(): {
    total_signals: number;
    allowed_signals: number;
    blocked_signals: number;
    average_compression_ratio: number;
    learning_blocked_time: number;
  } {
    const signals = this.heidiStatus.getLearningSignals();
    const heidiStatus = this.heidiStatus.getStatus();
    
    const allowedSignals = signals.filter(s => s.signal_strength >= this.constraints.min_signal_strength);
    
    return {
      total_signals: signals.length,
      allowed_signals: allowedSignals.length,
      blocked_signals: signals.length - allowedSignals.length,
      average_compression_ratio: allowedSignals.length / Math.max(1, signals.length),
      learning_blocked_time: heidiStatus.learning_blocked ? 1 : 0
    };
  }
}
