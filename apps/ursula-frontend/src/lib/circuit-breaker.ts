/**
 * CIRCUIT BREAKER - Prevent bridge failures from taking down the system
 * If UrsulaBridge fails repeatedly, stop trying and queue tasks
 */

export interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Failures before opening
  resetTimeout: number;         // Time before attempting reset (ms)
  monitoringPeriod: number;     // Time window for failure counting (ms)
  priorityTiers: {
    paidConfirmed: boolean;      // Allow paid/confirmed tasks
    highValue: boolean;          // Allow high-value users
    normal: boolean;             // Normal tasks blocked
  };
}

export class CircuitBreaker {
  private state: CircuitBreakerState;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: 5,
      resetTimeout: 60 * 1000,  // 1 minute
      monitoringPeriod: 10 * 60 * 1000,  // 10 minutes
      priorityTiers: {
        paidConfirmed: true,    // Allow paid/confirmed tasks
        highValue: true,        // Allow high-value users
        normal: false,           // Block normal tasks first
      },
      ...config,
    };

    this.state = {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };
  }

  /**
   * Execute operation through circuit breaker with priority support
   */
  async execute<T>(
    operation: () => Promise<T>,
    priority: 'paid_confirmed' | 'high_value' | 'normal' = 'normal'
  ): Promise<T> {
    if (this.isOpen() && !this.shouldAllowPriority(priority)) {
      throw new Error('Circuit breaker is OPEN - operation blocked');
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if priority should be allowed through open circuit
   */
  private shouldAllowPriority(priority: 'paid_confirmed' | 'high_value' | 'normal'): boolean {
    switch (priority) {
      case 'paid_confirmed':
        return this.config.priorityTiers.paidConfirmed;
      case 'high_value':
        return this.config.priorityTiers.highValue;
      case 'normal':
        return this.config.priorityTiers.normal;
      default:
        return false;
    }
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    if (!this.state.isOpen) {
      return false;
    }

    // Check if we should attempt a reset
    if (Date.now() >= this.state.nextAttemptTime) {
      this.attemptReset();
      return false;
    }

    return true;
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.state.failureCount = 0;
    this.state.isOpen = false;
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    const now = Date.now();

    // Reset failure count if outside monitoring period
    if (now - this.state.lastFailureTime > this.config.monitoringPeriod) {
      this.state.failureCount = 0;
    }

    this.state.failureCount++;
    this.state.lastFailureTime = now;

    // Open circuit if threshold exceeded
    if (this.state.failureCount >= this.config.failureThreshold) {
      this.openCircuit();
    }
  }

  /**
   * Open the circuit
   */
  private openCircuit(): void {
    this.state.isOpen = true;
    this.state.nextAttemptTime = Date.now() + this.config.resetTimeout;

    console.warn(`[CIRCUIT-BREAKER] Circuit opened due to ${this.state.failureCount} failures`);
  }

  /**
   * Attempt to reset circuit
   */
  private attemptReset(): void {
    console.log('[CIRCUIT-BREAKER] Attempting circuit reset');
    this.state.isOpen = false;
    this.state.failureCount = 0;
  }

  /**
   * Force reset circuit (for manual intervention)
   */
  forceReset(): void {
    console.log('[CIRCUIT-BREAKER] Manual circuit reset');
    this.state = {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };
  }
}

/**
 * Enhanced UrsulaBridge with circuit breaker and retry logic
 */
export class ResilientUrsulaBridge {
  private circuitBreaker: CircuitBreaker;
  private retryConfig: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
  };

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.circuitBreaker = new CircuitBreaker(config);
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000,    // 1 second
      maxDelay: 10000,     // 10 seconds
    };
  }

  /**
   * Execute task with circuit breaker and retry logic
   */
  async executeTask(
    userId: string,
    taskType: string,
    taskParams: Record<string, any>,
    taskId: string
  ): Promise<any> {
    return this.circuitBreaker.execute(async () => {
      return this.withRetry(() => {
        // Import UrsulaBridge dynamically to avoid circular dependencies
        return import('./ursula-bridge').then(({ UrsulaBridge }) =>
          UrsulaBridge.executeTask(userId, taskType, taskParams, taskId)
        );
      });
    });
  }

  /**
   * Check user credits with circuit breaker
   */
  async checkUserCredits(userId: string): Promise<any> {
    return this.circuitBreaker.execute(async () => {
      return this.withRetry(() => {
        return import('./ursula-bridge').then(({ UrsulaBridge }) =>
          UrsulaBridge.checkUserCredits(userId)
        );
      });
    });
  }

  /**
   * Create payment intent with circuit breaker
   */
  async createPaymentIntent(userId: string, amount?: number): Promise<any> {
    return this.circuitBreaker.execute(async () => {
      return this.withRetry(() => {
        return import('./ursula-bridge').then(({ UrsulaBridge }) =>
          UrsulaBridge.createPaymentIntent(userId, amount)
        );
      });
    });
  }

  /**
   * Get circuit breaker status for monitoring
   */
  getCircuitBreakerStatus(): CircuitBreakerState & { isHealthy: boolean } {
    const state = this.circuitBreaker.getState();
    return {
      ...state,
      isHealthy: !state.isOpen && state.failureCount < 3,
    };
  }

  /**
   * Execute with exponential backoff retry
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    attempt: number = 0
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= this.retryConfig.maxRetries) {
        throw error;
      }

      const delay = Math.min(
        this.retryConfig.baseDelay * Math.pow(2, attempt),
        this.retryConfig.maxDelay
      );

      console.warn(`[RESILIENT-BRIDGE] Retry ${attempt + 1}/${this.retryConfig.maxRetries} after ${delay}ms`);

      await this.sleep(delay);
      return this.withRetry(operation, attempt + 1);
    }
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
