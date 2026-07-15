/**
 * RECOVERY CONFIGURATION - No more arbitrary timeouts
 * Configurable, adaptive, and realistic failure handling
 */

export interface RecoveryConfig {
  timeouts: {
    execution: {
      base: number;        // Base timeout in ms
      max: number;         // Maximum timeout in ms
      multiplier: number;  // Backoff multiplier
    };
    payment: {
      base: number;        // Base timeout for payment confirmation
      max: number;         // Maximum timeout
      webhookDelay: number; // Expected max webhook delay
    };
    stall: {
      threshold: number;   // When to consider a task stalled
      checkInterval: number; // How often to check for stalls
    };
  };
  retries: {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    adaptiveBackoff: boolean;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeout: number;
    monitoringPeriod: number;
    priorityTiers: {
      paidConfirmed: boolean;    // Allow paid/confirmed tasks
      highValue: boolean;         // Allow high-value users
      normal: boolean;            // Normal tasks blocked
    };
  };
  reconciliation: {
    autoFix: boolean;             // DANGEROUS: Set to false
    requireExplicitAction: boolean; // ESCALATE, don't fix
    maxRecoveryAttempts: number;   // Prevent infinite loops
    finalState: string;           // FAILED_PERMANENT
  };
}

export const defaultConfig: RecoveryConfig = {
  timeouts: {
    execution: {
      base: 30 * 1000,      // 30 seconds base
      max: 5 * 60 * 1000,   // 5 minutes max
      multiplier: 2,        // Double each retry
    },
    payment: {
      base: 60 * 1000,      // 1 minute base
      max: 10 * 60 * 1000,  // 10 minutes max
      webhookDelay: 5 * 60 * 1000, // Stripe can delay up to 5 minutes
    },
    stall: {
      threshold: 5 * 60 * 1000,  // 5 minutes
      checkInterval: 60 * 1000,  // Check every minute
    },
  },
  retries: {
    maxAttempts: 3,
    baseDelay: 1000,       // 1 second
    maxDelay: 30000,       // 30 seconds
    adaptiveBackoff: true, // Increase delay on repeated failures
  },
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 60 * 1000,  // 1 minute
    monitoringPeriod: 10 * 60 * 1000, // 10 minutes
    priorityTiers: {
      paidConfirmed: true,    // Allow paid/confirmed through
      highValue: true,        // Allow high-value users
      normal: false,           // Block normal tasks first
    },
  },
  reconciliation: {
    autoFix: false,             // NEVER auto-fix financial discrepancies
    requireExplicitAction: true, // ALWAYS require manual approval
    maxRecoveryAttempts: 3,     // Prevent infinite loops
    finalState: 'FAILED_PERMANENT', // Dead state
  },
};

export class ConfigurableTimeouts {
  private config: RecoveryConfig;

  constructor(config: Partial<RecoveryConfig> = {}) {
    this.config = {
      ...defaultConfig,
      ...config,
    };
  }

  /**
   * Get adaptive timeout based on attempt number and context
   */
  getExecutionTimeout(attempt: number, context: 'normal' | 'high_priority' = 'normal'): number {
    const { base, max, multiplier } = this.config.timeouts.execution;
    
    let timeout = base * Math.pow(multiplier, attempt - 1);
    
    // High priority tasks get more time
    if (context === 'high_priority') {
      timeout *= 1.5;
    }
    
    return Math.min(timeout, max);
  }

  /**
   * Get payment timeout considering webhook delays
   */
  getPaymentTimeout(attempt: number): number {
    const { base, max, webhookDelay } = this.config.timeouts.payment;
    
    // Account for Stripe's webhook delays
    let timeout = base + webhookDelay;
    
    // Add backoff for retries
    timeout *= Math.pow(1.5, attempt - 1);
    
    return Math.min(timeout, max);
  }

  /**
   * Check if task should be considered stalled
   */
  isStalled(lastUpdate: Date, now: Date = new Date()): boolean {
    const timeSinceUpdate = now.getTime() - lastUpdate.getTime();
    return timeSinceUpdate > this.config.timeouts.stall.threshold;
  }

  /**
   * Get retry delay with adaptive backoff
   */
  getRetryDelay(attempt: number, consecutiveFailures: number = 0): number {
    const { baseDelay, maxDelay, adaptiveBackoff } = this.config.retries;
    
    let delay = baseDelay * Math.pow(2, attempt - 1);
    
    // Adaptive: increase delay if we've been failing consecutively
    if (adaptiveBackoff && consecutiveFailures > 2) {
      delay *= 1 + (consecutiveFailures * 0.5);
    }
    
    return Math.min(delay, maxDelay);
  }

  /**
   * Check if circuit breaker should allow request based on priority
   */
  shouldAllowRequest(priority: 'paid_confirmed' | 'high_value' | 'normal'): boolean {
    const { priorityTiers } = this.config.circuitBreaker;
    
    switch (priority) {
      case 'paid_confirmed':
        return priorityTiers.paidConfirmed;
      case 'high_value':
        return priorityTiers.highValue;
      case 'normal':
        return priorityTiers.normal;
      default:
        return false;
    }
  }

  /**
   * Check if recovery should stop (prevent infinite loops)
   */
  shouldStopRecovery(attempts: number, lastError: string): boolean {
    if (attempts >= this.config.reconciliation.maxRecoveryAttempts) {
      return true;
    }
    
    // Stop on certain critical errors
    const criticalErrors = [
      'INSUFFICIENT_FUNDS',
      'ACCOUNT_SUSPENDED',
      'PERMANENT_FAILURE',
    ];
    
    return criticalErrors.some(error => lastError.includes(error));
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(updates: Partial<RecoveryConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): RecoveryConfig {
    return { ...this.config };
  }
}
