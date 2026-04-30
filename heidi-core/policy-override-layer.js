/**
 * Policy Override Layer
 * Memory-over-rule enforcement and constraint authority
 * When historical truth outranks model reasoning
 */

class PolicyOverrideLayer {
    constructor(memoryService) {
        this.memoryService = memoryService;
        this.globalThemeTrust = new Map();
        this.policyConstraints = new Map();
        this.vetoHistory = [];
        this.lastVetoCheck = null;
        
        // Policy thresholds (these can be dynamically adjusted)
        this.thresholds = {
            theme_trust_minimum: 0.6,      // Below this = hard block
            confidence_trust_gap: 0.3,     // Gap between confidence and accuracy
            overfrequency_limit: 5,        // Overconfidence events per theme
            drift_threshold: 0.4,          // Historical accuracy drop threshold
            veto_cooldown_ms: 30000        // 30 seconds between veto checks
        };
        
        // Initialize policy constraints
        this.initializePolicyConstraints();
    }

    initializePolicyConstraints() {
        // Hard constraints that cannot be overridden
        this.policyConstraints.set('hard_block_themes', new Set());
        this.policyConstraints.set('restricted_themes', new Set());
        this.policyConstraints.set('require_manual_approval', new Set());
        
        console.log('[POLICY] Policy override layer initialized');
    }

    // CORE OVERRIDE FUNCTION
    async checkExecutionAuthority(task) {
        const theme = task.strategic_theme || task.strategic_theme_info?.value;
        const confidence = task.strategic_theme_confidence || task.strategic_theme_info?.confidence;
        
        if (!theme) {
            return {
                authorized: false,
                reason: 'missing_theme',
                action: 'HARD_BLOCK',
                authority: 'policy_override'
            };
        }

        // Check cooldown to prevent excessive veto checks
        if (this.lastVetoCheck && 
            Date.now() - this.lastVetoCheck < this.thresholds.veto_cooldown_ms) {
            // Skip detailed check if in cooldown, but still check hard blocks
            return this.checkHardBlocksOnly(task);
        }

        this.lastVetoCheck = Date.now();

        try {
            // Get historical accuracy from memory
            const historicalAccuracy = await this.memoryService.getThemeAccuracy(theme);
            
            // Check all policy constraints
            const checks = await Promise.all([
                this.checkThemeTrustThreshold(theme, historicalAccuracy),
                this.checkConfidenceTrustGap(theme, confidence, historicalAccuracy),
                this.checkOverfrequencyLimit(theme),
                this.checkDriftThreshold(theme, historicalAccuracy),
                this.checkHardConstraints(theme, task)
            ]);

            // Find the most restrictive check
            const veto = checks.find(check => !check.authorized);
            
            if (veto) {
                this.logVeto(task, veto);
                return veto;
            }

            // No veto - execution authorized
            return {
                authorized: true,
                reason: 'all_constraints_satisfied',
                action: 'ALLOW_EXECUTION',
                authority: 'policy_override',
                historical_accuracy: historicalAccuracy.rolling_accuracy,
                trust_score: this.calculateTrustScore(theme, historicalAccuracy)
            };

        } catch (error) {
            console.error('[POLICY] Error checking execution authority:', error);
            // Fail safe: block execution if policy check fails
            return {
                authorized: false,
                reason: 'policy_check_failed',
                action: 'HARD_BLOCK',
                authority: 'policy_override',
                error: error.message
            };
        }
    }

    async checkHardBlocksOnly(task) {
        const theme = task.strategic_theme || task.strategic_theme_info?.value;
        
        // Only check hard constraints during cooldown
        const hardConstraintCheck = await this.checkHardConstraints(theme, task);
        
        if (!hardConstraintCheck.authorized) {
            this.logVeto(task, hardConstraintCheck);
            return hardConstraintCheck;
        }

        return {
            authorized: true,
            reason: 'cooldown_mode_hard_blocks_only',
            action: 'ALLOW_EXECUTION',
            authority: 'policy_override'
        };
    }

    // POLICY CONSTRAINT CHECKS

    async checkThemeTrustThreshold(theme, historicalAccuracy) {
        const trustThreshold = this.thresholds.theme_trust_minimum;
        const rollingAccuracy = historicalAccuracy.rolling_accuracy;

        if (rollingAccuracy < trustThreshold) {
            return {
                authorized: false,
                reason: 'theme_trust_too_low',
                action: 'HARD_BLOCK',
                authority: 'policy_override',
                theme,
                current_accuracy: rollingAccuracy,
                required_accuracy: trustThreshold,
                message: `Theme "${theme}" has ${(rollingAccuracy * 100).toFixed(1)}% accuracy, below ${(trustThreshold * 100).toFixed(1)}% threshold`
            };
        }

        return { authorized: true };
    }

    async checkConfidenceTrustGap(theme, confidence, historicalAccuracy) {
        const gapThreshold = this.thresholds.confidence_trust_gap;
        const rollingAccuracy = historicalAccuracy.rolling_accuracy;
        const confidenceGap = Math.abs(confidence - rollingAccuracy);

        if (confidenceGap > gapThreshold) {
            return {
                authorized: false,
                reason: 'confidence_trust_gap_too_large',
                action: 'HARD_BLOCK',
                authority: 'policy_override',
                theme,
                confidence,
                historical_accuracy: rollingAccuracy,
                gap: confidenceGap,
                threshold: gapThreshold,
                message: `Confidence ${confidence.toFixed(2)} vs historical accuracy ${(rollingAccuracy * 100).toFixed(1)}% gap too large`
            };
        }

        return { authorized: true };
    }

    async checkOverfrequencyLimit(theme) {
        const overconfidenceEvents = await this.memoryService.getOverconfidenceEvents(theme, 10);
        const limit = this.thresholds.overfrequency_limit;

        if (overconfidenceEvents.length >= limit) {
            return {
                authorized: false,
                reason: 'overfrequency_limit_exceeded',
                action: 'HARD_BLOCK',
                authority: 'policy_override',
                theme,
                overconfidence_count: overconfidenceEvents.length,
                limit,
                message: `Theme "${theme}" has ${overconfidenceEvents.length} overconfidence events (limit: ${limit})`
            };
        }

        return { authorized: true };
    }

    async checkDriftThreshold(theme, historicalAccuracy) {
        const driftThreshold = this.thresholds.drift_threshold;
        const rollingAccuracy = historicalAccuracy.rolling_accuracy;

        // Check if accuracy has dropped significantly
        const globalTrust = this.globalThemeTrust.get(theme);
        if (globalTrust && globalTrust > rollingAccuracy + driftThreshold) {
            return {
                authorized: false,
                reason: 'accuracy_drift_detected',
                action: 'HARD_BLOCK',
                authority: 'policy_override',
                theme,
                current_accuracy: rollingAccuracy,
                previous_trust: globalTrust,
                drift: globalTrust - rollingAccuracy,
                threshold: driftThreshold,
                message: `Theme "${theme}" accuracy dropped by ${((globalTrust - rollingAccuracy) * 100).toFixed(1)}%`
            };
        }

        // Update global trust
        this.globalThemeTrust.set(theme, rollingAccuracy);

        return { authorized: true };
    }

    async checkHardConstraints(theme, task) {
        // Check hard-blocked themes
        if (this.policyConstraints.get('hard_block_themes').has(theme)) {
            return {
                authorized: false,
                reason: 'hard_blocked_theme',
                action: 'HARD_BLOCK',
                authority: 'policy_override',
                theme,
                message: `Theme "${theme}" is hard-blocked by policy`
            };
        }

        // Check restricted themes
        if (this.policyConstraints.get('restricted_themes').has(theme)) {
            return {
                authorized: false,
                reason: 'restricted_theme',
                action: 'REQUIRE_MANUAL_APPROVAL',
                authority: 'policy_override',
                theme,
                message: `Theme "${theme}" requires manual approval`
            };
        }

        return { authorized: true };
    }

    // UTILITY FUNCTIONS

    calculateTrustScore(theme, historicalAccuracy) {
        const rollingAccuracy = historicalAccuracy.rolling_accuracy;
        const totalPredictions = historicalAccuracy.correct + historicalAccuracy.incorrect;
        
        // Trust score considers accuracy and data volume
        let trustScore = rollingAccuracy;
        
        // Boost trust score for themes with more data
        if (totalPredictions > 10) {
            trustScore += 0.1;
        } else if (totalPredictions < 3) {
            trustScore -= 0.2; // Penalize low data volume
        }
        
        return Math.max(0.0, Math.min(1.0, trustScore));
    }

    logVeto(task, veto) {
        const vetoEvent = {
            timestamp: new Date().toISOString(),
            task_id: task.id,
            theme: task.strategic_theme || task.strategic_theme_info?.value,
            confidence: task.strategic_theme_confidence || task.strategic_theme_info?.confidence,
            reason: veto.reason,
            action: veto.action,
            authority: veto.authority,
            message: veto.message
        };

        this.vetoHistory.push(vetoEvent);
        
        // Keep only last 100 veto events
        if (this.vetoHistory.length > 100) {
            this.vetoHistory = this.vetoHistory.slice(-100);
        }

        console.log(`[POLICY VETO] ${veto.action}: ${veto.message}`);
    }

    // POLICY MANAGEMENT

    addHardBlockTheme(theme, reason = 'Manual policy addition') {
        this.policyConstraints.get('hard_block_themes').add(theme);
        console.log(`[POLICY] Added hard block for theme "${theme}": ${reason}`);
    }

    removeHardBlockTheme(theme) {
        this.policyConstraints.get('hard_block_themes').delete(theme);
        console.log(`[POLICY] Removed hard block for theme "${theme}"`);
    }

    addRestrictedTheme(theme, reason = 'Manual policy addition') {
        this.policyConstraints.get('restricted_themes').add(theme);
        console.log(`[POLICY] Added restriction for theme "${theme}": ${reason}`);
    }

    updateThreshold(thresholdName, newValue) {
        if (this.thresholds.hasOwnProperty(thresholdName)) {
            const oldValue = this.thresholds[thresholdName];
            this.thresholds[thresholdName] = newValue;
            console.log(`[POLICY] Updated threshold ${thresholdName}: ${oldValue} → ${newValue}`);
        } else {
            throw new Error(`Unknown threshold: ${thresholdName}`);
        }
    }

    // MONITORING AND REPORTING

    getVetoHistory(limit = 20) {
        return this.vetoHistory.slice(-limit);
    }

    getPolicyStatus() {
        return {
            thresholds: this.thresholds,
            hard_blocked_themes: Array.from(this.policyConstraints.get('hard_block_themes')),
            restricted_themes: Array.from(this.policyConstraints.get('restricted_themes')),
            global_theme_trust: Object.fromEntries(this.globalThemeTrust),
            total_vetoes: this.vetoHistory.length,
            last_veto_check: this.lastVetoCheck
        };
    }

    async getSystemHealth() {
        const recentVetoes = this.vetoHistory.slice(-10);
        const vetoRate = recentVetoes.length / 10; // Veto rate in last 10 checks
        
        return {
            healthy: vetoRate < 0.3, // Healthy if less than 30% veto rate
            veto_rate: vetoRate,
            recent_vetoes: recentVetoes.length,
            policy_constraints: {
                hard_blocks: this.policyConstraints.get('hard_block_themes').size,
                restrictions: this.policyConstraints.get('restricted_themes').size
            },
            global_trust_entries: this.globalThemeTrust.size
        };
    }
}

module.exports = PolicyOverrideLayer;
