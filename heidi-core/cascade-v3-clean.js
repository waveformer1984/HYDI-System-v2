// CASCADE AGENT v3 - Policy Override Layer
// Memory has veto power over reasoning

const fs = require('fs').promises;
const path = require('path');
const HeidiMemoryService = require('../src/services/heidi-memory-service');
const PolicyOverrideLayer = require('./policy-override-layer');
const DecisionResolver = require('./decision-resolver');
const ResolverGovernance = require('./resolver-governance');
const SystemDriftMonitor = require('./system-drift-monitor-clean');
const GlobalDriftEvaluator = require('./global-drift-evaluator');
const ExternalCalibrationAnchor = require('./external-calibration-anchor');

class CascadeEngineV3 {
    constructor() {
        this.mode = "execution";
        this.systemDefaults = {
            strategic_theme: "revenue",
            cashflow_type: "recurring",
            complexity: "medium"
        };
        
        // Confidence tracking and calibration
        this.confidenceTracker = {
            themeAccuracy: {},
            overconfidenceLog: [],
            calibrationHistory: [],
            lastCalibration: null
        };
        
        // Persistent Memory Layer
        this.memoryService = new HeidiMemoryService(
            process.env.SUPABASE_URL || 'http://localhost:54321',
            process.env.SUPABASE_ANON_KEY || 'your-anon-key'
        );
        
        // Policy Override Layer - Memory has veto power over reasoning
        this.policyOverride = new PolicyOverrideLayer(this.memoryService);
        
        // Decision Resolver - The fourth thing that ONLY does arbitration
        this.decisionResolver = new DecisionResolver();
        
        // System Drift Monitor - Monitors collective behavior over time
        this.driftMonitor = new SystemDriftMonitor();
        
        // Global Drift Evaluator - Layer 7: Meta-calibration of the entire organism over time
        this.globalDriftEvaluator = new GlobalDriftEvaluator(this.memoryService);
        
        // External Calibration Anchor - Layer 8: External reality anchor (top authority)
        this.externalCalibrationAnchor = new ExternalCalibrationAnchor(this.memoryService);
        
        // Cache for performance
        this.cache = new Map();
        this.lastUpdate = null;
        
        // System thresholds
        this.structuralHealthThreshold = 0.7;
        this.inertiaThreshold = 0.6;
        
        // Meta strategy
        this.metaStrategy = {
            focus: 'platform_ecosystem',
            target_markets: ['enterprise', 'developer_tools'],
            time_horizon: 'long_term'
        };
        
        // Decision history
        this.decisionHistory = [];
        
        // Anti-misalignment metrics
        this.antiMisalignmentMetrics = {
            structural_health: null,
            strategic_inertia: null,
            forbidden_pattern_violations: 0,
            intent_consistency_score: 0,
            meta_strategy_alignment_score: 0,
            false_optimization_warnings: 0,
            last_update: null
        };

        // Forbidden patterns for anti-misalignment
        this.forbiddenPatterns = [
            {
                id: 'revenue_only_focus',
                name: 'Revenue-Only Focus',
                description: 'Tasks that prioritize revenue over strategic positioning',
                pattern: (task, allTasks) => {
                    const revenueKeywords = ['revenue', 'profit', 'monetization', 'sales'];
                    const hasRevenueKeywords = revenueKeywords.some(keyword => 
                        task.title.toLowerCase().includes(keyword) || 
                        task.description.toLowerCase().includes(keyword)
                    );
                    const lowStrategicScore = (task.advanced_score?.strategic_coherence || 0) < 0.5;
                    return hasRevenueKeywords && lowStrategicScore;
                },
                penalty: 0.3
            },
            {
                id: 'short_term_optimization',
                name: 'Short-Term Optimization',
                description: 'Tasks that optimize for immediate gains at expense of long-term strategy',
                pattern: (task, allTasks) => {
                    const quickWinKeywords = ['quick', 'fast', 'immediate', 'urgent'];
                    const hasQuickWinKeywords = quickWinKeywords.some(keyword => 
                        task.title.toLowerCase().includes(keyword)
                    );
                    const longTermNegative = task.strategic_debt?.score > 0.7;
                    return hasQuickWinKeywords && longTermNegative;
                },
                penalty: 0.4
            },
            {
                id: 'single_point_failure',
                name: 'Single Point Failure Risk',
                description: 'Tasks that create critical dependencies without backup plans',
                pattern: (task, allTasks) => {
                    const highDependency = task.dependency_risk > 0.8;
                    const lowReversibility = task.reversibility === 'low';
                    const noAlternative = !task.description.toLowerCase().includes('alternative') && 
                                        !task.description.toLowerCase().includes('backup');
                    return highDependency && lowReversibility && noAlternative;
                },
                penalty: 0.5
            }
        ];
    }

    // CORE THEME NORMALIZATION (guarantees state)
    normalizeTaskWithTheme(task) {
        let strategicTheme = task.strategic_theme;
        let confidence = 1.0;
        let source = 'task';
        let warnings = [];

        // If no theme provided, infer it
        if (!strategicTheme) {
            const inference = this.mapTaskToTheme(task);
            strategicTheme = inference.theme;
            confidence = inference.confidence;
            source = 'inference';
            
            if (confidence < 0.7) {
                warnings.push(`Low confidence theme inference: ${confidence.toFixed(2)}`);
            }
        }

        // If still no theme, use system default
        if (!strategicTheme) {
            strategicTheme = this.systemDefaults.strategic_theme;
            confidence = 0.5; // Lower confidence for defaults
            source = 'default';
            warnings.push('Using default strategic theme');
        }

        return {
            ...task,
            strategic_theme: strategicTheme,
            strategic_theme_confidence: confidence,
            strategic_theme_source: source,
            theme_warnings: warnings
        };
    }

    // Theme inference with confidence scoring
    mapTaskToTheme(task) {
        const themeKeywords = {
            'AI Infrastructure Revenue': ['ai', 'infrastructure', 'compute', 'model', 'training', 'inference'],
            'Industrial Manufacturing Monetization': ['manufacturing', 'industrial', 'factory', 'production', 'supply chain'],
            'Music/IP Asset Expansion': ['music', 'ip', 'intellectual property', 'licensing', 'royalties', 'content'],
            'Core AI / SaaS Revenue Systems': ['saas', 'subscription', 'recurring', 'mrr', 'arr', 'churn']
        };

        const text = (task.title + ' ' + task.description).toLowerCase();
        let bestTheme = null;
        let bestScore = 0;

        for (const [theme, keywords] of Object.entries(themeKeywords)) {
            const matches = keywords.filter(keyword => text.includes(keyword)).length;
            const score = matches / keywords.length;
            
            if (score > bestScore) {
                bestScore = score;
                bestTheme = theme;
            }
        }

        return {
            theme: bestTheme || this.systemDefaults.strategic_theme,
            confidence: Math.min(0.9, bestScore + 0.3) // Boost minimum confidence
        };
    }

    // BEHAVIOR-ADAPTIVE GATING SYSTEM
    computeEffectiveConfidence(task) {
        const themeConfidence = task.strategic_theme_confidence || 0.5;
        const theme = task.strategic_theme;
        
        // Get historical accuracy for this theme
        const historicalAccuracy = this.getHistoricalThemeAccuracy(theme);
        
        // Combine current confidence with historical reliability
        let effectiveConfidence = themeConfidence;
        
        // Downgrade confidence if theme is historically unreliable
        if (historicalAccuracy.rollingAccuracy < 0.6) {
            const downgradeFactor = 0.6 + (historicalAccuracy.rollingAccuracy * 0.4);
            effectiveConfidence *= downgradeFactor;
            
            this.flagThemeAsUnstable(theme, historicalAccuracy.rollingAccuracy);
        }
        
        // Additional penalty for themes with repeated overconfidence
        const overconfidencePenalty = this.getOverconfidencePenalty(theme);
        effectiveConfidence *= (1 - overconfidencePenalty);
        
        return Math.max(0.1, Math.min(1.0, effectiveConfidence));
    }

    getHistoricalThemeAccuracy(theme) {
        const accuracy = this.confidenceTracker.themeAccuracy[theme];
        if (!accuracy) {
            return { rollingAccuracy: 0.5, correct: 0, incorrect: 0 };
        }
        
        const total = accuracy.correct + accuracy.incorrect || accuracy.predictions;
        const rollingAccuracy = total > 0 ? accuracy.correct / total : 0.5;
        
        return {
            rollingAccuracy,
            correct: accuracy.correct || 0,
            incorrect: accuracy.incorrect || (total - accuracy.correct) || 0
        };
    }

    getOverconfidencePenalty(theme) {
        const recentOverconfidence = this.confidenceTracker.overconfidenceLog
            .filter(event => event.theme === theme)
            .slice(-5);
        
        if (recentOverconfidence.length >= 3) {
            return 0.2;
        } else if (recentOverconfidence.length >= 2) {
            return 0.1;
        }
        
        return 0;
    }

    flagThemeAsUnstable(theme, accuracy) {
        console.log(`[UNSTABLE THEME] "${theme}" has low historical accuracy: ${(accuracy * 100).toFixed(1)}%`);
        this.unstableThemes = this.unstableThemes || new Set();
        this.unstableThemes.add(theme);
    }

    determineExecutionMode(task) {
        const effectiveConfidence = this.computeEffectiveConfidence(task);
        const theme = task.strategic_theme;
        const historicalAccuracy = this.getHistoricalThemeAccuracy(theme);
        
        // HIGH CONFIDENCE (≥ 0.75)
        if (effectiveConfidence >= 0.75) {
            return {
                mode: 'trusted',
                effective_confidence: effectiveConfidence,
                historical_accuracy: historicalAccuracy.rollingAccuracy,
                adaptations: [],
                notes: 'Trusted execution - full automation allowed'
            };
        }
        
        // MEDIUM CONFIDENCE (0.5 – 0.74)
        if (effectiveConfidence >= 0.5) {
            return {
                mode: 'bounded',
                effective_confidence: effectiveConfidence,
                historical_accuracy: historicalAccuracy.rollingAccuracy,
                adaptations: ['reduce_scope', 'avoid_irreversible'],
                notes: 'Bounded execution - scope reduced, irreversible actions avoided'
            };
        }
        
        // LOW CONFIDENCE (< 0.5)
        return {
            mode: 'gated',
            effective_confidence: effectiveConfidence,
            historical_accuracy: historicalAccuracy.rollingAccuracy,
            adaptations: ['request_clarification', 'simulate_only'],
            notes: 'Gated execution - clarification required or simulation only'
        };
    }

    // CONFIDENCE CALIBRATION SYSTEM
    async recordThemePrediction(taskId, theme, confidence, source) {
        const prediction = {
            taskId,
            theme,
            confidence,
            source,
            timestamp: new Date().toISOString(),
            outcome: null,
            calibrated: false
        };
        
        // Track locally
        if (!this.confidenceTracker.themeAccuracy[theme]) {
            this.confidenceTracker.themeAccuracy[theme] = {
                predictions: 0,
                correct: 0,
                avgConfidence: 0,
                confidenceSum: 0,
                accuracy: 0
            };
        }
        
        this.confidenceTracker.themeAccuracy[theme].predictions++;
        this.confidenceTracker.themeAccuracy[theme].confidenceSum += confidence;
        this.confidenceTracker.themeAccuracy[theme].avgConfidence = 
            this.confidenceTracker.themeAccuracy[theme].confidenceSum / 
            this.confidenceTracker.themeAccuracy[theme].predictions;
        
        // Store in persistent memory
        try {
            await this.memoryService.recordThemePrediction(taskId, theme, confidence, source);
        } catch (error) {
            console.warn('[MEMORY] Failed to store prediction in persistent layer:', error.message);
        }
        
        return prediction;
    }

    async recordThemeOutcome(taskId, wasCorrect, actualTheme = null) {
        const themeAccuracy = this.confidenceTracker.themeAccuracy;
        let foundPrediction = null;
        
        for (const [theme, stats] of Object.entries(themeAccuracy)) {
            if (stats.predictions > 0) {
                foundPrediction = { theme, confidence: stats.avgConfidence };
                break;
            }
        }
        
        if (!foundPrediction) return null;
        
        const { theme, confidence } = foundPrediction;
        const stats = themeAccuracy[theme];
        
        // Record outcome
        if (wasCorrect) {
            stats.correct = (stats.correct || 0) + 1;
        } else {
            stats.incorrect = (stats.incorrect || 0) + 1;
        }
        
        stats.accuracy = stats.correct / (stats.correct + stats.incorrect);
        
        // Check for overconfidence
        const overconfidenceDetected = confidence > 0.75 && !wasCorrect;
        if (overconfidenceDetected) {
            const overconfidenceEvent = {
                taskId,
                theme,
                confidence,
                outcome: 'wrong',
                severity: confidence > 0.9 ? 'high' : 'medium',
                timestamp: new Date().toISOString()
            };
            
            this.confidenceTracker.overconfidenceLog.push(overconfidenceEvent);
            
            if (this.confidenceTracker.overconfidenceLog.length > 50) {
                this.confidenceTracker.overconfidenceLog = this.confidenceTracker.overconfidenceLog.slice(-50);
            }
            
            console.log(`[OVERCONFIDENCE] Task ${taskId}: ${confidence.toFixed(2)} confidence, wrong theme "${theme}"`);
        }
        
        // Store outcome in persistent memory
        try {
            await this.memoryService.recordThemeOutcome(taskId, actualTheme || theme, wasCorrect);
        } catch (error) {
            console.warn('[MEMORY] Failed to store outcome in persistent layer:', error.message);
        }
        
        return {
            theme,
            confidence,
            wasCorrect,
            calibratedAccuracy: stats.accuracy,
            overconfidenceDetected
        };
    }

    // MAIN PROCESSING FUNCTION WITH POLICY OVERRIDE
    async reprioritizeTasks() {
        const revenueData = await this.loadRevenueTasks();
        const enhancedTasks = [];
        
        // Load decision history
        await this.loadDecisionHistory();
        
        // Process each task through policy override
        for (const task of revenueData.tasks) {
            // STEP 1: Normalize task and guarantee state
            const normalizedTask = this.normalizeTaskWithTheme(task);
            
            // STEP 1.5: Record prediction for confidence tracking
            await this.recordThemePrediction(
                task.id,
                normalizedTask.strategic_theme,
                normalizedTask.strategic_theme_confidence,
                normalizedTask.strategic_theme_source
            );
            
            // STEP 2: Gather authority signals
            const cascadeOutput = {
                strategic_theme: normalizedTask.strategic_theme,
                strategic_theme_confidence: normalizedTask.strategic_theme_confidence,
                v3_adjusted_score: this.calculateAdvancedScore(normalizedTask)
            };
            
            const memorySignal = await this.memoryService.getThemeAccuracy(normalizedTask.strategic_theme);
            memorySignal.theme = normalizedTask.strategic_theme;
            
            const policyConstraints = await this.policyOverride.checkExecutionAuthority(normalizedTask);
            
            // STEP 3: Decision Arbitration - The referee resolves conflicts
            const arbitration = await this.decisionResolver.resolveDecision(cascadeOutput, memorySignal, policyConstraints);
            
            // STEP 4: Behavior-adaptive execution mode determination (only if authorized by arbitration)
            const executionMode = arbitration.final_action === 'proceed' ? 
                this.determineExecutionMode(normalizedTask) : 
                {
                    mode: 'arbitration_blocked',
                    effective_confidence: 0.0,
                    historical_accuracy: 0.0,
                    adaptations: ['arbitration_veto'],
                    notes: arbitration.reasoning || 'Execution blocked by decision arbitration'
                };
            
            // STEP 5: Processing only if authorized by arbitration
            let advancedScore = 0;
            let v3AdjustedScore = 0;
            
            if (arbitration.final_action === 'proceed') {
                advancedScore = this.calculateAdvancedScore(normalizedTask);
                v3AdjustedScore = Math.round(advancedScore * (executionMode.effective_confidence || 0.5));
            }
            
            // Determine status
            const status = arbitration.final_action === 'proceed' ? 'active' : 'arbitration_blocked';
            
            enhancedTasks.push({
                ...task,
                // v1/v2 fields
                advanced_score: advancedScore,
                strategic_theme: normalizedTask.strategic_theme,
                strategic_theme_confidence: normalizedTask.strategic_theme_confidence,
                strategic_theme_source: normalizedTask.strategic_theme_source,
                theme_warnings: normalizedTask.theme_warnings,
                cashflow_type: this.classifyCashflowType(normalizedTask),
                // DECISION ARBITRATION OUTPUT REQUIREMENTS
                arbitration: {
                    final_action: arbitration.final_action,
                    winning_authority: arbitration.winning_authority,
                    reasoning: arbitration.reasoning,
                    confidence: arbitration.confidence,
                    conflict_resolution: arbitration.conflict_resolution,
                    conflicts_detected: arbitration.conflicts_detected || []
                },
                policy_authority: {
                    authorized: policyConstraints.authorized,
                    action: policyConstraints.action,
                    reason: policyConstraints.reason,
                    message: policyConstraints.message,
                    trust_score: policyConstraints.trust_score
                },
                // BEHAVIOR-ADAPTIVE OUTPUT REQUIREMENTS
                execution_mode: executionMode.mode,
                strategic_theme_info: {
                    value: normalizedTask.strategic_theme,
                    confidence: normalizedTask.strategic_theme_confidence,
                    source: normalizedTask.strategic_theme_source
                },
                historical_accuracy: executionMode.historical_accuracy,
                effective_confidence: executionMode.effective_confidence,
                adaptation_notes: executionMode.notes,
                adaptations: executionMode.adaptations,
                v3_adjusted_score: v3AdjustedScore,
                status,
                confidence_tracked: true
            });
        }
        
        // Record all decisions for drift monitoring
        const now = Date.now();
        enhancedTasks.forEach(task => {
            this.driftMonitor.recordDecision(
                task.arbitration,
                null, // Outcome will be recorded separately
                task.arbitration.winning_authority === 'governance' ? task.arbitration : null,
                task.arbitration.winning_authority === 'execution_bias' ? task.arbitration : null,
                {
                    decision_time: now - (now - 1000), // Approximate
                    arbitration_time: 100,
                    governance_time: 50,
                    bias_time: 25
                }
            );
        });
        
        // Apply global drift evaluation (Layer 7)
        const globalDriftEvaluation = await this.globalDriftEvaluator.evaluateGlobalDrift();
        
        // Apply external calibration anchor (Layer 8) - Top authority
        const externalAlignment = await this.externalCalibrationAnchor.evaluateExternalAlignment(
            globalDriftEvaluation.drift_score.drift_score || 0
        );
        
        // Determine final execution mode based on Layer 8 authority
        let finalExecutionMode = this.globalDriftEvaluator.getRegimeBasedExecutionMode();
        
        // Layer 8 can override Layer 7 but not Policy
        if (externalAlignment.corrective_actions.action !== 'maintain') {
            if (externalAlignment.corrective_actions.system_mode) {
                finalExecutionMode = externalAlignment.corrective_actions.system_mode;
            }
            
            // Apply Layer 8 corrective actions
            enhancedTasks.forEach(task => {
                if (task.execution_mode.mode === 'trusted' || task.execution_mode.mode === finalExecutionMode) {
                    task.execution_mode.mode = finalExecutionMode;
                    task.execution_mode.external_alignment_cap = true;
                    task.execution_mode.cap_reason = externalAlignment.corrective_actions.reason;
                    task.execution_mode.cap_authority = 'layer8_external_anchor';
                }
            });
        } else {
            // Apply Layer 7 caps if Layer 8 doesn't intervene
            enhancedTasks.forEach(task => {
                if (task.execution_mode.mode === 'trusted' && finalExecutionMode === 'gated') {
                    task.execution_mode.mode = 'gated';
                    task.execution_mode.global_drift_cap = true;
                    task.execution_mode.cap_reason = globalDriftEvaluation.adaptation.reason;
                    task.execution_mode.cap_authority = 'layer7_internal_stability';
                } else if (task.execution_mode.mode === 'trusted' && finalExecutionMode === 'bounded') {
                    task.execution_mode.mode = 'bounded';
                    task.execution_mode.global_drift_cap = true;
                    task.execution_mode.cap_reason = globalDriftEvaluation.adaptation.reason;
                    task.execution_mode.cap_authority = 'layer7_internal_stability';
                }
            });
        }
        
        // Sort by v3-adjusted score
        enhancedTasks.sort((a, b) => b.v3_adjusted_score - a.v3_adjusted_score);
        
        // Cache results
        this.lastUpdate = new Date().toISOString();
        this.cache.set('enhanced_tasks_v3', enhancedTasks);
        
        return {
            tasks: enhancedTasks,
            theme_confidence_metrics: this.getThemeConfidenceMetrics(),
            strategic_themes: this.getThemeDistribution(enhancedTasks),
            metadata: {
                version: 'v3',
                mode: this.mode,
                last_update: this.lastUpdate,
                total_tasks: enhancedTasks.length,
                authorized_tasks: enhancedTasks.filter(t => t.policy_authority.authorized).length,
                blocked_tasks: enhancedTasks.filter(t => !t.policy_authority.authorized).length
            }
        };
    }

    // HELPER METHODS
    async loadRevenueTasks() {
        try {
            const data = await fs.readFile(path.join(__dirname, 'revenue-tasks.json'), 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('[CASCADE v3] Error loading revenue tasks:', error);
            return { tasks: [] };
        }
    }

    async loadDecisionHistory() {
        try {
            const data = await fs.readFile(path.join(__dirname, 'decision-history.json'), 'utf8');
            this.decisionHistory = JSON.parse(data);
        } catch (error) {
            console.log('[CASCADE v3] No decision history found, starting fresh');
            this.decisionHistory = [];
        }
    }

    calculateAdvancedScore(task) {
        // Simplified scoring for demonstration
        return Math.random() * 100;
    }

    classifyCashflowType(task) {
        const text = (task.title + ' ' + task.description).toLowerCase();
        
        if (text.includes('subscription') || text.includes('recurring')) {
            return 'recurring';
        } else if (text.includes('one-time') || text.includes('single')) {
            return 'one-time';
        }
        
        return 'hybrid';
    }

    getThemeConfidenceMetrics() {
        const recentWarnings = this.themeFallbackWarnings?.slice(-20) || [];
        const defaultUsage = recentWarnings.filter(w => w.source === 'default').length;
        const lowConfidenceUsage = recentWarnings.filter(w => w.confidence < 0.5).length;
        
        return {
            total_warnings: this.themeFallbackWarnings?.length || 0,
            recent_default_usage: defaultUsage,
            recent_low_confidence: lowConfidenceUsage,
            default_overuse_alert: defaultUsage > 5,
            confidence_health: defaultUsage > 5 ? 'degraded' : 'healthy'
        };
    }

    getThemeDistribution(tasks) {
        const distribution = {};
        tasks.forEach(task => {
            const theme = task.strategic_theme;
            distribution[theme] = (distribution[theme] || 0) + 1;
        });
        return distribution;
    }

    // Mode management
    setMode(newMode) {
        if (['execution', 'exploration', 'optimization'].includes(newMode)) {
            this.mode = newMode;
            console.log(`[CASCADE v3] Mode changed to: ${newMode}`);
        } else {
            throw new Error(`Invalid mode: ${newMode}`);
        }
    }

    getMode() {
        return this.mode;
    }
}

module.exports = CascadeEngineV3;
