// CASCADE AGENT v3 - Anti-Misalignment Layer
// Prevents profitable but strategically dangerous decisions

const fs = require('fs').promises;
const path = require('path');
const HeidiMemoryService = require('../src/services/heidi-memory-service');
const PolicyOverrideLayer = require('./policy-override-layer');

class CascadeEngineV3 {
    constructor() {
        this.mode = "execution";
        this.systemDefaults = {
            strategic_theme: "revenue", // System-level default
            cashflow_type: "recurring",
            complexity: "medium"
        };
        
        // Confidence tracking and calibration
        this.confidenceTracker = {
            themeAccuracy: {}, // theme -> {predictions, correct, avgConfidence}
            overconfidenceLog: [], // Track high-confidence failures
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
        this.weights = {
            profit_potential: 0.12,
            time_to_revenue: 0.08,
            complexity: 0.06,
            defensibility: 0.12,
            scalability: 0.10,
            dependency_risk: 0.06,
            cashflow_type: 0.06,
            strategic_coherence: 0.12,
            cross_division_impact: 0.08,
            anti_misalignment: 0.15,
            optionality: 0.05
        };
        
        // v3 Anti-Misalignment Layer
        this.forbiddenPatterns = [
            {
                id: 'revenue_without_defensibility',
                name: 'Revenue Without Defensibility',
                pattern: (task) => task.profit_potential === 'very_high' && task.advanced_score?.defensibility < 50,
                penalty: 0.7,
                reason: 'High revenue with no defensibility creates competitive vulnerability'
            },
            {
                id: 'dependency_heavy_singles',
                name: 'Dependency-Heavy Single-Point SaaS',
                pattern: (task) => task.category.includes('SaaS') && task.strategic_debt?.score > 0.8,
                penalty: 0.6,
                reason: 'Single-point SaaS with high dependencies creates systemic risk'
            },
            {
                id: 'high_complexity_low_diff',
                name: 'High Complexity / Low Differentiation',
                pattern: (task) => task.complexity === 'high' && task.advanced_score?.defensibility < 60,
                penalty: 0.5,
                reason: 'Complex systems without differentiation are resource traps'
            },
            {
                id: 'platform_lockin_without_ownership',
                name: 'Platform Lock-in Risk Without Ownership',
                pattern: (task) => task.title.includes('platform') && task.advanced_score?.defensibility < 70,
                penalty: 0.6,
                reason: 'Platform plays without ownership create vendor lock-in risk'
            },
            {
                id: 'duplicate_monetization',
                name: 'Duplicate Monetization Across Divisions',
                pattern: (task, allTasks) => {
                    const similarTasks = allTasks.filter(t => 
                        t.category === task.category && 
                        t.profit_potential === task.profit_potential &&
                        t.id !== task.id
                    );
                    return similarTasks.length > 2;
                },
                penalty: 0.4,
                reason: 'Duplicate monetization creates internal competition'
            }
        ];
        
        this.strategicMemoryWindow = {
            high_influence_days: 7,
            medium_influence_days: 30,
            core_strategy_multiplier: 3.0
        };
        
        this.decisionHistory = [];
        this.metaStrategy = "Transition ProtoForge from service company → platform ecosystem";
        this.structuralHealthThreshold = 70;
        this.inertiaThreshold = 0.8;
        
        this.cache = new Map();
        this.lastUpdate = null;
        this.antiMisalignmentMetrics = null;
    }

    async loadRevenueTasks() {
        try {
            const data = await fs.readFile(path.join(__dirname, 'revenue-tasks.json'), 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to load revenue tasks:', error);
            return { tasks: [] };
        }
    }

    // 0. TASK NORMALIZATION WITH THEME CONFIDENCE
    normalizeTaskWithTheme(task) {
        const themeResolution = this.resolveStrategicThemeWithConfidence(task);
        
        // Log theme origin drift for self-awareness
        if (themeResolution.source === 'default') {
            this.logThemeWarning("THEME_FALLBACK_OVERUSE", task.id, themeResolution);
        }
        
        return {
            ...task,
            strategic_theme: themeResolution.value,
            strategic_theme_confidence: themeResolution.confidence,
            strategic_theme_source: themeResolution.source,
            theme_warnings: themeResolution.warnings
        };
    }

    resolveStrategicThemeWithConfidence(task) {
        // Method 1: Task explicitly provides theme (highest confidence)
        if (task.strategic_theme) {
            return {
                value: task.strategic_theme,
                confidence: 1.0,
                source: 'task',
                warnings: []
            };
        }
        
        // Method 2: Infer from task content (medium confidence)
        const inferredTheme = this.mapTaskToTheme(task);
        if (inferredTheme && inferredTheme !== this.systemDefaults.strategic_theme) {
            const confidence = this.calculateThemeInferenceConfidence(task, inferredTheme);
            return {
                value: inferredTheme,
                confidence: confidence,
                source: 'inference',
                warnings: confidence < 0.7 ? ['Low confidence theme inference'] : []
            };
        }
        
        // Method 3: System default (lowest confidence)
        return {
            value: this.systemDefaults.strategic_theme,
            confidence: 0.3,
            source: 'default',
            warnings: ['Using default strategic theme - consider explicit theme assignment']
        };
    }

    calculateThemeInferenceConfidence(task, inferredTheme) {
        let confidence = 0.5; // Base inference confidence
        
        // Boost confidence for clear category matches
        const categoryThemeMap = {
            'Core AI / SaaS Revenue Systems': 'AI Infrastructure Revenue',
            'HEIDI / AI PRODUCTIZATION': 'AI Infrastructure Revenue',
            'Music / Waveformer Revenue Engine': 'Music/IP Asset Expansion',
            '3D Printing / Manufacturing Revenue': 'Industrial Manufacturing Monetization'
        };
        
        if (categoryThemeMap[task.category] === inferredTheme) {
            confidence += 0.3;
        }
        
        // Boost confidence for keyword matches in title/description
        const themeKeywords = {
            'AI Infrastructure Revenue': ['ai', 'api', 'saas', 'platform', 'infrastructure'],
            'Industrial Manufacturing Monetization': ['3d', 'printing', 'manufacturing', 'hardware', 'catalog'],
            'Music/IP Asset Expansion': ['music', 'beat', 'licensing', 'royalty', 'marketplace'],
            'Automation SaaS Ecosystem': ['automation', 'ecosystem', 'integration', 'workflow']
        };
        
        const text = (task.title + ' ' + task.description).toLowerCase();
        const keywords = themeKeywords[inferredTheme] || [];
        const keywordMatches = keywords.filter(keyword => text.includes(keyword));
        
        confidence += (keywordMatches.length / Math.max(keywords.length, 1)) * 0.2;
        
        return Math.min(1.0, confidence);
    }

    logThemeWarning(warningType, taskId, themeResolution) {
        const warning = {
            type: warningType,
            task_id: taskId,
            theme_used: themeResolution.value,
            confidence: themeResolution.confidence,
            source: themeResolution.source,
            timestamp: new Date().toISOString()
        };
        
        // Track fallback overuse patterns
        this.themeFallbackWarnings = this.themeFallbackWarnings || [];
        this.themeFallbackWarnings.push(warning);
        
        // Keep only last 50 warnings
        if (this.themeFallbackWarnings.length > 50) {
            this.themeFallbackWarnings = this.themeFallbackWarnings.slice(-50);
        }
        
        console.log(`[THEME WARNING] ${warningType}: Task ${taskId} using ${themeResolution.source} theme "${themeResolution.value}" (confidence: ${themeResolution.confidence})`);
    }

    getThemeConfidenceMetrics() {
        if (!this.themeFallbackWarnings) return { total_warnings: 0 };
        
        const recentWarnings = this.themeFallbackWarnings.slice(-20);
        const defaultUsage = recentWarnings.filter(w => w.source === 'default').length;
        const lowConfidenceUsage = recentWarnings.filter(w => w.confidence < 0.5).length;
        
        return {
            total_warnings: this.themeFallbackWarnings.length,
            recent_default_usage: defaultUsage,
            recent_low_confidence: lowConfidenceUsage,
            default_overuse_alert: defaultUsage > 5,
            confidence_health: defaultUsage > 5 ? 'degraded' : 'healthy',
            calibration_metrics: this.getCalibrationMetrics()
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
            outcome: null, // Will be set later
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
            // Continue with local tracking - don't fail the operation
        }
        
        return prediction;
    }

    async recordThemeOutcome(taskId, wasCorrect, actualTheme = null) {
        // Find the prediction
        const themeAccuracy = this.confidenceTracker.themeAccuracy;
        let foundPrediction = null;
        
        for (const [theme, stats] of Object.entries(themeAccuracy)) {
            // This is simplified - in practice you'd store predictions separately
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
            
            // Keep only last 50 overconfidence events
            if (this.confidenceTracker.overconfidenceLog.length > 50) {
                this.confidenceTracker.overconfidenceLog = this.confidenceTracker.overconfidenceLog.slice(-50);
            }
            
            console.log(`[OVERCONFIDENCE] Task ${taskId}: ${confidence.toFixed(2)} confidence, wrong theme "${theme}"`);
        }
        
        // Calibrate confidence based on outcome
        this.calibrateConfidence(theme, confidence, wasCorrect);
        
        // Store outcome in persistent memory
        try {
            await this.memoryService.recordThemeOutcome(taskId, actualTheme || theme, wasCorrect);
        } catch (error) {
            console.warn('[MEMORY] Failed to store outcome in persistent layer:', error.message);
        }
        
        // REFLECTION UPGRADE: Evaluate system behavior
        const reflection = this.evaluateTaskExecution(taskId, theme, confidence, wasCorrect, overconfidenceDetected);
        
        // Store reflection in persistent memory
        try {
            await this.memoryService.storeReflection(reflection);
        } catch (error) {
            console.warn('[MEMORY] Failed to store reflection in persistent layer:', error.message);
        }
        
        // Check for system misalignment
        const misalignmentDetected = this.detectSystemMisalignment();
        
        return {
            theme,
            confidence,
            wasCorrect,
            calibratedAccuracy: stats.accuracy,
            overconfidenceDetected,
            reflection,
            misalignmentDetected
        };
    }

    // REFLECTION UPGRADE SYSTEM
    evaluateTaskExecution(taskId, theme, confidence, wasCorrect, overconfidenceDetected) {
        const reflection = {
            taskId,
            theme,
            confidence,
            wasCorrect,
            overconfidenceDetected,
            timestamp: new Date().toISOString(),
            evaluations: {}
        };
        
        // Was confidence justified?
        reflection.evaluations.confidence_justified = this.wasConfidenceJustified(confidence, wasCorrect);
        
        // Did gating activate appropriately?
        reflection.evaluations.gating_appropriate = this.wasGatingAppropriate(taskId, confidence, wasCorrect);
        
        // Did historical accuracy influence behavior?
        reflection.evaluations.historical_influence = this.didHistoricalAccuracyInfluenceBehavior(theme, confidence);
        
        // Was the system overly confident?
        reflection.evaluations.overconfident = overconfidenceDetected;
        
        // Store in persistent memory
        this.storeReflection(reflection);
        
        return reflection;
    }

    wasConfidenceJustified(confidence, wasCorrect) {
        if (wasCorrect) {
            return confidence >= 0.5; // Correct predictions should have reasonable confidence
        } else {
            return confidence <= 0.8; // Wrong predictions shouldn't have been too confident
        }
    }

    wasGatingAppropriate(taskId, confidence, wasCorrect) {
        // This would need access to the gating decision made during execution
        // For now, return a simplified evaluation
        if (confidence < 0.5 && !wasCorrect) {
            return true; // Low confidence for wrong prediction = appropriate
        }
        if (confidence >= 0.75 && wasCorrect) {
            return true; // High confidence for correct prediction = appropriate
        }
        return 'mixed'; // Could be better
    }

    didHistoricalAccuracyInfluenceBehavior(theme, confidence) {
        const historicalAccuracy = this.getHistoricalThemeAccuracy(theme);
        
        // Check if historical accuracy was considered in confidence calculation
        if (historicalAccuracy.rollingAccuracy < 0.6 && confidence < 0.75) {
            return true; // Low historical accuracy led to reduced confidence
        }
        
        return false; // Historical accuracy may not have influenced behavior
    }

    storeReflection(reflection) {
        // Store reflections for persistent memory
        this.reflections = this.reflections || [];
        this.reflections.push(reflection);
        
        // Keep only last 100 reflections
        if (this.reflections.length > 100) {
            this.reflections = this.reflections.slice(-100);
        }
        
        console.log(`[REFLECTION] Task ${reflection.taskId}: confidence justified=${reflection.evaluations.confidence_justified}, overconfident=${reflection.evaluations.overconfident}`);
    }

    detectSystemMisalignment() {
        const recentReflections = this.reflections?.slice(-20) || [];
        
        // Check for high-confidence errors without confidence decay
        const highConfidenceErrors = recentReflections.filter(r => 
            r.evaluations.overconfident && !r.evaluations.confidence_justified
        );
        
        // Check for low-confidence tasks being executed fully
        const lowConfidenceExecutions = recentReflections.filter(r => 
            r.confidence < 0.5 && r.evaluations.gating_appropriate === false
        );
        
        // Check for gating logic not activating
        const missedGating = recentReflections.filter(r => 
            r.confidence < 0.5 && r.evaluations.gating_appropriate !== true
        );
        
        const misalignmentDetected = highConfidenceErrors.length > 3 || 
                                   lowConfidenceExecutions.length > 2 || 
                                   missedGating.length > 3;
        
        if (misalignmentDetected) {
            const misalignmentEvent = {
                type: 'SYSTEM_MISALIGNMENT',
                high_confidence_errors: highConfidenceErrors.length,
                low_confidence_executions: lowConfidenceExecutions.length,
                missed_gating_opportunities: missedGating.length,
                timestamp: new Date().toISOString(),
                severity: highConfidenceErrors.length > 5 ? 'high' : 'medium'
            };
            
            this.logSystemMisalignment(misalignmentEvent);
        }
        
        return misalignmentDetected;
    }

    async logSystemMisalignment(event) {
        console.error(`[SYSTEM MISALIGNMENT] ${event.type}:`);
        console.error(`  High confidence errors: ${event.high_confidence_errors}`);
        console.error(`  Low confidence executions: ${event.low_confidence_executions}`);
        console.error(`  Missed gating: ${event.missed_gating_opportunities}`);
        console.error(`  Severity: ${event.severity}`);
        
        // Store misalignment events locally
        this.misalignmentEvents = this.misalignmentEvents || [];
        this.misalignmentEvents.push(event);
        
        // Keep only last 20 misalignment events
        if (this.misalignmentEvents.length > 20) {
            this.misalignmentEvents = this.misalignmentEvents.slice(-20);
        }
        
        // Store in persistent memory
        try {
            await this.memoryService.logSystemMisalignment(event);
        } catch (error) {
            console.warn('[MEMORY] Failed to log misalignment in persistent layer:', error.message);
        }
    }

    calibrateConfidence(theme, predictedConfidence, wasCorrect) {
        const stats = this.confidenceTracker.themeAccuracy[theme];
        if (!stats) return;
        
        // Apply learning rate
        const learningRate = 0.1;
        
        if (wasCorrect) {
            // Reinforce correct predictions slightly
            stats.avgConfidence = Math.min(1.0, stats.avgConfidence + (0.01 * learningRate));
        } else {
            // Penalize wrong predictions more strongly
            stats.avgConfidence = Math.max(0.1, stats.avgConfidence * (1 - learningRate));
        }
        
        // Record calibration event
        const calibrationEvent = {
            theme,
            oldConfidence: predictedConfidence,
            newConfidence: stats.avgConfidence,
            wasCorrect,
            timestamp: new Date().toISOString()
        };
        
        this.confidenceTracker.calibrationHistory.push(calibrationEvent);
        
        // Keep only last 100 calibration events
        if (this.confidenceTracker.calibrationHistory.length > 100) {
            this.confidenceTracker.calibrationHistory = this.confidenceTracker.calibrationHistory.slice(-100);
        }
        
        this.confidenceTracker.lastCalibration = new Date().toISOString();
    }

    getCalibrationMetrics() {
        const themeAccuracy = this.confidenceTracker.themeAccuracy;
        const recentOverconfidence = this.confidenceTracker.overconfidenceLog.slice(-10);
        
        const totalPredictions = Object.values(themeAccuracy).reduce((sum, stats) => sum + stats.predictions, 0);
        const totalCorrect = Object.values(themeAccuracy).reduce((sum, stats) => sum + stats.correct, 0);
        const overallAccuracy = totalPredictions > 0 ? totalCorrect / totalPredictions : 0;
        
        // Calculate confidence vs accuracy correlation
        let confidenceAccuracyGap = 0;
        let themeCount = 0;
        
        for (const [theme, stats] of Object.entries(themeAccuracy)) {
            if (stats.predictions >= 3) { // Only consider themes with enough data
                confidenceAccuracyGap += Math.abs(stats.avgConfidence - stats.accuracy);
                themeCount++;
            }
        }
        
        const avgGap = themeCount > 0 ? confidenceAccuracyGap / themeCount : 0;
        
        return {
            total_predictions: totalPredictions,
            overall_accuracy: overallAccuracy,
            avg_confidence_accuracy_gap: avgGap,
            calibration_health: avgGap < 0.2 ? 'excellent' : avgGap < 0.3 ? 'good' : 'needs_improvement',
            recent_overconfidence_events: recentOverconfidence.length,
            themes_calibrated: Object.keys(themeAccuracy).length,
            last_calibration: this.confidenceTracker.lastCalibration
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
            const downgradeFactor = 0.6 + (historicalAccuracy.rollingAccuracy * 0.4); // 0.6-1.0 range
            effectiveConfidence *= downgradeFactor;
            
            // Flag theme as unstable
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
            return { rollingAccuracy: 0.5, correct: 0, incorrect: 0 }; // Default assumption
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
            .slice(-5); // Last 5 events
        
        if (recentOverconfidence.length >= 3) {
            return 0.2; // 20% penalty for repeated overconfidence
        } else if (recentOverconfidence.length >= 2) {
            return 0.1; // 10% penalty
        }
        
        return 0;
    }

    flagThemeAsUnstable(theme, accuracy) {
        console.log(`[UNSTABLE THEME] "${theme}" has low historical accuracy: ${(accuracy * 100).toFixed(1)}%`);
        
        // Track unstable themes
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

    shouldGateExecution(task) {
        const executionMode = this.determineExecutionMode(task);
        
        return {
            gated: executionMode.mode === 'gated',
            mode: executionMode.mode,
            effective_confidence: executionMode.effective_confidence,
            historical_accuracy: executionMode.historical_accuracy,
            adaptations: executionMode.adaptations,
            reason: executionMode.notes
        };
    }

    // 1. FORBIDDEN STRATEGIES SYSTEM
    checkForbiddenPatterns(task, allTasks) {
        const violations = [];
        
        this.forbiddenPatterns.forEach(pattern => {
            if (pattern.pattern(task, allTasks)) {
                violations.push({
                    pattern_id: pattern.id,
                    name: pattern.name,
                    penalty: pattern.penalty,
                    reason: pattern.reason
                });
            }
        });
        
        return {
            has_violations: violations.length > 0,
            violations,
            total_penalty: violations.reduce((sum, v) => sum + v.penalty, 0),
            blocked: violations.some(v => v.penalty > 0.6)
        };
    }

    // 2. INTENT CONSISTENCY CHECK
    calculateIntentAlignment(task, recentDecisions) {
        if (recentDecisions.length === 0) {
            return { score: 1.0, consistent: true, contradictions: [] };
        }
        
        const contradictions = [];
        let alignmentScore = 1.0;
        
        // Check strategic theme consistency - theme is guaranteed to exist
        const recentThemes = recentDecisions.slice(-10).map(d => d.strategic_theme).filter(Boolean);
        const taskTheme = task.strategic_theme;
        
        if (taskTheme && recentThemes.length > 0) {
            const themeConsistency = recentThemes.filter(theme => theme === taskTheme).length / recentThemes.length;
            if (themeConsistency < 0.3) {
                contradictions.push({
                    type: 'theme_inconsistency',
                    current: taskTheme,
                    recent: recentThemes,
                    severity: 'medium'
                });
                alignmentScore -= 0.3;
            }
        }
        
        // Check revenue type consistency
        const recentRevenueTypes = recentDecisions.slice(-10).map(d => d.cashflow_type).filter(Boolean);
        const taskRevenueType = task.cashflow_type;
        
        if (taskRevenueType && recentRevenueTypes.length > 0) {
            const typeConsistency = recentRevenueTypes.filter(type => type === taskRevenueType).length / recentRevenueTypes.length;
            if (typeConsistency < 0.2 && recentRevenueTypes.length >= 5) {
                contradictions.push({
                    type: 'revenue_type_shift',
                    current: taskRevenueType,
                    recent: recentRevenueTypes,
                    severity: 'low'
                });
                alignmentScore -= 0.1;
            }
        }
        
        // Check complexity consistency
        const recentComplexities = recentDecisions.slice(-10).map(d => d.complexity).filter(Boolean);
        const taskComplexity = task.complexity;
        
        if (taskComplexity && recentComplexities.length > 0) {
            const avgComplexity = this.calculateAverageComplexity(recentComplexities);
            if (taskComplexity === 'high' && avgComplexity < 2.0) {
                contradictions.push({
                    type: 'complexity_spike',
                    current: taskComplexity,
                    recent_average: avgComplexity,
                    severity: 'high'
                });
                alignmentScore -= 0.4;
            }
        }
        
        return {
            score: Math.max(0, alignmentScore),
            consistent: contradictions.length === 0,
            contradictions,
            strategic_drift: contradictions.filter(c => c.severity === 'high').length > 0
        };
    }

    calculateAverageComplexity(complexities) {
        const complexityMap = { 'low': 1, 'medium': 2, 'high': 3 };
        const values = complexities.map(c => complexityMap[c] || 2);
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    // 3. STRATEGIC MEMORY WINDOW
    calculateMemoryInfluence(decisionDate, isCoreStrategy = false) {
        const now = new Date();
        const decisionAge = Math.floor((now - new Date(decisionDate)) / (1000 * 60 * 60 * 24));
        
        let influence = 1.0;
        
        if (decisionAge <= this.strategicMemoryWindow.high_influence_days) {
            influence = 1.0;
        } else if (decisionAge <= this.strategicMemoryWindow.medium_influence_days) {
            influence = 0.5;
        } else {
            influence = 0.2;
        }
        
        if (isCoreStrategy) {
            influence *= this.strategicMemoryWindow.core_strategy_multiplier;
        }
        
        return {
            influence,
            age_days: decisionAge,
            category: decisionAge <= 7 ? 'high' : decisionAge <= 30 ? 'medium' : 'low'
        };
    }

    // 4. STRUCTURAL HEALTH SCORE
    calculateStructuralHealth(tasks) {
        let healthScore = 100;
        const issues = [];
        
        // Dependency fragmentation
        const dependencyCounts = tasks.map(t => t.strategic_debt?.score || 0);
        const avgDependency = dependencyCounts.reduce((sum, score) => sum + score, 0) / tasks.length;
        if (avgDependency > 0.6) {
            healthScore -= 20;
            issues.push('High dependency concentration');
        }
        
        // System coupling
        const highCouplingTasks = tasks.filter(t => t.cross_division_impact?.active_divisions > 3);
        if (highCouplingTasks.length > tasks.length * 0.3) {
            healthScore -= 15;
            issues.push('Excessive system coupling');
        }
        
        // Revenue stream over-reliance
        const revenueStreams = tasks.reduce((streams, task) => {
            const stream = task.cashflow_type || 'unknown';
            streams[stream] = (streams[stream] || 0) + 1;
            return streams;
        }, {});
        
        const maxStreamShare = Math.max(...Object.values(revenueStreams)) / tasks.length;
        if (maxStreamShare > 0.7) {
            healthScore -= 25;
            issues.push('Over-reliance on single revenue stream');
        }
        
        // Infrastructure stability
        const highRiskTasks = tasks.filter(t => t.failure_simulation?.overall_risk > 0.7);
        if (highRiskTasks.length > tasks.length * 0.4) {
            healthScore -= 20;
            issues.push('Infrastructure stability concerns');
        }
        
        return {
            score: Math.max(0, healthScore),
            issues,
            health_rating: healthScore >= 80 ? 'excellent' : healthScore >= 60 ? 'good' : healthScore >= 40 ? 'concerning' : 'critical'
        };
    }

    // 5. FALSE OPTIMIZATION DETECTOR
    detectFalseOptimization(task, baselineMetrics) {
        const warnings = [];
        let optimizationWarning = false;
        
        // Faster revenue but higher fragility
        if (task.time_to_revenue.includes('1') && task.strategic_debt?.score > 0.7) {
            warnings.push({
                type: 'revenue_vs_fragility',
                description: 'Fast revenue comes with high fragility risk',
                severity: 'high'
            });
            optimizationWarning = true;
        }
        
        // Simpler systems that remove long-term upside
        if (task.complexity === 'low' && task.optionality_score < 0.3) {
            warnings.push({
                type: 'simplicity_vs_optionality',
                description: 'Simplicity removes long-term optionality',
                severity: 'medium'
            });
            optimizationWarning = true;
        }
        
        // Short-term optimization that kills optionality
        if (task.profit_potential === 'very_high' && task.reversibility === 'low' && task.optionality_score < 0.4) {
            warnings.push({
                type: 'short_term_trap',
                description: 'Short-term optimization kills future options',
                severity: 'critical'
            });
            optimizationWarning = true;
        }
        
        return {
            optimization_warning: optimizationWarning,
            warnings,
            false_optimization_detected: warnings.some(w => w.severity === 'critical')
        };
    }

    // 6. OPTIONALITY SCORE
    calculateOptionalityScore(task) {
        let optionalityScore = 0.5; // Base score
        
        // Platform plays increase optionality
        if (task.title.includes('platform') || task.description.includes('ecosystem')) {
            optionalityScore += 0.3;
        }
        
        // API/infrastructure increases optionality
        if (task.title.includes('API') || task.title.includes('infrastructure')) {
            optionalityScore += 0.2;
        }
        
        // Multi-division impact increases optionality
        if (task.cross_division_impact?.active_divisions >= 2) {
            optionalityScore += 0.2 * task.cross_division_impact.active_divisions;
        }
        
        // High defensibility increases optionality
        if (task.advanced_score?.defensibility > 70) {
            optionalityScore += 0.2;
        }
        
        // High complexity can increase optionality if defensible
        if (task.complexity === 'high' && task.advanced_score?.defensibility > 60) {
            optionalityScore += 0.1;
        }
        
        // Low reversibility decreases optionality
        if (task.reversibility === 'low') {
            optionalityScore -= 0.3;
        }
        
        return {
            score: Math.max(0, Math.min(1, optionalityScore)),
            future_option_value: optionalityScore > 0.7 ? 'high' : optionalityScore > 0.4 ? 'medium' : 'low',
            unlocks_future_paths: optionalityScore > 0.6
        };
    }

    // 7. STRATEGIC INERTIA CONTROL
    detectStrategicInertia(tasks, recentDecisions) {
        const inertiaMetrics = {
            task_type_repetition: 0,
            revenue_stream_focus: 0,
            category_expansion: 0,
            overall_inertia: 0
        };
        
        // Task type repetition
        const recentTaskTypes = recentDecisions.slice(-20).map(d => d.category).filter(Boolean);
        const typeFrequency = {};
        recentTaskTypes.forEach(type => {
            typeFrequency[type] = (typeFrequency[type] || 0) + 1;
        });
        
        const maxTypeFrequency = Math.max(...Object.values(typeFrequency));
        inertiaMetrics.task_type_repetition = maxTypeFrequency / recentTaskTypes.length;
        
        // Revenue stream focus
        const recentRevenueTypes = recentDecisions.slice(-20).map(d => d.cashflow_type).filter(Boolean);
        const revenueFrequency = {};
        recentRevenueTypes.forEach(type => {
            revenueFrequency[type] = (revenueFrequency[type] || 0) + 1;
        });
        
        const maxRevenueFrequency = Math.max(...Object.values(revenueFrequency));
        inertiaMetrics.revenue_stream_focus = maxRevenueFrequency / recentRevenueTypes.length;
        
        // Category expansion (inverse of inertia)
        const uniqueCategories = new Set(recentTaskTypes).size;
        inertiaMetrics.category_expansion = uniqueCategories / Math.min(recentTaskTypes.length, 8);
        
        // Overall inertia
        inertiaMetrics.overall_inertia = (inertiaMetrics.task_type_repetition + inertiaMetrics.revenue_stream_focus) / 2;
        
        return {
            ...inertiaMetrics,
            inertia_alert: inertiaMetrics.overall_inertia > this.inertiaThreshold,
            forced_exploration: inertiaMetrics.overall_inertia > this.inertiaThreshold && this.mode === 'execution'
        };
    }

    // 8. DECISION REVERSIBILITY SCORE
    calculateReversibilityScore(task) {
        let reversibilityScore = 0.7; // Base score
        
        // High complexity reduces reversibility
        if (task.complexity === 'high') {
            reversibilityScore -= 0.3;
        }
        
        // High dependencies reduce reversibility
        if (task.strategic_debt?.score > 0.7) {
            reversibilityScore -= 0.4;
        }
        
        // Physical products reduce reversibility
        if (task.category.includes('Physical') || task.category.includes('Manufacturing')) {
            reversibilityScore -= 0.3;
        }
        
        // Platform plays reduce reversibility
        if (task.title.includes('platform') || task.description.includes('ecosystem')) {
            reversibilityScore -= 0.2;
        }
        
        // API/SaaS increases reversibility
        if (task.category.includes('SaaS') || task.title.includes('API')) {
            reversibilityScore += 0.2;
        }
        
        // Quick revenue increases reversibility
        if (task.time_to_revenue.includes('1') || task.time_to_revenue.includes('1-2')) {
            reversibilityScore += 0.1;
        }
        
        const reversibilityLevel = reversibilityScore > 0.7 ? 'high' : reversibilityScore > 0.4 ? 'medium' : 'low';
        
        return {
            score: Math.max(0, Math.min(1, reversibilityScore)),
            level: reversibilityLevel,
            dangerous_combo: reversibilityLevel === 'low' && task.advanced_score?.defensibility < 50
        };
    }

    // 9. META-STRATEGY ALIGNMENT
    calculateMetaStrategyAlignment(task) {
        const metaStrategyKeywords = [
            'platform', 'ecosystem', 'infrastructure', 'api', 'network',
            'scalable', 'multi-tenant', 'marketplace', 'integration'
        ];
        
        const text = (task.title + ' ' + task.description).toLowerCase();
        const keywordMatches = metaStrategyKeywords.filter(keyword => text.includes(keyword));
        
        let alignmentScore = 0.3; // Base alignment
        
        // Keyword matching
        alignmentScore += (keywordMatches.length / metaStrategyKeywords.length) * 0.4;
        
        // Category alignment
        const alignedCategories = [
            'Platform / Ecosystem Expansion',
            'HEIDI / AI PRODUCTIZATION',
            'Core AI / SaaS Revenue Systems'
        ];
        
        if (alignedCategories.includes(task.category)) {
            alignmentScore += 0.3;
        }
        
        // Cross-division impact supports meta-strategy
        if (task.cross_division_impact?.active_divisions >= 3) {
            alignmentScore += 0.2;
        }
        
        // Reversibility (platform transition needs reversible steps)
        if (task.reversibility !== 'low') {
            alignmentScore += 0.1;
        }
        
        return {
            score: Math.max(0, Math.min(1, alignmentScore)),
            aligned: alignmentScore > 0.6,
            supports_platform_transition: alignmentScore > 0.7,
            keyword_matches: keywordMatches,
            justification: alignmentScore > 0.6 ? 'Supports platform ecosystem transition' : 'May not align with meta-strategy'
        };
    }

    // MAIN REPRIORITIZATION FUNCTION (v3)
    async reprioritizeTasks() {
        const revenueData = await this.loadRevenueTasks();
        const enhancedTasks = [];
        
        // Load decision history
        await this.loadDecisionHistory();
        
        // Process each task through v3 anti-misalignment
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
            
            // STEP 2: Policy Override Check - Memory has veto power over reasoning
            const policyAuthority = await this.policyOverride.checkExecutionAuthority(normalizedTask);
            
            // STEP 3: Behavior-adaptive execution mode determination (only if authorized)
            const executionMode = policyAuthority.authorized ? 
                this.determineExecutionMode(normalizedTask) : 
                {
                    mode: 'policy_blocked',
                    effective_confidence: 0.0,
                    historical_accuracy: 0.0,
                    adaptations: ['policy_veto'],
                    notes: policyAuthority.message || 'Execution blocked by policy override'
                }

    // 7. STRATEGIC INERTIA CONTROL
    detectStrategicInertia(tasks, recentDecisions) {
            const inertiaMetrics = {
                task_type_repetition: 0,
                revenue_stream_focus: 0,
                category_expansion: 0,
                overall_inertia: 0
            };
            
            // Task type repetition
            const recentTaskTypes = recentDecisions.slice(-20).map(d => d.category).filter(Boolean);
            const typeFrequency = {};
            recentTaskTypes.forEach(type => {
                typeFrequency[type] = (typeFrequency[type] || 0) + 1;
            });
            
            const maxTypeFrequency = Math.max(...Object.values(typeFrequency));
            inertiaMetrics.task_type_repetition = maxTypeFrequency / recentTaskTypes.length;
            
            // Revenue stream focus
            const recentRevenueTypes = recentDecisions.slice(-20).map(d => d.cashflow_type).filter(Boolean);
            const revenueFrequency = {};
            recentRevenueTypes.forEach(type => {
                revenueFrequency[type] = (revenueFrequency[type] || 0) + 1;
            });
            
            const maxRevenueFrequency = Math.max(...Object.values(revenueFrequency));
            inertiaMetrics.revenue_stream_focus = maxRevenueFrequency / recentRevenueTypes.length;
            
            // Category expansion (inverse of inertia)
            const uniqueCategories = new Set(recentTaskTypes).size;
            inertiaMetrics.category_expansion = uniqueCategories / Math.min(recentTaskTypes.length, 8);
            
            // Overall inertia
            inertiaMetrics.overall_inertia = (inertiaMetrics.task_type_repetition + inertiaMetrics.revenue_stream_focus) / 2;
            
            return {
                ...inertiaMetrics,
                inertia_alert: inertiaMetrics.overall_inertia > this.inertiaThreshold,
                forced_exploration: inertiaMetrics.overall_inertia > this.inertiaThreshold && this.mode === 'execution'
            };
        }

        // 8. DECISION REVERSIBILITY SCORE
        calculateReversibilityScore(task) {
            let reversibilityScore = 0.7; // Base score
            
            // High complexity reduces reversibility
            if (task.complexity === 'high') {
                reversibilityScore -= 0.3;
            }
            
            // High dependencies reduce reversibility
            if (task.strategic_debt?.score > 0.7) {
                reversibilityScore -= 0.4;
            }
            
            // Physical products reduce reversibility
            if (task.category.includes('Physical') || task.category.includes('Manufacturing')) {
                reversibilityScore -= 0.3;
            }
            
            // Platform plays reduce reversibility
            if (task.title.includes('platform') || task.description.includes('ecosystem')) {
                reversibilityScore -= 0.2;
            }
            
            // API/SaaS increases reversibility
            if (task.category.includes('SaaS') || task.title.includes('API')) {
                reversibilityScore += 0.2;
            }
            
            // Quick revenue increases reversibility
            if (task.time_to_revenue.includes('1') || task.time_to_revenue.includes('1-2')) {
                reversibilityScore += 0.1;
            }
            
            const reversibilityLevel = reversibilityScore > 0.7 ? 'high' : reversibilityScore > 0.4 ? 'medium' : 'low';
            
            return {
                score: Math.max(0, Math.min(1, reversibilityScore)),
                level: reversibilityLevel,
                dangerous_combo: reversibilityLevel === 'low' && task.advanced_score?.defensibility < 50
            };
        }

        // 9. META-STRATEGY ALIGNMENT
        calculateMetaStrategyAlignment(task) {
            const metaStrategyKeywords = [
                'platform', 'ecosystem', 'infrastructure', 'api', 'network',
                'scalable', 'multi-tenant', 'marketplace', 'integration'
            ];
            
            const text = (task.title + ' ' + task.description).toLowerCase();
            const keywordMatches = metaStrategyKeywords.filter(keyword => text.includes(keyword));
            
            let alignmentScore = 0.3; // Base alignment
            
            // Keyword matching
            alignmentScore += (keywordMatches.length / metaStrategyKeywords.length) * 0.4;
            
            // Category alignment
            const alignedCategories = [
                'Platform / Ecosystem Expansion',
                'HEIDI / AI PRODUCTIZATION',
                'Core AI / SaaS Revenue Systems'
            ];
            
            if (alignedCategories.includes(task.category)) {
                alignmentScore += 0.3;
            }
            
            // Cross-division impact supports meta-strategy
            if (task.cross_division_impact?.active_divisions >= 3) {
                alignmentScore += 0.2;
            }
            
            // Reversibility (platform transition needs reversible steps)
            if (task.reversibility !== 'low') {
                alignmentScore += 0.1;
            }
            
            return {
                score: Math.max(0, Math.min(1, alignmentScore)),
                aligned: alignmentScore > 0.6,
                supports_platform_transition: alignmentScore > 0.7,
                keyword_matches: keywordMatches,
                justification: alignmentScore > 0.6 ? 'Supports platform ecosystem transition' : 'May not align with meta-strategy'
            };
        }

        // MAIN REPRIORITIZATION FUNCTION (v3)
        async reprioritizeTasks() {
            const revenueData = await this.loadRevenueTasks();
            const enhancedTasks = [];
            
            // Load decision history
            await this.loadDecisionHistory();
            
            // Process each task through v3 anti-misalignment
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
                
                // STEP 2: Policy Override Check - Memory has veto power over reasoning
                const policyAuthority = await this.policyOverride.checkExecutionAuthority(normalizedTask);
                
                // STEP 3: Behavior-adaptive execution mode determination (only if authorized)
                const executionMode = policyAuthority.authorized ? 
                    this.determineExecutionMode(normalizedTask) : 
                    {
                        mode: 'policy_blocked',
                        effective_confidence: 0.0,
                        historical_accuracy: 0.0,
                        adaptations: ['policy_veto'],
                        notes: policyAuthority.message || 'Execution blocked by policy override'
                    };
                
                // STEP 4: v2 processing (only if authorized by policy)
                const crossDivisionImpact = policyAuthority.authorized ? this.calculateCrossDivisionImpact(normalizedTask) : null;
                const existenceReason = policyAuthority.authorized ? this.validateExistenceReason(normalizedTask) : null;
                const strategicDebt = policyAuthority.authorized ? this.calculateStrategicDebt(normalizedTask) : null;
                const evolutionStage = policyAuthority.authorized ? this.determineEvolutionStage(normalizedTask) : null;
                const failureSimulation = policyAuthority.authorized ? this.simulateFailureScenarios(normalizedTask) : null;
                const advancedScore = policyAuthority.authorized ? this.calculateAdvancedScore(normalizedTask) : 0;
                
                // STEP 5: v3 anti-misalignment processing (only if authorized by policy)
                let v3AdjustedScore = 0;
                let forbiddenPatterns = [];
                let intentAlignment = null;
                let optionalityScore = 0;
                let reversibilityScore = 0;
                let metaStrategyAlignment = null;
                let falseOptimization = null;
                let antiMisalignmentScore = 0;
                
                if (policyAuthority.authorized) {
                    forbiddenPatterns = this.checkForbiddenPatterns(normalizedTask, revenueData.tasks);
                    intentAlignment = this.calculateIntentAlignment(normalizedTask, this.decisionHistory);
                    optionalityScore = this.calculateOptionalityScore(normalizedTask);
                    reversibilityScore = this.calculateReversibilityScore(normalizedTask);
                    metaStrategyAlignment = this.calculateMetaStrategyAlignment(normalizedTask);
                    falseOptimization = this.detectFalseOptimization(normalizedTask, {});
                    
                    // Calculate anti-misalignment score
                    antiMisalignmentScore = this.calculateAntiMisalignmentScore(
                        forbiddenPatterns,
                        intentAlignment,
                        optionalityScore,
                        reversibilityScore,
                        metaStrategyAlignment
                    );
                    
                    // Calculate v3-adjusted score
                    v3AdjustedScore = this.calculateV3AdjustedScore(
                        advancedScore,
                        antiMisalignmentScore,
                        falseOptimization
                    );
                    
                    // Intent consistency bonus/penalty
                    v3AdjustedScore *= intentAlignment.score;
                    
                    // Meta-strategy alignment bonus
                    if (metaStrategyAlignment.aligned) {
                        v3AdjustedScore *= 1.2;
                    } else {
                        v3AdjustedScore *= 0.8; // Deprioritize misaligned tasks
                    }
                    
                    // Optionality bonus
                    if (optionalityScore.unlocks_future_paths) {
                        v3AdjustedScore *= 1.1;
                    }
                    
                    // Reversibility penalty for dangerous combos
                    if (reversibilityScore.dangerous_combo) {
                        v3AdjustedScore *= 0.5;
                    }
                }
                
                // Determine status
                const status = policyAuthority.authorized ? this.determineTaskStatusV3(
                    normalizedTask, 
                    advancedScore,
                    strategicDebt,
                    existenceReason,
                    failureSimulation,
                    forbiddenPatterns,
                    falseOptimization
                ) : 'policy_blocked';
                
                enhancedTasks.push({
                    ...task,
                    // v1/v2 fields
                    advanced_score: advancedScore,
                    strategic_theme: normalizedTask.strategic_theme,
                    strategic_theme_confidence: normalizedTask.strategic_theme_confidence,
                    strategic_theme_source: normalizedTask.strategic_theme_source,
                    theme_warnings: normalizedTask.theme_warnings,
                    cross_division_impact: crossDivisionImpact,
                    existence_reason: existenceReason,
                    strategic_debt: strategicDebt,
                    evolution_stage: evolutionStage,
                    failure_simulation: failureSimulation,
                    cashflow_type: this.classifyCashflowType(normalizedTask),
                    // v3 anti-misalignment fields
                    forbidden_patterns: forbiddenPatterns,
                    intent_alignment: intentAlignment,
                    optionality_score: optionalityScore,
                    reversibility: reversibilityScore,
                    meta_strategy_alignment: metaStrategyAlignment,
                    false_optimization: falseOptimization,
                    anti_misalignment_score: antiMisalignmentScore,
                    v3_adjusted_score: Math.round(v3AdjustedScore),
                    status,
                    // POLICY OVERRIDE OUTPUT REQUIREMENTS
                    policy_authority: {
                        authorized: policyAuthority.authorized,
                        action: policyAuthority.action,
                        reason: policyAuthority.reason,
                        message: policyAuthority.message,
                        trust_score: policyAuthority.trust_score
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
                    confidence_tracked: true
                });
            }
            
            // Sort by v3-adjusted score
            enhancedTasks.sort((a, b) => b.v3_adjusted_score - a.v3_adjusted_score);
            
            // Enforce execution focus limit
            const focusedTasks = this.enforceExecutionFocus(enhancedTasks);
            
            // Calculate system-level metrics
            const structuralHealth = this.calculateStructuralHealth(focusedTasks);
            const strategicInertia = this.detectStrategicInertia(focusedTasks, this.decisionHistory);
            
            // Update anti-misalignment metrics
            this.antiMisalignmentMetrics = {
                structural_health: structuralHealth,
                strategic_inertia: strategicInertia,
                forbidden_pattern_violations: enhancedTasks.filter(t => t.forbidden_patterns.has_violations).length,
                intent_consistency_score: enhancedTasks.reduce((sum, t) => sum + t.intent_alignment.score, 0) / enhancedTasks.length,
                meta_strategy_alignment_score: enhancedTasks.reduce((sum, t) => sum + t.meta_strategy_alignment.score, 0) / enhancedTasks.length,
                false_optimization_warnings: enhancedTasks.filter(t => t.false_optimization.optimization_warning).length,
                last_update: new Date().toISOString()
            };
            
            // Cache results
            this.lastUpdate = new Date().toISOString();
            this.cache.set('enhanced_tasks_v3', enhancedTasks);
            this.cache.set('anti_misalignment_metrics', this.antiMisalignmentMetrics);
            
            // Update decision history
            await this.updateDecisionHistory(focusedTasks.slice(0, 3));
            
            return {
                tasks: enhancedTasks,
                focused_tasks: focusedTasks,
                anti_misalignment_metrics: this.antiMisalignmentMetrics,
                theme_confidence_metrics: this.getThemeConfidenceMetrics(),
                strategic_themes: this.getThemeDistribution(enhancedTasks),
                structural_health: structuralHealth,
                strategic_inertia: strategicInertia,
                recommended_actions: this.generateV3Actions(enhancedTasks, structuralHealth, strategicInertia),
                warnings: this.generateV3Warnings(structuralHealth, strategicInertia),
                meta_strategy: this.metaStrategy,
                metadata: {
                    version: 'v3',
                    mode: this.mode,
                    last_update: this.lastUpdate,
                    total_tasks: enhancedTasks.length,
                    active_tasks: focusedTasks.length,
                    blocked_tasks: enhancedTasks.filter(t => t.forbidden_patterns.blocked).length,
                    structural_health_score: structuralHealth.score,
                    anti_misalignment_health: structuralHealth.score >= this.structuralHealthThreshold ? 'healthy' : 'warning',
                    theme_confidence_health: this.getThemeConfidenceMetrics().confidence_health
                }
            };
        }

        calculateAntiMisalignmentScore(forbiddenPatterns, intentAlignment, optionalityScore, reversibilityScore, metaStrategyAlignment) {
            let score = 0.5; // Base score
            
            // Forbidden patterns penalty
            if (forbiddenPatterns.has_violations) {
                score -= forbiddenPatterns.total_penalty * 0.5;
            }
            
            // Intent consistency bonus
            score += intentAlignment.score * 0.3;
            
            // Optionality bonus
            score += optionalityScore.score * 0.2;
            
            // Meta-strategy alignment bonus
            score += metaStrategyAlignment.score * 0.3;
            
            // Reversibility consideration
            if (reversibilityScore.dangerous_combo) {
                score -= 0.4;
            }
            
            return Math.max(0, Math.min(1, score));
        }

        // MAIN REPRIORITIZATION FUNCTION (v3)
        async reprioritizeTasks() {
            const revenueData = await this.loadRevenueTasks();
            const enhancedTasks = [];
            
            // Load decision history
            await this.loadDecisionHistory();
            
            // Process each task through v3 anti-misalignment
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
                
                // STEP 2: Policy Override Check - Memory has veto power over reasoning
                const policyAuthority = await this.policyOverride.checkExecutionAuthority(normalizedTask);
                
                // STEP 3: Behavior-adaptive execution mode determination (only if authorized)
                const executionMode = policyAuthority.authorized ? 
                    this.determineExecutionMode(normalizedTask) : 
                    {
                        mode: 'policy_blocked',
                        effective_confidence: 0.0,
                        historical_accuracy: 0.0,
                        adaptations: ['policy_veto'],
                        notes: policyAuthority.message || 'Execution blocked by policy override'
                    };
                
                // STEP 4: v2 processing (only if authorized by policy)
                const crossDivisionImpact = policyAuthority.authorized ? this.calculateCrossDivisionImpact(normalizedTask) : null;
                const existenceReason = policyAuthority.authorized ? this.validateExistenceReason(normalizedTask) : null;
                const strategicDebt = policyAuthority.authorized ? this.calculateStrategicDebt(normalizedTask) : null;
                const evolutionStage = policyAuthority.authorized ? this.determineEvolutionStage(normalizedTask) : null;
                const failureSimulation = policyAuthority.authorized ? this.simulateFailureScenarios(normalizedTask) : null;
                const advancedScore = policyAuthority.authorized ? this.calculateAdvancedScore(normalizedTask) : 0;
                
                // STEP 5: v3 anti-misalignment processing (only if authorized by policy)
                let v3AdjustedScore = 0;
                let forbiddenPatterns = [];
                let intentAlignment = null;
                let optionalityScore = 0;
                let reversibilityScore = 0;
                let metaStrategyAlignment = null;
                let falseOptimization = null;
                let antiMisalignmentScore = 0;
                
                if (policyAuthority.authorized) {
                    forbiddenPatterns = this.checkForbiddenPatterns(normalizedTask, revenueData.tasks);
                    intentAlignment = this.calculateIntentAlignment(normalizedTask, this.decisionHistory);
                    optionalityScore = this.calculateOptionalityScore(normalizedTask);
                    reversibilityScore = this.calculateReversibilityScore(normalizedTask);
                    metaStrategyAlignment = this.calculateMetaStrategyAlignment(normalizedTask);
                    falseOptimization = this.detectFalseOptimization(normalizedTask, {});
                    
                    // Calculate anti-misalignment score
                    antiMisalignmentScore = this.calculateAntiMisalignmentScore(
                        forbiddenPatterns,
                        intentAlignment,
                        optionalityScore,
                        reversibilityScore,
                        metaStrategyAlignment
                    );
                    
                    // Calculate v3-adjusted score
                    v3AdjustedScore = this.calculateV3AdjustedScore(
                        advancedScore,
                        antiMisalignmentScore,
                        falseOptimization
                    );
                    
                    // Intent consistency bonus/penalty
                    v3AdjustedScore *= intentAlignment.score;
                    
                    // Meta-strategy alignment bonus
                    if (metaStrategyAlignment.aligned) {
                        v3AdjustedScore *= 1.2;
                    } else {
                        v3AdjustedScore *= 0.8; // Deprioritize misaligned tasks
                    }
                    
                    // Optionality bonus
                    if (optionalityScore.unlocks_future_paths) {
                        v3AdjustedScore *= 1.1;
                    }
                    
                    // Reversibility penalty for dangerous combos
                    if (reversibilityScore.dangerous_combo) {
                        v3AdjustedScore *= 0.5;
                    }
                }
                
                // Determine status
                const status = policyAuthority.authorized ? this.determineTaskStatusV3(
                    normalizedTask, 
                    advancedScore,
                    strategicDebt,
                    existenceReason,
                    failureSimulation,
                    forbiddenPatterns,
                    falseOptimization
                ) : 'policy_blocked';
                
                enhancedTasks.push({
                ...task,
                // v1/v2 fields
                advanced_score: advancedScore,
                strategic_theme: normalizedTask.strategic_theme,
                strategic_theme_confidence: normalizedTask.strategic_theme_confidence,
                strategic_theme_source: normalizedTask.strategic_theme_source,
                theme_warnings: normalizedTask.theme_warnings,
                cross_division_impact: crossDivisionImpact,
                existence_reason: existenceReason,
                strategic_debt: strategicDebt,
                evolution_stage: evolutionStage,
                failure_simulation: failureSimulation,
                cashflow_type: this.classifyCashflowType(normalizedTask),
                // v3 anti-misalignment fields
                forbidden_patterns: forbiddenPatterns,
                intent_alignment: intentAlignment,
                optionality_score: optionalityScore,
                reversibility: reversibilityScore,
                meta_strategy_alignment: metaStrategyAlignment,
                false_optimization: falseOptimization,
                anti_misalignment_score: antiMisalignmentScore,
                v3_adjusted_score: Math.round(v3AdjustedScore),
                status,
                // POLICY OVERRIDE OUTPUT REQUIREMENTS
                policy_authority: {
                    authorized: policyAuthority.authorized,
                    action: policyAuthority.action,
                    reason: policyAuthority.reason,
                    message: policyAuthority.message,
                    trust_score: policyAuthority.trust_score
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
                confidence_tracked: true
            });
        }
        
        // Sort by v3-adjusted score
        enhancedTasks.sort((a, b) => b.v3_adjusted_score - a.v3_adjusted_score);
        
        // Enforce execution focus limit
        const focusedTasks = this.enforceExecutionFocus(enhancedTasks);
        
        // Calculate system-level metrics
        const structuralHealth = this.calculateStructuralHealth(focusedTasks);
        const strategicInertia = this.detectStrategicInertia(focusedTasks, this.decisionHistory);
        
        // Update anti-misalignment metrics
        this.antiMisalignmentMetrics = {
            structural_health: structuralHealth,
            strategic_inertia: strategicInertia,
            forbidden_pattern_violations: enhancedTasks.filter(t => t.forbidden_patterns.has_violations).length,
            intent_consistency_score: enhancedTasks.reduce((sum, t) => sum + t.intent_alignment.score, 0) / enhancedTasks.length,
            meta_strategy_alignment_score: enhancedTasks.reduce((sum, t) => sum + t.meta_strategy_alignment.score, 0) / enhancedTasks.length,
            false_optimization_warnings: enhancedTasks.filter(t => t.false_optimization.optimization_warning).length,
            last_update: new Date().toISOString()
        };
        
        // Cache results
        this.lastUpdate = new Date().toISOString();
        this.cache.set('enhanced_tasks_v3', enhancedTasks);
        this.cache.set('anti_misalignment_metrics', this.antiMisalignmentMetrics);
        
        // Update decision history
        await this.updateDecisionHistory(focusedTasks.slice(0, 3));
        
        return {
            tasks: enhancedTasks,
            focused_tasks: focusedTasks,
            anti_misalignment_metrics: this.antiMisalignmentMetrics,
            theme_confidence_metrics: this.getThemeConfidenceMetrics(),
            strategic_themes: this.getThemeDistribution(enhancedTasks),
            structural_health: structuralHealth,
            strategic_inertia: strategicInertia,
            recommended_actions: this.generateV3Actions(enhancedTasks, structuralHealth, strategicInertia),
            warnings: this.generateV3Warnings(structuralHealth, strategicInertia),
            meta_strategy: this.metaStrategy,
            metadata: {
                version: 'v3',
                mode: this.mode,
                last_update: this.lastUpdate,
                total_tasks: enhancedTasks.length,
                active_tasks: focusedTasks.length,
                blocked_tasks: enhancedTasks.filter(t => t.forbidden_patterns.blocked).length,
                structural_health_score: structuralHealth.score,
                anti_misalignment_health: structuralHealth.score >= this.structuralHealthThreshold ? 'healthy' : 'warning',
                theme_confidence_health: this.getThemeConfidenceMetrics().confidence_health
            }
        };
    }

    calculateAntiMisalignmentScore(forbiddenPatterns, intentAlignment, optionalityScore, reversibilityScore, metaStrategyAlignment) {
        let score = 0.5; // Base score
        
        // Forbidden patterns penalty
        if (forbiddenPatterns.has_violations) {
            score -= forbiddenPatterns.total_penalty * 0.5;
        }
        
        // Intent consistency bonus
        score += intentAlignment.score * 0.3;
        
        // Optionality bonus
        score += optionalityScore.score * 0.2;
        
        // Meta-strategy alignment bonus
        score += metaStrategyAlignment.score * 0.3;
        
        // Reversibility consideration
        if (reversibilityScore.dangerous_combo) {
            score -= 0.4;
        }
        
        return Math.max(0, Math.min(1, score));
    }

    async loadDecisionHistory() {
        // In production, this would load from database
        // For now, simulate some history
        if (this.decisionHistory.length === 0) {
            this.decisionHistory = [
                { id: '1', strategic_theme: 'AI Infrastructure Revenue', cashflow_type: 'recurring', category: 'Core AI / SaaS Revenue Systems', complexity: 'medium', date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
                { id: '2', strategic_theme: 'Automation SaaS Ecosystem', cashflow_type: 'recurring', category: 'Platform / Ecosystem Expansion', complexity: 'low', date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
                { id: '3', strategic_theme: 'Music/IP Asset Expansion', cashflow_type: 'equity', category: 'Music / Waveformer Revenue Engine', complexity: 'medium', date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) }
            ];
        }
    }

    async updateDecisionHistory(focusedTasks) {
        // Add current top tasks to history
        const today = new Date();
        focusedTasks.forEach(task => {
            this.decisionHistory.push({
                id: task.id,
                strategic_theme: task.strategic_theme,
                cashflow_type: task.cashflow_type,
                category: task.category,
                complexity: task.complexity,
                date: today
            });
        });
        
        // Keep only recent history (last 90 days)
        const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        this.decisionHistory = this.decisionHistory.filter(d => new Date(d.date) > cutoffDate);
        
        // In production, this would save to database
    }

    generateV3Actions(tasks, structuralHealth, strategicInertia) {
        const actions = [];
        
        // Structural health actions
        if (structuralHealth.score < this.structuralHealthThreshold) {
            actions.push({
                priority: 'critical',
                type: 'address_structural_health',
                issues: structuralHealth.issues,
                message: 'Address structural health issues before proceeding'
            });
        }
        
        // Inertia actions
        if (strategicInertia.inertia_alert) {
            actions.push({
                priority: 'high',
                type: 'combat_strategic_inertia',
                forced_exploration: strategicInertia.forced_exploration,
                message: 'Combat strategic inertia - forced exploration mode activated'
            });
        }
        
        // Forbidden pattern actions
        const blockedTasks = tasks.filter(t => t.forbidden_patterns.blocked);
        if (blockedTasks.length > 0) {
            actions.push({
                priority: 'medium',
                type: 'review_blocked_tasks',
                blocked_count: blockedTasks.length,
                message: `${blockedTasks.length} tasks blocked by forbidden patterns`
            });
        }
        
        // False optimization actions
        const falseOptTasks = tasks.filter(t => t.false_optimization.false_optimization_detected);
        if (falseOptTasks.length > 0) {
            actions.push({
                priority: 'high',
                type: 'address_false_optimization',
                task_count: falseOptTasks.length,
                message: 'Address false optimization patterns'
            });
        }
        
        return actions.slice(0, 10);
    }

    generateV3Warnings(structuralHealth, strategicInertia) {
        const warnings = [];
        
        // Structural health warnings
        structuralHealth.issues.forEach(issue => {
            warnings.push({
                type: 'structural_health',
                message: issue,
                severity: structuralHealth.score < 50 ? 'critical' : 'warning'
            });
        });
        
        // Inertia warnings
        if (strategicInertia.inertia_alert) {
            warnings.push({
                type: 'strategic_inertia',
                message: 'Strategic inertia detected - system becoming too consistent',
                severity: 'warning'
            });
        }
        
        return warnings;
    }

    // Helper methods (inherited from v2, simplified)
    mapTaskToTheme(task) {
        // Simplified theme mapping
        const themeMappings = {
            'AI Infrastructure Revenue': ['HEIDI / AI PRODUCTIZATION', 'Core AI / SaaS Revenue Systems'],
            'Industrial Manufacturing Monetization': ['3D Printing / Manufacturing Revenue'],
            'Music/IP Asset Expansion': ['Music / Waveformer Revenue Engine'],
            'Automation SaaS Ecosystem': ['Platform / Ecosystem Expansion', 'Automation & Micro-SaaS Ideas']
        };
        
        for (const [theme, categories] of Object.entries(themeMappings)) {
            if (categories.includes(task.category)) return theme;
        }
        return 'Uncategorized';
    }

    calculateCrossDivisionImpact(task) {
        const divisions = {
            'ProtoForge Core': 0,
            'Waveformer Records': 0,
            'Z Labs / Hardware': 0,
            'AI Systems (HEIDI)': 0
        };
        
        const text = (task.title + ' ' + task.description).toLowerCase();
        
        if (text.includes('protoforge') || text.includes('core')) divisions['ProtoForge Core'] = 0.8;
        if (text.includes('music') || text.includes('waveformer')) divisions['Waveformer Records'] = 0.8;
        if (text.includes('3d') || text.includes('hardware')) divisions['Z Labs / Hardware'] = 0.8;
        if (text.includes('ai') || text.includes('heidi')) divisions['AI Systems (HEIDI)'] = 0.8;
        
        const activeDivisions = Object.values(divisions).filter(score => score > 0).length;
        const maxImpact = Math.max(...Object.values(divisions));
        
        return {
            score: maxImpact,
            divisions: Object.entries(divisions).filter(([name, score]) => score > 0).map(([name, score]) => ({ division: name, impact: score })),
            active_divisions: activeDivisions
        };
    }

    validateExistenceReason(task) {
        const text = (task.title + ' ' + task.description).toLowerCase();
        const hasReason = text.includes('revenue') || text.includes('automate') || text.includes('scale') || text.includes('defend');
        
        return {
            valid: hasReason,
            reason: hasReason ? 'strategic' : null,
            confidence: hasReason ? 0.8 : 0.2,
            message: hasReason ? 'Clear strategic purpose identified' : 'Cannot justify strategic purpose'
        };
    }

    classifyCashflowType(task) {
        const quickCashCategories = ['Automation & Micro-SaaS Ideas'];
        const recurringCategories = ['Core AI / SaaS Revenue Systems', 'Platform / Ecosystem Expansion'];
        const equityCategories = ['HEIDI / AI PRODUCTIZATION', 'Platform / Ecosystem Expansion'];
        
        if (quickCashCategories.includes(task.category) && task.time_to_revenue.includes('1-2')) {
            return 'immediate';
        } else if (recurringCategories.includes(task.category)) {
            return 'recurring';
        } else if (equityCategories.includes(task.category)) {
            return 'equity';
        } else {
            return 'hybrid';
        }
    }

    calculateStrategicDebt(task) {
        let debtScore = 0;
        
        if (task.category.includes('AI')) debtScore += 0.3;
        if (task.category.includes('Physical')) debtScore += 0.4;
        if (task.complexity === 'high') debtScore += 0.3;
        if (task.time_to_revenue.includes('4-6')) debtScore += 0.2;
        
        return {
            score: debtScore,
            level: debtScore > 0.7 ? 'high' : debtScore > 0.4 ? 'medium' : 'low',
            factors: []
        };
    }

    determineEvolutionStage(task) {
        return 'idea'; // Default stage
    }

    simulateFailureScenarios(task) {
        return {
            scenarios: [],
            overall_risk: 0.3,
            has_mitigation: true
        };
    }

    calculateAdvancedScore(task) {
        return {
            total_score: 75,
            confidence_score: 80,
            failure_risk_score: 25,
            breakdown: {
                profit_potential: 80,
                time_to_revenue: 70,
                complexity: 60,
                defensibility: 75,
                scalability: 70,
                dependency_risk: 30,
                cashflow_type: 75
            }
        };
    }

    applyModeAdjustments(baseScore, task) {
        return baseScore;
    }

    enforceExecutionFocus(tasks) {
        return tasks.filter(t => t.status === 'active').slice(0, 3);
    }

    getThemeDistribution(tasks) {
        const distribution = {};
        const themes = ['AI Infrastructure Revenue', 'Industrial Manufacturing Monetization', 'Music/IP Asset Expansion', 'Automation SaaS Ecosystem'];
        themes.forEach(theme => {
            distribution[theme] = tasks.filter(t => t.strategic_theme === theme).length;
        });
        return distribution;
    }

    determineTaskStatusV3(task, advancedScore, strategicDebt, existenceReason, failureSimulation, forbiddenPatterns, falseOptimization) {
        // Blocked by forbidden patterns
        if (forbiddenPatterns.blocked) {
            return 'killed';
        }
        
        // False optimization detected
        if (falseOptimization.false_optimization_detected) {
            return 'dormant';
        }
        
        // Standard v2 logic
        if (!existenceReason.valid || strategicDebt.level === 'high') {
            return 'killed';
        }
        
        if (advancedScore.failure_risk_score > 70) {
            return 'dormant';
        }
        
        return 'active';
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

    getAntiMisalignmentMetrics() {
        return this.antiMisalignmentMetrics;
    }
}

module.exports = CascadeEngineV3;
