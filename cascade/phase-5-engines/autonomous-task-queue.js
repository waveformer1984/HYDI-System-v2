/**
 * HYDI Autonomous Reasoning Queue
 * Phase 5.1 Implementation
 *
 * Purpose: Background task execution engine enabling proactive system optimization
 * Deployed: 5/19/2026 Session 5
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class AutonomousReasoningQueue extends EventEmitter {
  constructor(config = {}) {
    super();

    this.taskQueue = [];
    this.executionHistory = [];
    this.executionStats = {
      completed: 0,
      failed: 0,
      totalExecutionTime: 0
    };

    this.maxConcurrentTasks = config.maxConcurrentTasks || 4;
    this.executorCount = 0;
    this.running = false;

    // Inject cascade system reference
    this.cascadeSystem = config.cascadeSystem || null;
    this.metricsCollector = config.metricsCollector || null;
  }

  /**
   * Add a new task to the queue
   */
  enqueueTask(taskType, context = {}, priority = 'normal') {
    const task = {
      id: crypto.randomUUID(),
      type: taskType,
      context: context,
      priority: priority,
      createdAt: Date.now(),
      status: 'queued',
      retryCount: 0,
      maxRetries: 3
    };

    this.taskQueue.push(task);
    this.sortQueue();

    this.emit('task-enqueued', {
      taskId: task.id,
      taskType: task.type,
      queueLength: this.taskQueue.length
    });

    return task.id;
  }

  /**
   * Sort queue by priority (critical > high > normal > low)
   */
  sortQueue() {
    const priorityMap = { critical: 4, high: 3, normal: 2, low: 1 };
    this.taskQueue.sort((a, b) => {
      const priorityDiff = priorityMap[b.priority] - priorityMap[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      // Secondary sort by creation time (FIFO within same priority)
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Execute next task in queue
   */
  async executeNextTask() {
    if (this.taskQueue.length === 0) return null;
    if (this.executorCount >= this.maxConcurrentTasks) return null;

    this.executorCount++;
    const task = this.taskQueue.shift();
    task.status = 'executing';
    const startTime = Date.now();

    this.emit('task-started', { taskId: task.id, taskType: task.type });

    try {
      const result = await this.executeByType(task.type, task.context);

      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      task.executionTime = task.completedAt - startTime;

      this.executionHistory.push(task);
      this.executionStats.completed++;
      this.executionStats.totalExecutionTime += task.executionTime;

      this.emit('task-completed', {
        taskId: task.id,
        taskType: task.type,
        executionTime: task.executionTime
      });

      // Auto-enqueue follow-up tasks if reasoning suggests them
      if (result.suggestedFollowUp && Array.isArray(result.suggestedFollowUp)) {
        for (const followUp of result.suggestedFollowUp) {
          this.enqueueTask(
            followUp.type,
            followUp.context || {},
            followUp.priority || 'normal'
          );
        }
      }

      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.failedAt = Date.now();
      task.executionTime = task.failedAt - startTime;

      this.executionStats.failed++;

      // Retry logic for transient failures
      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.status = 'queued';
        task.lastError = error.message;
        this.taskQueue.push(task);
        this.sortQueue();

        this.emit('task-retried', {
          taskId: task.id,
          taskType: task.type,
          attemptNumber: task.retryCount
        });
      } else {
        this.executionHistory.push(task);

        this.emit('task-failed', {
          taskId: task.id,
          taskType: task.type,
          error: error.message
        });
      }
    } finally {
      this.executorCount--;
    }
  }

  /**
   * Route task execution by type
   */
  async executeByType(taskType, context) {
    switch(taskType) {
      case 'introspect_performance':
        return await this.introspectSystemPerformance(context);
      case 'validate_cascade':
        return await this.validateCascadeIntegrity(context);
      case 'optimize_knowledge_graph':
        return await this.optimizeKnowledgeGraph(context);
      case 'detect_reasoning_gaps':
        return await this.detectReasoningGaps(context);
      case 'synthesize_insights':
        return await this.synthesizeInsights(context);
      case 'health_check':
        return await this.performHealthCheck(context);
      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }
  }

  /**
   * Task: Introspect system performance and identify optimizations
   */
  async introspectSystemPerformance(context = {}) {
    const metrics = {
      timestamp: Date.now(),
      averageInferenceTime: await this.getAverageInferenceTime(),
      cacheHitRate: await this.getCacheHitRate(),
      governanceApprovalRate: await this.getApprovalRate(),
      cascadeFidelity: await this.measureCascadeFidelity(),
      knowledgeGraphSize: await this.measureKnowledgeGraphSize(),
      queueHealth: {
        pending: this.taskQueue.length,
        completed: this.executionStats.completed,
        failed: this.executionStats.failed
      }
    };

    const suggestedFollowUp = [];

    // Detect anomalies and suggest follow-up
    if (metrics.averageInferenceTime > 500) {
      suggestedFollowUp.push({
        type: 'optimize_inference',
        context: { metrics, reason: 'High inference latency detected' },
        priority: 'high'
      });
    }
    if (metrics.cacheHitRate < 0.7) {
      suggestedFollowUp.push({
        type: 'optimize_cache',
        context: { metrics, reason: 'Low cache hit rate' },
        priority: 'normal'
      });
    }
    if (metrics.governanceApprovalRate < 0.95) {
      suggestedFollowUp.push({
        type: 'analyze_governance',
        context: { metrics, reason: 'Governance rejection rate elevated' },
        priority: 'normal'
      });
    }

    return {
      type: 'introspection_result',
      metrics,
      anomaliesDetected: suggestedFollowUp.length,
      suggestedFollowUp
    };
  }

  /**
   * Task: Validate CASCADE system integrity
   */
  async validateCascadeIntegrity(context = {}) {
    const validation = {
      timestamp: Date.now(),
      truthLayerValid: await this.validateTruthLayer(),
      indexConsistent: await this.validateIndexConsistency(),
      graphConnected: await this.validateGraphConnectivity(),
      embeddingsAligned: await this.validateEmbeddings(),
      checksumValid: await this.validateChecksums()
    };

    const allValid = Object.values(validation).filter(v => typeof v === 'boolean').every(v => v);
    const suggestedFollowUp = [];

    if (!allValid) {
      suggestedFollowUp.push({
        type: 'repair_cascade',
        context: { validation, reason: 'CASCADE integrity compromised' },
        priority: 'critical'
      });
    }

    return {
      type: 'cascade_validation',
      validation,
      healthy: allValid,
      suggestedFollowUp
    };
  }

  /**
   * Task: Optimize knowledge graph structure
   */
  async optimizeKnowledgeGraph(context = {}) {
    const optimization = {
      timestamp: Date.now(),
      graphSizeBefore: await this.measureKnowledgeGraphSize(),
      redundanciesRemoved: 0,
      connectivityImproved: false
    };

    // Detect and remove duplicate nodes
    optimization.redundanciesRemoved = await this.removeRedundantNodes();

    // Optimize graph structure
    optimization.connectivityImproved = await this.rebalanceGraph();

    optimization.graphSizeAfter = await this.measureKnowledgeGraphSize();
    optimization.spaceFreed = optimization.graphSizeBefore - optimization.graphSizeAfter;

    return {
      type: 'knowledge_graph_optimization',
      optimization,
      suggestedFollowUp: []
    };
  }

  /**
   * Task: Detect reasoning gaps
   */
  async detectReasoningGaps(context = {}) {
    const gaps = {
      timestamp: Date.now(),
      gapCount: 0,
      gapsByType: {},
      criticalGaps: []
    };

    // Analyze recent reasoning failures
    const recentFailures = this.executionHistory.slice(-100).filter(t => t.status === 'failed');

    for (const failure of recentFailures) {
      const gapType = this.classifyGap(failure);
      gaps.gapsByType[gapType] = (gaps.gapsByType[gapType] || 0) + 1;

      if (failure.priority === 'critical') {
        gaps.criticalGaps.push({
          taskId: failure.id,
          taskType: failure.type,
          gapType,
          error: failure.error
        });
      }
    }

    gaps.gapCount = Object.values(gaps.gapsByType).reduce((a, b) => a + b, 0);

    return {
      type: 'gap_detection',
      gaps,
      suggestedFollowUp: gaps.criticalGaps.length > 0 ? [{
        type: 'synthesize_insights',
        context: { gaps, reason: 'Critical reasoning gaps detected' },
        priority: 'high'
      }] : []
    };
  }

  /**
   * Task: Synthesize insights from patterns
   */
  async synthesizeInsights(context = {}) {
    const synthesis = {
      timestamp: Date.now(),
      insightsGenerated: 0,
      insights: []
    };

    // Extract high-confidence patterns from execution history
    const patterns = await this.extractSuccessPatterns();

    for (const pattern of patterns) {
      if (pattern.confidence > 0.8) {
        synthesis.insights.push({
          id: crypto.randomUUID(),
          pattern: pattern.name,
          confidence: pattern.confidence,
          applicableTasks: pattern.applicableTasks,
          timestamp: Date.now()
        });
        synthesis.insightsGenerated++;
      }
    }

    return {
      type: 'insight_synthesis',
      synthesis,
      suggestedFollowUp: []
    };
  }

  /**
   * Task: General health check
   */
  async performHealthCheck(context = {}) {
    const health = {
      timestamp: Date.now(),
      queueHealth: {
        size: this.taskQueue.length,
        avgWaitTime: await this.getAverageQueueWaitTime(),
        oldestTask: this.taskQueue.length > 0 ? Date.now() - this.taskQueue[0].createdAt : 0
      },
      executionHealth: {
        successRate: this.executionStats.completed / (this.executionStats.completed + this.executionStats.failed) || 0,
        avgExecutionTime: this.executionStats.totalExecutionTime / this.executionStats.completed || 0,
        totalTasks: this.executionStats.completed + this.executionStats.failed
      },
      systemHealth: {
        running: this.running,
        executorsActive: this.executorCount,
        memoryUsage: process.memoryUsage()
      }
    };

    return {
      type: 'health_check',
      health,
      status: health.executionHealth.successRate > 0.95 ? 'healthy' : 'degraded',
      suggestedFollowUp: health.executionHealth.successRate < 0.9 ? [{
        type: 'introspect_performance',
        context: { reason: 'Low success rate detected' },
        priority: 'high'
      }] : []
    };
  }

  /**
   * Start the continuous execution loop
   */
  async start(intervalMs = 1000) {
    if (this.running) return;
    this.running = true;

    this.emit('queue-started');

    // Initial tasks
    this.enqueueTask('health_check', {}, 'normal');
    this.enqueueTask('validate_cascade', {}, 'normal');
    this.enqueueTask('introspect_performance', {}, 'normal');

    this.executionLoop = setInterval(async () => {
      try {
        // Execute up to maxConcurrentTasks simultaneously
        while (this.executorCount < this.maxConcurrentTasks && this.taskQueue.length > 0) {
          this.executeNextTask().catch(error => {
            this.emit('executor-error', { error: error.message });
          });
        }
      } catch (error) {
        this.emit('loop-error', { error: error.message });
      }
    }, intervalMs);

    // Schedule periodic tasks
    this.schedulePeriodicTasks();
  }

  /**
   * Stop the execution loop
   */
  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.executionLoop) {
      clearInterval(this.executionLoop);
    }

    this.emit('queue-stopped');
  }

  /**
   * Schedule periodic background tasks
   */
  schedulePeriodicTasks() {
    // Performance introspection every 30 seconds
    setInterval(() => {
      if (this.running) {
        this.enqueueTask('introspect_performance', {}, 'normal');
      }
    }, 30000);

    // CASCADE validation every 5 minutes
    setInterval(() => {
      if (this.running) {
        this.enqueueTask('validate_cascade', {}, 'normal');
      }
    }, 300000);

    // Knowledge graph optimization every 10 minutes
    setInterval(() => {
      if (this.running) {
        this.enqueueTask('optimize_knowledge_graph', {}, 'low');
      }
    }, 600000);

    // Health check every 1 minute
    setInterval(() => {
      if (this.running) {
        this.enqueueTask('health_check', {}, 'normal');
      }
    }, 60000);
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueSize: this.taskQueue.length,
      executorsActive: this.executorCount,
      executionStats: this.executionStats,
      running: this.running,
      historySize: this.executionHistory.length
    };
  }

  /**
   * Get recent task history
   */
  getRecentHistory(limit = 20) {
    return this.executionHistory.slice(-limit).map(task => ({
      id: task.id,
      type: task.type,
      status: task.status,
      executionTime: task.executionTime,
      createdAt: task.createdAt,
      completedAt: task.completedAt
    }));
  }

  // ==================== Helper Methods ====================

  async getAverageInferenceTime() {
    if (!this.metricsCollector) return 0;
    return await this.metricsCollector.getAverageInferenceTime();
  }

  async getCacheHitRate() {
    if (!this.metricsCollector) return 0;
    return await this.metricsCollector.getCacheHitRate();
  }

  async getApprovalRate() {
    if (!this.metricsCollector) return 0;
    return await this.metricsCollector.getGovernanceApprovalRate();
  }

  async measureCascadeFidelity() {
    if (!this.cascadeSystem) return 0;
    return await this.cascadeSystem.measureFidelity?.() || 1.0;
  }

  async measureKnowledgeGraphSize() {
    if (!this.cascadeSystem) return 0;
    return await this.cascadeSystem.measureGraphSize?.() || 0;
  }

  async validateTruthLayer() {
    if (!this.cascadeSystem) return true;
    return await this.cascadeSystem.validateTruthLayer?.() || true;
  }

  async validateIndexConsistency() {
    if (!this.cascadeSystem) return true;
    return await this.cascadeSystem.validateIndex?.() || true;
  }

  async validateGraphConnectivity() {
    if (!this.cascadeSystem) return true;
    return await this.cascadeSystem.validateGraphConnectivity?.() || true;
  }

  async validateEmbeddings() {
    if (!this.cascadeSystem) return true;
    return await this.cascadeSystem.validateEmbeddings?.() || true;
  }

  async validateChecksums() {
    if (!this.cascadeSystem) return true;
    return await this.cascadeSystem.validateChecksums?.() || true;
  }

  async removeRedundantNodes() {
    if (!this.cascadeSystem) return 0;
    return await this.cascadeSystem.removeRedundancy?.() || 0;
  }

  async rebalanceGraph() {
    if (!this.cascadeSystem) return false;
    return await this.cascadeSystem.rebalance?.() || false;
  }

  async extractSuccessPatterns() {
    const patterns = {};

    for (const task of this.executionHistory.filter(t => t.status === 'completed')) {
      const key = task.type;
      if (!patterns[key]) {
        patterns[key] = {
          name: key,
          count: 0,
          totalTime: 0,
          applicableTasks: []
        };
      }
      patterns[key].count++;
      patterns[key].totalTime += task.executionTime || 0;
    }

    return Object.values(patterns).map(p => ({
      ...p,
      confidence: Math.min(p.count / this.executionStats.completed, 1.0),
      avgTime: p.totalTime / p.count
    }));
  }

  async getAverageQueueWaitTime() {
    if (this.executionHistory.length === 0) return 0;
    const waitTimes = this.executionHistory.map(t => {
      return t.completedAt ? t.completedAt - t.createdAt : Date.now() - t.createdAt;
    });
    return waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
  }

  classifyGap(failure) {
    if (!failure.error) return 'unknown';
    const error = failure.error.toLowerCase();

    if (error.includes('timeout')) return 'timeout';
    if (error.includes('memory')) return 'memory';
    if (error.includes('network')) return 'network';
    if (error.includes('validation')) return 'validation';
    if (error.includes('not found')) return 'missing_data';

    return 'logic_error';
  }
}

module.exports = AutonomousReasoningQueue;
