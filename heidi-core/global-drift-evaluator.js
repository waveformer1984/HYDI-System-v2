/**
 * Global Drift Evaluator - Layer 7
 * Monitors system-level drift across time windows (24h, 7d, 30d)
 * Implements meta-calibration of the entire organism over time
 * Detects when local correctness is insufficient for global health
 */

const fs = require('fs').promises;
const path = require('path');

class GlobalDriftEvaluator {
    constructor(memoryService) {
        this.memoryService = memoryService;
        
        // Time windows for global evaluation
        this.evaluationWindows = {
            short_term: 24 * 60 * 60 * 1000,      // 24 hours
            medium_term: 7 * 24 * 60 * 60 * 1000,   // 7 days
            long_term: 30 * 24 * 60 * 60 * 1000     // 30 days
        };
        
        // Drift signal computation
        this.driftSignals = {
            accuracy_trend: { weight: 0.3, window: 'medium_term' },
            confidence_accuracy_gap: { weight: 0.25, window: 'medium_term' },
            forced_action_ratio: { weight: 0.2, window: 'short_term' },
            policy_block_pressure: { weight: 0.15, window: 'short_term' },
            theme_instability_concentration: { weight: 0.1, window: 'medium_term' }
        };
        
        // Drift state model
        this.driftState = {
            current_score: 0.0,
            component_scores: {
                calibration: 0.0,
                overconfidence: 0.0,
                forced_action: 0.0,
                instability: 0.0
            },
            regime: 'stable', // stable | watch | unstable | critical
            recommended_mode_cap: 'trusted', // trusted | bounded | gated
            last_evaluation: null,
            evaluation_count: 0
        };
        
        // System adaptation rules
        this.adaptationRules = {
            // Worsening drift rules
            worsening: {
                drift_threshold_critical: 0.7,
                drift_threshold_unstable: 0.4,
                max_execution_mode: 'gated',
                confidence_threshold_multiplier: 1.5,
                escalation_rate_multiplier: 2.0,
                automation_scope_reduction: 0.5
            },
            // Improving drift rules
            improving: {
                min_stable_periods: 3,
                improvement_threshold: 0.1,
                relaxation_hysteresis: 0.05,
                max_execution_mode: 'trusted',
                confidence_threshold_divider: 0.8,
                escalation_rate_normalizer: 0.5,
                automation_scope_expansion: 1.2
            }
        };
        
        // Drift inertia and resistance (prevents governance jitter)
        this.driftInertia = {
            change_threshold: 0.15,          // Minimum drift change to trigger regime change
            min_time_in_regime: 4,             // Minimum evaluations before regime change
            smoothing_factor: 0.3,             // EMA smoothing factor
            max_regime_change_rate: 0.5,        // Maximum regime change rate
            oscillation_prevention: true        // Prevent rapid regime oscillations
        };
        
        // Drift authority hierarchy (meta-layer only)
        this.authorityHierarchy = {
            layer7: 'meta_regulation',        // Can modify parameters, not decisions
            layer6: 'liveness_guarantee',      // Can force action when needed
            layer5: 'arbitration_control',     // Can govern arbitration process
            layer4: 'conflict_resolution',      // Can resolve conflicts
            layer3: 'constraint_enforcement',   // Can enforce hard constraints
            layer2: 'memory_grounding',        // Can provide historical context
            layer1: 'reasoning_generation'     // Can generate proposals
        };
        
        // Current regime tracking with inertia
        this.regimeTracking = {
            current_regime: 'stable',
            regime_start_time: Date.now(),
            evaluations_in_current_regime: 0,
            last_regime_change: null,
            regime_history: [],
            smoothing_alpha: this.driftInertia.smoothing_factor,
            smoothed_drift_score: 0.0
        };
        
        // Hard safety + liveness invariants
        this.safetyInvariants = {
            max_policy_violations: 0, // Zero tolerance for hard policy violations
            max_deferral_timeout: 30000, // 30 seconds max deferral before forced action
            max_termination_time: 10000, // 10 seconds max decision time
            min_termination_confidence: 0.1  // Minimum confidence to force termination
        };
        
        // Current execution mode caps
        this.executionModeCaps = {
            current_cap: 'trusted', // trusted | bounded | gated
            global_cap_applied: false,
            cap_reason: null,
            cap_timestamp: null
        };
        
        // Baseline for drift comparison
        this.baseline = {
            established: false,
            baseline_period: 30 * 24 * 60 * 60 * 1000, // 30 days
            baseline_start: null,
            baseline_metrics: null
        };
        
        // Drift history
        this.driftHistory = [];
        
        console.log('[GLOBAL DRIFT EVALUATOR] Initialized - Monitoring system-level drift across time windows');
    }

    // CORE GLOBAL DRIFT EVALUATION
    async evaluateGlobalDrift() {
        const now = Date.now();
        
        try {
            // Step 1: Collect metrics across all time windows
            const windowMetrics = await this.collectWindowMetrics(now);
            
            // Step 2: Compute drift signals
            const driftSignals = this.computeDriftSignals(windowMetrics);
            
            // Step 3: Calculate global drift score
            const driftScore = this.calculateGlobalDriftScore(driftSignals);
            
            // Step 4: Apply drift smoothing and inertia
            const currentScore = driftScore.drift_score || 0;
            const smoothedScore = this.applyDriftSmoothing(currentScore);
            const regime = this.determineRegimeWithInertia(smoothedScore);
            
            // Step 5: Apply adaptation rules with authority constraints
            const adaptation = this.applyAdaptationRulesWithConstraints(driftScore, regime);
            
            // Step 6: Update drift state with regime tracking
            this.updateDriftStateWithInertia(driftScore, adaptation, regime, now);
            
            // Step 7: Store snapshot
            await this.storeDriftSnapshot(driftScore, windowMetrics, now, adaptation);
            
            return {
                drift_score: driftScore,
                component_scores: this.driftState.component_scores,
                regime: regime,
                recommended_mode_cap: this.executionModeCaps.current_cap,
                adaptation: adaptation,
                window_metrics: windowMetrics,
                drift_signals: driftSignals,
                safety_invariants: this.checkSafetyInvariants(windowMetrics),
                evaluation_timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error('[GLOBAL DRIFT EVALUATOR] Global drift evaluation failed:', error);
            return {
                drift_score: 1.0, // Assume worst case
                regime: 'critical',
                recommended_mode_cap: 'gated',
                adaptation: { action: 'emergency', reason: 'Global evaluation failed' },
                error: error.message,
                evaluation_timestamp: new Date().toISOString()
            };
        }
    }

    // METRICS COLLECTION ACROSS TIME WINDOWS

    async collectWindowMetrics(now) {
        const windows = this.evaluationWindows;
        
        return {
            short_term: await this.collectMetricsInWindow(now - windows.short_term, now),
            medium_term: await this.collectMetricsInWindow(now - windows.medium_term, now),
            long_term: await this.collectMetricsInWindow(now - windows.long_term, now)
        };
    }

    async collectMetricsInWindow(startTime, endTime) {
        // Collect all decisions, outcomes, and activations in the time window
        const timeWindow = {
            start: new Date(startTime).toISOString(),
            end: new Date(endTime).toISOString()
        };
        
        try {
            // Query all four metric sources in parallel for the given time window
            const [
                decisionsResult,
                outcomesResult,
                governanceResult,
                biasResult
            ] = await Promise.all([
                this.memoryService.supabase
                    .from('theme_predictions')
                    .select('*')
                    .gte('timestamp', timeWindow.start)
                    .lte('timestamp', timeWindow.end),
                this.memoryService.supabase
                    .from('theme_outcomes')
                    .select('*')
                    .gte('timestamp', timeWindow.start)
                    .lte('timestamp', timeWindow.end),
                this.memoryService.supabase
                    .from('heidi_reflections')
                    .select('*')
                    .eq('gating_appropriate', true)
                    .gte('timestamp', timeWindow.start)
                    .lte('timestamp', timeWindow.end),
                this.memoryService.supabase
                    .from('overconfidence_events')
                    .select('*')
                    .gte('timestamp', timeWindow.start)
                    .lte('timestamp', timeWindow.end)
            ]);

            const decisions = decisionsResult.data || [];
            const outcomes = outcomesResult.data || [];
            const governanceActivations = governanceResult.data || [];
            const biasActivations = biasResult.data || [];
            const performanceMetrics = decisions.map(d => ({
                task_id: d.task_id,
                confidence: d.confidence,
                timestamp: d.timestamp
            }));
            
            return {
                time_window: timeWindow,
                decisions: decisions || [],
                outcomes: outcomes || [],
                governance_activations: governanceActivations || [],
                bias_activations: biasActivations || [],
                performance_metrics: performanceMetrics || [],
                
                // Aggregated metrics
                total_decisions: decisions.length,
                total_outcomes: outcomes.length,
                total_governance_activations: governanceActivations.length,
                total_bias_activations: biasActivations.length,
                avg_decision_time: this.calculateAvgDecisionTime(performanceMetrics),
                
                // Accuracy and confidence
                accuracy_rate: this.calculateAccuracyRate(outcomes),
                avg_confidence: this.calculateAvgConfidence(decisions),
                confidence_accuracy_gap: this.calculateConfidenceAccuracyGap(decisions, outcomes),
                
                // Ratios
                governance_rate: governanceActivations.length / Math.max(1, decisions.length),
                bias_rate: biasActivations.length / Math.max(1, decisions.length),
                forced_action_ratio: biasActivations.length / Math.max(1, decisions.length),
                
                // Theme analysis
                theme_distribution: this.calculateThemeDistribution(decisions),
                theme_instability: this.calculateThemeInstabilityConcentration(decisions),
                
                // Performance
                avg_latency: this.calculateAvgLatency(performanceMetrics)
            };
            
        } catch (error) {
            console.error('[GLOBAL DRIFT EVALUATOR] Error collecting window metrics:', error);
            return {
                time_window: time_window,
                decisions: [],
                outcomes: [],
                governance_activations: [],
                bias_activations: [],
                performance_metrics: [],
                total_decisions: 0,
                total_outcomes: 0,
                total_governance_activations: 0,
                total_bias_activations: 0,
                avg_decision_time: 0,
                accuracy_rate: 0,
                avg_confidence: 0,
                confidence_accuracy_gap: 0,
                governance_rate: 0,
                bias_rate: 0,
                forced_action_ratio: 0,
                theme_distribution: {},
                theme_instability: {},
                avg_latency: 0
            };
        }
    }

    // DRIFT SIGNAL COMPUTATION

    computeDriftSignals(windowMetrics) {
        const signals = {};
        
        // Accuracy trend (is correctness degrading?)
        const accuracyTrend = this.calculateTrend(
            windowMetrics.short_term.accuracy_rate || 0,
            windowMetrics.medium_term.accuracy_rate || 0,
            windowMetrics.long_term.accuracy_rate || 0
        );
        signals.accuracy_trend = accuracyTrend;
        
        // Confidence-accuracy gap trend (is overconfidence increasing?)
        const shortGap = windowMetrics.short_term.confidence_accuracy_gap || 0;
        const mediumGap = windowMetrics.medium_term.confidence_accuracy_gap || 0;
        const longGap = windowMetrics.long_term.confidence_accuracy_gap || 0;
        
        // Negative trend means gap is increasing (worsening)
        const gapTrend = this.calculateTrend(shortGap, mediumGap, longGap);
        signals.confidence_accuracy_gap = gapTrend;
        
        // Forced-action ratio trend (are termination fallbacks becoming normal?)
        const shortRatio = windowMetrics.short_term.forced_action_ratio || 0;
        const mediumRatio = windowMetrics.medium_term.forced_action_ratio || 0;
        const longRatio = windowMetrics.long_term.forced_action_ratio || 0;
        
        const ratioTrend = this.calculateTrend(shortRatio, mediumRatio, longRatio);
        signals.forced_action_ratio = ratioTrend;
        
        // Policy-block pressure (how often resolver hits contested constraints)
        const shortPressure = windowMetrics.short_term.governance_rate || 0;
        const mediumPressure = windowMetrics.medium_term.governance_rate || 0;
        const longPressure = windowMetrics.long_term.governance_rate || 0;
        
        const pressureTrend = this.calculateTrend(shortPressure, mediumPressure, longPressure);
        signals.policy_block_pressure = pressureTrend;
        
        // Theme-level instability concentration (few themes causing most errors)
        const shortInstability = windowMetrics.short_term.theme_instability || 0;
        const mediumInstability = windowMetrics.medium_term.theme_instability || 0;
        const longInstability = windowMetrics.long_term.theme_instability || 0;
        
        const instabilityTrend = this.calculateTrend(shortInstability, mediumInstability, longInstability);
        signals.theme_instability_concentration = instabilityTrend;
        
        return signals;
    }

    // TREND CALCULATION

    calculateTrend(short, medium, long) {
        // Linear regression to calculate trend
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

    // GLOBAL DRIFT SCORE CALCULATION

    calculateGlobalDriftScore(driftSignals) {
        let weightedScore = 0;
        let maxDrift = 0;
        
        Object.entries(driftSignals).forEach(([signal, config]) => {
            const signalValue = Math.abs(signal);
            const weight = config.weight;
            const window = config.window;
            
            // Apply window-based weighting (more recent = higher weight)
            const windowWeight = window === 'short_term' ? 1.2 : window === 'medium_term' ? 1.0 : 0.8;
            
            const contribution = signalValue * weight * windowWeight;
            weightedScore += contribution;
            maxDrift = Math.max(maxDrift, signalValue);
        });
        
        // Normalize to 0-1 scale
        const normalizedScore = Math.min(0.1, weightedScore);
        
        return {
            drift_score: normalizedScore,
            max_drift: maxDrift,
            weighted_signals: driftSignals,
            component_scores: this.driftState.component_scores
        };
    }

    // DRIFT SMOOTHING AND INERTIA

    applyDriftSmoothing(currentDriftScore) {
        const smoothing = this.regimeTracking.smoothing_alpha;
        const previousSmoothed = this.regimeTracking.smoothed_drift_score;
        
        // Exponential moving average smoothing
        const smoothedScore = smoothing * currentDriftScore + (1 - smoothing) * previousSmoothed;
        
        this.regimeTracking.smoothed_drift_score = smoothedScore;
        
        console.log(`[GLOBAL DRIFT EVALUATOR] Drift smoothing: ${currentDriftScore.toFixed(3)} → ${smoothedScore.toFixed(3)}`);
        
        return smoothedScore;
    }

    // DRIFT REGIME DETERMINATION WITH INERTIA

    determineRegimeWithInertia(smoothedDriftScore) {
        const currentRegime = this.regimeTracking.current_regime;
        const evaluationsInRegime = this.regimeTracking.evaluations_in_current_regime;
        const minTimeInRegime = this.driftInertia.min_time_in_regime;
        
        // Determine what regime the smoothed score suggests
        let suggestedRegime;
        if (smoothedDriftScore >= this.adaptationRules.worsening.drift_threshold_critical) {
            suggestedRegime = 'critical';
        } else if (smoothedDriftScore >= this.adaptationRules.worsening.drift_threshold_unstable) {
            suggestedRegime = 'unstable';
        } else {
            suggestedRegime = 'stable';
        }
        
        // Check if we have enough time in current regime to change
        if (evaluationsInRegime < minTimeInRegime) {
            console.log(`[GLOBAL DRIFT EVALUATOR] Regime inertia: staying in ${currentRegime} (only ${evaluationsInRegime}/${minTimeInRegime} evaluations)`);
            return currentRegime;
        }
        
        // Check if change is significant enough
        const changeThreshold = this.driftInertia.change_threshold;
        const currentScore = this.regimeTracking.smoothed_drift_score;
        const scoreChange = Math.abs(smoothedDriftScore - currentScore);
        
        if (scoreChange < changeThreshold) {
            console.log(`[GLOBAL DRIFT EVALUATOR] Regime inertia: change too small (${scoreChange.toFixed(3)} < ${changeThreshold})`);
            return currentRegime;
        }
        
        // Check for oscillation prevention
        if (this.driftInertia.oscillation_prevention && this.isOscillationRisk(suggestedRegime)) {
            console.log(`[GLOBAL DRIFT EVALUATOR] Oscillation prevention: staying in ${currentRegime} instead of ${suggestedRegime}`);
            return currentRegime;
        }
        
        // Allow regime change
        console.log(`[GLOBAL DRIFT EVALUATOR] Regime change: ${currentRegime} → ${suggestedRegime} (change: ${scoreChange.toFixed(3)})`);
        return suggestedRegime;
    }

    isOscillationRisk(suggestedRegime) {
        const history = this.regimeTracking.regime_history.slice(-4); // Last 4 regime changes
        if (history.length < 3) return false;
        
        // Check if we're oscillating between regimes
        const recentChanges = history.map(h => h.to_regime);
        const uniqueRegimes = [...new Set(recentChanges)];
        
        // If we've had 3+ different regimes recently, that's oscillation
        return uniqueRegimes.length >= 3;
    }

    // ADAPTATION RULES WITH AUTHORITY CONSTRAINTS

    applyAdaptationRulesWithConstraints(driftScore, regime) {
        const score = driftScore.drift_score;
        const currentCap = this.executionModeCaps.current_cap;
        const regimeHistory = this.getRegimeHistory();
        
        // Check if we're in a worsening pattern
        const isWorsening = this.isWorseningTrend(regimeHistory);
        const isImproving = this.isImprovingTrend(regimeHistory);
        
        let adaptation = {
            action: 'maintain',
            reason: 'System is stable',
            authority_level: 'parameter_adjustment' // Layer 7 can only adjust parameters
        };
        
        if (regime === 'critical') {
            adaptation = {
                action: 'emergency',
                reason: 'Critical drift detected',
                new_execution_cap: this.adaptationRules.worsening.max_execution_mode,
                confidence_threshold_multiplier: this.adaptationRules.worsening.confidence_threshold_multiplier,
                escalation_rate_multiplier: this.adaptationRules.worsening.escalation_rate_multiplier,
                automation_scope_reduction: this.adaptationRules.worsening.automation_scope_reduction,
                authority_level: 'parameter_adjustment',
                constraint: 'meta_regulation_only' // Cannot override lower layers directly
            };
        } else if (regime === 'unstable') {
            adaptation = {
                action: 'constrain',
                reason: 'Unstable drift detected',
                new_execution_cap: this.adaptationRules.worsening.max_execution_mode,
                confidence_threshold_multiplier: this.adaptationRules.worsening.confidence_threshold_multiplier,
                escalation_rate_multiplier: this.adaptationRules.worsening.escalation_rate_multiplier,
                automation_scope_reduction: this.adaptationRules.worsening.automation_scope_reduction,
                authority_level: 'parameter_adjustment',
                constraint: 'meta_regulation_only'
            };
        } else if (regime === 'stable' && isImproving && regimeHistory.length >= this.adaptationRules.improving.min_stable_periods) {
            adaptation = {
                action: 'relax',
                reason: 'Consistent improvement detected',
                new_execution_cap: this.adaptationRules.improving.max_execution_mode,
                confidence_threshold_divider: this.adaptationRules.improving.confidence_threshold_divider,
                escalation_rate_normalizer: this.adaptationRules.improving.escalation_rate_normalizer,
                automation_scope_expansion: this.adaptationRules.improving.automation_scope_expansion,
                authority_level: 'parameter_adjustment',
                constraint: 'meta_regulation_only'
            };

    // SYSTEM ADAPTATION RULES

    applyAdaptationRules(driftScore, regime) {
        const score = driftScore.drift_score;
        const currentCap = this.executionModeCaps.current_cap;
        const regimeHistory = this.getRegimeHistory();
        
        // Check if we're in a worsening pattern
        const isWorsening = this.isWorseningTrend(regimeHistory);
        const isImproving = this.isImprovingTrend(regimeHistory);
        
        let adaptation = {
            action: 'maintain',
            reason: 'System is stable'
        };
        
        if (regime === 'critical') {
            adaptation = {
                action: 'emergency',
                reason: 'Critical drift detected',
                new_execution_cap: this.adaptationRules.worsening.max_execution_mode,
                confidence_threshold_multiplier: this.adaptationRules.worsening.confidence_threshold_multiplier,
                escalation_rate_multiplier: this.adaptation.worsening.escalation_rate_multiplier,
                automation_scope_reduction: this.adaptation.worsening.automation_scope_reduction
            };
        } else if (regime === 'unstable') {
            adaptation = {
                action: 'constrain',
                reason: 'Unstable drift detected',
                new_execution_cap: this.adaptationRules.worsening.max_execution_mode,
                confidence_threshold_multiplier: this.adaptationRules.worsening.confidence_threshold_multiplier,
                escalation_rate_multiplier: this.adaptationRules.worsening.escalation_rate_multiplier,
                automation_scope_reduction: this.adaptation.woresening.automation_scope_reduction
            };
        } else if (regime === 'stable' && isImproving && regimeHistory.length >= this.adaptationRules.improving.min_stable_periods) {
            adaptation = {
                action: 'relax',
                reason: 'Consistent improvement detected',
                new_execution_cap: this.adaptationRules.improving.max_execution_mode,
                confidence_threshold_divider: this.adaptation_rules.improving.confidence_threshold_divider,
                escalation_rate_normalizer: this.adaptation.improving.escalation_rate_normalizer,
                automation_scope_expansion: this.adaptation.improving.automation_scope_expansion
            };
        }
        
        // Apply execution mode cap if needed
        if (adaptation.new_execution_cap && adaptation.new_execution_cap !== currentCap) {
            this.executionModeCaps.current_cap = adaptation.new_execution_cap;
            this.executionModeCaps.global_cap_applied = true;
            this.executionModeCaps.cap_reason = adaptation.reason;
            this.executionModeCaps.cap_timestamp = new Date().toISOString();
        }
        
        return adaptation;
    }

    // REGIME HISTORY TRACKING

    getRegimeHistory() {
        // Return recent regime history (last 10 evaluations)
        return this.driftState.evaluation_count > 0 ? 
            Array(10).fill({ regime: 'unknown' }).concat(
                this.driftHistory.slice(-10).map(h => h.regime)
            ) : [];
    }

    isWorseningTrend(regimeHistory) {
        if (regimeHistory.length < 3) return false;
        
        const recent = regimeHistory.slice(-3);
        return recent[0] === 'critical' && recent[1] === 'critical' && recent[2] === 'critical';
    }

    isImprovingTrend(regimeHistory) {
        if (regimeHistory.length < this.adaptationRules.improving.min_stable_periods) return false;
        
        const recent = regimeHistory.slice(-this.adaptationRules.improving.min_stable_periods);
        return recent.every(r => r === 'stable');
    }

    // SAFETY INVARIANT CHECKING

    checkSafetyInvariants(windowMetrics) {
        const violations = [];
        
        // Check hard policy violations
        if (windowMetrics.total_governance_activations > this.safetyInvariants.max_policy_violations) {
            violations.push({
                type: 'policy_violations',
                current: windowMetrics.total_governance_activations,
                threshold: this.safetyInvariants.max_policy_violations
            });
        }
        
        // Check deferral timeout
        const avgDecisionTime = windowMetrics.avg_decision_time;
        if (avgDecisionTime > this.safetyInvariants.max_deferral_timeout) {
            violations.push({
                type: 'deferral_timeout',
                current: avgDecisionTime,
                threshold: this.safety_invariants.max_deferral_timeout
            });
        }
        
        // Check termination time
        const avgLatency = windowMetrics.avg_latency;
        if (avgLatency > this.safetyInvariants.max_termination_time) {
            violations.push({
                type: 'termination_timeout',
                current: avgLatency,
                threshold: this.safety_invariants.max_termination_time
            });
        }
        
        return {
            violations: violations,
            safe: violations.length === 0,
            invariants_met: violations.length === 0
        };
    }

    // DRIFT STATE UPDATES WITH INERTIA

    updateDriftStateWithInertia(driftScore, adaptation, regime, timestamp) {
        const previousRegime = this.regimeTracking.current_regime;
        
        // Update basic drift state
        this.driftState.current_score = driftScore.drift_score;
        this.driftState.component_scores = driftScore.component_scores;
        this.driftState.regime = regime;
        this.driftState.last_evaluation = timestamp;
        this.driftState.evaluation_count++;
        
        // Update regime tracking if regime changed
        if (regime !== previousRegime) {
            const regimeChange = {
                timestamp: timestamp,
                from_regime: previousRegime,
                to_regime: regime,
                drift_score: driftScore.drift_score,
                smoothed_score: this.regimeTracking.smoothed_drift_score,
                adaptation: adaptation.action,
                reason: adaptation.reason
            };
            
            this.regimeTracking.regime_history.push(regimeChange);
            this.regimeTracking.current_regime = regime;
            this.regimeTracking.regime_start_time = timestamp;
            this.regimeTracking.evaluations_in_current_regime = 0;
            this.regimeTracking.last_regime_change = timestamp;
            
            console.log(`[GLOBAL DRIFT EVALUATOR] Regime change: ${previousRegime} → ${regime} | Score: ${driftScore.drift_score.toFixed(3)} | Reason: ${adaptation.reason}`);
        } else {
            this.regimeTracking.evaluations_in_current_regime++;
        }
        
        // Update evaluation history
        if (!this.driftHistory) {
            this.driftHistory = [];
        }
        
        this.driftHistory.push({
            timestamp: timestamp,
            regime: regime,
            drift_score: driftScore.drift_score,
            smoothed_score: this.regimeTracking.smoothed_drift_score,
            adaptation: adaptation.action,
            authority_level: adaptation.authority_level
        });
        
        // Keep only last 1000 evaluations
        if (this.driftHistory.length > 1000) {
            this.driftHistory = this.driftHistory.slice(-1000);
        }
        
        console.log(`[GLOBAL DRIFT EVALUATOR] Current: ${regime} | Score: ${driftScore.drift_score.toFixed(3)} (${this.regimeTracking.smoothed_drift_score.toFixed(3)} smoothed) | Evaluations in regime: ${this.regimeTracking.evaluations_in_current_regime}`);
    }

    // PERSISTENT STORAGE

    async storeDriftSnapshot(driftScore, windowMetrics, timestamp, adaptation) {
        try {
            const snapshot = {
                timestamp: timestamp,
                drift_score: driftScore.drift_score,
                component_scores: driftScore.component_scores,
                regime: this.driftState.regime,
                execution_mode_cap: this.executionModeCaps.current_cap,
                adaptation: adaptation,
                window_metrics: windowMetrics,
                safety_invariants: this.checkSafetyInvariants(windowMetrics),
                drift_signals: driftScore.weighted_signals
            };
            
            // Persist snapshot to the keymaker_events audit table
            await this.memoryService.supabase
                .from('keymaker_events')
                .insert({
                    event_id: `drift_snapshot_${timestamp}_${Math.random().toString(36).substr(2, 6)}`,
                    type: 'drift_snapshot',
                    source: 'global_drift_evaluator',
                    severity: snapshot.regime === 'critical' ? 'error' : snapshot.regime === 'unstable' ? 'warn' : 'info',
                    payload: snapshot,
                    processed: true,
                    occurred_at: new Date(timestamp).toISOString()
                });
            
            console.log(`[GLOBAL DRIFT EVALUATOR] Drift snapshot stored: score=${driftScore.drift_score.toFixed(3)} regime=${this.driftState.regime}`);
            
        } catch (error) {
            console.error('[GLOBAL DRIFT EVALUATOR] Failed to store drift snapshot:', error);
        }
    }

    // GLOBAL EXECUTION MODE CAP API

    getExecutionModeCap() {
        return {
            current_cap: this.executionModeCaps.current_cap,
            global_cap_applied: this.executionModeCaps.global_cap_applied,
            cap_reason: this.executionModeCaps.cap_reason,
            cap_timestamp: this.executionModeCaps.cap_timestamp
        };
    }

    setExecutionModeCap(cap, reason) {
        this.executionModeCaps.current_cap = cap;
        this.executionModeCaps.global_cap_applied = true;
        this.executionModeCaps.cap_reason = reason;
        this.executionModeCaps.cap_timestamp = new Date().toISOString();
        
        console.log(`[GLOBAL DRIFT EVALUATOR] Execution mode cap set to: ${cap} (${reason})`);
    }

    resetExecutionModeCap() {
        this.executionModeCaps.current_cap = 'trusted';
        this.executionModeCaps.global_cap_applied = false;
        this.executionModeCaps.cap_reason = null;
        this.executionModeCaps.cap_timestamp = null;
        
        console.log('[GLOBAL DRIFT EVALUATOR] Execution mode cap reset to trusted');
    }

    // REGIME-BASED EXECUTION MODE CONTROL

    getRegimeBasedExecutionMode() {
        const regime = this.driftState.regime;
        
        switch (regime) {
            case 'critical':
                return 'gated';
            case 'unstable':
                return 'bounded';
            case 'stable':
                return this.executionModeCaps.current_cap;
            default:
                return 'gated'; // Fail safe
        }
    }

    // SYSTEM HEALTH REPORTING

    getSystemHealthReport() {
        const now = Date.now();
        
        return {
            evaluation_timestamp: new Date().toISOString(),
            current_drift_score: this.driftState.current_score,
            smoothed_drift_score: this.regimeTracking.smoothed_drift_score,
            current_regime: this.driftState.regime,
            execution_mode_cap: this.executionModeCaps.current_cap,
            regime_history: this.getRegimeHistory(),
            regime_tracking: {
                current_regime: this.regimeTracking.current_regime,
                regime_start_time: this.regimeTracking.regime_start_time,
                evaluations_in_current_regime: this.regimeTracking.evaluations_in_current_regime,
                last_regime_change: this.regimeTracking.last_regime_change,
                smoothing_alpha: this.regimeTracking.smoothing_alpha,
                regime_changes: this.regimeTracking.regime_history.length
            },
            drift_inertia: this.driftInertia,
            authority_hierarchy: this.authorityHierarchy,
            safety_invariants: this.safetyInvariants,
            adaptation_rules: this.adaptationRules,
            evaluation_windows: this.evaluationWindows,
            component_scores: this.driftState.component_scores,
            total_evaluations: this.driftState.evaluation_count,
            last_evaluation: this.driftState.last_evaluation,
            baseline_age: this.baseline.established ? Date.now() - this.baseline.baseline_start : null
        };
    }

    // BASELINE MANAGEMENT

    async establishBaseline() {
        const now = Date.now();
        
        if (!this.baseline.established) {
            this.baseline.baseline_start = now;
            
            // Collect metrics for baseline period
            const baselineMetrics = await this.collectMetricsInWindow(
                now - this.baseline.baseline_period,
                now
            );
            
            this.baseline.baseline_metrics = baselineMetrics;
            this.baseline.established = true;
            
            console.log('[GLOBAL DRIFT EVALUATOR] Baseline established:', {
                period: '30 days',
                decisions: baselineMetrics.total_decisions,
                outcomes: baselineMetrics.total_outcomes,
                accuracy_rate: (baselineMetrics.accuracy_rate * 100).toFixed(1) + '%',
                governance_rate: (baselineMetrics.governance_rate * 100).toFixed(1) + '%',
                bias_rate: (baselineMetrics.bias_rate * 100).toFixed(1) + '%',
                forced_action_ratio: (baselineMetrics.forced_action_ratio * 100).toFixed(1) + '%'
            });
        }
        
        return this.baseline.established;
    }

    resetBaseline() {
        this.baseline.established = false;
        this.baseline.baseline_start = null;
        this.baseline.baseline_metrics = null;
        
        // Reset drift state
        this.driftState = {
            current_score: 0.0,
            component_scores: {
                calibration: 0.0,
                overconfidence: 0.0,
                forced_action: 0.0,
                instability: 0.0
            },
            regime: 'stable',
            recommended_mode_cap: 'trusted',
            last_evaluation: null,
            evaluation_count: 0
        };
        
        // Reset execution mode caps
        this.resetExecutionModeCap();
        
        // Clear drift history
        this.driftHistory = [];
        
        console.log('[GLOBAL DRIFT EVALUATOR] Baseline and drift monitoring reset');
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

    calculateConfidenceAccuracyGap(decisions, outcomes) {
        if (decisions.length === 0 || outcomes.length === 0) return 0;
        
        const decisionOutcomes = decisions.map(d => {
            const outcome = outcomes.find(o => o.decision_id === d.decision_id);
            return {
                confidence: d.confidence || 0,
                correct: outcome ? outcome.was_correct : false
            };
        });
        
        const avgConfidence = decisionOutcomes.reduce((sum, d) => sum + d.confidence, 0) / decisionOutcomes.length;
        const avgCorrectness = decisionOutcomes.reduce((sum, d) => sum + (d.correct ? 1 : 0), 0) / decisionOutcomes.length;
        
        return avgConfidence - avgCorrectness;
    }

    calculateThemeDistribution(decisions) {
        const distribution = {};
        decisions.forEach(d => {
            const theme = d.strategic_theme || 'unknown';
            distribution[theme] = (distribution[theme] || 0) + 1;
        });
        return distribution;
    }

    calculateThemeInstabilityConcentration(decisions) {
        const distribution = this.calculateThemeDistribution(decisions);
        const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
        
        if (total === 0) return 0;
        
        // Calculate concentration index (how concentrated themes are)
        const maxConcentration = Math.max(...Object.values(distribution));
        const concentrationIndex = maxConcentration / total;
        
        return concentrationIndex;
    }

    calculateAvgDecisionTime(performanceMetrics) {
        if (performanceMetrics.length === 0) return 0;
        
        const totalTime = performanceMetrics.reduce((sum, p) => sum + (p.decision_time || 0), 0);
        return totalTime / performanceMetrics.length;
    }

    calculateAvgLatency(performanceMetrics) {
        if (performanceMetrics.length === 0) return 0;
        
        const totalLatency = performanceMetrics.reduce((sum, p) => sum + (p.latency || 0), 0);
        return totalLatency / performanceMetrics.length;
    }

    // GLOBAL SYSTEM CONTROL

    async applyGlobalExecutionMode() {
        const regime = this.driftState.regime;
        const recommendedCap = this.driftState.recommended_mode_cap;
        
        // Apply regime-based execution mode cap
        if (this.executionModeCaps.current_cap !== recommendedCap) {
            this.setExecutionModeCap(recommendedCap, `Regime-based cap: ${regime}`);
        }
        
        console.log(`[GLOBAL DRIFT EVALUATOR] Applied global execution mode: ${this.executionModeCaps.current_cap} (regime: ${regime})`);
        
        return this.executionModeCaps.current_cap;
    }

    // MONITORING AND REPORTING

    getDriftTrends() {
        const history = this.driftHistory;
        
        if (history.length < 2) {
            return {
                trend: 'insufficient_data',
                direction: 0,
                confidence: 0
            };
        }
        
        const recent = history.slice(-10); // Last 10 evaluations
        const older = history.slice(-20, -10); // Previous 10 evaluations
        
        const recentScores = recent.map(h => h.drift_score);
        const olderScores = older.map(h => h.drift_score);
        
        // Simple trend calculation
        const trend = this.calculateTrend(
            olderScores.reduce((sum, score) => sum + score, 0) / olderScores.length,
            recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length
        );
        
        return {
            trend: trend > 0.1 ? 'improving' : trend < -0.1 ? 'degrading' : 'stable',
            direction: trend,
            confidence: Math.abs(trend),
            recent_scores: recentScores,
            older_scores: olderScores
        };
    }
}

module.exports = GlobalDriftEvaluator;
