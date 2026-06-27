/**
 * CENTRAL TRANSITION REGISTRY
 * Single source of truth for all state transitions
 * Eliminates scattered transition logic across codebase
 */

export type TaskState = "pending" | "claimed" | "queued" | "running" | "retrying" | "resolving" | "failed" | "hard_failed" | "completed";

export interface TransitionRule {
  from: TaskState;
  to: TaskState[];
  requires_budget?: boolean;
  max_attempts?: number;
  description?: string;
}

export interface TransitionViolation {
  type: "invalid_transition" | "budget_exceeded" | "terminal_violation" | "canonical_state";
  message: string;
  from?: TaskState;
  to?: TaskState;
  allowed?: TaskState[];
}

/**
 * SINGLE TRANSITION AUTHORITY
 * The ONLY place where state transitions are defined
 */
export class TransitionRegistry {
  // CENTRAL TRANSITION TABLE - Change here ONLY
  private static readonly TRANSITIONS: Record<TaskState, TaskState[]> = {
    "pending": ["claimed", "queued", "running", "failed"],
    "claimed": ["queued", "running", "failed"],
    "queued": ["running", "resolving", "failed"],
    "running": ["resolving", "completed", "failed"],
    "failed": ["retrying", "queued", "hard_failed"],
    "retrying": ["running", "queued", "hard_failed"],
    "resolving": ["queued", "running", "completed", "failed", "hard_failed"],
    "hard_failed": [],  // Terminal state
    "completed": []      // Terminal state
  };

  // Transition rules with additional constraints
  private static readonly RULES: Record<string, TransitionRule> = {
    "pending->queued": {
      from: "pending",
      to: ["queued"],
      description: "Task accepted into execution queue"
    },
    "queued->running": {
      from: "queued",
      to: ["running"],
      description: "Task started execution"
    },
    "queued->failed": {
      from: "queued",
      to: ["failed"],
      description: "Task failed before execution"
    },
    "running->completed": {
      from: "running",
      to: ["completed"],
      description: "Task completed successfully"
    },
    "running->failed": {
      from: "running",
      to: ["failed"],
      description: "Task failed during execution"
    },
    "failed->retrying": {
      from: "failed",
      to: ["retrying"],
      requires_budget: true,
      max_attempts: 3,
      description: "Retrying failed task"
    },
    "failed->hard_failed": {
      from: "failed",
      to: ["hard_failed"],
      description: "Task permanently failed"
    },
    "retrying->running": {
      from: "retrying",
      to: ["running"],
      description: "Retry attempt started"
    },
    "retrying->hard_failed": {
      from: "retrying",
      to: ["hard_failed"],
      requires_budget: true,
      max_attempts: 3,
      description: "Retry budget exhausted"
    },
    "resolving->running": {
      from: "resolving",
      to: ["running"],
      description: "Fix applied, retrying original task"
    },
    "resolving->failed": {
      from: "resolving",
      to: ["failed"],
      description: "Fix failed, task still broken"
    }
  };

  /**
   * Get allowed transitions for a state
   */
  static getAllowedTransitions(from: TaskState): TaskState[] {
    return [...this.TRANSITIONS[from]];
  }

  /**
   * Validate a single transition
   */
  static validateTransition(from: TaskState, to: TaskState): TransitionViolation | null {
    const allowed = this.TRANSITIONS[from];

    if (!allowed.includes(to)) {
      return {
        type: "invalid_transition",
        message: `Invalid transition from ${from} to ${to}`,
        from,
        to,
        allowed
      };
    }

    return null;
  }

  /**
   * Check if state is terminal
   */
  static isTerminal(state: TaskState): boolean {
    return this.TRANSITIONS[state].length === 0;
  }

  /**
   * Get transition rule details
   */
  static getTransitionRule(from: TaskState, to: TaskState): TransitionRule | null {
    const key = `${from}->${to}`;
    return this.RULES[key] || null;
  }

  /**
   * Get all transition rules
   */
  static getAllRules(): TransitionRule[] {
    return Object.values(this.RULES);
  }

  /**
   * Validate transition with budget constraints
   */
  static validateTransitionWithBudget(
    from: TaskState,
    to: TaskState,
    currentAttempts: number = 0
  ): TransitionViolation | null {
    // Basic transition validation
    const basicValidation = this.validateTransition(from, to);
    if (basicValidation) {
      return basicValidation;
    }

    // Check terminal state violation
    if (this.isTerminal(from)) {
      return {
        type: "terminal_violation",
        message: `Cannot transition from terminal state: ${from}`,
        from
      };
    }

    // Check budget constraints
    const rule = this.getTransitionRule(from, to);
    if (rule?.requires_budget && rule.max_attempts) {
      if (currentAttempts >= rule.max_attempts) {
        return {
          type: "budget_exceeded",
          message: `Budget exceeded for ${from}->${to}: ${currentAttempts}/${rule.max_attempts}`,
          from,
          to
        };
      }
    }

    return null;
  }

  /**
   * Get all possible states
   */
  static getAllStates(): TaskState[] {
    return Object.keys(this.TRANSITIONS) as TaskState[];
  }

  /**
   * Get terminal states
   */
  static getTerminalStates(): TaskState[] {
    return Object.entries(this.TRANSITIONS)
      .filter(([_, transitions]) => transitions.length === 0)
      .map(([state]) => state as TaskState);
  }

  /**
   * Get initial states (states with no incoming transitions)
   */
  static getInitialStates(): TaskState[] {
    const allStates = this.getAllStates();
    const targetStates = new Set<TaskState>();

    // Collect all target states
    Object.values(this.TRANSITIONS).forEach(transitions => {
      transitions.forEach(state => targetStates.add(state));
    });

    // States that are never targets are initial states
    return allStates.filter(state => !targetStates.has(state));
  }

  /**
   * Validate transition path (sequence of states)
   */
  static validateTransitionPath(path: TaskState[]): TransitionViolation | null {
    if (path.length < 2) return null;

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];

      const violation = this.validateTransition(from, to);
      if (violation) {
        return {
          ...violation,
          message: `Invalid path at step ${i + 1}: ${violation.message}`
        };
      }
    }

    return null;
  }

  /**
   * Generate state diagram (DOT format)
   */
  static generateStateDiagram(): string {
    const states = this.getAllStates();
    const terminalStates = this.getTerminalStates();

    let dot = 'digraph TaskStateMachine {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=circle];\n\n';

    // Add states
    states.forEach(state => {
      const style = terminalStates.includes(state) ? ' [shape=doublecircle]' : '';
      dot += `  "${state}"${style};\n`;
    });

    dot += '\n';

    // Add transitions
    Object.entries(this.TRANSITIONS).forEach(([from, transitions]) => {
      transitions.forEach(to => {
        dot += `  "${from}" -> "${to}";\n`;
      });
    });

    dot += '}';

    return dot;
  }

  /**
   * Export transitions as JSON
   */
  static exportTransitions(): Record<string, TaskState[]> {
    return JSON.parse(JSON.stringify(this.TRANSITIONS));
  }

  /**
   * Validate registry consistency
   */
  static validateRegistry(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const states = this.getAllStates();

    // Check all target states exist
    Object.values(this.TRANSITIONS).forEach(transitions => {
      transitions.forEach(target => {
        if (!states.includes(target)) {
          errors.push(`Target state "${target}" does not exist in registry`);
        }
      });
    });

    // Check for unreachable states
    const reachable = new Set<TaskState>();
    const initial = this.getInitialStates();

    // BFS from initial states
    const queue = [...initial];
    while (queue.length > 0) {
      const current = queue.shift()!;
      reachable.add(current);

      const transitions = this.TRANSITIONS[current];
      transitions.forEach(next => {
        if (!reachable.has(next)) {
          queue.push(next);
        }
      });
    }

    const unreachable = states.filter(state => !reachable.has(state));
    if (unreachable.length > 0) {
      errors.push(`Unreachable states: ${unreachable.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
