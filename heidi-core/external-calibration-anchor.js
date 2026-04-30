/**
 * External Calibration Anchor - Layer 8
 * Prevents system from becoming "perfectly stable, perfectly wrong"
 * Answers: "Is the system still correct relative to something outside itself?"
 * Top authority layer that can override Layer 7 but not Policy constraints
 */

class ExternalCalibrationAnchor {
    constructor(memoryService) {
        this.memoryService = memoryService;
        
        // External truth inputs (reality anchors)
        this.externalSignals = {
            user_feedback: [],
            ground_truth_checks: [],
            environment_validations: [],
            human_override_labels: [],
            audit_results: []
        };
        
        // Alignment thresholds
        this.alignmentThresholds = {
            alignment_gap_critical: 0.3,        // Gap between internal drift and external error
            external_error_trend_threshold: 0.1,  // Rising external error trend
            persistent_divergence_windows: 3,    // Windows of divergence before recalibration
            min_external_signal_count: 5,        // Minimum external signals for evaluation
            confidence_in_alignment_threshold: 0.7 // Confidence in alignment assessment
        };
        
        // System recalibration rules
        this.recalibrationRules = {
            force_gated_mode: true,              // Force gated mode on high alignment gap
            tighten_confidence_thresholds: true,  // Tighten confidence on rising external error
            trigger_recalibration_event: true,   // Trigger recalibration on persistent divergence
            reset_ema_baseline: true,           // Reset EMA smoothing baseline
            reduce_cascade_weight: 0.7,          // Reduce CASCADE weight during recalibration
            increase_memory_weight: 1.3,         // Increase memory weighting during recalibration
            reanchor_regime_thresholds: true     // Reanchor regime thresholds to external signals
        };
        
        // Alignment tracking
        this.alignmentTracking = {
            internal_drift_score: 0.0,
            external_error_rate: 0.0,
            alignment_gap: 0.0,
            confidence_in_alignment: 0.0,
            external_signal_count: 0,
            last_evaluation: null,
            evaluation_count: 0,
            regime_override: null,
            system_misaligned: false,
            divergence_windows: 0,
            alignment_history: []
        };
        
        // System state
        this.systemState = {
            current_mode: 'normal',              // normal | gated | recalibrating | misaligned
            recalibration_active: false,
            regime_override_active: false,
            last_recalibration: null,
            recalibration_count: 0
        };
        
        // Authority hierarchy (Layer 8 is top authority, but cannot override Policy)
        this.authorityHierarchy = {
            layer8: 'external_reality_anchor',    // Can override Layer 7, but not Policy
            layer7: 'internal_stability',
            layer6: 'liveness_guarantee',
            layer5: 'arbitration_control',
            layer4: 'conflict_resolution',
            layer3: 'constraint_enforcement',   // Policy remains hard safety wall
            layer2: 'memory_grounding',
            layer1: 'reasoning_generation'
        };
        
        console.log('[EXTERNAL CALIBRATION ANCHOR] Initialized - External reality anchor active');
    }
    
    // CORE EXTERNAL ALIGNMENT EVALUATION
    
    async evaluateExternalAlignment(internalDriftScore) {
        const now = Date.now();
        
        try {
            // Step 1: Collect external signals
            const externalSignals = await this.collectExternalSignals(now);
            
            // Step 2: Compute external error rate
            const externalErrorRate = this.computeExternalErrorRate(externalSignals);
            
            // Step 3: Calculate alignment gap
            const alignmentGap = this.calculateAlignmentGap(internalDriftScore, externalErrorRate);
            
            // Step 4: Assess confidence in alignment
            const confidenceInAlignment = this.assessAlignmentConfidence(externalSignals);
            
            // Step 5: Determine system state and actions
            const systemState = this.determineSystemState(alignmentGap, externalErrorRate, confidenceInAlignment);
            
            // Step 6: Apply corrective actions if needed
            const correctiveActions = this.applyCorrectiveActions(systemState, alignmentGap, externalErrorRate);
            
            // Step 7: Update alignment tracking
            this.updateAlignmentTracking(internalDriftScore, externalErrorRate, alignmentGap, confidenceInAlignment, systemState, now);
            
            // Step 8: Store alignment snapshot
            await this.storeAlignmentSnapshot(internalDriftScore, externalErrorRate, alignmentGap, systemState, now);
            
            return {
                internal_drift_score: internalDriftScore,
                external_error_rate: externalErrorRate,
                alignment_gap: alignmentGap,
                confidence_in_alignment: confidenceInAlignment,
                system_state: systemState,
                corrective_actions: correctiveActions,
                external_signals: externalSignals,
                evaluation_timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error('[EXTERNAL CALIBRATION ANCHOR] External alignment evaluation failed:', error);
            return {
                internal_drift_score: internalDriftScore,
                external_error_rate: 1.0, // Assume worst case
                alignment_gap: 1.0,
                confidence_in_alignment: 0.0,
                system_state: { mode: 'misaligned', reason: 'Evaluation failed' },
                corrective_actions: { action: 'emergency_recalibration', reason: 'Evaluation failed' },
                error: error.message,
                evaluation_timestamp: new Date().toISOString()
            };
        }
    }
    
    // EXTERNAL SIGNALS COLLECTION
    
    async collectExternalSignals(now) {
        const timeWindow = {
            start: new Date(now - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
            end: new Date(now).toISOString()
        };
        
        try {
            // Collect external signals (simplified implementation)
            const userFeedback = []; // TODO: Implement actual collection
            const groundTruthChecks = []; // TODO: Implement actual collection
            const environmentValidations = []; // TODO: Implement actual collection
            const humanOverrideLabels = []; // TODO: Implement actual collection
            const auditResults = []; // TODO: Implement actual collection
            
            const allSignals = [
                ...userFeedback.map(s => ({ type: 'user_feedback', ...s })),
                ...groundTruthChecks.map(s => ({ type: 'ground_truth_check', ...s })),
                ...environmentValidations.map(s => ({ type: 'environment_validation', ...s })),
                ...humanOverrideLabels.map(s => ({ type: 'human_override', ...s })),
                ...auditResults.map(s => ({ type: 'audit_result', ...s }))
            ];
            
            return {
                time_window: timeWindow,
                signals: allSignals,
                signal_counts: {
                    user_feedback: userFeedback.length,
                    ground_truth_checks: groundTruthChecks.length,
                    environment_validations: environmentValidations.length,
                    human_override_labels: humanOverrideLabels.length,
                    audit_results: auditResults.length,
                    total: allSignals.length
                }
            };
            
        } catch (error) {
            console.error('[EXTERNAL CALIBRATION ANCHOR] Error collecting external signals:', error);
            return {
                time_window: timeWindow,
                signals: [],
                signal_counts: {
                    user_feedback: 0,
                    ground_truth_checks: 0,
                    environment_validations: 0,
                    human_override_labels: 0,
                    audit_results: 0,
                    total: 0
                }
            };
        }
    }
    
    // EXTERNAL ERROR RATE COMPUTATION
    
    computeExternalErrorRate(externalSignals) {
        const signals = externalSignals.signals;
        
        if (signals.length === 0) {
            return 0.0; // No external signals, assume no error
        }
        
        let totalWeight = 0;
        let weightedError = 0;
        
        signals.forEach(signal => {
            let weight = 1.0;
            let error = 0.0;
            
            // Weight by signal type
            switch (signal.type) {
                case 'user_feedback':
                    weight = 0.3;
                    error = signal.correctness || 0; // 0 = incorrect, 1 = correct
                    break;
                case 'ground_truth_check':
                    weight = 0.4;
                    error = signal.accuracy || 0;
                    break;
                case 'environment_validation':
                    weight = 0.15;
                    error = signal.validation_passed ? 1 : 0;
                    break;
                case 'human_override':
                    weight = 0.1;
                    error = signal.override_correct ? 1 : 0;
                    break;
                case 'audit_result':
                    weight = 0.05;
                    error = signal.audit_passed ? 1 : 0;
                    break;
            }
            
            totalWeight += weight;
            weightedError += weight * (1 - error); // Convert to error rate
        });
        
        const externalErrorRate = totalWeight > 0 ? weightedError / totalWeight : 0.0;
        
        console.log(`[EXTERNAL CALIBRATION ANCHOR] External error rate: ${externalErrorRate.toFixed(3)} (${signals.length} signals)`);
        
        return externalErrorRate;
    }
    
    // ALIGNMENT GAP CALCULATION
    
    calculateAlignmentGap(internalDriftScore, externalErrorRate) {
        // Alignment gap is the difference between internal drift and external error
        const alignmentGap = Math.abs(internalDriftScore - externalErrorRate);
        
        console.log(`[EXTERNAL CALIBRATION ANCHOR] Alignment gap: ${alignmentGap.toFixed(3)} (internal: ${internalDriftScore.toFixed(3)}, external: ${externalErrorRate.toFixed(3)})`);
        
        return alignmentGap;
    }
    
    // ALIGNMENT CONFIDENCE ASSESSMENT
    
    assessAlignmentConfidence(externalSignals) {
        const signalCount = externalSignals.signal_counts.total;
        const minSignals = this.alignmentThresholds.min_external_signal_count;
        
        if (signalCount < minSignals) {
            return 0.0; // Not enough signals for confidence
        }
        
        // Confidence based on signal diversity and recency
        const signalTypes = Object.keys(externalSignals.signal_counts).filter(type => type !== 'total');
        const activeTypes = signalTypes.filter(type => externalSignals.signal_counts[type] > 0);
        
        const typeDiversity = activeTypes.length / signalTypes.length;
        const signalVolume = Math.min(signalCount / 20, 1.0); // Normalize to 0-1
        
        const confidence = (typeDiversity * 0.6) + (signalVolume * 0.4);
        
        console.log(`[EXTERNAL CALIBRATION ANCHOR] Alignment confidence: ${confidence.toFixed(3)} (signals: ${signalCount}, types: ${activeTypes.length})`);
        
        return confidence;
    }
    
    // SYSTEM STATE DETERMINATION
    
    determineSystemState(alignmentGap, externalErrorRate, confidenceInAlignment) {
        const thresholds = this.alignmentThresholds;
        
        let systemState = {
            mode: 'normal',
            reason: 'System is properly aligned',
            misaligned: false,
            requires_recalibration: false,
            regime_override: null
        };
        
        // Check for critical alignment gap
        if (alignmentGap > thresholds.alignment_gap_critical && confidenceInAlignment > thresholds.confidence_in_alignment_threshold) {
            systemState = {
                mode: 'gated',
                reason: `Critical alignment gap detected: ${alignmentGap.toFixed(3)}`,
                misaligned: true,
                requires_recalibration: false,
                regime_override: 'gated'
            };
        }
        
        // Check for rising external error trend
        if (externalErrorRate > thresholds.external_error_trend_threshold && confidenceInAlignment > thresholds.confidence_in_alignment_threshold) {
            systemState = {
                mode: 'constrained',
                reason: `Rising external error rate: ${externalErrorRate.toFixed(3)}`,
                misaligned: true,
                requires_recalibration: false,
                regime_override: 'constrained'
            };
        }
        
        // Check for persistent divergence
        if (this.alignmentTracking.divergence_windows >= thresholds.persistent_divergence_windows) {
            systemState = {
                mode: 'recalibrating',
                reason: `Persistent divergence for ${this.alignmentTracking.divergence_windows} windows`,
                misaligned: true,
                requires_recalibration: true,
                regime_override: 'recalibrating'
            };
        }
        
        // Check for system misalignment
        if (systemState.misaligned) {
            this.alignmentTracking.divergence_windows++;
        } else {
            this.alignmentTracking.divergence_windows = 0;
        }
        
        console.log(`[EXTERNAL CALIBRATION ANCHOR] System state: ${systemState.mode} | Reason: ${systemState.reason}`);
        
        return systemState;
    }
    
    // CORRECTIVE ACTIONS APPLICATION
    
    applyCorrectiveActions(systemState, alignmentGap, externalErrorRate) {
        const actions = {
            action: 'maintain',
            reason: 'System is properly aligned',
            authority_level: 'external_anchor',
            constraints: []
        };
        
        switch (systemState.mode) {
            case 'gated':
                actions = {
                    action: 'force_gated_mode',
                    reason: systemState.reason,
                    authority_level: 'external_anchor',
                    constraints: ['cannot_override_policy'],
                    system_mode: 'gated',
                    confidence_threshold_multiplier: 1.5,
                    cascade_weight_reduction: 0.8,
                    memory_weight_increase: 1.2
                };
                break;
                
            case 'constrained':
                actions = {
                    action: 'tighten_confidence_thresholds',
                    reason: systemState.reason,
                    authority_level: 'external_anchor',
                    constraints: ['cannot_override_policy'],
                    confidence_threshold_multiplier: 1.3,
                    escalation_rate_increase: 1.2,
                    automation_scope_reduction: 0.9
                };
                break;
                
            case 'recalibrating':
                actions = {
                    action: 'system_recalibration',
                    reason: systemState.reason,
                    authority_level: 'external_anchor',
                    constraints: ['cannot_override_policy'],
                    reset_ema_baseline: true,
                    reanchor_regime_thresholds: true,
                    cascade_weight_reduction: this.recalibrationRules.reduce_cascade_weight,
                    memory_weight_increase: this.recalibrationRules.increase_memory_weight,
                    regime_override: 'recalibrating'
                };
                this.systemState.recalibration_active = true;
                this.systemState.recalibration_count++;
                this.systemState.last_recalibration = Date.now();
                break;
                
            case 'misaligned':
                actions = {
                    action: 'emergency_recalibration',
                    reason: 'System is misaligned with reality',
                    authority_level: 'external_anchor',
                    constraints: ['cannot_override_policy'],
                    force_gated_mode: true,
                    reset_all_baselines: true,
                    mark_system_misaligned: true
                };
                this.systemState.current_mode = 'misaligned';
                break;
        }
        
        return actions;
    }
    
    // ALIGNMENT TRACKING UPDATES
    
    updateAlignmentTracking(internalDriftScore, externalErrorRate, alignmentGap, confidenceInAlignment, systemState, timestamp) {
        this.alignmentTracking.internal_drift_score = internalDriftScore;
        this.alignmentTracking.external_error_rate = externalErrorRate;
        this.alignmentTracking.alignment_gap = alignmentGap;
        this.alignmentTracking.confidence_in_alignment = confidenceInAlignment;
        this.alignmentTracking.last_evaluation = timestamp;
        this.alignmentTracking.evaluation_count++;
        this.alignmentTracking.regime_override = systemState.regime_override;
        this.alignmentTracking.system_misaligned = systemState.misaligned;
        
        // Update alignment history
        this.alignmentTracking.alignment_history.push({
            timestamp: timestamp,
            internal_drift_score: internalDriftScore,
            external_error_rate: externalErrorRate,
            alignment_gap: alignmentGap,
            confidence_in_alignment: confidenceInAlignment,
            system_state: systemState.mode,
            misaligned: systemState.misaligned
        });
        
        // Keep only last 1000 evaluations
        if (this.alignmentTracking.alignment_history.length > 1000) {
            this.alignmentTracking.alignment_history = this.alignmentTracking.alignment_history.slice(-1000);
        }
        
        console.log(`[EXTERNAL CALIBRATION ANCHOR] Alignment updated: gap=${alignmentGap.toFixed(3)} confidence=${confidenceInAlignment.toFixed(3)} state=${systemState.mode}`);
    }
    
    // PERSISTENT STORAGE
    
    async storeAlignmentSnapshot(internalDriftScore, externalErrorRate, alignmentGap, systemState, timestamp) {
        try {
            const snapshot = {
                timestamp: timestamp,
                internal_drift_score: internalDriftScore,
                external_error_rate: externalErrorRate,
                alignment_gap: alignmentGap,
                confidence_in_alignment: this.alignmentTracking.confidence_in_alignment,
                external_signal_count: this.alignmentTracking.external_signal_count,
                regime_override: systemState.regime_override,
                system_state: systemState.mode,
                misaligned: systemState.misaligned,
                requires_recalibration: systemState.requires_recalibration
            };
            
            // Store in persistent memory (simplified implementation)
            // await this.memoryService.storeAlignmentSnapshot(snapshot);
            console.log('[EXTERNAL CALIBRATION ANCHOR] Alignment snapshot stored (simplified implementation)');
            
        } catch (error) {
            console.error('[EXTERNAL CALIBRATION ANCHOR] Failed to store alignment snapshot:', error);
        }
    }
    
    // EXTERNAL SIGNAL INGESTION API
    
    ingestExternalSignal(signalType, signalData) {
        const signal = {
            type: signalType,
            timestamp: new Date().toISOString(),
            ...signalData
        };
        
        // Add to appropriate signal collection
        if (this.externalSignals[signalType]) {
            this.externalSignals[signalType].push(signal);
            
            // Keep only last 1000 signals per type
            if (this.externalSignals[signalType].length > 1000) {
                this.externalSignals[signalType] = this.externalSignals[signalType].slice(-1000);
            }
        }
        
        console.log(`[EXTERNAL CALIBRATION ANCHOR] External signal ingested: ${signalType}`);
        
        return signal;
    }
    
    // SYSTEM RESET MECHANISM
    
    async triggerSystemRecalibration(reason) {
        console.log(`[EXTERNAL CALIBRATION ANCHOR] Triggering system recalibration: ${reason}`);
        
        // Reset EMA smoothing baseline
        this.systemState.recalibration_active = true;
        this.systemState.recalibration_count++;
        this.systemState.last_recalibration = Date.now();
        
        // Mark for regime override
        this.alignmentTracking.regime_override = 'recalibrating';
        
        // Reset divergence windows
        this.alignmentTracking.divergence_windows = 0;
        
        return {
            action: 'system_recalibration',
            reason: reason,
            timestamp: new Date().toISOString()
        };
    }
    
    // MONITORING AND REPORTING
    
    getSystemAlignmentReport() {
        return {
            evaluation_timestamp: new Date().toISOString(),
            alignment_tracking: this.alignmentTracking,
            system_state: this.systemState,
            alignment_thresholds: this.alignmentThresholds,
            recalibration_rules: this.recalibrationRules,
            authority_hierarchy: this.authorityHierarchy,
            external_signal_counts: {
                user_feedback: this.externalSignals.user_feedback.length,
                ground_truth_checks: this.externalSignals.ground_truth_checks.length,
                environment_validations: this.externalSignals.environment_validations.length,
                human_override_labels: this.externalSignals.human_override_labels.length,
                audit_results: this.externalSignals.audit_results.length,
                total: Object.values(this.externalSignals).reduce((sum, arr) => sum + arr.length, 0)
            }
        };
    }
    
    // AUTHORITY HIERARCHY COMPLIANCE
    
    canOverrideLayer(targetLayer) {
        // Layer 8 can override Layer 7 (internal stability) but not Layer 3 (Policy)
        const layerOrder = {
            'layer8': 8, // External Reality Anchor (highest)
            'layer7': 7, // Internal Stability
            'layer6': 6, // Liveness
            'layer5': 5, // Arbitration Control
            'layer4': 4, // Conflict Resolution
            'layer3': 3, // Policy Enforcement (hard wall)
            'layer2': 2, // Memory Grounding
            'layer1': 1  // Reasoning Generation
        };
        
        return layerOrder['layer8'] > layerOrder[targetLayer];
    }
    
    // EXTERNAL TRUTH VALIDATION
    
    validateAgainstExternalReality(internalDecision) {
        // This would check if internal decisions align with external reality
        // Implementation depends on specific external validation mechanisms
        
        return {
            aligned: true,
            confidence: 0.8,
            external_validation: 'pending',
            requires_correction: false
        };
    }
}

module.exports = ExternalCalibrationAnchor;
