/**
 * HEIDI Tool Integration Monitor
 * Logs, timestamps, evaluates, and ranks tool usage
 */

class ToolIntegrationMonitor {
  constructor() {
    this.toolLogs = new Map(); // toolId -> [log entries]
    this.toolMetrics = new Map(); // toolId -> metrics
    this.toolRankings = new Map(); // toolId -> ranking score
    this.inefficiencyThreshold = 0.3; // Below this is inefficient
  }

  /**
   * Log tool call with full metadata
   */
  logToolCall(toolId, toolName, input, options = {}) {
    const logEntry = {
      id: this.generateLogId(),
      toolId,
      toolName,
      timestamp: new Date().toISOString(),
      input: this.sanitizeInput(input),
      output: null,
      executionTime: null,
      success: null,
      error: null,
      options,
      sessionId: options.sessionId || 'default',
      requestId: options.requestId || this.generateLogId()
    };

    // Store in tool logs
    if (!this.toolLogs.has(toolId)) {
      this.toolLogs.set(toolId, []);
    }
    this.toolLogs.get(toolId).push(logEntry);

    // Initialize metrics if needed
    if (!this.toolMetrics.has(toolId)) {
      this.toolMetrics.set(toolId, {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        avgExecutionTime: 0,
        lastUsed: null,
        usefulnessScore: 0.5, // Start neutral
        inefficiencyCount: 0
      });
    }

    // Update metrics
    const metrics = this.toolMetrics.get(toolId);
    metrics.totalCalls++;
    metrics.lastUsed = logEntry.timestamp;

    console.log(`[Tool Monitor] ${toolName} called - ID: ${logEntry.id}, Session: ${logEntry.sessionId}`);
    
    return logEntry.id;
  }

  /**
   * Complete tool call with results
   */
  completeToolCall(logId, output, executionTime, success = true, error = null) {
    // Find the log entry
    let logEntry = null;
    let toolId = null;

    for (const [tid, logs] of this.toolLogs) {
      const entry = logs.find(log => log.id === logId);
      if (entry) {
        logEntry = entry;
        toolId = tid;
        break;
      }
    }

    if (!logEntry) {
      console.warn(`[Tool Monitor] Log entry not found: ${logId}`);
      return;
    }

    // Update log entry
    logEntry.output = this.sanitizeOutput(output);
    logEntry.executionTime = executionTime;
    logEntry.success = success;
    logEntry.error = error ? error.message : null;
    logEntry.completedAt = new Date().toISOString();

    // Update metrics
    const metrics = this.toolMetrics.get(toolId);
    if (success) {
      metrics.successfulCalls++;
    } else {
      metrics.failedCalls++;
    }

    // Update average execution time
    const totalTime = metrics.avgExecutionTime * (metrics.totalCalls - 1) + executionTime;
    metrics.avgExecutionTime = totalTime / metrics.totalCalls;

    // Evaluate usefulness
    const usefulness = this.evaluateToolUsefulness(logEntry);
    this.updateUsefulnessScore(toolId, usefulness);

    // Check for inefficiency
    if (usefulness < this.inefficiencyThreshold) {
      metrics.inefficiencyCount++;
      console.log(`[Tool Monitor] ⚠️ Inefficient tool use detected: ${logEntry.toolName} (score: ${usefulness.toFixed(2)})`);
      this.emit('tool_inefficiency', { toolId, logEntry, usefulness });
    }

    // Update rankings
    this.updateToolRankings();

    console.log(`[Tool Monitor] ${logEntry.toolName} completed - Success: ${success}, Time: ${executionTime}ms, Usefulness: ${usefulness.toFixed(2)}`);
  }

  /**
   * Evaluate tool usefulness based on output quality and impact
   */
  evaluateToolUsefulness(logEntry) {
    let usefulness = 0.5; // Base score

    // Success factor (40% weight)
    if (logEntry.success) {
      usefulness += 0.4;
    } else {
      usefulness -= 0.4;
    }

    // Execution time factor (20% weight)
    const timeScore = Math.max(0, 1 - (logEntry.executionTime / 10000)); // 10s = 0 score
    usefulness += timeScore * 0.2;

    // Output quality factor (30% weight)
    const outputQuality = this.evaluateOutputQuality(logEntry.output);
    usefulness += outputQuality * 0.3;

    // Input-output relevance factor (10% weight)
    const relevance = this.evaluateInputOutputRelevance(logEntry.input, logEntry.output);
    usefulness += relevance * 0.1;

    return Math.max(0, Math.min(1, usefulness));
  }

  /**
   * Evaluate output quality
   */
  evaluateOutputQuality(output) {
    if (!output) return 0;

    let quality = 0.5;

    // Check for meaningful content
    if (typeof output === 'string') {
      if (output.length > 10) quality += 0.2;
      if (output.length > 100) quality += 0.1;
      
      // Check for error indicators
      if (output.includes('error') || output.includes('failed')) {
        quality -= 0.3;
      }
      
      // Check for success indicators
      if (output.includes('success') || output.includes('completed')) {
        quality += 0.1;
      }
    } else if (typeof output === 'object') {
      // Object outputs are generally more structured
      quality += 0.2;
      
      // Check for required fields
      if (output.data || output.result || output.items) {
        quality += 0.1;
      }
      
      // Check for error fields
      if (output.error) {
        quality -= 0.3;
      }
    }

    return Math.max(0, Math.min(1, quality));
  }

  /**
   * Evaluate input-output relevance
   */
  evaluateInputOutputRelevance(input, output) {
    if (!input || !output) return 0.5;

    // Simple relevance check - can be enhanced
    let relevance = 0.5;

    // Check for keyword overlap
    const inputStr = typeof input === 'string' ? input.toLowerCase() : JSON.stringify(input).toLowerCase();
    const outputStr = typeof output === 'string' ? output.toLowerCase() : JSON.stringify(output).toLowerCase();

    // Extract keywords (simple approach)
    const inputWords = inputStr.split(/\s+/).filter(w => w.length > 3);
    const outputWords = outputStr.split(/\s+/).filter(w => w.length > 3);

    // Calculate overlap
    const overlap = inputWords.filter(word => outputWords.includes(word)).length;
    const overlapRatio = overlap / Math.max(inputWords.length, 1);

    relevance += overlapRatio * 0.5;

    return Math.max(0, Math.min(1, relevance));
  }

  /**
   * Update usefulness score with exponential moving average
   */
  updateUsefulnessScore(toolId, newScore) {
    const metrics = this.toolMetrics.get(toolId);
    const alpha = 0.3; // EMA smoothing factor
    
    metrics.usefulnessScore = alpha * newScore + (1 - alpha) * metrics.usefulnessScore;
  }

  /**
   * Update tool rankings based on metrics
   */
  updateToolRankings() {
    const rankings = new Map();

    for (const [toolId, metrics] of this.toolMetrics) {
      let rankingScore = 0;

      // Success rate (30% weight)
      const successRate = metrics.totalCalls > 0 ? metrics.successfulCalls / metrics.totalCalls : 0;
      rankingScore += successRate * 0.3;

      // Usefulness score (40% weight)
      rankingScore += metrics.usefulnessScore * 0.4;

      // Speed score (20% weight) - faster is better
      const speedScore = Math.max(0, 1 - (metrics.avgExecutionTime / 5000)); // 5s = 0 score
      rankingScore += speedScore * 0.2;

      // Recency score (10% weight) - recently used is slightly preferred
      const recencyScore = metrics.lastUsed ? 
        Math.max(0, 1 - (Date.now() - new Date(metrics.lastUsed).getTime()) / (24 * 60 * 60 * 1000)) : 0;
      rankingScore += recencyScore * 0.1;

      rankings.set(toolId, rankingScore);
    }

    this.toolRankings = rankings;
  }

  /**
   * Get tool recommendations based on rankings
   */
  getToolRecommendations(taskType = 'general', limit = 5) {
    const recommendations = [];

    for (const [toolId, score] of this.toolRankings) {
      const metrics = this.toolMetrics.get(toolId);
      const logs = this.toolLogs.get(toolId);
      
      recommendations.push({
        toolId,
        rankingScore: score,
        successRate: metrics.totalCalls > 0 ? metrics.successfulCalls / metrics.totalCalls : 0,
        usefulnessScore: metrics.usefulnessScore,
        avgExecutionTime: metrics.avgExecutionTime,
        totalCalls: metrics.totalCalls,
        inefficiencyCount: metrics.inefficiencyCount,
        lastUsed: metrics.lastUsed
      });
    }

    // Sort by ranking score
    recommendations.sort((a, b) => b.rankingScore - a.rankingScore);

    return recommendations.slice(0, limit);
  }

  /**
   * Get inefficient tools for optimization
   */
  getInefficientTools(threshold = null) {
    const inefficientThreshold = threshold || this.inefficiencyThreshold;
    const inefficient = [];

    for (const [toolId, metrics] of this.toolMetrics) {
      if (metrics.usefulnessScore < inefficientThreshold && metrics.totalCalls >= 3) {
        inefficient.push({
          toolId,
          usefulnessScore: metrics.usefulnessScore,
          inefficiencyCount: metrics.inefficiencyCount,
          totalCalls: metrics.totalCalls,
          recommendation: this.generateOptimizationRecommendation(toolId, metrics)
        });
      }
    }

    return inefficient.sort((a, b) => a.usefulnessScore - b.usefulnessScore);
  }

  /**
   * Generate optimization recommendations for inefficient tools
   */
  generateOptimizationRecommendation(toolId, metrics) {
    const recommendations = [];

    if (metrics.avgExecutionTime > 5000) {
      recommendations.push('Consider optimizing for speed or adding timeout');
    }

    if (metrics.failedCalls / metrics.totalCalls > 0.3) {
      recommendations.push('High failure rate - check error handling or input validation');
    }

    if (metrics.inefficiencyCount > metrics.totalCalls * 0.5) {
      recommendations.push('Consistently inefficient - consider replacement or removal');
    }

    if (recommendations.length === 0) {
      recommendations.push('Monitor for improvement patterns');
    }

    return recommendations;
  }

  /**
   * Get detailed tool statistics
   */
  getToolStatistics(toolId) {
    const metrics = this.toolMetrics.get(toolId);
    const logs = this.toolLogs.get(toolId);
    const ranking = this.toolRankings.get(toolId);

    if (!metrics) {
      return null;
    }

    return {
      toolId,
      metrics: { ...metrics },
      rankingScore: ranking || 0,
      recentLogs: logs ? logs.slice(-10) : [],
      performanceTrend: this.calculatePerformanceTrend(logs || []),
      efficiencyStatus: metrics.usefulnessScore < this.inefficiencyThreshold ? 'inefficient' : 'efficient'
    };
  }

  /**
   * Calculate performance trend over time
   */
  calculatePerformanceTrend(logs) {
    if (logs.length < 5) return 'insufficient_data';

    const recentLogs = logs.slice(-10);
    const oldLogs = logs.slice(-20, -10);

    if (oldLogs.length === 0) return 'insufficient_data';

    const recentSuccess = recentLogs.filter(log => log.success).length / recentLogs.length;
    const oldSuccess = oldLogs.filter(log => log.success).length / oldLogs.length;

    const recentAvgTime = recentLogs.reduce((sum, log) => sum + (log.executionTime || 0), 0) / recentLogs.length;
    const oldAvgTime = oldLogs.reduce((sum, log) => sum + (log.executionTime || 0), 0) / oldLogs.length;

    if (recentSuccess > oldSuccess + 0.1 && recentAvgTime < oldAvgTime) {
      return 'improving';
    } else if (recentSuccess < oldSuccess - 0.1 || recentAvgTime > oldAvgTime * 1.2) {
      return 'degrading';
    } else {
      return 'stable';
    }
  }

  /**
   * Export tool usage data for analysis
   */
  exportToolUsageData() {
    const exportData = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTools: this.toolMetrics.size,
        totalCalls: Array.from(this.toolMetrics.values()).reduce((sum, m) => sum + m.totalCalls, 0),
        overallSuccessRate: this.calculateOverallSuccessRate(),
        inefficientTools: this.getInefficientTools().length
      },
      tools: []
    };

    for (const [toolId, metrics] of this.toolMetrics) {
      exportData.tools.push({
        toolId,
        ...metrics,
        rankingScore: this.toolRankings.get(toolId) || 0,
        recentLogs: (this.toolLogs.get(toolId) || []).slice(-5)
      });
    }

    return exportData;
  }

  /**
   * Calculate overall success rate
   */
  calculateOverallSuccessRate() {
    let totalCalls = 0;
    let totalSuccess = 0;

    for (const metrics of this.toolMetrics.values()) {
      totalCalls += metrics.totalCalls;
      totalSuccess += metrics.successfulCalls;
    }

    return totalCalls > 0 ? totalSuccess / totalCalls : 0;
  }

  /**
   * Reset tool metrics (for testing or optimization)
   */
  resetToolMetrics(toolId = null) {
    if (toolId) {
      this.toolMetrics.delete(toolId);
      this.toolLogs.delete(toolId);
      this.toolRankings.delete(toolId);
      console.log(`[Tool Monitor] Reset metrics for tool: ${toolId}`);
    } else {
      this.toolMetrics.clear();
      this.toolLogs.clear();
      this.toolRankings.clear();
      console.log('[Tool Monitor] Reset all tool metrics');
    }
  }

  // Utility methods
  generateLogId() {
    return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sanitizeInput(input) {
    if (typeof input === 'string') {
      return input.length > 500 ? input.substring(0, 500) + '...' : input;
    }
    return JSON.stringify(input).length > 500 ? 
      JSON.stringify(input).substring(0, 500) + '...' : 
      JSON.stringify(input);
  }

  sanitizeOutput(output) {
    if (typeof output === 'string') {
      return output.length > 500 ? output.substring(0, 500) + '...' : output;
    }
    return JSON.stringify(output).length > 500 ? 
      JSON.stringify(output).substring(0, 500) + '...' : 
      JSON.stringify(output);
  }

  // Event emitter functionality
  emit(event, data) {
    // Simple event emission - can be enhanced with proper EventEmitter
    if (this.listeners && this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  on(event, callback) {
    if (!this.listeners) this.listeners = {};
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }
}

module.exports = ToolIntegrationMonitor;
