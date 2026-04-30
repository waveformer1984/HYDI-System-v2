/**
 * Resolver Governance Rules
 * Meta-authority that governs the Decision Resolver
 * Defines when arbitration is allowed, when it must defer, and when to escalate
 */

class ResolverGovernance {
    constructor() {
        // Governance rules for the Decision Resolver
        this.governanceRules = {
            // Rule 1: Arbitration permission conditions
            arbitration_allowed: {
                min_authority_confidence: 0.3,      // At least one authority must be confident
                max_confidence_gap: 0.8,             // Gap between authorities can't be too large
                min_data_points: 3,                   // Need minimum data for statistical decisions
                temporal_consistency_window: 24 * 60 * 60 * 1000 // 24 hours
            },
            
            // Rule 2: Mandatory defer conditions
            must_defer: {
                low_confidence_multi_conflict: 0.4,   // All authorities < 40% confidence
                high_uncertainty_threshold: 0.7,      // Overall uncertainty > 70%
                insufficient_observability: true,       // Not enough data to decide
                temporal_instability: true,            // Rapidly changing signals
                structural_ambiguity: true              // Fundamentally ambiguous situation
            },
            
            // Rule 3: Escalation triggers
            must_escalate: {
                policy_memory_conflict: true,          // Policy conflicts with memory
                systemic_disagreement: true,           // All three authorities disagree
                confidence_decay_pattern: true,       // Confidence trending down
                cascade_failure_pattern: true,        // Repeated arbitration failures
                authority_balance_disruption: true     // Authority weights become unstable
            },
            
            // Rule 4: Resolution constraints
            resolution_constraints: {
                max_arbitration_time: 10000,          // 10 seconds max arbitration time
                min_resolution_confidence: 0.6,        // Resolution must meet minimum confidence
                require_explanation: true,             // Must provide reasoning
                track_arbitration_outcome: true        // Must track if arbitration was correct
            }
        };

        // Escalation tracking
        this.escalationHistory = [];
        this.deferredDecisions = [];
        this.arbitrationOutcomes = [];
        
        // Governance metrics
        this.governanceMetrics = {
            total_arbitrations: 0,
            deferred_decisions: 0,
            escalated_decisions: 0,
            governance_overrides: 0,
            arbitration_failures: 0
        };
    }

    // CORE GOVERNANCE FUNCTION
    shouldArbitrate(authorities, conflicts) {
        const startTime = Date.now();
        
        try {
            // Check if arbitration is allowed
            const permissionCheck = this.checkArbitrationPermission(authorities, conflicts);
            if (!permissionCheck.allowed) {
                return {
                    should_arbitrate: false,
                    action: permissionCheck.action,
                    reason: permissionCheck.reason,
                    governance_rule: permissionCheck.rule
                };
            }
            
            // Check for mandatory defer conditions
            const deferCheck = this.checkMandatoryDefer(authorities, conflicts);
            if (deferCheck.must_defer) {
                this.recordDeferredDecision(authorities, conflicts, deferCheck);
                return {
                    should_arbitrate: false,
                    action: 'defer',
                    reason: deferCheck.reason,
                    governance_rule: deferCheck.rule,
                    defer_conditions: deferCheck.conditions
                };
            }
            
            // Check for escalation triggers
            const escalationCheck = this.checkEscalationTriggers(authorities, conflicts);
            if (escalationCheck.must_escalate) {
                this.recordEscalation(authorities, conflicts, escalationCheck);
                return {
                    should_arbitrate: false,
                    action: 'escalate',
                    reason: escalationCheck.reason,
                    governance_rule: escalationCheck.rule,
                    escalation_triggers: escalationCheck.triggers
                };
            }
            
            // Arbitration is allowed and not deferred/escalated
            return {
                should_arbitrate: true,
                action: 'arbitrate',
                reason: 'All governance checks passed',
                governance_rules_applied: permissionCheck.rules_checked
            };
            
        } catch (error) {
            console.error('[RESOLVER GOVERNANCE] Governance check failed:', error);
            return {
                should_arbitrate: false,
                action: 'governance_error',
                reason: `Governance check failed: ${error.message}`,
                error: error.message
            };
        } finally {
            this.governanceMetrics.total_arbitrations++;
        }
    }

    // GOVERNANCE CHECKS

    checkArbitrationPermission(authorities, conflicts) {
        const rules = this.governanceRules.arbitration_allowed;
        const rulesChecked = [];
        
        // Check 1: Minimum authority confidence
        const maxConfidence = Math.max(...Object.values(authorities).map(a => a.confidence));
        if (maxConfidence < rules.min_authority_confidence) {
            return {
                allowed: false,
                action: 'block',
                reason: `All authorities below confidence threshold: ${maxConfidence.toFixed(2)} < ${rules.min_authority_confidence}`,
                rule: 'min_authority_confidence'
            };
        }
        rulesChecked.push('min_authority_confidence');
        
        // Check 2: Maximum confidence gap
        const confidences = Object.values(authorities).map(a => a.confidence);
        const confidenceGap = Math.max(...confidences) - Math.min(...confidences);
        if (confidenceGap > rules.max_confidence_gap) {
            return {
                allowed: false,
                action: 'defer',
                reason: `Confidence gap too large: ${confidenceGap.toFixed(2)} > ${rules.max_confidence_gap}`,
                rule: 'max_confidence_gap'
            };
        }
        rulesChecked.push('max_confidence_gap');
        
        // Check 3: Minimum data points
        const totalDataPoints = Object.values(authorities).reduce((sum, a) => sum + (a.samples || 0), 0);
        if (totalDataPoints < rules.min_data_points) {
            return {
                allowed: false,
                action: 'defer',
                reason: `Insufficient data points: ${totalDataPoints} < ${rules.min_data_points}`,
                rule: 'min_data_points'
            };
        }
        rulesChecked.push('min_data_points');
        
        // Check 4: Temporal consistency
        const timestamps = Object.values(authorities).map(a => new Date(a.timestamp).getTime());
        const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);
        if (timeSpan > rules.temporal_consistency_window) {
            return {
                allowed: false,
                action: 'defer',
                reason: `Temporal inconsistency: ${timeSpan / (1000 * 60 * 60)} hours span`,
                rule: 'temporal_consistency_window'
            };
        }
        rulesChecked.push('temporal_consistency_window');
        
        return {
            allowed: true,
            rules_checked: rulesChecked
        };
    }

    checkMandatoryDefer(authorities, conflicts) {
        const rules = this.governanceRules.must_defer;
        const conditions = [];
        
        // Check 1: Low confidence multi-conflict
        const maxConfidence = Math.max(...Object.values(authorities).map(a => a.confidence));
        if (maxConfidence < rules.low_confidence_multi_conflict && conflicts.length > 1) {
            conditions.push({
                type: 'low_confidence_multi_conflict',
                value: maxConfidence,
                threshold: rules.low_confidence_multi_conflict
            });
        }
        
        // Check 2: High uncertainty threshold
        const avgConfidence = Object.values(authorities).reduce((sum, a) => sum + a.confidence, 0) / Object.keys(authorities).length;
        const uncertainty = 1 - avgConfidence;
        if (uncertainty > rules.high_uncertainty_threshold) {
            conditions.push({
                type: 'high_uncertainty',
                value: uncertainty,
                threshold: rules.high_uncertainty_threshold
            });
        }
        
        // Check 3: Insufficient observability
        const totalSamples = Object.values(authorities).reduce((sum, a) => sum + (a.samples || 0), 0);
        if (totalSamples < 5 && conflicts.length > 0) { // Low data + conflict = defer
            conditions.push({
                type: 'insufficient_observability',
                value: totalSamples,
                threshold: 5
            });
        }
        
        // Check 4: Temporal instability
        const timestamps = Object.values(authorities).map(a => new Date(a.timestamp).getTime());
        const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);
        if (timeSpan < 60000 && conflicts.length > 1) { // Recent conflicting signals
            conditions.push({
                type: 'temporal_instability',
                value: timeSpan / 1000,
                threshold: 60
            });
        }
        
        // Check 5: Structural ambiguity
        const uniqueActions = new Set(Object.values(authorities).map(a => a.action));
        if (uniqueActions.size === 3 && conflicts.length > 1) { // All three disagree
            conditions.push({
                type: 'structural_ambiguity',
                value: uniqueActions.size,
                threshold: 3
            });
        }
        
        return {
            must_defer: conditions.length > 0,
            conditions,
            rule: conditions.length > 0 ? conditions[0].type : null
        };
    }

    checkEscalationTriggers(authorities, conflicts) {
        const rules = this.governanceRules.must_escalate;
        const triggers = [];
        
        // Check 1: Policy-memory conflict
        const policyAction = authorities.policy?.action;
        const memoryAction = authorities.memory?.action;
        if (policyAction && memoryAction && policyAction !== memoryAction) {
            triggers.push({
                type: 'policy_memory_conflict',
                policy_action: policyAction,
                memory_action: memoryAction
            });
        }
        
        // Check 2: Systemic disagreement
        const uniqueActions = new Set(Object.values(authorities).map(a => a.action));
        if (uniqueActions.size === 3) {
            triggers.push({
                type: 'systemic_disagreement',
                unique_actions: Array.from(uniqueActions)
            });
        }
        
        // Check 3: Confidence decay pattern
        const recentOutcomes = this.arbitrationOutcomes.slice(-5);
        if (recentOutcomes.length >= 3) {
            const confidenceTrend = recentOutcomes.map(o => o.resolution_confidence || 0);
            const isDecaying = confidenceTrend.every((conf, i) => i === 0 || conf < confidenceTrend[i-1]);
            if (isDecaying) {
                triggers.push({
                    type: 'confidence_decay_pattern',
                    trend: 'decreasing',
                    values: confidenceTrend
                });
            }
        }
        
        // Check 4: Cascade failure pattern
        const recentDeferred = this.deferredDecisions.slice(-3);
        if (recentDeferred.length >= 2) {
            triggers.push({
                type: 'cascade_failure_pattern',
                recent_deferred: recentDeferred.length,
                pattern: 'repeated_deferral'
            });
        }
        
        // Check 5: Authority balance disruption
        const weights = { policy: 1.0, memory: 0.8, reasoning: 0.6 }; // These should match DecisionResolver
        const actualDominance = this.calculateAuthorityDominance(authorities);
        const expectedDominance = Object.keys(weights).sort((a, b) => weights[b] - weights[a]);
        const isDisrupted = JSON.stringify(actualDominance) !== JSON.stringify(expectedDominance);
        
        if (isDisrupted) {
            triggers.push({
                type: 'authority_balance_disruption',
                actual_dominance: actualDominance,
                expected_dominance: expectedDominance
            });
        }
        
        return {
            must_escalate: triggers.length > 0,
            triggers,
            rule: triggers.length > 0 ? triggers[0].type : null
        };
    }

    // POST-ARBITRATION GOVERNANCE

    validateArbitrationOutcome(arbitrationResult, authorities, conflicts) {
        const constraints = this.governanceRules.resolution_constraints;
        
        // Check 1: Resolution confidence threshold
        if (arbitrationResult.confidence < constraints.min_resolution_confidence) {
            return {
                valid: false,
                reason: `Resolution confidence too low: ${arbitrationResult.confidence.toFixed(2)} < ${constraints.min_resolution_confidence}`,
                action: 'defer'
            };
        }
        
        // Check 2: Explanation requirement
        if (!arbitrationResult.reasoning || arbitrationResult.reasoning.length < 10) {
            return {
                valid: false,
                reason: 'Insufficient explanation provided',
                action: 'require_explanation'
            };
        }
        
        // Check 3: Track outcome for learning
        this.recordArbitrationOutcome(arbitrationResult, authorities, conflicts);
        
        return {
            valid: true,
            reason: 'Arbitration outcome meets governance constraints'
        };
    }

    // HELPER METHODS

    calculateAuthorityDominance(authorities) {
        const sorted = Object.entries(authorities)
            .sort(([,a], [,b]) => b.confidence - a.confidence)
            .map(([name]) => name);
        return sorted;
    }

    recordDeferredDecision(authorities, conflicts, deferCheck) {
        const record = {
            timestamp: new Date().toISOString(),
            authorities: authorities,
            conflicts: conflicts,
            defer_conditions: deferCheck.conditions,
            governance_rule: deferCheck.rule
        };
        
        this.deferredDecisions.push(record);
        this.governanceMetrics.deferred_decisions++;
        
        // Keep only last 100 records
        if (this.deferredDecisions.length > 100) {
            this.deferredDecisions = this.deferredDecisions.slice(-100);
        }
        
        console.log(`[GOVERNANCE] Decision deferred: ${deferCheck.rule}`);
    }

    recordEscalation(authorities, conflicts, escalationCheck) {
        const record = {
            timestamp: new Date().toISOString(),
            authorities: authorities,
            conflicts: conflicts,
            escalation_triggers: escalationCheck.triggers,
            governance_rule: escalationCheck.rule
        };
        
        this.escalationHistory.push(record);
        this.governanceMetrics.escalated_decisions++;
        
        // Keep only last 100 records
        if (this.escalationHistory.length > 100) {
            this.escalationHistory = this.escalationHistory.slice(-100);
        }
        
        console.warn(`[GOVERNANCE] Decision escalated: ${escalationCheck.rule}`);
    }

    recordArbitrationOutcome(arbitrationResult, authorities, conflicts) {
        const record = {
            timestamp: new Date().toISOString(),
            arbitration_result: arbitrationResult,
            authorities: authorities,
            conflicts: conflicts,
            resolution_confidence: arbitrationResult.confidence,
            winning_authority: arbitrationResult.winning_authority
        };
        
        this.arbitrationOutcomes.push(record);
        
        // Keep only last 1000 records
        if (this.arbitrationOutcomes.length > 1000) {
            this.arbitrationOutcomes = this.arbitrationOutcomes.slice(-1000);
        }
    }

    // GOVERNANCE MANAGEMENT

    updateGovernanceRule(category, ruleName, value) {
        if (this.governanceRules[category] && this.governanceRules[category].hasOwnProperty(ruleName)) {
            const oldValue = this.governanceRules[category][ruleName];
            this.governanceRules[category][ruleName] = value;
            console.log(`[GOVERNANCE] Rule updated: ${category}.${ruleName} ${oldValue} → ${value}`);
        } else {
            throw new Error(`Unknown governance rule: ${category}.${ruleName}`);
        }
    }

    // MONITORING AND ANALYTICS

    getGovernanceMetrics() {
        const recentArbitrations = this.arbitrationOutcomes.slice(-20);
        const recentDeferrals = this.deferredDecisions.slice(-20);
        const recentEscalations = this.escalationHistory.slice(-20);
        
        return {
            ...this.governanceMetrics,
            recent_arbitration_success_rate: recentArbitrations.length > 0 ? 
                recentArbitrations.filter(a => a.resolution_confidence > 0.6).length / recentArbitrations.length : 0,
            defer_rate: this.governanceMetrics.total_arbitrations > 0 ? 
                this.governanceMetrics.deferred_decisions / this.governanceMetrics.total_arbitrations : 0,
            escalation_rate: this.governanceMetrics.total_arbitrations > 0 ? 
                this.governanceMetrics.escalated_decisions / this.governanceMetrics.total_arbitrations : 0,
            governance_health: this.calculateGovernanceHealth()
        };
    }

    calculateGovernanceHealth() {
        const metrics = this.governanceMetrics;
        
        // Health factors
        const deferRate = metrics.total_arbitrations > 0 ? metrics.deferred_decisions / metrics.total_arbitrations : 0;
        const escalationRate = metrics.total_arbitrations > 0 ? metrics.escalated_decisions / metrics.total_arbitrations : 0;
        
        // Too many deferrals or escalations indicates system instability
        const stabilityScore = Math.max(0, 1 - (deferRate + escalationRate));
        
        // Governance is healthy if it's not over-blocking or over-escalating
        return {
            healthy: stabilityScore > 0.7,
            stability_score: stabilityScore,
            defer_rate: deferRate,
            escalation_rate: escalationRate,
            recommendation: stabilityScore > 0.7 ? 'stable' : 'adjust_governance_rules'
        };
    }

    getGovernanceHistory(limit = 20) {
        return {
            deferred_decisions: this.deferredDecisions.slice(-limit),
            escalated_decisions: this.escalationHistory.slice(-limit),
            arbitration_outcomes: this.arbitrationOutcomes.slice(-limit)
        };
    }
}

module.exports = ResolverGovernance;
