/**
 * HEIDI STATUS MODEL
 * Tracks Heidi's performance, confidence, and constraints
 * Prevents Heidi from acting like it can do anything
 */

export type SystemStatus = "RUNNING" | "DEGRADED" | "PAUSED" | "EMERGENCY";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface StrategySuccessRate {
  [strategy: string]: number;
}

export interface HeidiStatus {
  confidence: number;                    // 0.0 - 1.0
  recent_failures: number;               // Last 24 hours
  recent_successes: number;              // Last 24 hours
  strategy_success_rate: StrategySuccessRate;
  system_status: SystemStatus;
  risk_level: RiskLevel;
  learning_blocked: boolean;
  last_intent_proposal?: string;
  last_intent_score?: number;
  constraint_violations: number;
  adaptive_threshold: number;            // Minimum confidence to propose
}

export interface IntentProposal {
  intent_id: string;
  description: string;
  strategy: string;
  risk_score: number;
  allowed: boolean;
  reason?: string;
  proposed_at: string;
  heidi_confidence: number;
}

export interface LearningSignal {
  signal_type: "success" | "failure" | "rejection" | "quarantine";
  strategy: string;
  intent_id?: string;
  failure_signature?: string;
  system_status: SystemStatus;
  timestamp: string;
  signal_strength: number;              // 0.0 - 1.0
}

/**
 * HEIDI STATUS TRACKER
 * Manages Heidi's performance metrics and constraints
 */
export class HeidiStatusTracker {
  private static instance: HeidiStatusTracker;
  private status: HeidiStatus;
  private intentHistory: IntentProposal[] = [];
  private learningSignals: LearningSignal[] = [];
  private lastUpdate: string;

  private constructor() {
    this.status = {
      confidence: 0.5,
      recent_failures: 0,
      recent_successes: 0,
      strategy_success_rate: {},
      system_status: "RUNNING",
      risk_level: "MEDIUM",
      learning_blocked: false,
      constraint_violations: 0,
      adaptive_threshold: 0.3
    };
    this.lastUpdate = new Date().toISOString();
  }

  static getInstance(): HeidiStatusTracker {
    if (!HeidiStatusTracker.instance) {
      HeidiStatusTracker.instance = new HeidiStatusTracker();
    }
    return HeidiStatusTracker.instance;
  }

  /**
   * Update Heidi status based on system state
   */
  updateFromSystemState(systemStatus: SystemStatus, failureRate: number): void {
    this.status.system_status = systemStatus;

    // Block learning if system not healthy
    this.status.learning_blocked = systemStatus !== "RUNNING";

    // Adjust risk level based on system state
    if (systemStatus === "EMERGENCY") {
      this.status.risk_level = "CRITICAL";
      this.status.confidence = Math.max(0.1, this.status.confidence - 0.2);
    } else if (systemStatus === "PAUSED") {
      this.status.risk_level = "HIGH";
      this.status.confidence = Math.max(0.2, this.status.confidence - 0.1);
    } else if (systemStatus === "DEGRADED") {
      this.status.risk_level = "MEDIUM";
      this.status.confidence = Math.max(0.3, this.status.confidence - 0.05);
    } else {
      // System is running - allow confidence recovery
      if (failureRate < 0.2) {
        this.status.risk_level = "LOW";
        this.status.confidence = Math.min(0.9, this.status.confidence + 0.05);
      } else if (failureRate < 0.4) {
        this.status.risk_level = "MEDIUM";
        this.status.confidence = Math.min(0.7, this.status.confidence + 0.02);
      }
    }

    // Adjust adaptive threshold based on confidence
    this.status.adaptive_threshold = 0.3 + (1 - this.status.confidence) * 0.4;

    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Record intent proposal
   */
  recordIntentProposal(proposal: IntentProposal): void {
    this.intentHistory.push(proposal);
    this.status.last_intent_proposal = proposal.description;
    this.status.last_intent_score = proposal.risk_score;

    // Maintain history size
    if (this.intentHistory.length > 100) {
      this.intentHistory = this.intentHistory.slice(-100);
    }

    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Record learning signal
   */
  recordLearningSignal(signal: LearningSignal): void {
    this.learningSignals.push(signal);

    // Update counters
    if (signal.signal_type === "success") {
      this.status.recent_successes++;
    } else if (signal.signal_type === "failure") {
      this.status.recent_failures++;
    }

    // Update strategy success rates
    if (signal.strategy) {
      const current = this.status.strategy_success_rate[signal.strategy] || 0.5;
      const weight = signal.signal_strength;
      const newValue = signal.signal_type === "success" ? 1 : 0;
      this.status.strategy_success_rate[signal.strategy] = current * (1 - weight) + newValue * weight;
    }

    // Adjust confidence based on signals
    if (signal.signal_type === "success" && !this.status.learning_blocked) {
      this.status.confidence = Math.min(0.9, this.status.confidence + 0.01 * signal.signal_strength);
    } else if (signal.signal_type === "failure") {
      this.status.confidence = Math.max(0.1, this.status.confidence - 0.02 * signal.signal_strength);
    } else if (signal.signal_type === "rejection") {
      this.status.confidence = Math.max(0.2, this.status.confidence - 0.03 * signal.signal_strength);
    }

    // Maintain signal history
    if (this.learningSignals.length > 1000) {
      this.learningSignals = this.learningSignals.slice(-1000);
    }

    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Check if Heidi can propose intent
   */
  canProposeIntent(): { allowed: boolean; reason?: string } {
    // Block if learning is disabled
    if (this.status.learning_blocked) {
      return { allowed: false, reason: "Learning blocked - system not healthy" };
    }

    // Block if confidence too low
    if (this.status.confidence < this.status.adaptive_threshold) {
      return {
        allowed: false,
        reason: `Confidence too low: ${this.status.confidence.toFixed(2)} < ${this.status.adaptive_threshold.toFixed(2)}`
      };
    }

    // Block if risk level too high
    if (this.status.risk_level === "CRITICAL") {
      return { allowed: false, reason: "Risk level too high: CRITICAL" };
    }

    // Block if too many recent failures
    if (this.status.recent_failures > this.status.recent_successes * 2) {
      return { allowed: false, reason: "Too many recent failures" };
    }

    return { allowed: true };
  }

  /**
   * Get strategy recommendations (what Heidi is good/bad at)
   */
  getStrategyRecommendations(): { good: string[], bad: string[], improving: string[] } {
    const strategies = Object.entries(this.status.strategy_success_rate);

    const good = strategies
      .filter(([_, rate]) => rate > 0.7)
      .map(([strategy, _]) => strategy);

    const bad = strategies
      .filter(([_, rate]) => rate < 0.4)
      .map(([strategy, _]) => strategy);

    const improving = strategies
      .filter(([_, rate]) => rate >= 0.4 && rate <= 0.7)
      .map(([strategy, _]) => strategy);

    return { good, bad, improving };
  }

  /**
   * Get failure patterns to avoid
   */
  getFailurePatterns(): { signatures: string[], types: string[], strategies: string[] } {
    const recentFailures = this.learningSignals
      .filter(s => s.signal_type === "failure")
      .slice(-50);

    const signatures = [...new Set(recentFailures.map(f => f.failure_signature).filter((s): s is string => Boolean(s)))];
    const types = [...new Set(recentFailures.map(f => f.strategy).filter((s): s is string => Boolean(s)))];
    const strategies = [...new Set(recentFailures.map(f => f.strategy).filter((s): s is string => Boolean(s)))];

    return { signatures, types, strategies };
  }

  /**
   * Get current status
   */
  getStatus(): HeidiStatus {
    return { ...this.status };
  }

  /**
   * Get intent history
   */
  getIntentHistory(limit?: number): IntentProposal[] {
    return limit ? this.intentHistory.slice(-limit) : this.intentHistory;
  }

  /**
   * Get learning signals
   */
  getLearningSignals(limit?: number): LearningSignal[] {
    return limit ? this.learningSignals.slice(-limit) : this.learningSignals;
  }

  /**
   * Reset daily counters
   */
  resetDailyCounters(): void {
    this.status.recent_failures = 0;
    this.status.recent_successes = 0;
    this.lastUpdate = new Date().toISOString();
  }

  /**
   * Get health summary
   */
  getHealthSummary(): any {
    const { good, bad, improving } = this.getStrategyRecommendations();
    const failurePatterns = this.getFailurePatterns();

    return {
      status: this.status,
      strategy_performance: { good, bad, improving },
      failure_patterns: failurePatterns,
      recent_intents: this.intentHistory.slice(-5),
      learning_blocked: this.status.learning_blocked,
      can_propose: this.canProposeIntent(),
      health_score: this.calculateHealthScore()
    };
  }

  /**
   * Calculate overall health score
   */
  private calculateHealthScore(): number {
    let score = 50; // Base score

    // Confidence contribution
    score += this.status.confidence * 20;

    // Success rate contribution
    const totalAttempts = this.status.recent_successes + this.status.recent_failures;
    if (totalAttempts > 0) {
      const successRate = this.status.recent_successes / totalAttempts;
      score += successRate * 20;
    }

    // System status contribution
    switch (this.status.system_status) {
      case "RUNNING": score += 10; break;
      case "DEGRADED": score += 0; break;
      case "PAUSED": score -= 10; break;
      case "EMERGENCY": score -= 20; break;
    }

    // Risk level penalty
    switch (this.status.risk_level) {
      case "LOW": score += 0; break;
      case "MEDIUM": score -= 5; break;
      case "HIGH": score -= 10; break;
      case "CRITICAL": score -= 15; break;
    }

    return Math.max(0, Math.min(100, score));
  }
}
