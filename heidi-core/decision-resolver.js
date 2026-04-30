/**
 * Decision Arbiter Module
 * Resolves conflicts between competing truth sources
 * Not CASCADE, not Supabase, not Policy - the fourth thing that ONLY does arbitration
 */

const fs = require('fs').promises;
const path = require('path');
const ResolverGovernance = require('./resolver-governance');
const ExecutionBias = require('./execution-bias');

class DecisionResolver {
    constructor() {
        // Authority weights (can be dynamically adjusted)
        this.authorityWeights = {
            policy: 1.0,        // Hard constraints always win
            memory: 0.8,        // Historical reality when statistically significant
            reasoning: 0.6      // Default driver when no conflict
        };

        // Conflict resolution rules
        this.resolutionRules = {
            // Rule 1: Hard safety constraints always win
            hard_safety_override: true,
            
            // Rule 2: Statistical significance threshold for memory
            memory_significance_threshold: 0.7,
            memory_min_samples: 5,
            
            // Rule 3: Recency decay for memory signals
            memory_recency_half_life: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
            
            // Rule 4: Confidence calibration for reasoning
            reasoning_confidence_threshold: 0.7,
            
            // Rule 5: Deadlock detection and resolution
            deadlock_timeout: 5000, // 5 seconds
            deadlock_resolution: 'conservative' // 'conservative' or 'aggressive'
        };

        // Conflict tracking
        this.conflictHistory = [];
        this.arbitrationStats = {
            total_decisions: 0,
            conflicts_resolved: 0,
            policy_wins: 0,
            memory_wins: 0,
            reasoning_wins: 0,
            deadlocks_resolved: 0
        };
        
        // Resolver Governance - Meta-authority that governs the Decision Resolver
        this.governance = new ResolverGovernance();
        
        // Execution Bias - Dumb but final tie-break authority that forces action
        this.executionBias = new ExecutionBias();
    }

    // CORE ARBITRATION FUNCTION
    async resolveDecision(cascadeOutput, memorySignal, policyConstraints) {
        const startTime = Date.now();
        
        try {
            // Step 1: Extract authority signals
            const authorities = this.extractAuthoritySignals(cascadeOutput, memorySignal, policyConstraints);
            
            // Step 2: Detect conflicts
            const conflicts = this.detectConflicts(authorities);
            
            // Step 3: Governance check - Should we arbitrate?
            const governanceCheck = this.governance.shouldArbitrate(authorities, conflicts);
            
            if (!governanceCheck.should_arbitrate) {
                // Return governance decision instead of arbitration
                return {
                    final_action: governanceCheck.action === 'defer' ? 'block' : governanceCheck.action,
                    winning_authority: 'governance',
                    reasoning: governanceCheck.reason,
                    confidence: 0.0,
                    conflict_resolution: governanceCheck.action,
                    governance_rule: governanceCheck.governance_rule,
                    governance_action: governanceCheck.action
                };
            }
            
            // Step 4: Apply resolution hierarchy (only if governance allows)
            let resolution;
            if (conflicts.length > 0) {
                resolution = await this.resolveConflicts(authorities, conflicts);
                this.arbitrationStats.conflicts_resolved++;
            } else {
                resolution = this.createNoConflictResolution(authorities);
            }
            
            // Step 5: Apply recency decay and confidence calibration
            resolution = this.calibrateResolution(resolution, authorities);
            
            // Step 6: Validate arbitration outcome against governance constraints
            const governanceValidation = this.governance.validateArbitrationOutcome(resolution, authorities, conflicts);
            
            if (!governanceValidation.valid) {
                // Override with governance decision
                return {
                    final_action: governanceValidation.action === 'defer' ? 'block' : governanceValidation.action,
                    winning_authority: 'governance_override',
                    reasoning: governanceValidation.reason,
                    confidence: 0.0,
                    conflict_resolution: 'governance_override',
                    governance_rule: 'outcome_validation',
                    original_resolution: resolution
                };
            }
            
            // Step 7: Execution Bias check - Final authority that forces action when governance collapses
            const executionBiasCheck = this.executionBias.shouldForceExecution(governanceValidation.valid ? resolution : governanceValidation, authorities, conflicts);
            
            if (executionBiasCheck.should_force) {
                // Validate forced execution against critical safety constraints
                const biasValidation = this.executionBias.validateForcedExecution(executionBiasCheck, {
                    policy_authority: authorities.policy,
                    governance_result: governanceValidation
                });
                
                if (!biasValidation.valid) {
                    // Critical safety violation - escalate to human review
                    return {
                        final_action: 'human_review',
                        winning_authority: 'execution_bias_safety',
                        reasoning: `Critical safety violation in forced execution: ${biasValidation.violations.join(', ')}`,
                        confidence: 0.0,
                        conflict_resolution: 'safety_escalation',
                        bias_triggered: 'safety_violation',
                        violations: biasValidation.violations
                    };
                }
                
                // Apply forced execution
                return {
                    final_action: executionBiasCheck.forced_action,
                    winning_authority: 'execution_bias',
                    reasoning: executionBiasCheck.forced_reasoning,
                    confidence: executionBiasCheck.selected_authority ? 
                        authorities[executionBiasCheck.selected_authority]?.confidence || 0.5 : 0.3,
                    conflict_resolution: 'execution_bias_override',
                    bias_triggered: executionBiasCheck.bias_triggered,
                    bias_priority: executionBiasCheck.bias_priority,
                    original_resolution: resolution
                };
            }
            
            // Step 8: Record arbitration
            this.recordArbitration(authorities, conflicts, resolution, Date.now() - startTime);
            
            return resolution;

        } catch (error) {
            console.error('[DECISION RESOLVER] Arbitration failed:', error);
            return this.createFallbackResolution(cascadeOutput, error);
        }
    }

    // STEP 1: Extract authority signals
    extractAuthoritySignals(cascadeOutput, memorySignal, policyConstraints) {
        return {
            reasoning: {
                source: 'cascade',
                action: 'proceed',
                confidence: cascadeOutput.strategic_theme_confidence || 0.5,
                value: cascadeOutput.v3_adjusted_score || 0,
                theme: cascadeOutput.strategic_theme,
                reasoning: 'High value task with strategic alignment',
                timestamp: new Date().toISOString(),
                weight: this.authorityWeights.reasoning
            },
            
            memory: {
                source: 'supabase',
                action: memorySignal.rollingAccuracy > 0.6 ? 'proceed' : 'block',
                confidence: this.calculateMemoryConfidence(memorySignal),
                value: memorySignal.rollingAccuracy || 0.5,
                theme: memorySignal.theme,
                reasoning: `Historical accuracy: ${(memorySignal.rollingAccuracy * 100).toFixed(1)}%`,
                timestamp: memorySignal.last_updated || new Date().toISOString(),
                samples: memorySignal.correct + memorySignal.incorrect || 0,
                weight: this.authorityWeights.memory
            },
            
            policy: {
                source: 'policy_override',
                action: policyConstraints.authorized ? 'proceed' : 'block',
                confidence: 1.0, // Policy constraints are binary
                value: policyConstraints.authorized ? 1.0 : 0.0,
                theme: policyConstraints.theme || 'unknown',
                reasoning: policyConstraints.message || 'Policy constraint',
                timestamp: new Date().toISOString(),
                constraint_type: policyConstraints.action || 'unknown',
                weight: this.authorityWeights.policy
            }
        };
    }

    // STEP 2: Detect conflicts
    detectConflicts(authorities) {
        const conflicts = [];
        
        // Conflict 1: Policy vs Reasoning
        if (authorities.policy.action === 'block' && authorities.reasoning.action === 'proceed') {
            conflicts.push({
                type: 'policy_reasoning',
                authorities: ['policy', 'reasoning'],
                severity: 'high',
                description: 'Policy blocks reasoning recommendation'
            });
        }
        
        // Conflict 2: Memory vs Reasoning
        if (authorities.memory.action === 'block' && authorities.reasoning.action === 'proceed') {
            conflicts.push({
                type: 'memory_reasoning',
                authorities: ['memory', 'reasoning'],
                severity: this.calculateConflictSeverity(authorities.memory, authorities.reasoning),
                description: 'Memory blocks reasoning recommendation'
            });
        }
        
        // Conflict 3: Policy vs Memory
        if (authorities.policy.action === 'proceed' && authorities.memory.action === 'block') {
            conflicts.push({
                type: 'policy_memory',
                authorities: ['policy', 'memory'],
                severity: 'medium',
                description: 'Policy allows but memory blocks'
            });
        }
        
        // Conflict 4: Three-way disagreement
        const actions = [authorities.policy.action, authorities.memory.action, authorities.reasoning.action];
        if (new Set(actions).size === 3) {
            conflicts.push({
                type: 'three_way_disagreement',
                authorities: ['policy', 'memory', 'reasoning'],
                severity: 'critical',
                description: 'All three authorities disagree'
            });
        }
        
        return conflicts;
    }

    // STEP 3: Resolve conflicts using hierarchy
    async resolveConflicts(authorities, conflicts) {
        // Rule 1: Hard safety constraints always win
        const hardSafetyConflict = conflicts.find(c => 
            c.type === 'policy_reasoning' && 
            authorities.policy.constraint_type === 'HARD_BLOCK'
        );
        
        if (hardSafetyConflict) {
            this.arbitrationStats.policy_wins++;
            return {
                final_action: 'block',
                winning_authority: 'policy',
                reasoning: 'Hard safety constraint overrides all other considerations',
                confidence: 1.0,
                conflict_resolution: 'hierarchy_rule_1'
            };
        }
        
        // Rule 2: Statistical significance for memory
        const memoryConflict = conflicts.find(c => c.authorities.includes('memory'));
        if (memoryConflict && this.isMemoryStatisticallySignificant(authorities.memory)) {
            this.arbitrationStats.memory_wins++;
            return {
                final_action: authorities.memory.action,
                winning_authority: 'memory',
                reasoning: authorities.memory.reasoning,
                confidence: authorities.memory.confidence,
                conflict_resolution: 'hierarchy_rule_2'
            };
        }
        
        // Rule 3: Weighted authority resolution
        const weightedDecision = this.calculateWeightedDecision(authorities);
        this.arbitrationStats.reasoning_wins++;
        
        return {
            final_action: weightedDecision.action,
            winning_authority: 'weighted_arbitration',
            reasoning: `Weighted decision: ${weightedDecision.reasoning}`,
            confidence: weightedDecision.confidence,
            conflict_resolution: 'hierarchy_rule_3',
            authority_weights: this.authorityWeights
        };
    }

    // STEP 4: Calibrate resolution
    calibrateResolution(resolution, authorities) {
        // Apply recency decay to memory influence
        if (resolution.winning_authority === 'memory') {
            const recencyFactor = this.calculateRecencyDecay(authorities.memory);
            resolution.confidence *= recencyFactor;
        }
        
        // Apply confidence calibration for reasoning
        if (resolution.winning_authority === 'reasoning') {
            if (authorities.reasoning.confidence < this.resolutionRules.reasoning_confidence_threshold) {
                resolution.confidence *= 0.8; // Penalize low confidence reasoning
            }
        }
        
        return resolution;
    }

    // HELPER METHODS
    
    calculateMemoryConfidence(memorySignal) {
        const samples = memorySignal.correct + memorySignal.incorrect || 0;
        if (samples < this.resolutionRules.memory_min_samples) {
            return 0.3; // Low confidence for insufficient data
        }
        
        // Confidence based on sample size and consistency
        const sampleConfidence = Math.min(1.0, samples / 20); // Scale to 20 samples = full confidence
        const accuracyConfidence = memorySignal.rolling_accuracy || 0.5;
        
        return (sampleConfidence + accuracyConfidence) / 2;
    }

    calculateConflictSeverity(authority1, authority2) {
        const confidenceGap = Math.abs(authority1.confidence - authority2.confidence);
        const valueGap = Math.abs(authority1.value - authority2.value);
        
        if (confidenceGap > 0.5 || valueGap > 0.7) {
            return 'high';
        } else if (confidenceGap > 0.3 || valueGap > 0.4) {
            return 'medium';
        }
        
        return 'low';
    }

    isMemoryStatisticallySignificant(memoryAuthority) {
        return memoryAuthority.samples >= this.resolutionRules.memory_min_samples &&
               memoryAuthority.confidence >= this.resolutionRules.memory_significance_threshold;
    }

    calculateWeightedDecision(authorities) {
        let proceedWeight = 0;
        let blockWeight = 0;
        
        Object.values(authorities).forEach(authority => {
            const weight = authority.weight * authority.confidence;
            if (authority.action === 'proceed') {
                proceedWeight += weight;
            } else {
                blockWeight += weight;
            }
        });
        
        const totalWeight = proceedWeight + blockWeight;
        const proceedProbability = totalWeight > 0 ? proceedWeight / totalWeight : 0.5;
        
        return {
            action: proceedProbability > 0.5 ? 'proceed' : 'block',
            confidence: Math.abs(proceedProbability - 0.5) * 2, // Convert to 0-1 scale
            reasoning: `Weighted vote: proceed=${proceedWeight.toFixed(2)}, block=${blockWeight.toFixed(2)}`
        };
    }

    calculateRecencyDecay(memoryAuthority) {
        const now = Date.now();
        const memoryTime = new Date(memoryAuthority.timestamp).getTime();
        const age = now - memoryTime;
        const halfLife = this.resolutionRules.memory_recency_half_life;
        
        // Exponential decay
        return Math.pow(0.5, age / halfLife);
    }

    createNoConflictResolution(authorities) {
        // No conflicts - proceed with highest confidence authority
        const authoritiesArray = Object.values(authorities);
        const bestAuthority = authoritiesArray.reduce((best, current) => 
            current.confidence > best.confidence ? current : best
        );
        
        return {
            final_action: bestAuthority.action,
            winning_authority: bestAuthority.source,
            reasoning: bestAuthority.reasoning,
            confidence: bestAuthority.confidence,
            conflict_resolution: 'no_conflict'
        };
    }

    createFallbackResolution(cascadeOutput, error) {
        return {
            final_action: 'block', // Fail safe
            winning_authority: 'fallback',
            reasoning: `Arbitration failed: ${error.message}`,
            confidence: 0.0,
            conflict_resolution: 'fallback_error',
            error: error.message
        };
    }

    recordArbitration(authorities, conflicts, resolution, duration) {
        const record = {
            timestamp: new Date().toISOString(),
            duration_ms: duration,
            authorities: authorities,
            conflicts: conflicts,
            resolution: resolution,
            arbitration_stats: { ...this.arbitrationStats }
        };
        
        this.conflictHistory.push(record);
        
        // Keep only last 1000 records
        if (this.conflictHistory.length > 1000) {
            this.conflictHistory = this.conflictHistory.slice(-1000);
        }
        
        this.arbitrationStats.total_decisions++;
        
        // Log significant conflicts
        if (conflicts.some(c => c.severity === 'critical')) {
            console.warn('[DECISION RESOLVER] Critical conflict resolved:', resolution);
        }
    }

    // DYNAMIC AUTHORITY MANAGEMENT
    
    updateAuthorityWeight(authority, weight) {
        if (this.authorityWeights.hasOwnProperty(authority)) {
            const oldWeight = this.authorityWeights[authority];
            this.authorityWeights[authority] = Math.max(0.0, Math.min(1.0, weight));
            console.log(`[DECISION RESOLVER] Authority weight updated: ${authority} ${oldWeight} → ${weight}`);
        } else {
            throw new Error(`Unknown authority: ${authority}`);
        }
    }

    updateResolutionRule(ruleName, value) {
        if (this.resolutionRules.hasOwnProperty(ruleName)) {
            const oldValue = this.resolutionRules[ruleName];
            this.resolutionRules[ruleName] = value;
            console.log(`[DECISION RESOLVER] Resolution rule updated: ${ruleName} ${oldValue} → ${value}`);
        } else {
            throw new Error(`Unknown resolution rule: ${ruleName}`);
        }
    }

    // MONITORING AND ANALYTICS
    
    getArbitrationStats() {
        const recentConflicts = this.conflictHistory.slice(-100);
        const conflictRate = recentConflicts.filter(r => r.conflicts.length > 0).length / recentConflicts.length;
        
        return {
            ...this.arbitrationStats,
            recent_conflict_rate: conflictRate,
            authority_weights: { ...this.authorityWeights },
            resolution_rules: { ...this.resolutionRules },
            total_conflicts: this.conflictHistory.filter(r => r.conflicts.length > 0).length
        };
    }

    getConflictHistory(limit = 20) {
        return this.conflictHistory.slice(-limit);
    }

    getSystemHealth() {
        const stats = this.getArbitrationStats();
        const conflictRate = stats.recent_conflict_rate;
        
        return {
            healthy: conflictRate < 0.3, // Healthy if less than 30% conflicts
            conflict_rate: conflictRate,
            arbitration_stability: stats.total_decisions > 0 ? 
                (stats.conflicts_resolved / stats.total_decisions) : 0,
            authority_balance: {
                policy_dominance: stats.policy_wins / Math.max(1, stats.conflicts_resolved),
                memory_dominance: stats.memory_wins / Math.max(1, stats.conflicts_resolved),
                reasoning_dominance: stats.reasoning_wins / Math.max(1, stats.conflicts_resolved)
            }
        };
    }
}

module.exports = DecisionResolver;
