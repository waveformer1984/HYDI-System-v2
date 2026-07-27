/**
 * EXECUTION HARDENING LAYER
 * Independent enforcement for Windsurf execution
 * Turns executor from passive worker to independent verifier
 */

import { TransitionRegistry } from './transition-registry';
import { RepairPlanManager } from './repair-plans';

export interface ExecutionResult {
  status: "success" | "failed";
  action_results: ActionResult[];
  verification_passed: boolean;
  error: string | null;
  execution_time_ms: number;
  drift_detected?: boolean;
  validation_mismatch?: string;
}

export interface ActionResult {
  action_type: string;
  status: "success" | "failed";
  result: any;
  error?: string;
  execution_time_ms: number;
}

export interface ValidationDrift {
  api_validation: any;
  local_validation: any;
  mismatch_field: string;
  severity: "warning" | "critical";
}

export interface HardStopCondition {
  type: "terminal_state" | "budget_exceeded" | "invalid_plan" | "validation_mismatch" | "drift_detected";
  reason: string;
  task_id: string;
  timestamp: string;
}

/**
 * EXECUTION HARDENER
 * Independent validation and enforcement for task execution
 */
export class ExecutionHardener {
  
  /**
   * PRE-EXECUTION VALIDATION (Mirror Check)
   * Validate everything before execution begins
   */
  static async validateBeforeExecution(
    task: any,
    repairPlan?: any
  ): Promise<{ valid: boolean; errors: string[]; drift?: ValidationDrift }> {
    const errors: string[] = [];
    
    try {
      // 1. Validate state transition locally
      if (task.status && task.previous_status) {
        const localValidation = TransitionRegistry.validateTransition(
          task.previous_status as any, 
          task.status as any
        );
        
        if (localValidation) {
          errors.push(`Invalid transition: ${localValidation.message}`);
        }
      }
      
      // 2. Validate state version
      if (task.state_version === undefined) {
        errors.push("Missing state version");
      }
      
      // 3. Validate repair plan if present
      if (repairPlan) {
        const planValidation = RepairPlanManager.validateRepairPlan(repairPlan);
        if (!planValidation.valid) {
          errors.push(`Invalid repair plan: ${planValidation.errors.join(', ')}`);
        }
      }
      
      // 4. Check terminal state
      if (task.status && TransitionRegistry.isTerminal(task.status as any)) {
        errors.push(`Cannot execute terminal state: ${task.status}`);
      }
      
      // 5. Check retry budget
      if (task.retry_count >= task.max_retries) {
        errors.push("Retry budget exceeded");
      }
      
      return { valid: errors.length === 0, errors };
      
    } catch (error) {
      return {
        valid: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : 'Unknown'}`]
      };
    }
  }
  
  /**
   * DETECT GOVERNANCE DRIFT
   * Compare local validation with expected API validation
   */
  static detectDrift(
    localValidation: any,
    apiValidation: any
  ): ValidationDrift | null {
    // Check for critical mismatches
    const criticalFields = ['allowed', 'status', 'terminal'];
    
    for (const field of criticalFields) {
      if (localValidation[field] !== apiValidation[field]) {
        return {
          api_validation: apiValidation,
          local_validation: localValidation,
          mismatch_field: field,
          severity: "critical"
        };
      }
    }
    
    return null;
  }
  
  /**
   * VALIDATE ACTION BEFORE EXECUTION
   */
  static validateAction(action: any): { valid: boolean; error?: string } {
    const validActionTypes = [
      "analyze_error", 
      "identify_missing_module", 
      "apply_patch", 
      "rerun_task", 
      "verify_state"
    ];
    
    if (!action.type) {
      return { valid: false, error: "Missing action type" };
    }
    
    if (!validActionTypes.includes(action.type)) {
      return { valid: false, error: `Invalid action type: ${action.type}` };
    }
    
    // Action-specific validation
    switch (action.type) {
      case "apply_patch":
        if (!action.target) {
          return { valid: false, error: "apply_patch requires target" };
        }
        if (!action.operation) {
          return { valid: false, error: "apply_patch requires operation" };
        }
        break;
        
      case "verify_state":
        if (!action.expected_state) {
          return { valid: false, error: "verify_state requires expected_state" };
        }
        break;
    }
    
    return { valid: true };
  }
  
  /**
   * EXECUTE ACTION WITH GUARDS
   */
  static async executeActionWithGuard(
    action: any,
    executor: (action: any) => Promise<any>
  ): Promise<ActionResult> {
    const startTime = Date.now();
    
    try {
      // Pre-execution validation
      const validation = this.validateAction(action);
      if (!validation.valid) {
        return {
          action_type: action.type,
          status: "failed",
          result: null,
          error: validation.error,
          execution_time_ms: Date.now() - startTime
        };
      }
      
      // Execute action
      const result = await executor(action);
      
      return {
        action_type: action.type,
        status: "success",
        result,
        execution_time_ms: Date.now() - startTime
      };
      
    } catch (error) {
      return {
        action_type: action.type,
        status: "failed",
        result: null,
        error: error instanceof Error ? error.message : "Unknown error",
        execution_time_ms: Date.now() - startTime
      };
    }
  }
  
  /**
   * EXECUTE REPAIR PLAN WITH STEP-BY-STEP GUARDS
   */
  static async executeRepairPlan(
    repairPlan: any,
    actionExecutor: (action: any) => Promise<any>,
    verificationExecutor: (verification: any) => Promise<any>
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const actionResults: ActionResult[] = [];
    const driftDetected = false;
    
    try {
      // Pre-execution validation
      const validation = await this.validateBeforeExecution({}, repairPlan);
      if (!validation.valid) {
        return {
          status: "failed",
          action_results: [],
          verification_passed: false,
          error: `Pre-execution validation failed: ${validation.errors.join(', ')}`,
          execution_time_ms: Date.now() - startTime
        };
      }
      
      // Execute actions sequentially
      for (const action of repairPlan.actions) {
        const actionResult = await this.executeActionWithGuard(action, actionExecutor);
        actionResults.push(actionResult);
        
        // Abort on first action failure
        if (actionResult.status === "failed") {
          return {
            status: "failed",
            action_results: actionResults,
            verification_passed: false,
            error: `Action failed: ${actionResult.error}`,
            execution_time_ms: Date.now() - startTime
          };
        }
      }
      
      // Post-execution verification
      const verificationResult = await verificationExecutor(repairPlan.verification);
      
      if (!verificationResult.success) {
        return {
          status: "failed",
          action_results: actionResults,
          verification_passed: false,
          error: `Verification failed: ${verificationResult.error}`,
          execution_time_ms: Date.now() - startTime
        };
      }
      
      return {
        status: "success",
        action_results: actionResults,
        verification_passed: true,
        error: null,
        execution_time_ms: Date.now() - startTime,
        drift_detected: driftDetected
      };
      
    } catch (error) {
      return {
        status: "failed",
        action_results: actionResults,
        verification_passed: false,
        error: error instanceof Error ? error.message : "Unknown error",
        execution_time_ms: Date.now() - startTime,
        drift_detected: driftDetected
      };
    }
  }
  
  /**
   * CHECK HARD STOP CONDITIONS
   */
  static checkHardStopConditions(task: any): HardStopCondition | null {
    const conditions: HardStopCondition[] = [];
    
    // Terminal state
    if (task.status && TransitionRegistry.isTerminal(task.status as any)) {
      conditions.push({
        type: "terminal_state",
        reason: `Task is in terminal state: ${task.status}`,
        task_id: task.task_id || task.id,
        timestamp: new Date().toISOString()
      });
    }
    
    // Budget exceeded
    if (task.retry_count >= task.max_retries) {
      conditions.push({
        type: "budget_exceeded",
        reason: `Retry budget exceeded: ${task.retry_count}/${task.max_retries}`,
        task_id: task.task_id || task.id,
        timestamp: new Date().toISOString()
      });
    }
    
    // Invalid repair plan
    if (task.type === "fix" && task.inputs?.repair_plan_id) {
      // Would need to fetch and validate repair plan
      // For now, assume it's checked elsewhere
    }
    
    return conditions.length > 0 ? conditions[0] : null;
  }
  
  /**
   * CREATE EXECUTION REPORT
   */
  static createExecutionReport(
    task: any,
    result: ExecutionResult,
    hardStop?: HardStopCondition
  ): any {
    return {
      execution_id: `exec_${task.task_id || task.id}_${Date.now()}`,
      task_id: task.task_id || task.id,
      task_type: task.type,
      execution_status: result.status,
      execution_time_ms: result.execution_time_ms,
      action_results: result.action_results,
      verification_passed: result.verification_passed,
      drift_detected: result.drift_detected,
      hard_stop: hardStop,
      error: result.error,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * VALIDATE EXECUTION CONTRACT
   */
  static validateExecutionContract(result: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!result.status || !["success", "failed"].includes(result.status)) {
      errors.push("Missing or invalid status");
    }
    
    if (!Array.isArray(result.action_results)) {
      errors.push("Missing or invalid action_results");
    }
    
    if (typeof result.verification_passed !== "boolean") {
      errors.push("Missing or invalid verification_passed");
    }
    
    if (typeof result.execution_time_ms !== "number") {
      errors.push("Missing or invalid execution_time_ms");
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}
