/**
 * Outcome Validator Layer
 * 
 * Learns what actually became money, not what looked good on paper
 * Feeds real-world outcomes back to CASCADE to dynamically adjust thresholds
 * 
 * This is the adaptation layer that turns static rules into living intelligence
 */

const { createClient } = require('@supabase/supabase-js');
const { MemoryStore } = require('../memory/MemoryStore.js');

class OutcomeValidator {
  constructor() {
    // Initialize Supabase client
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );
    
    // Initialize memory store
    this.memory = new MemoryStore(this.supabase);
    
    // Dynamic thresholds (start with static, evolve with data)
    this.thresholds = {
      leadSourceMinConversion: 0.05,
      outreachMinPersonalization: 0.7,
      productMinDemandScore: 0.6,
      executionMinMargin: 0.30,
      
      // Adaptive weights
      sourceReliability: new Map(), // source -> reliability score
      nicheProfitability: new Map(), // niche -> avg margin
      messageEffectiveness: new Map(), // pattern -> conversion rate
      priceAccuracy: new Map() // projectType -> margin variance
    };
    
    // Learning configuration
    this.learningConfig = {
      minSamples: 10, // Minimum outcomes before adjusting
      adaptationRate: 0.1, // How fast to adjust
      confidenceThreshold: 0.8, // Confidence needed to adjust
      decayRate: 0.95 // Gradual decay of old signals
    };
    
    // Outcome tracking
    this.outcomeBuffer = [];
    this.lastAdaptation = Date.now();
    this.adaptationInterval = 24 * 60 * 60 * 1000; // Daily adaptation
    
    console.log('[OUTCOME VALIDATOR] Initialized - Ready to learn from reality');
  }

  /**
   * Record task execution and its real-world outcome
   */
  async recordOutcome(task, execution, outcome) {
    const record = {
      taskId: task.id,
      taskType: task.type,
      taskData: task,
      executionData: execution,
      outcome: outcome,
      timestamp: new Date().toISOString(),
      
      // Extract key metrics
      metrics: this.extractMetrics(task, execution, outcome)
    };
    
    // Store in database with verification
    console.log('[OUTCOME] Record keys:', Object.keys(record));
    await this.memory.writeAndVerify('task_outcomes', record, 'task_id');
    
    // Add to buffer for immediate learning
    this.outcomeBuffer.push(record);
    
    // Trigger adaptation if enough data
    if (this.outcomeBuffer.length >= this.learningConfig.minSamples) {
      await this.adaptThresholds();
    }
    
    console.log(`[OUTCOME VALIDATOR] Recorded outcome for ${task.type}: ${outcome.success ? 'SUCCESS' : 'FAILURE'}`);
    
    return record;
  }

  /**
   * Extract meaningful metrics from task outcome
   */
  extractMetrics(task, execution, outcome) {
    const metrics = {
      success: outcome.success || false,
      revenue: outcome.revenue || 0,
      cost: execution.cost || 0,
      margin: 0,
      timeToConversion: outcome.timeToConversion || null,
      leadQuality: outcome.leadQuality || 0,
      predictionAccuracy: 0
    };
    
    // Calculate margin if revenue exists
    if (metrics.revenue > 0) {
      metrics.margin = ((metrics.revenue - metrics.cost) / metrics.revenue) * 100;
    }
    
    // Calculate prediction accuracy
    if (task.predictions) {
      const predictions = Object.entries(task.predictions);
      const correct = predictions.filter(([key, pred]) => {
        const actual = outcome[key];
        return actual && Math.abs(actual - pred) / pred < 0.2; // Within 20%
      }).length;
      metrics.predictionAccuracy = correct / predictions.length;
    }
    
    return metrics;
  }

  /**
   * Adapt CASCADE thresholds based on real outcomes
   */
  async adaptThresholds() {
    console.log('\n[OUTCOME VALIDATOR] 🔄 Adapting thresholds based on outcomes...');
    
    const now = Date.now();
    // Remove time constraint for testing
    // if (now - this.lastAdaptation < this.adaptationInterval) {
    //   console.log('[OUTCOME VALIDATOR] Skipping adaptation - too soon');
    //   return;
    // }
    
    const adaptations = [];
    
    // Adapt lead source thresholds
    const sourceAdaptation = await this.adaptLeadSourceThresholds();
    if (sourceAdaptation) adaptations.push(sourceAdaptation);
    
    // Adapt outreach personalization
    const outreachAdaptation = await this.adaptOutreachThresholds();
    if (outreachAdaptation) adaptations.push(outreachAdaptation);
    
    // Adapt product demand thresholds
    const productAdaptation = await this.adaptProductThresholds();
    if (productAdaptation) adaptations.push(productAdaptation);
    
    // Adapt margin thresholds
    const marginAdaptation = await this.adaptMarginThresholds();
    if (marginAdaptation) adaptations.push(marginAdaptation);
    
    // Apply adaptations with confidence check
    for (const adaptation of adaptations) {
      if (adaptation.confidence >= this.learningConfig.confidenceThreshold) {
        this.applyAdaptation(adaptation);
        console.log(`[OUTCOME VALIDATOR] ✅ Applied: ${adaptation.description}`);
      } else {
        console.log(`[OUTCOME VALIDATOR] ⚠️ Skipped (low confidence): ${adaptation.description}`);
      }
    }
    
    // Clear buffer and update timestamp
    this.outcomeBuffer = [];
    this.lastAdaptation = now;
    
    // Store adaptation history
    try {
      await this.memory.write('threshold_adaptations', {
        adaptations: adaptations,
        timestamp: new Date().toISOString(),
        thresholds_after: this.thresholds
      });
    } catch (e) {
      console.error('[OUTCOME VALIDATOR] Failed to store adaptation:', e.message);
    }
    
    console.log('[OUTCOME VALIDATOR] Adaptation cycle complete\n');
  }

  /**
   * Adapt lead source validation based on actual conversion rates
   */
  async adaptLeadSourceThresholds() {
    try {
      const outcomes = await this.memory.aggregate('task_outcomes', 'taskData, metrics', {
        taskType: 'outreach'
      });
      
      // Filter by timestamp (in memory)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentOutcomes = outcomes.filter(o => 
        new Date(o.timestamp) > weekAgo
      );
      
      if (!recentOutcomes || recentOutcomes.length < this.learningConfig.minSamples) {
        return null;
      }
      
      // Use recentOutcomes for the rest of the method
      const filteredOutcomes = recentOutcomes;
      
    // Group by source
    const sourceStats = new Map();
    filteredOutcomes.forEach(outcome => {
      const source = outcome.taskData.leadSource;
      if (!sourceStats.has(source)) {
        sourceStats.set(source, { total: 0, revenue: 0, success: 0 });
      }
      const stats = sourceStats.get(source);
      stats.total++;
      stats.revenue += outcome.metrics.revenue;
      if (outcome.metrics.revenue > 0) stats.success++;
    });
    
    // Find best and worst performers
    let bestSource = null;
    let worstSource = null;
    let bestRevenue = 0;
    let worstRevenue = Infinity;
    
    for (const [source, stats] of sourceStats) {
      const avgRevenue = stats.revenue / stats.total;
      if (avgRevenue > bestRevenue) {
        bestRevenue = avgRevenue;
        bestSource = source;
      }
      if (avgRevenue < worstRevenue) {
        worstRevenue = avgRevenue;
        worstSource = source;
      }
    }
    
    // Suggest adaptation
    if (bestSource && worstSource && bestRevenue > worstRevenue * 2) {
      return {
        type: 'lead_source',
        description: `Source '${bestSource}' outperforms '${worSourceSource}' by ${((bestRevenue/worstRevenue - 1) * 100).toFixed(0)}%`,
        suggestion: {
          increaseReliability: bestSource,
          decreaseReliability: worstSource,
          adjustThreshold: worstRevenue > 0 ? Math.min(worstRevenue * 1.5, this.thresholds.leadSourceMinConversion * 2) : this.thresholds.leadSourceMinConversion
        },
        confidence: Math.min(filteredOutcomes.length / 50, 1)
      };
    }
    
    return null;
    } catch (e) {
      console.error('[OUTCOME VALIDATOR] Failed to adapt lead source thresholds:', e.message);
      return null;
    }
  }

  /**
   * Adapt outreach personalization based on actual response rates
   */
  async adaptOutreachThresholds() {
    const { data: outcomes } = await this.supabase
      .from('task_outcomes')
      .select('taskData, metrics')
      .eq('taskType', 'outreach')
      .gte('timestamp', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (!outcomes || outcomes.length < this.learningConfig.minSamples) {
      return null;
    }
    
    // Analyze personalization scores vs outcomes
    const scoreBuckets = new Map();
    outcomes.forEach(outcome => {
      const score = outcome.taskData.personalizationScore || 0.5;
      const bucket = Math.floor(score * 10) / 10;
      if (!scoreBuckets.has(bucket)) {
        scoreBuckets.set(bucket, { total: 0, success: 0 });
      }
      const stats = scoreBuckets.get(bucket);
      stats.total++;
      if (outcome.metrics.leadQuality > 0.5) stats.success++;
    });
    
    // Find optimal threshold
    let optimalThreshold = this.thresholds.outreachMinPersonalization;
    let bestSuccessRate = 0;
    
    for (const [threshold, stats] of scoreBuckets) {
      const successRate = stats.success / stats.total;
      if (stats.total >= 5 && successRate > bestSuccessRate) {
        bestSuccessRate = successRate;
        optimalThreshold = threshold;
      }
    }
    
    // Suggest adaptation
    if (Math.abs(optimalThreshold - this.thresholds.outreachMinPersonalization) > 0.1) {
      return {
        type: 'outreach_personalization',
        description: `Optimal personalization threshold appears to be ${optimalThreshold.toFixed(1)} (current: ${this.thresholds.outreachMinPersonalization})`,
        suggestion: {
          newThreshold: optimalThreshold,
          successRate: bestSuccessRate
        },
        confidence: Math.min(outcomes.length / 100, 1)
      };
    }
    
    return null;
  }

  /**
   * Adapt product demand thresholds based on actual sales
   */
  async adaptProductThresholds() {
    const { data: outcomes } = await this.supabase
      .from('task_outcomes')
      .select('taskData, metrics')
      .eq('taskType', 'product_listing')
      .gte('timestamp', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    
    if (!outcomes || outcomes.length < this.learningConfig.minSamples) {
      return null;
    }
    
    // Analyze demand signals vs actual sales
    const signalAnalysis = {
      searchVolume: { withSales: 0, withoutSales: 0 },
      waitlist: { withSales: 0, withoutSales: 0 },
      competitorReviews: { withSales: 0, withoutSales: 0 },
      customerRequest: { withSales: 0, withoutSales: 0 }
    };
    
    outcomes.forEach(outcome => {
      const product = outcome.taskData.product;
      const hasSales = outcome.metrics.revenue > 0;
      
      Object.keys(signalAnalysis).forEach(signal => {
        if (product[signal] > 0) {
          if (hasSales) signalAnalysis[signal].withSales++;
          else signalAnalysis[signal].withoutSales++;
        }
      });
    });
    
    // Calculate signal effectiveness
    const signalEffectiveness = {};
    Object.entries(signalAnalysis).forEach(([signal, data]) => {
      const total = data.withSales + data.withoutSales;
      signalEffectiveness[signal] = total > 0 ? data.withSales / total : 0;
    });
    
    // Find most reliable signal
    const bestSignal = Object.entries(signalEffectiveness)
      .sort((a, b) => b[1] - a[1])[0];
    
    if (bestSignal && bestSignal[1] > 0.3) {
      return {
        type: 'product_demand',
        description: `Signal '${bestSignal[0]}' has ${(bestSignal[1] * 100).toFixed(0)}% correlation with sales`,
        suggestion: {
          prioritizeSignal: bestSignal[0],
          adjustThreshold: Math.max(0.3, bestSignal[1] * 0.8)
        },
        confidence: Math.min(outcomes.length / 30, 1)
      };
    }
    
    return null;
  }

  /**
   * Adapt margin thresholds based on actual profitability
   */
  async adaptMarginThresholds() {
    const { data: outcomes } = await this.supabase
      .from('task_outcomes')
      .select('metrics')
      .in('taskType', ['execution', 'fulfillment'])
      .gte('timestamp', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    
    if (!outcomes || outcomes.length < this.learningConfig.minSamples) {
      return null;
    }
    
    // Analyze margin distribution
    const margins = outcomes
      .map(o => o.metrics.margin)
      .filter(m => m > 0);
    
    if (margins.length < 10) return null;
    
    // Calculate statistics
    margins.sort((a, b) => a - b);
    const p10 = margins[Math.floor(margins.length * 0.1)];
    const p25 = margins[Math.floor(margins.length * 0.25)];
    const median = margins[Math.floor(margins.length * 0.5)];
    
    // Find profitable threshold
    const profitableThresholds = margins.filter(m => m > 20);
    const avgProfitableMargin = profitableThresholds.reduce((a, b) => a + b, 0) / profitableThresholds.length;
    
    // Suggest adaptation
    if (avgProfitableMargin !== this.thresholds.executionMinMargin * 100) {
      const newThreshold = Math.max(20, Math.min(50, avgProfitableMargin * 0.8));
      
      return {
        type: 'execution_margin',
        description: `Average profitable margin is ${avgProfitableMargin.toFixed(1)}% (current threshold: ${this.thresholds.executionMinMargin * 100}%)`,
        suggestion: {
          newThreshold: newThreshold / 100,
          stats: { p10, p25, median }
        },
        confidence: Math.min(margins.length / 50, 1)
      };
    }
    
    return null;
  }

  /**
   * Apply adaptation to thresholds
   */
  applyAdaptation(adaptation) {
    switch (adaptation.type) {
      case 'lead_source':
        if (adaptation.suggestion.adjustThreshold) {
          this.thresholds.leadSourceMinConversion = adaptation.suggestion.adjustThreshold;
        }
        break;
        
      case 'outreach_personalization':
        if (adaptation.suggestion.newThreshold) {
          this.thresholds.outreachMinPersonalization = adaptation.suggestion.newThreshold;
        }
        break;
        
      case 'product_demand':
        if (adaptation.suggestion.adjustThreshold) {
          this.thresholds.productMinDemandScore = adaptation.suggestion.adjustThreshold;
        }
        break;
        
      case 'execution_margin':
        if (adaptation.suggestion.newThreshold) {
          this.thresholds.executionMinMargin = adaptation.suggestion.newThreshold;
        }
        break;
    }
  }

  /**
   * Get current thresholds for CASCADE
   */
  getThresholds() {
    return {
      ...this.thresholds,
      lastAdaptation: this.lastAdaptation,
      bufferSize: this.outcomeBuffer.length
    };
  }

  /**
   * Get adaptation history
   */
  async getAdaptationHistory(days = 30) {
    const { data } = await this.supabase
      .from('threshold_adaptations')
      .select('*')
      .gte('timestamp', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
      .order('timestamp', { ascending: false });
    
    return data || [];
  }

  /**
   * Force adaptation cycle (for testing)
   */
  async forceAdaptation() {
    console.log('[OUTCOME VALIDATOR] Forcing adaptation cycle...');
    await this.adaptThresholds();
  }

  /**
   * Get system health based on outcomes
   */
  async getSystemHealth() {
    const { data: recentOutcomes } = await this.supabase
      .from('task_outcomes')
      .select('taskType, metrics')
      .gte('timestamp', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (!recentOutcomes || recentOutcomes.length === 0) {
      return {
        status: 'unknown',
        reason: 'No outcome data available',
        recommendations: ['Execute more tasks to gather outcome data']
      };
    }
    
    // Calculate health metrics
    const totalTasks = recentOutcomes.length;
    const successfulTasks = recentOutcomes.filter(o => o.metrics.success).length;
    const revenueGenerated = recentOutcomes.reduce((sum, o) => sum + o.metrics.revenue, 0);
    const avgMargin = recentOutcomes
      .filter(o => o.metrics.margin > 0)
      .reduce((sum, o, _, arr) => sum + o.metrics.margin / arr.length, 0);
    
    const successRate = successfulTasks / totalTasks;
    
    // Determine health status
    let status = 'critical';
    let recommendations = [];
    
    if (successRate > 0.7 && revenueGenerated > 0) {
      status = 'healthy';
    } else if (successRate > 0.5) {
      status = 'degraded';
      recommendations.push('Review task quality and execution parameters');
    } else {
      recommendations.push('Success rate too low - consider lowering thresholds');
      recommendations.push('Analyze failure patterns in outcome data');
    }
    
    if (avgMargin < 25) {
      recommendations.push('Average margin is low - review pricing strategy');
    }
    
    return {
      status,
      metrics: {
        tasksAnalyzed: totalTasks,
        successRate: (successRate * 100).toFixed(1) + '%',
        totalRevenue: revenueGenerated,
        avgMargin: avgMargin.toFixed(1) + '%'
      },
      recommendations,
      lastAdaptation: this.lastAdaptation
    };
  }
}

module.exports = OutcomeValidator;
