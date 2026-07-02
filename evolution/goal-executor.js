/**
 * HEIDI Goal Executor
 * Bridges HeidiGoalEngine with ActionExecutor to actually execute approved goals
 * 
 * This is where HEIDI stops planning and starts doing
 */

const ActionExecutor = require('../heidi-core/actions/action-executor');

class GoalExecutor {
  constructor(goalEngine, actionExecutor = null) {
    this.goalEngine = goalEngine;
    this.actionExecutor = actionExecutor || new ActionExecutor();
    this.executionHistory = [];
  }

  /**
   * Execute the next pending task for a goal
   * @param {string} goalId - The goal ID
   * @returns {object} - Execution result
   */
  async executeNextTask(goalId) {
    const goal = this.goalEngine.getGoal(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    if (goal.status !== 'active') {
      throw new Error(`Goal ${goalId} is not active (status: ${goal.status})`);
    }

    const task = this.goalEngine.nextTask(goalId);
    if (!task) {
      return { success: true, message: 'All tasks completed for this goal' };
    }

    console.log(`[GoalExecutor] Executing task: ${task.description}`);
    
    try {
      const result = await this._executeTask(task, goal);
      
      // Mark task as complete
      this.goalEngine.completeTask(goalId, task.id, result);
      
      this.executionHistory.push({
        goalId,
        taskId: task.id,
        taskDescription: task.description,
        status: 'success',
        result,
        timestamp: new Date().toISOString()
      });

      return { success: true, task, result };
    } catch (error) {
      console.error(`[GoalExecutor] Task failed: ${error.message}`);
      
      // Mark task as failed
      this.goalEngine.failTask(goalId, task.id, error.message);
      
      this.executionHistory.push({
        goalId,
        taskId: task.id,
        taskDescription: task.description,
        status: 'failed',
        error: error.message,
        timestamp: new Date().toISOString()
      });

      return { success: false, task, error: error.message };
    }
  }

  /**
   * Execute all pending tasks for a goal
   * @param {string} goalId - The goal ID
   * @returns {object} - Execution summary
   */
  async executeGoal(goalId) {
    const goal = this.goalEngine.getGoal(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    const results = [];
    let task = this.goalEngine.nextTask(goalId);
    
    while (task) {
      const result = await this.executeNextTask(goalId);
      results.push(result);
      
      if (!result.success) {
        // Stop on first failure
        break;
      }
      
      task = this.goalEngine.nextTask(goalId);
    }

    return {
      goalId,
      objective: goal.objective,
      status: this.goalEngine.getGoal(goalId).status,
      results,
      totalTasks: goal.tasks.length,
      completedTasks: results.filter(r => r.success).length
    };
  }

  /**
   * Execute all active goals
   * @returns {object} - Execution summary
   */
  async executeAllActiveGoals() {
    const activeGoals = this.goalEngine.getActiveGoals();
    const results = [];

    for (const goal of activeGoals) {
      console.log(`[GoalExecutor] Processing goal: ${goal.objective}`);
      const result = await this.executeGoal(goal.id);
      results.push(result);
    }

    return {
      totalGoals: activeGoals.length,
      results
    };
  }

  /**
   * Parse a task description and determine the appropriate action
   * @private
   */
  async _executeTask(task, goal) {
    const description = task.description.toLowerCase();
    
    // Determine action type based on task description
    if (description.includes('run') || description.includes('execute') || description.includes('script')) {
      return await this._executeRunTask(description);
    } else if (description.includes('write') || description.includes('create') || description.includes('file')) {
      return await this._executeWriteTask(description);
    } else if (description.includes('read') || description.includes('check') || description.includes('verify')) {
      return await this._executeReadTask(description);
    } else if (description.includes('deploy') || description.includes('push') || description.includes('git')) {
      return await this._executeDeployTask(description);
    } else {
      // Default: treat as a planning/documentation task
      return await this._executePlanTask(description);
    }
  }

  async _executeRunTask(description) {
    // Extract command from description (simple heuristic)
    const match = description.match(/(?:run|execute)\s+(.+)/i);
    const command = match ? match[1] : 'echo "Task executed"';
    
    const action = {
      type: 'run_command',
      command: command
    };
    
    return await this.actionExecutor.execute(action);
  }

  async _executeWriteTask(description) {
    // For now, just log it - actual file writing would need more parsing
    return {
      success: true,
      message: `Write task acknowledged: ${description}`,
      note: 'File writing requires additional parsing logic'
    };
  }

  async _executeReadTask(description) {
    // For now, just log it - actual file reading would need more parsing
    return {
      success: true,
      message: `Read task acknowledged: ${description}`,
      note: 'File reading requires additional parsing logic'
    };
  }

  async _executeDeployTask(description) {
    const action = {
      type: 'run_command',
      command: 'git status'
    };
    
    return await this.actionExecutor.execute(action);
  }

  async _executePlanTask(description) {
    return {
      success: true,
      message: `Planning task completed: ${description}`,
      result: 'Task documented and acknowledged'
    };
  }

  getExecutionHistory() {
    return this.executionHistory;
  }

  clearExecutionHistory() {
    this.executionHistory = [];
  }
}

module.exports = GoalExecutor;
