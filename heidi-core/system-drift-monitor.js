/**
 * System Drift Monitor
 * Global system drift evaluation over time
 * Monitors whether collective behavior is becoming wrong even if individual decisions look correct
 */

class SystemDriftMonitor {
    constructor() {
        // Drift evaluation configuration
        this.driftConfig = {
            // Time windows for evaluation
            evaluation_windows: {
                short_term: 60 * 60 * 1000,        // 1 hour
                medium_term: 24 * 60 * 60 * 1000,  // 1 day
                long_term: 7 * 24 * 60 * 60 * 1000 // 1 week
            },
            
            // Drift detection thresholds
            drift_thresholds: {
                accuracy_drift: 0.15,            // 15% accuracy drop
                confidence_drift: 0.2,          // 20% confidence drop
                action_pattern_drift: 0.3,      // 30% change in action patterns
                governance_overuse: 0.4,         // 40% governance/bias activation
                decision_latency_drift: 0.25      // 25% increase in decision time
            },
            
            // System health indicators
            health_indicators: {
                decision_quality: 0.7,           // Minimum average decision quality
                action_consistency: 0.6,         // Consistency in similar situations
                learning_rate: 0.1,               // Minimum improvement rate
                stability_score: 0.8               // Minimum system stability
            }
        };
        
        // Drift tracking
        this.driftHistory = [];
        this.systemMetrics = {
            decisions: [],
            outcomes: [],
            governance_activations: [],
            bias_activations: [],
            performance_metrics: []
        };
        
        // Baseline establishment
        this.baseline = {
            established: false,
            baseline_period: 7 * 24 * 60 * 60 * 1000, // 1 week to establish baseline
            baseline_start: null,
            baseline_metrics: null
        };
        
        // Drift alerts
        this.driftAlerts = [];
        this.alertThresholds = {
            minor: 0.1,
            moderate: 0.2,
            critical: 0.3
        };
        
        // System drift score
        this.currentDriftScore = 0.0;
        
        console.log('[SYSTEM DRIFT MONITOR] Initialized - Monitoring collective behavior over time');
    }

    // CORE DRIFT EVALUATION
    evaluateSystemDrift() {
        const now = Date.now();
        
        try {
            // Step 1: Collect recent system metrics
            const recentMetrics = this.collectRecentMetrics(now);
            
            // Step 2: Compare against baseline
            const driftAnalysis = this.compareAgainstBaseline(recentMetrics);
            
            // Step 3: Calculate drift score
            const driftScore = this.calculateDriftScore(driftAnalysis);
            
            // Step 4: Detect drift patterns
            const driftPatterns = this.detectDriftPatterns(driftAnalysis);
            
            // Step 5: Update drift tracking
            this.updateDriftTracking(driftScore, driftAnalysis, driftPatterns, now);
            
            // Step 6: Generate alerts if needed
            this.generateDriftAlerts(driftScore, driftPatterns);
            
            return {
                drift_score: driftScore,
                drift_analysis: driftAnalysis,
                drift_patterns: driftPatterns,
                system_health: this.calculateSystemHealth(driftScore),
                recommendations: this.generateRecommendations(driftScore, driftPatterns),
                evaluation_timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error('[SYSTEM DRIFT MONITOR] Drift evaluation failed:', error);
            return {
                drift_score: 1.0, // Assume worst case on error
                error: error.message,
                evaluation_timestamp: new Date().toISOString()
            };
        }
    }

    // METRICS COLLECTION

    collectRecentMetrics(now) {
        const windows = this.driftConfig.evaluation_windows;
        
        return {
            short_term: this.collectMetricsInWindow(now - windows.short_term, now),
            medium_term: this.collectMetricsInWindow(now - windows.medium_term, now),
            long_term: this.collectMetricsInWindow(now - windows.long_term, now),
            current: this.collectMetricsInWindow(now - 60000, now) // Last minute
        };
    }

    collectMetricsInWindow(startTime, endTime) {
        const recentDecisions = this.systemMetrics.decisions.filter(d => 
            d.timestamp >= startTime && d.timestamp <= endTime
        );
        
        const recentOutcomes = this.systemMetrics.outcomes.filter(o => 
            o.timestamp >= startTime && o.timestamp <= endTime
        );
        
        const recentGovernance = this.systemMetrics.governance_activations.filter(g => 
            g.timestamp >= startTime && g.timestamp <= endTime
        );
        
        const recentBias = this.systemMetrics.bias_activations.filter(b => 
            b.timestamp >= startTime && b.timestamp <= endTime
        );
        
        const recentPerformance = this.systemMetrics.performance_metrics.filter(p => 
            p.timestamp >= startTime && p.timestamp <= endTime
        );
        
        return {
            decisions: recentDecisions,
            outcomes: recentOutcomes,
            governance_activations: recentGovernance,
            bias_activations: recentBias,
            performance_metrics: recentPerformance,
            
            // Aggregated metrics
            total_decisions: recentDecisions.length,
            accuracy_rate: this.calculateAccuracyRate(recentOutcomes),
            avg_confidence: this.calculateAvgConfidence(recentDecisions),
            governance_rate: recentGovernance.length / Math.max(1, recentDecisions.length),
            bias_rate: recentBias.length / Math.max(1, recentDecisions.length),
            avg_decision_time: this.calculateAvgDecisionTime(recentPerformance)
        };
    }

    // BASELINE MANAGEMENT

    establishBaseline() {
        const now = Date.now();
        
        if (!this.baseline.established) {
            this.baseline.baseline_start = now;
            
            // Collect metrics for baseline period
            const baselineMetrics = this.collectMetricsInWindow(
                now - this.baseline.baseline_period,
                now
            );
            
            this.baseline.baseline_metrics = baselineMetrics;
            this.baseline.established = true;
            
            console.log('[SYSTEM DRIFT MONITOR] Baseline established:', {
                period: '1 week',
                decisions: baselineMetrics.total_decisions,
                accuracy: (baselineMetrics.accuracy_rate * 100).toFixed(1) + '%',
                governance_rate: (baselineMetrics.governance_rate * 100).toFixed(1) + '%',
                bias_rate: (baselineMetrics.bias_rate * 100).toFixed(1) + '%'
            });
        }
        
        return this.baseline.established;
    }

    // DRIFT ANALYSIS

    compareAgainstBaseline(recentMetrics) {
        if (!this.baseline.established) {
            return {
                baseline_available: false,
                recommendation: 'establish_baseline_first'
            };
        }
        
        const baseline = this.baseline.baseline_metrics;
        
        return {
            baseline_available: true,
            baseline_metrics: baseline,
            
            // Calculate drift for each metric
            accuracy_drift: this.calculateMetricDrift(baseline.accuracy_rate, recentMetrics.short_term.accuracy_rate),
            confidence_drift: this.calculateMetricDrift(baseline.avg_confidence, recentMetrics.short_term.avg_confidence),
            governance_drift: this.calculateMetricDrift(baseline.governance_rate, recentMetrics.short_term.governance_rate),
            bias_drift: this.calculateMetricDrift(baseline.bias_rate, recentMetrics.short_term.bias_rate),
            decision_latency_drift: this.calculateMetricDrift(baseline.avg_decision_time, recentMetrics.short_term.avg_decision_time),
            
            // Trend analysis (short vs medium vs long term)
            trend_analysis: {
                accuracy_trend: this.calculateTrend(
                    recentMetrics.short_term.accuracy_rate,
                    recentMetrics.medium_term.accuracy_rate,
                    recentMetrics.long_term.accuracy_rate
                ),
                confidence_trend: this.calculateTrend(
                    recentMetrics.short_term.avg_confidence,
                    recentMetrics.medium_term.avg_confidence,
                    recentMetrics.long_term.avg_confidence
                ),
                governance_trend: this.calculateTrend(
                    recentMetrics.short_term.governance_rate,
                    recentMetrics.medium_term.governance_rate,
                    recentMetrics.long_term.governance_rate
                ),
                bias_trend: this.calculateTrend(
                    recentMetrics.short_term.bias_rate,
                    recentMetrics.medium_term.bias_rate,
                    recentMetrics.long_term.bias_rate
                )
            }
        };
    }

    calculateMetricDrift(baselineValue, currentValue) {
        if (baselineValue === 0) return 0; // Avoid division by zero
        
        const drift = (currentValue - baselineValue) / baselineValue;
        return Math.max(-1, Math.min(1, drift)); // Clamp to [-1, 1]
    }

    calculateTrend(short, medium, long) {
        // Simple linear trend calculation
        if (short === 0 && medium === 0 && long === 0) return 0;
        
        const weights = [1, 2, 3]; // More weight to longer term
        const values = [short, medium, long];
        
        let covariance = 0;
        let variance = 0;
        
        const mean = values.reduce((sum, val, i) => sum + val * weights[i], 0) / weights.reduce((sum, w) => sum + w, 0);
        
        for (let i = 0; i < values.length - 1; i++) {
            covariance += weights[i] * weights[i + 1] * (values[i] - mean) * (values[i + 1] - mean);
        }
        
        if (variance === 0) return 0;
        
        return covariance / variance;
    }

    // DRIFT SCORE CALCULATION

    calculateDriftScore(driftAnalysis) {
        const thresholds = this.driftConfig.drift_thresholds;
        
        let driftScore = 0;
        let maxDrift = 0;
        
        // Weight each type of drift
        const driftWeights = {
            accuracy_drift: 0.3,
            confidence_drift: 0.2,
            governance_drift: 0.2,
            bias_drift: 0.15,
            decision_latency_drift: 0.15
        };
        
        Object.entries(driftAnalysis).forEach(([metric, value]) => {
            if (driftWeights.hasOwnProperty(metric)) {
                const weight = driftWeights[metric];
                const threshold = thresholds[metric];
                
                const contribution = Math.abs(value) * weight;
                driftScore += contribution;
                
                maxDrift = Math.max(maxDrift, Math.abs(value));
            }
        });
        
        // Normalize score
        driftScore = Math.min(1.0, driftScore);
        
        return {
            drift_score: driftScore,
            max_drift: maxDrift,
            weighted_drifts: Object.fromEntries(
                Object.entries(driftAnalysis).map(([metric, value]) => [
                    metric, 
                    { value, weight: driftWeights[metric] || 0 }
                ]
            )
        };
    }

    // DRIFT PATTERN DETECTION

    detectDriftPatterns(driftAnalysis) {
        const patterns = [];
        
        // Pattern 1: Consistent negative drift
        if (Object.values(driftAnalysis).every(value => value < -0.1)) {
            patterns.push({
                type: 'consistent_negative_drift',
                severity: 'high',
                description: 'All metrics trending negative',
                affected_metrics: Object.keys(driftAnalysis)
            });
        }
        
        // Pattern 2: Governance overuse
        if (driftAnalysis.governance_drift > 0.3) {
            patterns.push({
                type: 'governance_overuse',
                severity: 'medium',
                description: 'High governance activation rate',
                value: driftAnalysis.governance_drift
            });
        }
        
        // Pattern 3: Bias overreliance
        if (driftAnalysis.bias_drift > 0.2) {
            patterns.push({
                type: 'bias_overreliance',
                severity: 'medium',
                description: 'High execution bias activation rate',
                value: driftAnalysis.bias_drift
            });
        }
        
        // Pattern 4: Confidence collapse
        if (driftAnalysis.confidence_drift < -0.3 && driftAnalysis.accuracy_drift < -0.2) {
            patterns.push({
                type: 'confidence_collapse',
                severity: 'high',
                description: 'Confidence and accuracy both declining',
                confidence_drift: driftAnalysis.confidence_drift,
                accuracy_drift: driftAnalysis.accuracy_drift
            });
        }
        
        // Pattern 5: Action pattern shift
        const trendChanges = [
            driftAnalysis.trend_analysis.accuracy_trend,
            driftAnalysis.trend_analysis.governance_trend,
            driftAnalysis.trend_analysis.bias_trend
        ];
        
        if (trendChanges.some(trend => Math.abs(trend) > 0.3)) {
            patterns.push({
                type: 'action_pattern_shift',
                severity: 'medium',
                description: 'Significant change in action patterns',
                trends: trendChanges
            });
        }
        
        return patterns;
    }

    // SYSTEM HEALTH CALCULATION

    calculateSystemHealth(driftScore) {
        const health = this.driftConfig.health_indicators;
        
        // Health factors
        const driftHealth = Math.max(0, 1 - driftScore); // Invert drift score for health
        
        const healthScore = (driftHealth + 
                           (health.decision_quality * 0.2) + 
                           (health.action_consistency * 0.2) + 
                           (health.learning_rate * 0.2) + 
                           (health.stability_score * 0.2)) / 1.8;
        
        return {
            healthy: healthScore > 0.7,
            health_score: healthScore,
            drift_score: driftScore,
            health_factors: {
                drift_health: driftHealth,
                decision_quality: health.decision_quality,
                action_consistency: health.action_consistency,
                learning_rate: health.learning_rate,
                stability_score: health.stability_score
            }
        };
    }

    // TRACKING AND ALERTS

    updateDriftTracking(driftScore, driftAnalysis, driftPatterns, timestamp) {
        this.currentDriftScore = driftScore;
        
        const record = {
            timestamp: timestamp,
            drift_score: driftScore,
            drift_analysis: driftAnalysis,
            drift_patterns: driftPatterns,
            system_health: this.calculateSystemHealth(driftScore)
        };
        
        this.driftHistory.push(record);
        
        // Keep only last 1000 records
        if (this.driftHistory.length > 1000) {
            this.driftHistory = this.driftHistory.slice(-1000);
        }
        
        console.log(`[SYSTEM DRIFT MONITOR] Drift score: ${driftScore.toFixed(3)} | Health: ${record.system_health.healthy ? 'healthy' : 'unhealthy'}`);
    }

    generateDriftAlerts(driftScore, driftPatterns) {
        const alerts = [];
        
        // Check for critical drift
        if (driftScore > this.alertThresholds.critical) {
            alerts.push({
                severity: 'critical',
                message: `Critical system drift detected: ${(driftScore * 100).toFixed(1)}% drift`,
                recommendations: this.generateCriticalRecommendations(driftPatterns),
                timestamp: new Date().toISOString()
            });
        } else if (driftScore > this.alertThresholds.moderate) {
            alerts.push({
                severity: 'moderate',
                message: `System drift detected: ${(driftScore * 100).toFixed(1)}% drift`,
                recommendations: this.generateModerateRecommendations(driftPatterns),
                timestamp: new Date().toISOString()
            });
        } else if (driftScore > this.alertThresholds.minor) {
            alerts.push({
                severity: 'minor',
                message: `Minor system drift detected: ${(driftScore * 100).toFixed(1)}% drift`,
                recommendations: this.generateMinorRecommendations(driftPatterns),
                timestamp: new Date().toISOString()
            });
        }
        
        // Pattern-specific alerts
        driftPatterns.forEach(pattern => {
            if (pattern.severity === 'high') {
                alerts.push({
                    severity: 'critical',
                    message: `Critical pattern: ${pattern.description}`,
                    pattern_type: pattern.type,
                    recommendations: this.generatePatternRecommendations(pattern),
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        this.driftAlerts = alerts;
        
        // Keep only last 100 alerts
        if (this.driftAlerts.length > 100) {
            this.driftAlerts = this.driftAlerts.slice(-100);
        }
        
        if (alerts.length > 0) {
            console.log(`[SYSTEM DRIFT MONITOR] ${alerts.length} drift alerts generated`);
        }
    }

    generateRecommendations(driftScore, driftPatterns) {
        const recommendations = [];
        
        if (driftScore > 0.3) {
            recommendations.push({
                type: 'system_reset',
                priority: 'critical',
                action: 'Consider system reset or major reconfiguration',
                reasoning: 'Severe drift detected'
            });
        }
        
        if (driftPatterns.some(p => p.type === 'confidence_collapse')) {
            recommendations.push({
                type: 'confidence_audit',
                priority: 'high',
                action: 'Audit confidence calibration system',
                reasoning: 'Confidence collapse detected'
            });
        }
        
        if (driftPatterns.some(p => p.type === 'governance_overuse')) {
            recommendations.push({
                type: 'governance_review',
                priority: 'medium',
                action: 'Review governance thresholds and rules',
                reasoning: 'Governance overuse detected'
            });
        }
        
        return recommendations;
    }

    generateCriticalRecommendations(driftPatterns) {
        const recommendations = [];
        
        driftPatterns.forEach(pattern => {
            switch (pattern.type) {
                case 'consistent_negative_drift':
                    recommendations.push('Immediate system intervention required');
                    recommendations.push('Review all decision-making layers');
                    recommendations.push('Consider system rollback');
                    break;
                case 'confidence_collapse':
                    recommendations.push('Confidence system requires recalibration');
                    recommendations.push('Review memory accuracy tracking');
                    recommendations.push('Reduce confidence thresholds temporarily');
                    break;
                case 'bias_overreliance':
                    recommendations.push('Review execution bias configuration');
                    recommendations.push('Increase deferral thresholds');
                    recommendations.push('Add human review triggers');
                    break;
                case 'action_pattern_shift':
                    recommendations.push('Analyze root causes of pattern changes');
                    recommendations.push('Update decision patterns');
                    recommendations.push('Monitor for continued shifts');
                    break;
            }
        });
        
        return recommendations;
    }

    generateModerateRecommendations(driftPatterns) {
        const recommendations = [];
        
        driftPatterns.forEach(pattern => {
            switch (pattern.type) {
                case 'governance_overuse':
                    recommendations.push('Adjust governance thresholds');
                    recommendations.push('Monitor governance activation rate');
                    break;
                case 'bias_overreliance':
                    recommendations.push('Review execution bias settings');
                    recommendations.push('Consider increasing safe default usage');
                    break;
                case 'action_pattern_shift':
                    recommendations.push('Investigate pattern changes');
                    recommendations.push('Monitor for stability');
                    break;
            }
        });
        
        return recommendations;
    }

    generateMinorRecommendations(driftPatterns) {
        const recommendations = [];
        
        driftPatterns.forEach(pattern => {
            recommendations.push(`Monitor ${pattern.type}`);
        });
        
        return recommendations;
    }

    // UTILITY METHODS

    calculateAccuracyRate(outcomes) {
        if (outcomes.length === 0) return 0;
        
        const correct = outcomes.filter(o => o.was_correct).length;
        return correct / outcomes.length;
    }

    calculateAvgConfidence(decisions) {
        if (decisions.length === 0) return 0;
        
        const totalConfidence = decisions.reduce((sum, d) => sum + (d.confidence || 0), 0);
        return totalConfidence / decisions.length;
    }

    calculateAvgDecisionTime(performance) {
        if (performance.length === 0) return 0;
        
        const totalTime = performance.reduce((sum, p) => sum + (p.decision_time || 0), 0);
        return totalTime / performance.length;
    }

    // METRICS RECORDING

    recordDecision(decision, outcome, governanceActivation, biasActivation, performanceMetric) {
        const now = new Date().toISOString();
        
        this.systemMetrics.decisions.push({
            timestamp: now,
            decision_id: decision.id || 'unknown',
            final_action: decision.final_action,
            confidence: decision.confidence,
            winning_authority: decision.winning_authority,
            execution_time: performanceMetric?.decision_time || 0
        });
        
        if (outcome) {
            this.systemMetrics.outcomes.push({
                timestamp: now,
                was_correct: outcome.was_correct,
                actual_theme: outcome.actual_theme,
                expected_theme: decision.strategic_theme,
                confidence_at_decision: decision.confidence
            });
        }
        
        if (governanceActivation) {
            this.systemMetrics.governance_activations.push({
                timestamp: now,
                governance_action: governanceActivation.action,
                governance_rule: governanceActivation.governance_rule,
                reasoning: governanceActivation.reasoning
            });
        }
        
        if (biasActivation) {
            this.systemMetrics.bias_activations.push({
                timestamp: now,
                bias_triggered: biasActivation.bias_triggered,
                bias_priority: biasActivation.bias_priority,
                forced_reasoning: biasActivation.forced_reasoning
            });
        }
        
        if (performanceMetric) {
            this.systemMetrics.performance_metrics.push({
                timestamp: now,
                decision_time: performanceMetric.decision_time,
                arbitration_time: performanceMetric.arbitration_time,
                governance_time: performanceMetric.governance_time,
                bias_time: performanceMetric.bias_time
            });
        }
        
        // Keep only last 10000 records per category
        Object.keys(this.systemMetrics).forEach(category => {
            if (this.systemMetrics[category].length > 10000) {
                this.systemMetrics[category] = this.systemMetrics[category].slice(-10000);
            }
        });
    }

    // MONITORING AND REPORTING

    getSystemDriftReport() {
        if (!this.baseline.established) {
            return {
                status: 'baseline_not_established',
                recommendation: 'establish_baseline_first'
            };
        }
        
        const currentEvaluation = this.evaluateSystemDrift();
        
        return {
            status: 'active',
            current_drift_score: currentEvaluation.drift_score,
            system_health: currentEvaluation.system_health,
            baseline_metrics: this.baseline.baseline_metrics,
            recent_metrics: currentEvaluation.drift_analysis,
            drift_patterns: currentEvaluation.drift_patterns,
            drift_alerts: this.driftAlerts.slice(-10),
            recommendations: currentEvaluation.recommendations,
            evaluation_timestamp: currentEvaluation.evaluation_timestamp,
            
            // Summary statistics
            summary: {
                total_decisions: this.systemMetrics.decisions.length,
                total_outcomes: this.systemMetrics.outcomes.length,
                total_governance_activations: this.systemMetrics.governance_activations.length,
                total_bias_activations: this.systemMetrics.bias_activations.length,
                drift_history_entries: this.driftHistory.length,
                current_drift_score: this.currentDriftScore,
                baseline_age: Date.now() - this.baseline.baseline_start
            }
        };
    }

    resetDriftMonitoring() {
        this.driftHistory = [];
        this.systemMetrics = {
            decisions: [],
            outcomes: [],
            governance_activations: [],
            bias_activations: [],
            performance_metrics: []
        };
        
        this.baseline.established = false;
        this.baseline.baseline_start = null;
        this.baseline.baseline_metrics = null;
        this.currentDriftScore = 0.0;
        this.driftAlerts = [];
        
        console.log('[SYSTEM DRIFT MONITOR] Drift monitoring reset');
    }
}

module.exports = SystemDriftMonitor;
