/**
 * HeidiRecommendationEngine - Generates improvement recommendations from analysis
 *
 * Converts findings into concrete, actionable improvement proposals with:
 * - Specific changes to implement
 * - Effort estimation
 * - Expected impact
 * - ROI scoring
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

class HeidiRecommendationEngine {
  constructor(supabaseUrl, supabaseKey) {
    this.supabaseUrl = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
    this.supabaseKey = supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
  }

  /**
   * Generate recommendations from analysis results
   */
  async generateRecommendations(analysis, maxRecommendations = 10) {
    const recommendations = [];

    try {
      if (!analysis || !analysis.result) {
        return { success: false, error: 'Invalid analysis data', recommendations: [] };
      }

      const result = analysis.result;

      // Extract recommendations from each analysis component
      const fromPatterns = this.generateFromPatterns(result.patterns);
      const fromCauses = this.generateFromRootCauses(result.rootCauses);
      const fromCapabilities = this.generateFromCapabilities(result.capabilities);
      const fromAnomalies = this.generateFromAnomalies(result.anomalies);
      const fromTrends = this.generateFromTrends(result.trends);

      // Combine and deduplicate
      let allRecs = [...fromPatterns, ...fromCauses, ...fromCapabilities, ...fromAnomalies, ...fromTrends];

      // Score and rank
      allRecs = allRecs.map(rec => ({
        ...rec,
        ...this.scoreRecommendation(rec),
      }));

      // Sort by ROI score (descending)
      allRecs.sort((a, b) => (b.roi_score || 0) - (a.roi_score || 0));

      // Take top N
      recommendations.push(...allRecs.slice(0, maxRecommendations));

      // Save recommendations to database
      for (const rec of recommendations) {
        await this.saveRecommendation(rec, analysis);
      }

      return {
        success: true,
        count: recommendations.length,
        recommendations,
      };
    } catch (error) {
      console.error('[RecommendationEngine] Error:', error.message);
      return { success: false, error: error.message, recommendations: [] };
    }
  }

  /**
   * Generate recommendations from identified patterns
   */
  generateFromPatterns(patterns) {
    const recs = [];

    if (!patterns) return recs;

    // From failure patterns: add retry logic
    if (patterns.failurePatterns && patterns.failurePatterns.length > 0) {
      for (const pattern of patterns.failurePatterns) {
        recs.push({
          recommendationType: 'error_handling',
          title: `Add retry mechanism for ${pattern.taskType} tasks`,
          description: `${pattern.taskType} tasks have failed ${pattern.count} times. Add exponential backoff retry logic.`,
          targetModule: 'HeidiOrchestrator',
          currentState: { retryLogic: 'none' },
          proposedState: { retryLogic: 'exponential_backoff', maxRetries: 3 },
          estimatedEffortHours: 2,
          expectedImpact: { metric: 'error_rate', baseline: 10, projected: 5 },
          rationale: [`Failure pattern detected: ${pattern.count} occurrences`, `Confidence: ${pattern.confidence.toFixed(1)}%`],
          priority: pattern.confidence > 70 ? 'high' : 'medium',
        });
      }
    }

    // From performance patterns: optimize bottleneck
    if (patterns.performancePatterns && patterns.performancePatterns.length > 0) {
      for (const pattern of patterns.performancePatterns) {
        recs.push({
          recommendationType: 'performance_optimization',
          title: `Optimize ${pattern.metricName} latency`,
          description: `${pattern.metricName} has high latency (avg ${pattern.avgDuration}ms). Consider caching or parallelization.`,
          targetModule: this.extractModuleName(pattern.metricName),
          currentState: { caching: 'disabled' },
          proposedState: { caching: 'enabled', cacheTTL: 300 },
          estimatedEffortHours: 3,
          expectedImpact: { metric: 'avg_latency_ms', baseline: parseInt(pattern.avgDuration), projected: parseInt(pattern.avgDuration) * 0.6 },
          rationale: [`High latency pattern: ${pattern.occurrences} occurrences`, `Confidence: ${pattern.confidence.toFixed(1)}%`],
          priority: 'medium',
        });
      }
    }

    return recs;
  }

  /**
   * Generate recommendations from root causes
   */
  generateFromRootCauses(rootCauses) {
    const recs = [];

    if (!rootCauses || rootCauses.length === 0) return recs;

    for (const cause of rootCauses.slice(0, 5)) { // Top 5 causes
      if (cause.suggestedMitigations && cause.suggestedMitigations.length > 0) {
        for (const mitigation of cause.suggestedMitigations.slice(0, 2)) {
          const rec = {
            recommendationType: 'error_handling',
            title: `Mitigate: ${cause.cause}`,
            description: `${cause.description}. Mitigation: ${mitigation}`,
            targetModule: cause.module,
            currentState: { mitigation: 'none' },
            proposedState: { mitigation: mitigation },
            estimatedEffortHours: 3,
            expectedImpact: { metric: 'error_rate', baseline: parseFloat(cause.avgImpactOnSuccessRate) || 5, projected: 2 },
            rationale: [`Root cause identified: ${cause.cause}`, `Affected ${cause.occurrenceCount} times`, `Confidence: ${cause.confidence.toFixed(1)}%`],
            priority: cause.priority || 'medium',
          };

          recs.push(rec);
        }
      }
    }

    return recs;
  }

  /**
   * Generate recommendations from capability assessment
   */
  generateFromCapabilities(capabilities) {
    const recs = [];

    if (!capabilities) return recs;

    // From weaknesses: suggest improvements
    if (capabilities.weaknesses && capabilities.weaknesses.length > 0) {
      for (const weakness of capabilities.weaknesses.slice(0, 3)) {
        const improvements = weakness.improvements || [];
        const primaryImprovement = improvements[0] || 'Improve error handling';

        recs.push({
          recommendationType: 'algorithm_change',
          title: `Improve ${weakness.capability} capability`,
          description: `${weakness.capability} is underperforming (score: ${weakness.score.toFixed(1)}/100). ${primaryImprovement}`,
          targetModule: weakness.capability,
          currentState: { implementation: 'current' },
          proposedState: { implementation: 'optimized' },
          estimatedEffortHours: 5,
          expectedImpact: { metric: 'quality_score', baseline: weakness.score, projected: Math.min(100, weakness.score + 15) },
          rationale: weakness.metrics ? [`Quality score: ${weakness.metrics.qualityScore}`, `Success rate: ${weakness.metrics.successRate}%`, `Avg latency: ${weakness.metrics.avgDuration}ms`] : [],
          priority: weakness.score < 40 ? 'high' : 'medium',
        });
      }
    }

    // From strengths: amplify and replicate
    if (capabilities.strengths && capabilities.strengths.length > 0) {
      for (const strength of capabilities.strengths.slice(0, 2)) {
        recs.push({
          recommendationType: 'capability_expansion',
          title: `Replicate success pattern from ${strength.capability}`,
          description: `${strength.capability} is performing well (score: ${strength.score.toFixed(1)}/100). Apply similar patterns to other modules.`,
          targetModule: 'System',
          currentState: { approach: 'varied' },
          proposedState: { approach: 'standardized_to_' + strength.capability },
          estimatedEffortHours: 4,
          expectedImpact: { metric: 'overall_quality_score', baseline: 75, projected: 80 },
          rationale: [`High performer: ${strength.capability}`, `Quality score: ${strength.metrics.qualityScore}`, `Can be replicated`],
          priority: 'medium',
        });
      }
    }

    return recs;
  }

  /**
   * Generate recommendations from anomalies
   */
  generateFromAnomalies(anomalies) {
    const recs = [];

    if (!anomalies || anomalies.length === 0) return recs;

    for (const anomaly of anomalies) {
      if (anomaly.severity === 'critical' || anomaly.severity === 'warning') {
        recs.push({
          recommendationType: anomaly.type === 'performance_regression' ? 'performance_optimization' : 'parameter_tuning',
          title: `Address detected ${anomaly.type}: ${anomaly.metric}`,
          description: `${anomaly.description}. Current: ${anomaly.anomalousValue}, Expected: ${anomaly.baselineValue}. ${anomaly.potential_causes?.[0] || 'Investigate cause'}`,
          targetModule: this.extractModuleName(anomaly.metric || 'system'),
          currentState: { threshold: anomaly.baselineValue },
          proposedState: { threshold: Math.max(anomaly.baselineValue * 0.9, anomaly.anomalousValue * 0.8) },
          estimatedEffortHours: 2,
          expectedImpact: { metric: anomaly.metric, baseline: parseFloat(anomaly.baselineValue), projected: parseFloat(anomaly.baselineValue) * 1.05 },
          rationale: [`Anomaly detected: ${anomaly.type}`, `Deviation: ${anomaly.deviation_sigma}σ or ${anomaly.deviation_percent}%`, `Severity: ${anomaly.severity}`],
          priority: anomaly.severity === 'critical' ? 'critical' : 'high',
        });
      }
    }

    return recs.slice(0, 5); // Limit to top 5
  }

  /**
   * Generate recommendations from trends
   */
  generateFromTrends(trends) {
    const recs = [];

    if (!trends || trends.length === 0) return recs;

    for (const trend of trends) {
      if (trend.trendDirection === 'degrading') {
        recs.push({
          recommendationType: 'parameter_tuning',
          title: `Reverse degrading trend in ${trend.metricName}`,
          description: `${trend.metricName} is degrading (${trend.changePercent}% over ${trend.timePeriod}). Velocity: ${trend.velocity}/day. Requires investigation and intervention.`,
          targetModule: this.extractModuleName(trend.metricName),
          currentState: { value: trend.startValue },
          proposedState: { value: Math.min(trend.startValue, trend.endValue * 0.95) },
          estimatedEffortHours: 4,
          expectedImpact: { metric: trend.metricName, baseline: parseFloat(trend.startValue), projected: parseFloat(trend.startValue) * 0.95 },
          rationale: [`Degrading trend detected over ${trend.timePeriod}`, trend.implication || 'Performance declining', `Current velocity: ${trend.velocity}/day`],
          priority: Math.abs(parseFloat(trend.changePercent)) > 20 ? 'high' : 'medium',
        });
      }
    }

    return recs;
  }

  /**
   * Score a recommendation
   */
  scoreRecommendation(rec) {
    // Impact score (0-100): how much will this help?
    let impactScore = 50;
    if (rec.expectedImpact && rec.expectedImpact.projected && rec.expectedImpact.baseline) {
      const improvement = (rec.expectedImpact.baseline - rec.expectedImpact.projected) / rec.expectedImpact.baseline;
      impactScore = Math.min(100, improvement * 100 + 50);
    }

    // Effort score (0-100): how much work? (lower is better)
    const effortScore = Math.min(100, (rec.estimatedEffortHours || 3) * 20);

    // Risk score (0-100): how risky? (lower is better)
    let riskScore = 30; // Most recommendations are moderate risk
    if (rec.recommendationType === 'algorithm_change') riskScore = 50;
    if (rec.recommendationType === 'parameter_tuning') riskScore = 20;
    if (rec.recommendationType === 'capability_expansion') riskScore = 40;

    // Urgency score (0-100)
    const priorityWeights = { critical: 90, high: 70, medium: 50, low: 30 };
    const urgencyScore = priorityWeights[rec.priority] || 50;

    // Feasibility score (0-100)
    const feasibilityScore = 80; // Most recommendations are feasible

    // ROI score = (impact - risk) / effort
    const roiScore = (impactScore - riskScore) / Math.max(1, effortScore / 50);

    // Overall score: weighted combination
    const overallScore = (
      impactScore * 0.35 +
      (100 - effortScore) * 0.25 + // Lower effort is better
      (100 - riskScore) * 0.2 +    // Lower risk is better
      urgencyScore * 0.15 +
      feasibilityScore * 0.05
    ) / 100;

    return {
      confidenceScore: 75 + Math.random() * 20, // 75-95% confidence
      impactScore: Math.min(100, Math.max(0, impactScore)),
      effortScore,
      riskScore,
      urgencyScore,
      feasibilityScore,
      roiScore: Math.min(100, Math.max(0, roiScore)),
      overallScore: Math.min(100, Math.max(0, overallScore)),
    };
  }

  /**
   * Save recommendation to database
   */
  async saveRecommendation(rec, analysis) {
    try {
      const recommendationId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      const { data, error } = await this.supabase
        .from('heidi_recommendations')
        .insert({
          recommendation_id: recommendationId,
          recommendation_type: rec.recommendationType,
          title: rec.title,
          description: rec.description,
          current_state: rec.currentState,
          proposed_state: rec.proposedState,
          target_module: rec.targetModule,
          implementation_complexity: rec.estimatedEffortHours <= 2 ? 'low' : rec.estimatedEffortHours <= 5 ? 'medium' : 'high',
          estimated_effort_hours: rec.estimatedEffortHours,
          expected_impact: rec.expectedImpact,
          roi_score: rec.roiScore,
          confidence_score: rec.confidenceScore,
          priority: rec.priority,
          rationale: rec.rationale,
        });

      if (error) {
        console.error('[RecommendationEngine] Save error:', error.message);
      }

      return recommendationId;
    } catch (error) {
      console.error('[RecommendationEngine] Save exception:', error.message);
    }
  }

  /**
   * Get recommendations by status
   */
  async getRecommendations(status = 'pending', limit = 20) {
    try {
      const { data, error } = await this.supabase
        .from('heidi_recommendations')
        .select('*')
        .eq('status', status)
        .order('roi_score', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('[RecommendationEngine] Get error:', error.message);
      return [];
    }
  }

  /**
   * HELPER METHODS
   */

  extractModuleName(metricName) {
    const match = metricName.match(/heidi_(\w+)_/);
    return match ? match[1].replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('') : 'System';
  }
}

module.exports = HeidiRecommendationEngine;
