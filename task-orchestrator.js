#!/usr/bin/env node
/**
 * HYDI Task Orchestrator
 * ======================
 *
 * Executes tasks as directed acyclic graphs (DAGs).
 * Manages dependencies, parallelizes independent steps,
 * and coordinates multi-agent workflows.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.hydi', 'logs');

// ============================================================================
// TASK ORCHESTRATOR
// ============================================================================

class TaskOrchestrator {
  constructor(agentRegistry) {
    this.agentRegistry = agentRegistry;
    this.executingTasks = new Map();
    this.taskHistory = [];
    this.logger = this.createLogger();
  }

  createLogger() {
    return {
      info: (msg, data = {}) => this._log('INFO', msg, data),
      warn: (msg, data = {}) => this._log('WARN', msg, data),
      error: (msg, data = {}) => this._log('ERROR', msg, data),
    };
  }

  _log(level, message, data) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, component: 'task-orchestrator', message, ...data };
    console.log(`[${timestamp}] [${level}] [Orchestrator] ${message}`);

    const logFile = path.join(LOG_DIR, 'task-orchestrator.log');
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  }

  // ========================================================================
  // TASK EXECUTION
  // ========================================================================

  async execute(taskDef) {
    const taskId = taskDef.id || uuidv4();

    this.logger.info(`Executing task: ${taskDef.name}`, { taskId });

    const task = {
      id: taskId,
      name: taskDef.name,
      type: taskDef.type,
      startTime: Date.now(),
      status: 'RUNNING',
      steps: taskDef.steps || [],
      results: {},
      errors: [],
    };

    this.executingTasks.set(taskId, task);

    try {
      // Validate DAG
      this.validateDAG(task.steps);

      // Resolve agent assignments
      const assignments = this.assignAgents(task.steps);

      // Execute steps respecting dependencies
      const execution = await this.executeDAG(task, assignments);

      task.status = execution.success ? 'COMPLETED' : 'FAILED';
      task.results = execution.results;
      task.errors = execution.errors;

      // Store in history
      this.taskHistory.push({
        ...task,
        endTime: Date.now(),
        duration: Date.now() - task.startTime,
      });

      // Learn from successful execution
      if (execution.success) {
        await this.learnWorkflow(task);
      }

      this.logger.info(`Task completed: ${taskId}`, {
        status: task.status,
        duration: Date.now() - task.startTime,
      });

      return {
        success: execution.success,
        taskId,
        results: execution.results,
        errors: execution.errors,
        duration: Date.now() - task.startTime,
      };
    } catch (error) {
      task.status = 'FAILED';
      task.errors.push(error.message);

      this.logger.error(`Task failed: ${taskId}`, { error: error.message });

      return {
        success: false,
        taskId,
        error: error.message,
        duration: Date.now() - task.startTime,
      };
    } finally {
      this.executingTasks.delete(taskId);
    }
  }

  // ========================================================================
  // DAG EXECUTION
  // ========================================================================

  validateDAG(steps) {
    // Check for circular dependencies
    const visited = new Set();
    const recStack = new Set();

    const hasCycle = (stepId) => {
      visited.add(stepId);
      recStack.add(stepId);

      const step = steps.find((s) => s.id === stepId);
      for (const dep of step.dependencies || []) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) return true;
        } else if (recStack.has(dep)) {
          return true;
        }
      }

      recStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id) && hasCycle(step.id)) {
        throw new Error(`Circular dependency detected in DAG`);
      }
    }
  }

  assignAgents(steps) {
    const assignments = {};

    for (const step of steps) {
      if (step.agent) {
        // Explicit agent assignment
        assignments[step.id] = this.agentRegistry.get(step.agent);
      } else {
        // Auto-assign based on capability
        const candidates = this.agentRegistry.getByCapability(step.action);
        if (candidates.length === 0) {
          throw new Error(`No agent found for capability: ${step.action}`);
        }
        // Choose agent with lowest current load
        assignments[step.id] = candidates.reduce((a, b) =>
          a.tasksCompleted < b.tasksCompleted ? a : b
        );
      }
    }

    return assignments;
  }

  async executeDAG(task, assignments) {
    const results = {};
    const errors = [];
    const completed = new Set();

    // Topological sort
    const sorted = this.topologicalSort(task.steps);

    // Execute in dependency order, parallelizing where possible
    for (const stepIds of sorted) {
      // Execute all steps at this level in parallel
      const promises = stepIds.map(async (stepId) => {
        const step = task.steps.find((s) => s.id === stepId);
        const agent = assignments[stepId];

        // Wait for dependencies
        for (const dep of step.dependencies || []) {
          while (!completed.has(dep)) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }

        // Execute
        this.logger.info(`Step ${step.id}: ${agent.name} executing ${step.action}`);

        const result = await agent.execute({
          id: step.id,
          type: step.action,
          inputs: step.inputs,
          context: { taskId: task.id, previousResults: results },
          startTime: Date.now(),
        });

        if (result.success) {
          results[stepId] = result.result;
          await agent.recordSuccess(step, result.result);
        } else {
          errors.push({ step: stepId, error: result.error });
          await agent.recordFailure(step, new Error(result.error));
        }

        completed.add(stepId);
        return result.success;
      });

      const stepResults = await Promise.all(promises);

      // If any step failed and is critical, stop
      if (stepResults.some((r) => !r)) {
        const criticalSteps = stepIds.filter((id) =>
          task.steps.find((s) => s.id === id)?.critical
        );
        if (criticalSteps.length > 0) {
          this.logger.error('Critical step failed, stopping DAG execution');
          return { success: false, results, errors };
        }
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
    };
  }

  topologicalSort(steps) {
    const visited = new Set();
    const sorted = [];
    const levels = []; // Groups of steps that can run in parallel

    const visit = (stepId, currentLevel) => {
      if (visited.has(stepId)) return currentLevel;

      const step = steps.find((s) => s.id === stepId);
      const depLevels = [];

      for (const dep of step.dependencies || []) {
        depLevels.push(visit(dep, currentLevel));
      }

      const thisLevel = Math.max(...depLevels, -1) + 1;

      if (!levels[thisLevel]) levels[thisLevel] = [];
      levels[thisLevel].push(stepId);

      visited.add(stepId);
      return thisLevel;
    };

    for (const step of steps) {
      visit(step.id, 0);
    }

    return levels.filter((l) => l);
  }

  // ========================================================================
  // LEARNING
  // ========================================================================

  async learnWorkflow(task) {
    this.logger.info(`Learning from successful task: ${task.id}`);

    // Send to memory engine for procedural learning
    try {
      const workflow = {
        id: task.id,
        name: task.name,
        task_type: task.type,
        steps: task.steps,
        success_count: 1,
        failure_count: 0,
        avg_duration_ms: Date.now() - task.startTime,
        source_agent: 'task-orchestrator',
      };

      await fetch('http://localhost:9998/store-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });

      this.logger.info(`Workflow learned: ${task.id}`);
    } catch (e) {
      this.logger.warn('Failed to learn workflow', { error: e.message });
    }
  }

  // ========================================================================
  // STATUS
  // ========================================================================

  getStatus() {
    return {
      executing: this.executingTasks.size,
      executingTasks: Array.from(this.executingTasks.keys()),
      totalCompleted: this.taskHistory.length,
      averageTaskDuration: this.taskHistory.length > 0
        ? Math.round(
            this.taskHistory.reduce((sum, t) => sum + (t.duration || 0), 0) /
            this.taskHistory.length
          )
        : 0,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  TaskOrchestrator,
};
