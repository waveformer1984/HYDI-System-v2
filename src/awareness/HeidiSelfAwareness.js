/**
 * HEIDI SELF-AWARENESS - Real, Not Sci-Fi
 * Heidi doesn't "wake up." It tracks itself like a paranoid engineer.
 * 
 * Metrics tracked:
 * - Task success rate
 * - Revenue per action  
 * - Model accuracy
 * - Drift score
 * - Cost efficiency
 * 
 * 🧪 Drift Detection: drift = expected_outcome - actual_outcome
 * If drift increases: Re-evaluate strategy, Lower confidence, Switch models, Escalate
 * 
 * 🪞 Reflection Engine: Run every X cycles to analyze patterns and adapt
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../lib/structured-logger').child({ component: 'HeidiSelfAwareness' });

class HeidiSelfAwareness extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Drift detection settings
      driftThreshold: config.driftThreshold || 0.3,
      driftWindow: config.driftWindow || 100, // Last 100 actions
      driftCheckInterval: config.driftCheckInterval || 60000, // 1 minute
      
      // Reflection settings
      reflectionInterval: config.reflectionInterval || 300000, // 5 minutes
      reflectionDepth: config.reflectionDepth || 50, // Last 50 actions
      minConfidenceForReflection: config.minConfidenceForReflection || 0.7,
      
      // Self-awareness metrics
      enableRevenueTracking: config.enableRevenueTracking !== false,
      enablePerformanceTracking: config.enablePerformanceTracking !== false,
      enableCostTracking: config.enableCostTracking !== false,
      
      // Storage
      awarenessPath: config.awarenessPath || path.resolve(__dirname, '../../data/awareness'),
      
      ...config
    };
    
    // Core self-awareness metrics
    this.metrics = {
      // Performance metrics
      taskSuccess: {
        total: 0,
        successful: 0,
        failed: 0,
        rate: 0,
        avgLatency: 0,
        lastUpdated: Date.now()
      },
      
      // Revenue metrics
      revenue: {
        total: 0,
        perAction: 0,
        lastRevenue: 0,
        revenueActions: 0,
        conversionRate: 0,
        lastUpdated: Date.now()
      },
      
      // Model performance
      modelAccuracy: {
        overall: 0,
        byModel: new Map(),
        confidenceCalibration: 0,
        lastUpdated: Date.now()
      },
      
      // Cost efficiency
      costEfficiency: {
        totalCost: 0,
        costPerSuccess: 0,
        costPerRevenue: 0,
        roi: 0,
        lastUpdated: Date.now()
      },
      
      // Drift score
      drift: {
        score: 0,
        trend: 'stable',
        confidence: 0,
        lastCheck: Date.now(),
        history: []
      }
    };
    
    // Action history for analysis
    this.actionHistory = [];
    this.maxHistorySize = 1000;
    
    // Reflection results
    this.reflections = [];
    this.maxReflections = 100;
    
    // Self-awareness state
    this.selfAwarenessState = {
      level: 'operational', // operational, degraded, critical
      confidence: 0.8,
      lastSelfAssessment: Date.now(),
      patterns: new Map(),
      adaptations: new Map(),
      contradictions: []
    };
    
    // Initialize
    this.initialize();
    
    logger.info('[SELF-AWARENESS] Heidi Self-Awareness initialized');
    logger.info(`[SELF-AWARENESS] Drift threshold: ${this.config.driftThreshold}`);
    logger.info(`[SELF-AWARENESS] Reflection interval: ${this.config.reflectionInterval}ms`);
  }
  
  async initialize() {
    try {
      // Ensure awareness directory exists
      await fs.mkdir(this.config.awarenessPath, { recursive: true });
      
      // Load historical data
      await this.loadHistoricalData();
      
      // Start monitoring cycles
      this.startDriftDetection();
      this.startReflectionEngine();
      this.startSelfAssessment();
      
      logger.info('[SELF-AWARENESS] Self-awareness system initialized');

    } catch (error) {
      logger.error('[SELF-AWARENESS] Initialization failed', { error: error.message });
      throw error;
    }
  }
  
  /**
   * ACTION TRACKING - Record every action for self-awareness
   */
  
  trackAction(action) {
    const actionRecord = {
      id: action.id || `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: action.type,
      subtype: action.subtype,
      timestamp: Date.now(),
      success: action.success !== false,
      confidence: action.confidence || 0.5,
      latency: action.latency || 0,
      cost: action.cost || 0,
      revenue: action.revenue || 0,
      model: action.model,
      strategy: action.strategy,
      context: action.context || {},
      outcome: action.outcome || null,
      error: action.error || null
    };
    
    // Add to history
    this.actionHistory.push(actionRecord);
    
    // Keep history size manageable
    if (this.actionHistory.length > this.maxHistorySize) {
      this.actionHistory = this.actionHistory.slice(-this.maxHistorySize / 2);
    }
    
    // Update metrics
    this.updateMetrics(actionRecord);
    
    // Emit tracking event
    this.emit('action_tracked', actionRecord);
    
    logger.info(`[SELF-AWARENESS] Action tracked: ${actionRecord.type} (success: ${actionRecord.success})`);
  }
  
  updateMetrics(action) {
    // Update task success metrics
    this.metrics.taskSuccess.total++;
    if (action.success) {
      this.metrics.taskSuccess.successful++;
    } else {
      this.metrics.taskSuccess.failed++;
    }
    
    this.metrics.taskSuccess.rate = this.metrics.taskSuccess.successful / this.metrics.taskSuccess.total;
    
    // Update average latency
    const totalLatency = this.actionHistory.reduce((sum, a) => sum + a.latency, 0);
    this.metrics.taskSuccess.avgLatency = totalLatency / this.actionHistory.length;
    
    // Update revenue metrics
    if (this.config.enableRevenueTracking && action.revenue > 0) {
      this.metrics.revenue.total += action.revenue;
      this.metrics.revenue.lastRevenue = action.revenue;
      this.metrics.revenue.revenueActions++;
      this.metrics.revenue.perAction = this.metrics.revenue.total / this.metrics.revenue.revenueActions;
    }
    
    // Update model accuracy
    if (action.model) {
      const modelMetrics = this.metrics.modelAccuracy.byModel.get(action.model) || {
        total: 0,
        correct: 0,
        avgConfidence: 0
      };
      
      modelMetrics.total++;
      modelMetrics.avgConfidence = (modelMetrics.avgConfidence * (modelMetrics.total - 1) + action.confidence) / modelMetrics.total;
      
      // Track if confidence predicted success correctly
      const predictedSuccess = action.confidence > 0.5;
      const actualSuccess = action.success;
      if (predictedSuccess === actualSuccess) {
        modelMetrics.correct++;
      }
      
      this.metrics.modelAccuracy.byModel.set(action.model, modelMetrics);
    }
    
    // Update overall model accuracy
    const totalPredictions = this.actionHistory.length;
    const correctPredictions = this.actionHistory.filter(a => {
      const predictedSuccess = a.confidence > 0.5;
      const actualSuccess = a.success;
      return predictedSuccess === actualSuccess;
    }).length;
    
    this.metrics.modelAccuracy.overall = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;
    
    // Update cost efficiency
    if (this.config.enableCostTracking) {
      this.metrics.costEfficiency.totalCost += action.cost;
      
      if (action.success) {
        this.metrics.costEfficiency.costPerSuccess = this.metrics.costEfficiency.totalCost / this.metrics.taskSuccess.successful;
      }
      
      if (action.revenue > 0) {
        this.metrics.costEfficiency.costPerRevenue = this.metrics.costEfficiency.totalCost / this.metrics.revenue.total;
        this.metrics.costEfficiency.roi = (this.metrics.revenue.total - this.metrics.costEfficiency.totalCost) / this.metrics.costEfficiency.totalCost;
      }
    }
    
    // Update timestamps
    const now = Date.now();
    this.metrics.taskSuccess.lastUpdated = now;
    this.metrics.modelAccuracy.lastUpdated = now;
    this.metrics.costEfficiency.lastUpdated = now;
    
    if (action.revenue > 0) {
      this.metrics.revenue.lastUpdated = now;
    }
  }
  
  /**
   * DRIFT DETECTION - Monitor performance degradation
   */
  
  startDriftDetection() {
    const driftCheck = async () => {
      try {
        await this.calculateDrift();
      } catch (error) {
        logger.error('[SELF-AWARENESS] Drift detection failed', { error: error.message });
      }
      
      // Schedule next check
      setTimeout(driftCheck, this.config.driftCheckInterval);
    };
    
    // Start drift detection
    driftCheck();
  }
  
  async calculateDrift() {
    const recentActions = this.actionHistory.slice(-this.config.driftWindow);
    
    if (recentActions.length < 10) {
      logger.info('[SELF-AWARENESS] Insufficient data for drift calculation');
      return;
    }
    
    // Calculate confidence vs reality drift
    const confidenceDrift = this.calculateConfidenceDrift(recentActions);
    
    // Calculate performance drift
    const performanceDrift = this.calculatePerformanceDrift(recentActions);
    
    // Calculate cost drift
    const costDrift = this.calculateCostDrift(recentActions);
    
    // Combine drift scores
    const overallDrift = (confidenceDrift + performanceDrift + costDrift) / 3;
    
    // Determine trend
    const trend = this.determineDriftTrend(overallDrift);
    
    // Update drift metrics
    this.metrics.drift = {
      score: overallDrift,
      trend,
      confidence: this.calculateDriftConfidence(recentActions.length),
      lastCheck: Date.now(),
      components: {
        confidence: confidenceDrift,
        performance: performanceDrift,
        cost: costDrift
      }
    };
    
    // Add to history
    this.metrics.drift.history.push({
      timestamp: Date.now(),
      score: overallDrift,
      trend
    });
    
    // Keep history manageable
    if (this.metrics.drift.history.length > 100) {
      this.metrics.drift.history = this.metrics.drift.history.slice(-50);
    }
    
    // Check if drift exceeds threshold
    if (overallDrift > this.config.driftThreshold) {
      this.handleHighDrift(overallDrift);
    }
    
    // Emit drift update
    this.emit('drift_updated', {
      score: overallDrift,
      trend,
      threshold: this.config.driftThreshold,
      critical: overallDrift > this.config.driftThreshold
    });
    
    logger.info(`[SELF-AWARENESS] Drift calculated: ${overallDrift.toFixed(3)} (trend: ${trend})`);
  }
  
  calculateConfidenceDrift(actions) {
    // Measure how well confidence predicts actual success
    let totalError = 0;
    
    for (const action of actions) {
      const predictedSuccess = action.confidence > 0.5 ? 1 : 0;
      const actualSuccess = action.success ? 1 : 0;
      const error = Math.abs(predictedSuccess - actualSuccess);
      totalError += error;
    }
    
    return totalError / actions.length;
  }
  
  calculatePerformanceDrift(actions) {
    // Measure performance degradation over time
    if (actions.length < 20) return 0;
    
    const midpoint = Math.floor(actions.length / 2);
    const firstHalf = actions.slice(0, midpoint);
    const secondHalf = actions.slice(midpoint);
    
    const firstHalfSuccess = firstHalf.filter(a => a.success).length / firstHalf.length;
    const secondHalfSuccess = secondHalf.filter(a => a.success).length / secondHalf.length;
    
    // Positive drift means performance is declining
    return Math.max(0, firstHalfSuccess - secondHalfSuccess);
  }
  
  calculateCostDrift(actions) {
    // Measure cost efficiency degradation
    const recentCosts = actions.map(a => a.cost);
    const avgCost = recentCosts.reduce((sum, cost) => sum + cost, 0) / recentCosts.length;
    
    // Calculate variance from expected cost
    const expectedCost = 0.05; // $0.05 expected cost per action
    const costDrift = Math.abs(avgCost - expectedCost) / expectedCost;
    
    return Math.min(1, costDrift);
  }
  
  determineDriftTrend(currentDrift) {
    if (this.metrics.drift.history.length < 2) {
      return 'stable';
    }
    
    const previousDrift = this.metrics.drift.history[this.metrics.drift.history.length - 1].score;
    const difference = currentDrift - previousDrift;
    
    if (difference > 0.05) return 'increasing';
    if (difference < -0.05) return 'decreasing';
    return 'stable';
  }
  
  calculateDriftConfidence(sampleSize) {
    // Confidence in drift calculation based on sample size
    return Math.min(1, sampleSize / this.config.driftWindow);
  }
  
  handleHighDrift(driftScore) {
    logger.warn(`[SELF-AWARENESS] HIGH DRIFT DETECTED: ${driftScore.toFixed(3)}`);
    
    // Emit high drift alert
    this.emit('high_drift', {
      score: driftScore,
      threshold: this.config.driftThreshold,
      timestamp: Date.now(),
      recommendations: this.generateDriftRecommendations(driftScore)
    });
    
    // Update self-awareness state
    if (driftScore > 0.5) {
      this.selfAwarenessState.level = 'critical';
    } else if (driftScore > 0.3) {
      this.selfAwarenessState.level = 'degraded';
    }
    
    // Store contradiction
    this.selfAwarenessState.contradictions.push({
      type: 'high_drift',
      value: driftScore,
      timestamp: Date.now(),
      expected: 'low_drift',
      actual: 'high_drift'
    });
  }
  
  generateDriftRecommendations(driftScore) {
    const recommendations = [];
    
    if (driftScore > 0.4) {
      recommendations.push({
        priority: 'critical',
        action: 'reduce_confidence_threshold',
        reason: 'High drift indicates overconfidence'
      });
    }
    
    if (this.metrics.modelAccuracy.overall < 0.7) {
      recommendations.push({
        priority: 'high',
        action: 'switch_primary_model',
        reason: 'Model accuracy is poor'
      });
    }
    
    if (this.metrics.costEfficiency.roi < 0) {
      recommendations.push({
        priority: 'medium',
        action: 'reduce_external_usage',
        reason: 'Negative ROI indicates excessive costs'
      });
    }
    
    return recommendations;
  }
  
  /**
   * REFLECTION ENGINE - Deep analysis of patterns
   */
  
  startReflectionEngine() {
    const reflectionCycle = async () => {
      try {
        const reflection = await this.runReflection();
        this.reflections.push(reflection);
        
        // Keep reflections manageable
        if (this.reflections.length > this.maxReflections) {
          this.reflections = this.reflections.slice(-this.maxReflections / 2);
        }
        
        // Emit reflection completed
        this.emit('reflection_completed', reflection);
        
      } catch (error) {
        logger.error('[SELF-AWARENESS] Reflection failed', { error: error.message });
      }
      
      // Schedule next reflection
      setTimeout(reflectionCycle, this.config.reflectionInterval);
    };
    
    // Start reflection cycle
    reflectionCycle();
  }
  
  async runReflection() {
    const reflectionId = `reflection_${Date.now()}`;
    
    logger.info(`[SELF-AWARENESS] Running reflection: ${reflectionId}`);
    
    const recentActions = this.actionHistory.slice(-this.config.reflectionDepth);
    
    const reflection = {
      id: reflectionId,
      timestamp: Date.now(),
      duration: 0,
      
      // What worked
      whatWorked: this.analyzeWhatWorked(recentActions),
      
      // What failed
      whatFailed: this.analyzeWhatFailed(recentActions),
      
      // Patterns detected
      patterns: this.detectPatterns(recentActions),
      
      // Contradictions found
      contradictions: this.identifyContradictions(recentActions),
      
      // Recommendations
      recommendations: this.generateReflectionRecommendations(recentActions),
      
      // Self-assessment
      selfAssessment: this.performSelfAssessment(),
      
      // Adaptations needed
      adaptations: this.identifyAdaptations(recentActions)
    };
    
    // Calculate reflection duration
    reflection.duration = Date.now() - reflection.timestamp;
    
    // Store reflection
    await this.storeReflection(reflection);
    
    logger.info(`[SELF-AWARENESS] Reflection completed: ${reflectionId} (${reflection.duration}ms)`);
    
    return reflection;
  }
  
  analyzeWhatWorked(actions) {
    const successful = actions.filter(a => a.success);
    
    if (successful.length === 0) {
      return { message: 'No successful actions to analyze' };
    }
    
    // Find successful patterns
    const successfulModels = this.countByProperty(successful, 'model');
    const successfulStrategies = this.countByProperty(successful, 'strategy');
    const successfulTypes = this.countByProperty(successful, 'type');
    
    // Find highest performing combinations
    const topPerformers = {
      model: this.getTopPerformer(successfulModels),
      strategy: this.getTopPerformer(successfulStrategies),
      type: this.getTopPerformer(successfulTypes)
    };
    
    return {
      totalSuccessful: successful.length,
      successRate: successful.length / actions.length,
      topPerformers,
      insights: this.generateSuccessInsights(successful)
    };
  }
  
  analyzeWhatFailed(actions) {
    const failed = actions.filter(a => !a.success);
    
    if (failed.length === 0) {
      return { message: 'No failed actions to analyze' };
    }
    
    // Find failure patterns
    const failedModels = this.countByProperty(failed, 'model');
    const failedStrategies = this.countByProperty(failed, 'strategy');
    const failedTypes = this.countByProperty(failed, 'type');
    
    // Common failure reasons
    const failureReasons = this.countByProperty(failed, 'error');
    
    return {
      totalFailed: failed.length,
      failureRate: failed.length / actions.length,
      commonFailures: {
        models: this.getTopPerformer(failedModels),
        strategies: this.getTopPerformer(failedStrategies),
        types: this.getTopPerformer(failedTypes),
        reasons: this.getTopPerformer(failureReasons)
      },
      insights: this.generateFailureInsights(failed)
    };
  }
  
  detectPatterns(actions) {
    const patterns = [];
    
    // Temporal patterns
    const temporalPatterns = this.detectTemporalPatterns(actions);
    patterns.push(...temporalPatterns);
    
    // Performance patterns
    const performancePatterns = this.detectPerformancePatterns(actions);
    patterns.push(...performancePatterns);
    
    // Cost patterns
    const costPatterns = this.detectCostPatterns(actions);
    patterns.push(...costPatterns);
    
    // Model patterns
    const modelPatterns = this.detectModelPatterns(actions);
    patterns.push(...modelPatterns);
    
    return patterns;
  }
  
  detectTemporalPatterns(actions) {
    const patterns = [];
    
    // Group by hour of day
    const hourlyPerformance = this.groupByHour(actions);
    
    for (const [hour, hourActions] of hourlyPerformance) {
      const successRate = hourActions.filter(a => a.success).length / hourActions.length;
      
      if (successRate < 0.5) {
        patterns.push({
          type: 'temporal',
          pattern: 'low_success_hour',
          hour,
          successRate,
          recommendation: 'avoid_actions_during_hour'
        });
      }
    }
    
    return patterns;
  }
  
  detectPerformancePatterns(actions) {
    const patterns = [];
    
    // Latency patterns
    const avgLatency = actions.reduce((sum, a) => sum + a.latency, 0) / actions.length;
    const slowActions = actions.filter(a => a.latency > avgLatency * 2);
    
    if (slowActions.length > actions.length * 0.2) {
      patterns.push({
        type: 'performance',
        pattern: 'high_latency',
        percentage: slowActions.length / actions.length,
        avgLatency,
        recommendation: 'optimize_execution_speed'
      });
    }
    
    return patterns;
  }
  
  detectCostPatterns(actions) {
    const patterns = [];
    
    const avgCost = actions.reduce((sum, a) => sum + a.cost, 0) / actions.length;
    const expensiveActions = actions.filter(a => a.cost > avgCost * 2);
    
    if (expensiveActions.length > actions.length * 0.1) {
      patterns.push({
        type: 'cost',
        pattern: 'high_cost_actions',
        percentage: expensiveActions.length / actions.length,
        avgCost,
        recommendation: 'reduce_expensive_actions'
      });
    }
    
    return patterns;
  }
  
  detectModelPatterns(actions) {
    const patterns = [];
    
    // Model-specific performance
    for (const [model, modelActions] of this.groupByProperty(actions, 'model')) {
      const successRate = modelActions.filter(a => a.success).length / modelActions.length;
      
      if (successRate < 0.6) {
        patterns.push({
          type: 'model',
          pattern: 'low_model_performance',
          model,
          successRate,
          recommendation: 'reduce_model_usage'
        });
      }
    }
    
    return patterns;
  }
  
  identifyContradictions(actions) {
    const contradictions = [];
    
    // Confidence vs success contradictions
    const highConfidenceFailures = actions.filter(a => a.confidence > 0.8 && !a.success);
    const lowConfidenceSuccesses = actions.filter(a => a.confidence < 0.3 && a.success);
    
    if (highConfidenceFailures.length > actions.length * 0.1) {
      contradictions.push({
        type: 'confidence_misalignment',
        description: 'High confidence actions failing',
        count: highConfidenceFailures.length,
        recommendation: 'calibrate_confidence_lower'
      });
    }
    
    if (lowConfidenceSuccesses.length > actions.length * 0.1) {
      contradictions.push({
        type: 'confidence_misalignment',
        description: 'Low confidence actions succeeding',
        count: lowConfidenceSuccesses.length,
        recommendation: 'calibrate_confidence_higher'
      });
    }
    
    return contradictions;
  }
  
  generateReflectionRecommendations(actions) {
    const recommendations = [];
    
    // Based on success rate
    const successRate = actions.filter(a => a.success).length / actions.length;
    if (successRate < 0.7) {
      recommendations.push({
        priority: 'high',
        action: 'improve_success_rate',
        reason: `Success rate is ${successRate.toFixed(2)}`
      });
    }
    
    // Based on cost efficiency
    if (this.metrics.costEfficiency.roi < 0) {
      recommendations.push({
        priority: 'medium',
        action: 'improve_roi',
        reason: 'Negative ROI detected'
      });
    }
    
    // Based on drift
    if (this.metrics.drift.score > this.config.driftThreshold) {
      recommendations.push({
        priority: 'high',
        action: 'reduce_drift',
        reason: `Drift score ${this.metrics.drift.score.toFixed(3)} exceeds threshold`
      });
    }
    
    return recommendations;
  }
  
  performSelfAssessment() {
    const assessment = {
      overallLevel: this.calculateOverallLevel(),
      confidence: this.calculateSelfConfidence(),
      capabilities: this.assessCapabilities(),
      limitations: this.identifyLimitations(),
      healthScore: this.calculateHealthScore()
    };
    
    // Update self-awareness state
    this.selfAwarenessState.level = assessment.overallLevel;
    this.selfAwarenessState.confidence = assessment.confidence;
    this.selfAwarenessState.lastSelfAssessment = Date.now();
    
    return assessment;
  }
  
  identifyAdaptations(actions) {
    const adaptations = [];
    
    // Model adaptations
    const modelPerformance = this.analyzeModelPerformance(actions);
    for (const [model, performance] of Object.entries(modelPerformance)) {
      if (performance.successRate < 0.6) {
        adaptations.push({
          type: 'model_preference',
          action: 'decrease_usage',
          target: model,
          reason: `Low success rate: ${performance.successRate.toFixed(2)}`
        });
      } else if (performance.successRate > 0.9) {
        adaptations.push({
          type: 'model_preference',
          action: 'increase_usage',
          target: model,
          reason: `High success rate: ${performance.successRate.toFixed(2)}`
        });
      }
    }
    
    // Strategy adaptations
    const strategyPerformance = this.analyzeStrategyPerformance(actions);
    for (const [strategy, performance] of Object.entries(strategyPerformance)) {
      if (performance.avgCost > 0.1) {
        adaptations.push({
          type: 'cost_optimization',
          action: 'reduce_usage',
          target: strategy,
          reason: `High average cost: $${performance.avgCost.toFixed(4)}`
        });
      }
    }
    
    return adaptations;
  }
  
  /**
   * SELF-ASSESSMENT CYCLE
   */
  
  startSelfAssessment() {
    const selfAssessment = async () => {
      try {
        const assessment = this.performSelfAssessment();
        
        this.emit('self_assessment_completed', assessment);
        
        logger.info(`[SELF-AWARENESS] Self-assessment: ${assessment.overallLevel} (confidence: ${assessment.confidence.toFixed(2)})`);

      } catch (error) {
        logger.error('[SELF-AWARENESS] Self-assessment failed', { error: error.message });
      }
      
      // Schedule next assessment
      setTimeout(selfAssessment, this.config.reflectionInterval * 2); // Less frequent than reflection
    };
    
    // Start self-assessment
    selfAssessment();
  }
  
  /**
   * UTILITY METHODS
   */
  
  countByProperty(items, property) {
    const counts = {};
    for (const item of items) {
      const value = item[property] || 'unknown';
      counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
  }
  
  groupByProperty(items, property) {
    const groups = new Map();
    for (const item of items) {
      const value = item[property] || 'unknown';
      if (!groups.has(value)) {
        groups.set(value, []);
      }
      groups.get(value).push(item);
    }
    return groups;
  }
  
  groupByHour(actions) {
    const groups = new Map();
    for (const action of actions) {
      const hour = new Date(action.timestamp).getHours();
      if (!groups.has(hour)) {
        groups.set(hour, []);
      }
      groups.get(hour).push(action);
    }
    return groups;
  }
  
  getTopPerformer(counts) {
    let top = null;
    let maxCount = 0;
    
    for (const [value, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        top = { value, count };
      }
    }
    
    return top;
  }
  
  generateSuccessInsights(successful) {
    const insights = [];
    
    // High confidence success
    const highConfidenceSuccess = successful.filter(a => a.confidence > 0.8);
    if (highConfidenceSuccess.length > successful.length * 0.7) {
      insights.push('High confidence strongly correlates with success');
    }
    
    // Fast execution
    const avgLatency = successful.reduce((sum, a) => sum + a.latency, 0) / successful.length;
    if (avgLatency < 1000) {
      insights.push('Fast execution correlates with success');
    }
    
    return insights;
  }
  
  generateFailureInsights(failed) {
    const insights = [];
    
    // Low confidence failures
    const lowConfidenceFailure = failed.filter(a => a.confidence < 0.3);
    if (lowConfidenceFailure.length > failed.length * 0.5) {
      insights.push('Low confidence strongly correlates with failure');
    }
    
    // Common error patterns
    const errorTypes = this.countByProperty(failed, 'error');
    const topError = this.getTopPerformer(errorTypes);
    if (topError) {
      insights.push(`Most common failure: ${topError.value}`);
    }
    
    return insights;
  }
  
  analyzeModelPerformance(actions) {
    const performance = {};
    
    for (const [model, modelActions] of this.groupByProperty(actions, 'model')) {
      const successful = modelActions.filter(a => a.success).length;
      const totalCost = modelActions.reduce((sum, a) => sum + a.cost, 0);
      
      performance[model] = {
        successRate: successful / modelActions.length,
        avgCost: totalCost / modelActions.length,
        avgLatency: modelActions.reduce((sum, a) => sum + a.latency, 0) / modelActions.length
      };
    }
    
    return performance;
  }
  
  analyzeStrategyPerformance(actions) {
    const performance = {};
    
    for (const [strategy, strategyActions] of this.groupByProperty(actions, 'strategy')) {
      const successful = strategyActions.filter(a => a.success).length;
      const totalCost = strategyActions.reduce((sum, a) => sum + a.cost, 0);
      
      performance[strategy] = {
        successRate: successful / strategyActions.length,
        avgCost: totalCost / strategyActions.length,
        avgLatency: strategyActions.reduce((sum, a) => sum + a.latency, 0) / strategyActions.length
      };
    }
    
    return performance;
  }
  
  calculateOverallLevel() {
    const driftScore = this.metrics.drift.score;
    const successRate = this.metrics.taskSuccess.rate;
    const confidence = this.metrics.modelAccuracy.overall;
    
    if (driftScore > 0.4 || successRate < 0.6 || confidence < 0.6) {
      return 'critical';
    } else if (driftScore > 0.2 || successRate < 0.8 || confidence < 0.8) {
      return 'degraded';
    } else {
      return 'operational';
    }
  }
  
  calculateSelfConfidence() {
    const successRate = this.metrics.taskSuccess.rate;
    const driftScore = this.metrics.drift.score;
    const accuracy = this.metrics.modelAccuracy.overall;
    
    // Self-confidence based on performance consistency
    const confidence = (successRate + (1 - driftScore) + accuracy) / 3;
    return Math.max(0, Math.min(1, confidence));
  }
  
  assessCapabilities() {
    return {
      reasoning: this.metrics.modelAccuracy.overall > 0.7,
      execution: this.metrics.taskSuccess.rate > 0.8,
      adaptation: this.metrics.drift.score < 0.3,
      learning: this.reflections.length > 0,
      selfAwareness: true // By definition
    };
  }
  
  identifyLimitations() {
    const limitations = [];
    
    if (this.metrics.drift.score > 0.3) {
      limitations.push('High drift indicates prediction inconsistency');
    }
    
    if (this.metrics.taskSuccess.rate < 0.8) {
      limitations.push('Task execution reliability needs improvement');
    }
    
    if (this.metrics.costEfficiency.roi < 0) {
      limitations.push('Cost efficiency is negative');
    }
    
    return limitations;
  }
  
  calculateHealthScore() {
    const successRate = this.metrics.taskSuccess.rate;
    const driftScore = 1 - this.metrics.drift.score; // Invert drift (lower is better)
    const roi = Math.max(0, Math.min(1, (this.metrics.costEfficiency.roi + 1) / 2)); // Normalize ROI to 0-1
    
    return (successRate + driftScore + roi) / 3;
  }
  
  /**
   * PERSISTENCE
   */
  
  async storeReflection(reflection) {
    try {
      const filePath = path.join(this.config.awarenessPath, 'reflections.json');
      
      let reflections = [];
      try {
        const data = await fs.readFile(filePath, 'utf8');
        reflections = JSON.parse(data);
      } catch (error) {
        // File doesn't exist, start fresh
      }
      
      reflections.push(reflection);
      
      // Keep only recent reflections
      if (reflections.length > this.maxReflections) {
        reflections = reflections.slice(-this.maxReflections);
      }
      
      await fs.writeFile(filePath, JSON.stringify(reflections, null, 2));
      
    } catch (error) {
      logger.error('[SELF-AWARENESS] Failed to store reflection', { error: error.message });
    }
  }
  
  async loadHistoricalData() {
    try {
      // Load reflections
      const reflectionsPath = path.join(this.config.awarenessPath, 'reflections.json');
      try {
        const data = await fs.readFile(reflectionsPath, 'utf8');
        this.reflections = JSON.parse(data);
        logger.info(`[SELF-AWARENESS] Loaded ${this.reflections.length} historical reflections`);
      } catch (error) {
        logger.info('[SELF-AWARENESS] No historical reflections found');
      }

    } catch (error) {
      logger.error('[SELF-AWARENESS] Failed to load historical data', { error: error.message });
    }
  }
  
  /**
   * STATUS AND MONITORING
   */
  
  getStatus() {
    return {
      metrics: { ...this.metrics },
      selfAwareness: { ...this.selfAwarenessState },
      actionHistory: this.actionHistory.length,
      reflections: this.reflections.length,
      config: this.config
    };
  }
  
  getSelfAwarenessReport() {
    return {
      level: this.selfAwarenessState.level,
      confidence: this.selfAwarenessState.confidence,
      capabilities: this.assessCapabilities(),
      limitations: this.identifyLimitations(),
      healthScore: this.calculateHealthScore(),
      drift: this.metrics.drift,
      performance: this.metrics.taskSuccess,
      recommendations: this.generateReflectionRecommendations(this.actionHistory.slice(-50))
    };
  }
  
  async reset() {
    // Reset metrics
    this.metrics = {
      taskSuccess: {
        total: 0,
        successful: 0,
        failed: 0,
        rate: 0,
        avgLatency: 0,
        lastUpdated: Date.now()
      },
      revenue: {
        total: 0,
        perAction: 0,
        lastRevenue: 0,
        revenueActions: 0,
        conversionRate: 0,
        lastUpdated: Date.now()
      },
      modelAccuracy: {
        overall: 0,
        byModel: new Map(),
        confidenceCalibration: 0,
        lastUpdated: Date.now()
      },
      costEfficiency: {
        totalCost: 0,
        costPerSuccess: 0,
        costPerRevenue: 0,
        roi: 0,
        lastUpdated: Date.now()
      },
      drift: {
        score: 0,
        trend: 'stable',
        confidence: 0,
        lastCheck: Date.now(),
        history: []
      }
    };
    
    // Clear history
    this.actionHistory = [];
    this.reflections = [];
    
    // Reset self-awareness state
    this.selfAwarenessState = {
      level: 'operational',
      confidence: 0.8,
      lastSelfAssessment: Date.now(),
      patterns: new Map(),
      adaptations: new Map(),
      contradictions: []
    };
    
    logger.info('[SELF-AWARENESS] Reset completed');
  }
}

module.exports = HeidiSelfAwareness;
