/**
 * URSULA BRIDGE - HYDI delegates execution to Ursula
 * This is the ONLY way HYDI executes tasks
 */

export interface UrsulaExecuteRequest {
  type: 'resonate'; // Single winner module
  params: Record<string, any>;
  idempotencyKey: string;
}

export interface UrsulaExecuteResponse {
  success: boolean;
  result?: any;
  executionId: string;
  cost: number;
  ledgerEntryId: string;
  executionState: string;
  error?: string;
}

export class UrsulaBridge {
  private static readonly URSULA_BASE_URL = process.env.URSULA_API_URL || 'http://localhost:3000';
  private static readonly API_KEY = process.env.URSULA_API_KEY;

  private static buildHeaders(
    userId?: string,
    traceId?: string,
    contentType: boolean = false
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = 'application/json';
    if (this.API_KEY) headers['Authorization'] = `Bearer ${this.API_KEY}`;
    if (userId) headers['X-User-ID'] = userId;
    if (traceId) headers['X-Trace-ID'] = traceId;
    return headers;
  }

  /**
   * Execute task through Ursula - ONLY execution path
   */
  static async executeTask(
    userId: string,
    taskType: string,
    taskParams: Record<string, any>,
    taskId: string,
    traceId?: string
  ): Promise<UrsulaExecuteResponse> {
    const idempotencyKey = `task-${taskId}`;

    const requestBody: UrsulaExecuteRequest = {
      type: 'resonate', // HYDI only delegates to Resonate
      params: taskParams,
      idempotencyKey,
    };

    try {
      const response = await fetch(`${this.URSULA_BASE_URL}/api/execute`, {
        method: 'POST',
        headers: this.buildHeaders(userId, traceId, true),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Ursula execution failed: ${errorData.error || response.statusText}`);
      }

      const result = await response.json();
      
      return {
        success: result.success,
        result: result.result,
        executionId: result.executionId,
        cost: result.cost,
        ledgerEntryId: result.ledgerEntryId,
        executionState: result.executionState,
        error: result.error,
      };

    } catch (error) {
      console.error('[URSULA-BRIDGE] Execution error:', error);
      
      return {
        success: false,
        executionId: '',
        cost: 0,
        ledgerEntryId: '',
        executionState: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown execution error',
      };
    }
  }

  /**
   * Check if user can afford execution (pre-validation)
   */
  static async checkUserCredits(
    userId: string,
    traceId?: string
  ): Promise<{
    canExecute: boolean;
    creditsRemaining: number;
    subscriptionActive: boolean;
  }> {
    try {
      const response = await fetch(`${this.URSULA_BASE_URL}/api/user/status`, {
        method: 'GET',
        headers: this.buildHeaders(userId, traceId),
      });

      if (!response.ok) {
        throw new Error(`Status check failed: ${response.statusText}`);
      }

      const status = await response.json();
      
      return {
        canExecute: status.subscriptionActive && status.creditsRemaining > 0,
        creditsRemaining: status.creditsRemaining || 0,
        subscriptionActive: status.subscriptionActive || false,
      };

    } catch (error) {
      console.error('[URSULA-BRIDGE] Status check error:', error);
      
      // Fail safe - assume no credits if we can't check
      return {
        canExecute: false,
        creditsRemaining: 0,
        subscriptionActive: false,
      };
    }
  }

  /**
   * Get execution status from Ursula
   */
  static async getExecutionStatus(executionId: string): Promise<{
    status: string;
    result?: any;
    error?: string;
  }>;
  static async getExecutionStatus(
    executionId: string,
    traceId?: string
  ): Promise<{
    status: string;
    result?: any;
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.URSULA_BASE_URL}/api/executions/${executionId}`, {
        method: 'GET',
        headers: this.buildHeaders(undefined, traceId),
      });

      if (!response.ok) {
        throw new Error(`Status check failed: ${response.statusText}`);
      }

      return await response.json();

    } catch (error) {
      console.error('[URSULA-BRIDGE] Execution status error:', error);
      
      return {
        status: 'UNKNOWN',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create payment intent for task execution
   */
  static async createPaymentIntent(
    userId: string,
    amount: number = 2, // Resonate costs 2 credits
    traceId?: string
  ): Promise<{
    success: boolean;
    paymentIntentId?: string;
    clientSecret?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.URSULA_BASE_URL}/api/billing/create-intent`, {
        method: 'POST',
        headers: this.buildHeaders(userId, traceId, true),
        body: JSON.stringify({ amount }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Payment intent creation failed: ${errorData.error || response.statusText}`);
      }

      const result = await response.json();
      
      return {
        success: true,
        paymentIntentId: result.paymentIntentId,
        clientSecret: result.clientSecret,
      };

    } catch (error) {
      console.error('[URSULA-BRIDGE] Payment intent error:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
