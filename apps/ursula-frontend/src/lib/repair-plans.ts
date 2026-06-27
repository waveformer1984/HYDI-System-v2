/**
 * STRUCTURED REPAIR PLANS
 * Deterministic, inspectable recovery protocols
 * Replaces "hope-based fix tasks" with explicit strategies
 */

export interface RepairAction {
  type: "analyze_error" | "identify_missing_module" | "apply_patch" | "rerun_task" | "verify_state";
  input?: any;
  target?: string;
  operation?: string;
  params?: Record<string, any>;
}

export interface RepairVerification {
  type: "state_check" | "output_diff" | "invariant_check" | "rerun_task";
  expected_state?: "completed" | "failed";
  expected_output?: any;
  retries: number;
  timeout_ms?: number;
}

export interface RepairOutcome {
  status: "pending" | "running" | "completed" | "failed";
  reason?: string;
  attempt: number;
  started_at?: string;
  completed_at?: string;
}

export interface RepairPlan {
  repair_id: string;
  root_task_id: string;
  failure_type: string;
  strategy: string;
  confidence: number;
  actions: RepairAction[];
  verification: RepairVerification;
  outcome?: RepairOutcome;
  created_at: string;
  updated_at: string;
}

export interface RepairStrategy {
  name: string;
  description: string;
  failure_patterns: string[];
  actions: RepairAction[];
  verification: RepairVerification;
  max_attempts: number;
}

/**
 * CENTRAL REPAIR STRATEGY REGISTRY
 * Single source of truth for all repair strategies
 */
export class RepairStrategyRegistry {
  // REPAIR STRATEGIES - Change here ONLY
  private static readonly STRATEGIES: Record<string, RepairStrategy> = {
    "missing_import": {
      name: "patch_imports",
      description: "Add missing import statements to resolve import errors",
      failure_patterns: ["name.*not defined", "ImportError", "ModuleNotFoundError"],
      actions: [
        {
          type: "analyze_error",
          input: "stack_trace"
        },
        {
          type: "identify_missing_module"
        },
        {
          type: "apply_patch",
          target: "file.py",
          operation: "add_import"
        }
      ],
      verification: {
        type: "rerun_task",
        expected_state: "completed",
        retries: 1,
        timeout_ms: 30000
      },
      max_attempts: 3
    },
    "syntax_error": {
      name: "fix_syntax",
      description: "Fix Python syntax errors in source code",
      failure_patterns: ["SyntaxError", "invalid syntax"],
      actions: [
        {
          type: "analyze_error",
          input: "error_line"
        },
        {
          type: "apply_patch",
          target: "file.py",
          operation: "fix_syntax"
        }
      ],
      verification: {
        type: "rerun_task",
        expected_state: "completed",
        retries: 1,
        timeout_ms: 30000
      },
      max_attempts: 2
    },
    "timeout": {
      name: "increase_timeout_or_split_task",
      description: "Handle timeout errors by increasing limits or splitting work",
      failure_patterns: ["TimeoutError", "timeout", "took too long"],
      actions: [
        {
          type: "analyze_error",
          input: "execution_time"
        },
        {
          type: "apply_patch",
          operation: "increase_timeout"
        }
      ],
      verification: {
        type: "rerun_task",
        expected_state: "completed",
        retries: 1,
        timeout_ms: 60000
      },
      max_attempts: 2
    },
    "dependency_missing": {
      name: "install_dependency",
      description: "Install missing package dependencies",
      failure_patterns: ["No module named", "pip install", "requirements.txt"],
      actions: [
        {
          type: "identify_missing_module"
        },
        {
          type: "apply_patch",
          operation: "install_package"
        }
      ],
      verification: {
        type: "rerun_task",
        expected_state: "completed",
        retries: 1,
        timeout_ms: 45000
      },
      max_attempts: 2
    }
  };

  /**
   * Get strategy by failure type
   */
  static getStrategy(failureType: string): RepairStrategy | null {
    return this.STRATEGIES[failureType] || null;
  }

  /**
   * Match failure pattern to strategy
   */
  static matchStrategy(error: string): RepairStrategy | null {
    for (const [failureType, strategy] of Object.entries(this.STRATEGIES)) {
      for (const pattern of strategy.failure_patterns) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(error)) {
          return strategy;
        }
      }
    }
    return null;
  }

  /**
   * Get all strategies
   */
  static getAllStrategies(): RepairStrategy[] {
    return Object.values(this.STRATEGIES);
  }

  /**
   * Validate strategy exists
   */
  static validateStrategy(strategyName: string): boolean {
    return Object.values(this.STRATEGIES).some(s => s.name === strategyName);
  }
}

/**
 * REPAIR PLAN MANAGER
 * Creates and manages structured repair plans
 */
export class RepairPlanManager {
  /**
   * Create repair plan from failure
   */
  static createRepairPlan(
    rootTaskId: string,
    error: string,
    failureType?: string
  ): RepairPlan {
    // Auto-detect failure type if not provided
    if (!failureType) {
      const strategy = RepairStrategyRegistry.matchStrategy(error);
      failureType = strategy ? Object.keys(RepairStrategyRegistry['STRATEGIES']).find(
        key => RepairStrategyRegistry.getStrategy(key)?.name === strategy.name
      ) : 'unknown';
    }

    const strategy = RepairStrategyRegistry.getStrategy(failureType || 'unknown');
    if (!strategy) {
      throw new Error(`No repair strategy found for failure type: ${failureType || 'unknown'}`);
    }

    return {
      repair_id: `repair_${rootTaskId}_${Date.now()}`,
      root_task_id: rootTaskId,
      failure_type: failureType || 'unknown',
      strategy: strategy.name,
      confidence: 0.7, // Could be calculated based on pattern match confidence
      actions: [...strategy.actions],
      verification: { ...strategy.verification },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  /**
   * Validate repair plan structure
   */
  static validateRepairPlan(plan: RepairPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields
    if (!plan.repair_id) errors.push("Missing repair_id");
    if (!plan.root_task_id) errors.push("Missing root_task_id");
    if (!plan.failure_type) errors.push("Missing failure_type");
    if (!plan.strategy) errors.push("Missing strategy");
    if (!plan.actions || plan.actions.length === 0) errors.push("Missing actions");
    if (!plan.verification) errors.push("Missing verification");

    // Validate strategy exists
    if (!RepairStrategyRegistry.validateStrategy(plan.strategy)) {
      errors.push(`Invalid strategy: ${plan.strategy}`);
    }

    // Validate actions
    if (plan.actions) {
      const validActionTypes = ["analyze_error", "identify_missing_module", "apply_patch", "rerun_task", "verify_state"];
      plan.actions.forEach((action, index) => {
        if (!validActionTypes.includes(action.type)) {
          errors.push(`Invalid action type at index ${index}: ${action.type}`);
        }
      });
    }

    // Validate verification
    if (plan.verification) {
      const validVerificationTypes = ["state_check", "output_diff", "invariant_check", "rerun_task"];
      if (!validVerificationTypes.includes(plan.verification.type)) {
        errors.push(`Invalid verification type: ${plan.verification.type}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute repair plan step by step
   */
  static async executeRepairPlan(
    plan: RepairPlan,
    executor: (action: RepairAction) => Promise<any>
  ): Promise<RepairOutcome> {
    const outcome: RepairOutcome = {
      status: "running",
      attempt: (plan.outcome?.attempt || 0) + 1,
      started_at: new Date().toISOString()
    };

    try {
      // Execute actions sequentially
      for (const action of plan.actions) {
        await executor(action);
      }

      // Run verification
      outcome.status = "completed";
      outcome.completed_at = new Date().toISOString();

    } catch (error) {
      outcome.status = "failed";
      outcome.reason = error instanceof Error ? error.message : "Unknown error";
      outcome.completed_at = new Date().toISOString();
    }

    return outcome;
  }

  /**
   * Update repair plan outcome
   */
  static updateOutcome(plan: RepairPlan, outcome: RepairOutcome): RepairPlan {
    return {
      ...plan,
      outcome,
      updated_at: new Date().toISOString()
    };
  }

  /**
   * Check if repair plan should be retried
   */
  static shouldRetry(plan: RepairPlan): boolean {
    if (!plan.outcome) return true;

    const strategy = RepairStrategyRegistry.getStrategy(plan.failure_type);
    if (!strategy) return false;

    return plan.outcome.status === "failed" &&
      plan.outcome.attempt < strategy.max_attempts;
  }

  /**
   * Get repair plan statistics
   */
  static getRepairStats(plans: RepairPlan[]): {
    total: number;
    completed: number;
    failed: number;
    success_rate: number;
    strategy_stats: Record<string, { total: number; success: number; success_rate: number }>;
  } {
    const total = plans.length;
    const completed = plans.filter(p => p.outcome?.status === "completed").length;
    const failed = plans.filter(p => p.outcome?.status === "failed").length;
    const success_rate = total > 0 ? (completed / total) * 100 : 0;

    // Strategy breakdown
    const strategy_stats: Record<string, { total: number; success: number; success_rate: number }> = {};

    plans.forEach(plan => {
      const strategy = plan.strategy;
      if (!strategy_stats[strategy]) {
        strategy_stats[strategy] = { total: 0, success: 0, success_rate: 0 };
      }

      strategy_stats[strategy].total++;
      if (plan.outcome?.status === "completed") {
        strategy_stats[strategy].success++;
      }
    });

    // Calculate success rates
    Object.keys(strategy_stats).forEach(strategy => {
      const stats = strategy_stats[strategy];
      stats.success_rate = stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
    });

    return {
      total,
      completed,
      failed,
      success_rate,
      strategy_stats
    };
  }
}
