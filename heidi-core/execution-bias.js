/**
 * Execution Bias Layer
 * Dumb but final tie-break authority that forces action when governance collapses
 * NOT another smart system - simple, predictable, failsafe execution
 */

class ExecutionBias {
    constructor() {
        // Execution bias configuration (simple, predictable rules)
        this.biasConfig = {
            // When to trigger execution bias
            deferral_threshold: {
                max_deferral_time: 30000,        // 30 seconds of continuous deferral
                max_deferral_count: 5,           // 5 consecutive deferrals
                governance_deadlock: true        // All authorities in deferral state
            },
            
            // Safe default actions (when system can't decide)
            safe_defaults: {
                low_risk_action: 'monitor',        // Default to monitoring
                minimal_exposure: true,           // Use minimal exposure actions
                human_review_required: false,     // Don't require human review unless critical
                timeout_action: 'safe_default'     // What to do on timeout
            },
            
            // Execution forcing rules
            force_execution: {
                max_governance_loop_time: 10000,  // 10 seconds max governance evaluation
                min_confidence_for_block: 0.2,    // Block only if confidence < 20%
                require_explanation: false,       // Don't require explanation in bias mode
                fallback_priority: 'safety'        // 'safety' or 'utility'
            },
            
            // Action definitions
            actions: {
                proceed: {
                    description: 'Continue with original action',
                    risk_level: 'normal',
                    requires_validation: false
                },
                monitor: {
                    description: 'Monitor without action',
                    risk_level: 'low',
                    requires_validation: false
                },
                safe_default: {
                    description: 'Apply safe default behavior',
                    risk_level: 'low',
                    requires_validation: false
                },
                human_review: {
                    description: 'Escalate to human review',
                    risk_level: 'minimal',
                    requires_validation: true
                }
            }
        };

        // Execution tracking
        this.executionHistory = [];
        this.deferralTracking = {
            current_deferral_count: 0,
            deferral_start_time: null,
            last_deferral_reset: null
        };
        
        // Bias metrics
        this.biasMetrics = {
            total_bias_activations: 0,
            forced_executions: 0,
            safe_defaults_applied: 0,
            human_escalations: 0,
            governance_overrides: 0
        };
    }

    // CORE EXECUTION BIAS FUNCTION
    shouldForceExecution(governanceResult, authorities, conflicts) {
        const startTime = Date.now();
        
        try {
            // Check if we're in a deferral deadlock
            const deadlockCheck = this.checkDeferralDeadlock(governanceResult, authorities, conflicts);
            
            if (deadlockCheck.in_deadlock) {
                const forcedAction = this.resolveDeadlock(governanceResult, authorities, conflicts);
                this.recordBiasActivation('deadlock_resolution', forcedAction, deadlockCheck);
                return forcedAction;
            }
            
            // Check for governance timeout
            const timeoutCheck = this.checkGovernanceTimeout(governanceResult, startTime);
            
            if (timeoutCheck.timed_out) {
                const forcedAction = this.resolveTimeout(governanceResult, authorities);
                this.recordBiasActivation('timeout_resolution', forcedAction, timeoutCheck);
                return forcedAction;
            }
            
            // Check for excessive deferral count
            const deferralCheck = this.checkExcessiveDeferral(governanceResult);
            
            if (deferralCheck.excessive_deferral) {
                const forcedAction = this.resolveExcessiveDeferral(governanceResult, authorities);
                this.recordBiasActivation('excessive_deferral_resolution', forcedAction, deferralCheck);
                return forcedAction;
            }
            
            // No bias activation needed
            return {
                should_force: false,
                reason: 'No execution bias conditions met',
                bias_triggered: false
            };
            
        } catch (error) {
            console.error('[EXECUTION BIAS] Bias check failed:', error);
            // Fail safe to safe default
            const safeDefault = this.createSafeDefaultAction('bias_error');
            this.recordBiasActivation('error_fallback', safeDefault, { error: error.message });
            return safeDefault;
        }
    }

    // DEADLOCK DETECTION AND RESOLUTION

    checkDeferralDeadlock(governanceResult, authorities, conflicts) {
        const config = this.biasConfig.deferral_threshold;
        
        // Check 1: All authorities in deferral state
        const allDeferring = Object.values(authorities).every(authority => 
            authority.action === 'defer' || authority.action === 'block'
        );
        
        // Check 2: Governance itself deferring
        const governanceDeferring = governanceResult.action === 'defer' || 
                                   governanceResult.action === 'block';
        
        // Check 3: High conflict count with low confidence
        const highConflictLowConfidence = conflicts.length > 2 && 
            Object.values(authorities).every(a => a.confidence < 0.5);
        
        const inDeadlock = (allDeferring && governanceDeferring) || 
                           (highConflictLowConfidence && governanceDeferring);
        
        return {
            in_deadlock: inDeadlock,
            all_deferring: allDeferring,
            governance_deferring: governanceDeferring,
            high_conflict_low_confidence: highConflictLowConfidence,
            conflict_count: conflicts.length,
            avg_confidence: Object.values(authorities).reduce((sum, a) => sum + a.confidence, 0) / Object.keys(authorities).length
        };
    }

    resolveDeadlock(governanceResult, authorities, conflicts) {
        console.warn('[EXECUTION BIAS] Deferral deadlock detected - forcing execution');
        
        // Priority 1: If any authority has reasonable confidence, use it
        const reasonableAuthority = Object.values(authorities).find(a => a.confidence >= 0.4);
        
        if (reasonableAuthority) {
            return {
                should_force: true,
                forced_action: reasonableAuthority.action,
                forced_reasoning: `Deadlock resolved: selected reasonable authority (${reasonableAuthority.source}) with confidence ${reasonableAuthority.confidence.toFixed(2)}`,
                bias_triggered: 'deadlock_resolution',
                bias_priority: 'reasonable_confidence',
                selected_authority: reasonableAuthority.source
            };
        }
        
        // Priority 2: Apply safe default action
        return this.createSafeDefaultAction('deadlock');
    }

    // TIMEOUT HANDLING

    checkGovernanceTimeout(governanceResult, startTime) {
        const maxTime = this.biasConfig.force_execution.max_governance_loop_time;
        const elapsedTime = Date.now() - startTime;
        
        return {
            timed_out: elapsedTime > maxTime,
            elapsed_time: elapsedTime,
            max_time: maxTime
        };
    }

    resolveTimeout(governanceResult, authorities) {
        console.warn('[EXECUTION BIAS] Governance timeout - forcing execution');
        
        // On timeout, prefer the most confident authority
        const mostConfident = Object.values(authorities).reduce((best, current) => 
            current.confidence > best.confidence ? current : best
        );
        
        return {
            should_force: true,
            forced_action: mostConfident.action,
            forced_reasoning: `Timeout resolved: selected most confident authority (${mostConfident.source}) with confidence ${mostConfident.confidence.toFixed(2)}`,
            bias_triggered: 'timeout_resolution',
            bias_priority: 'most_confident',
            selected_authority: mostConfident.source
        };
    }

    // EXCESSIVE DEFERRAL HANDLING

    checkExcessiveDeferral(governanceResult) {
        const config = this.biasConfig.deferral_threshold;
        
        // Update deferral tracking
        if (governanceResult.action === 'defer') {
            if (!this.deferralTracking.deferral_start_time) {
                this.deferralTracking.deferral_start_time = Date.now();
            }
            this.deferralTracking.current_deferral_count++;
        } else {
            // Reset deferral tracking on successful resolution
            this.deferralTracking.current_deferral_count = 0;
            this.deferralTracking.deferral_start_time = null;
        }
        
        const excessiveCount = this.deferralTracking.current_deferral_count >= config.max_deferral_count;
        const excessiveTime = this.deferralTracking.deferral_start_time && 
                              (Date.now() - this.deferralTracking.deferral_start_time) > config.max_deferral_time;
        
        return {
            excessive_deferral: excessiveCount || excessiveTime,
            deferral_count: this.deferralTracking.current_deferral_count,
            deferral_time: this.deferralTracking.deferral_start_time ? 
                Date.now() - this.deferralTracking.deferral_start_time : 0,
            max_count: config.max_deferral_count,
            max_time: config.max_deferral_time
        };
    }

    resolveExcessiveDeferral(governanceResult, authorities) {
        console.warn('[EXECUTION BIAS] Excessive deferral - forcing execution');
        
        // After excessive deferral, apply safe default
        return this.createSafeDefaultAction('excessive_deferral');
    }

    // SAFE DEFAULT ACTIONS

    createSafeDefaultAction(reason) {
        const config = this.biasConfig.safe_defaults;
        
        let action = 'monitor';
        let reasoning = '';
        
        if (reason === 'deadlock') {
            action = 'safe_default';
            reasoning = 'Deadlock resolved: applying safe default action to prevent paralysis';
        } else if (reason === 'excessive_deferral') {
            action = 'safe_default';
            reasoning = 'Excessive deferral resolved: applying safe default action to restore functionality';
        } else if (reason === 'timeout') {
            action = 'safe_default';
            reasoning = 'Timeout resolved: applying safe default action to ensure responsiveness';
        } else {
            action = config.low_risk_action;
            reasoning = `Safe default applied: ${reason}`;
        }
        
        const actionDef = this.biasConfig.actions[action] || this.biasConfig.actions.monitor;
        
        this.biasMetrics.safe_defaults_applied++;
        
        return {
            should_force: true,
            forced_action: action,
            forced_reasoning: reasoning,
            bias_triggered: 'safe_default',
            bias_priority: 'safety_first',
            action_definition: actionDef,
            risk_level: actionDef.risk_level
        };
    }

    // EXECUTION VALIDATION

    validateForcedExecution(forcedAction, originalGovernance) {
        // Validate that forced action doesn't violate critical safety constraints
        const criticalViolations = [];
        
        // Check if forced action is 'proceed' but governance had hard block
        if (forcedAction.forced_action === 'proceed' && 
            originalGovernance.policy_authority?.action === 'HARD_BLOCK') {
            criticalViolations.push('hard_block_override');
        }
        
        // Check if forced action has reasonable confidence
        if (forcedAction.forced_action === 'proceed' && 
           (!forcedAction.selected_authority || forcedAction.selected_authority === 'governance')) {
            criticalViolations.push('low_confidence_proceed');
        }
        
        return {
            valid: criticalViolations.length === 0,
            violations: criticalViolations,
            recommendation: criticalViolations.length > 0 ? 'human_review' : 'execute'
        };
    }

    // RECORDING AND TRACKING

    recordBiasActivation(triggerType, forcedAction, context) {
        const record = {
            timestamp: new Date().toISOString(),
            trigger_type: triggerType,
            forced_action: forcedAction,
            context: context,
            deferral_count: this.deferralTracking.current_deferral_count,
            deferral_time: this.deferralTracking.deferral_start_time ? 
                Date.now() - this.deferralTracking.deferral_start_time : null
        };
        
        this.executionHistory.push(record);
        this.biasMetrics.total_bias_activations++;
        
        if (forcedAction.should_force) {
            this.biasMetrics.forced_executions++;
        }
        
        // Keep only last 1000 records
        if (this.executionHistory.length > 1000) {
            this.executionHistory = this.executionHistory.slice(-1000);
        }
        
        console.log(`[EXECUTION BIAS] ${triggerType}: ${forcedAction.forced_action} - ${forcedAction.forced_reasoning}`);
    }

    // CONFIGURATION MANAGEMENT

    updateBiasConfig(category, ruleName, value) {
        if (this.biasConfig[category] && this.biasConfig[category].hasOwnProperty(ruleName)) {
            const oldValue = this.biasConfig[category][ruleName];
            this.biasConfig[category][ruleName] = value;
            console.log(`[EXECUTION BIAS] Config updated: ${category}.${ruleName} ${oldValue} → ${value}`);
        } else {
            throw new Error(`Unknown bias config: ${category}.${ruleName}`);
        }
    }

    // MONITORING AND ANALYTICS

    getBiasMetrics() {
        const recentActivations = this.executionHistory.slice(-50);
        const recentForced = recentActivations.filter(a => a.forced_action && a.forced_action.should_force);
        
        const recentActivationRate = recentActivations.length > 0 ? 
            recentForced.length / recentActivations.length : 0;
        
        return {
            ...this.biasMetrics,
            recent_activation_rate: recentActivationRate,
            current_deferral_count: this.deferralTracking.current_deferral_count,
            current_deferral_time: this.deferralTracking.deferral_start_time ? 
                Date.now() - this.deferralTracking.deferral_start_time : null,
            deferral_threshold: this.biasConfig.deferral_threshold,
            safe_defaults: this.biasConfig.safe_defaults,
            force_execution: this.biasConfig.force_execution
        };
    }

    calculateBiasHealth() {
        const metrics = this.getBiasMetrics();
        
        // Health factors
        const activationRate = metrics.recent_activation_rate || 0;
        const deferralCount = metrics.current_deferral_count || 0;
        const deferralTime = metrics.current_deferral_time || 0;
        
        // System is healthy if bias is not constantly activating
        const healthScore = Math.max(0, 1 - (activationRate * 2)); // Penalize high activation
        
        return {
            healthy: healthScore > 0.7,
            health_score: healthScore,
            activation_rate: activationRate,
            deferral_status: {
                count: deferralCount,
                time_ms: deferralTime,
                status: deferralCount > 3 || deferralTime > 20000 ? 'concerning' : 'normal'
            },
            recommendation: healthScore > 0.7 ? 'stable' : 'monitor_bias_activation'
        };
    }

    getExecutionHistory(limit = 20) {
        return this.executionHistory.slice(-limit);
    }

    // RESET AND RECOVERY

    resetDeferralTracking() {
        this.deferralTracking = {
            current_deferral_count: 0,
            deferral_start_time: null,
            last_deferral_reset: new Date().toISOString()
        };
        
        console.log('[EXECUTION BIAS] Deferral tracking reset');
    }
}

module.exports = ExecutionBias;
