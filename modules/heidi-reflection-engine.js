// Heidi Reflection Engine - The Learning Loop
// Transforms actions into insights through continuous reflection
// Core: acts → logs → reflects → adapts

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../src/database');

class HeidiReflectionEngine extends EventEmitter {
  constructor(heidiConscience) {
    super();
    
    this.heidi = heidiConscience; // Reference to main Heidi system
    
    // Reflection state
    this.reflectionHistory = [];
    this.adaptivePatterns = new Map(); // pattern_id -> adaptation strategy
    this.performanceMetrics = {
      taskSuccessRate: 0,
      averageConfidence: 0,
      errorFrequency: new Map(), // error_type -> frequency
      improvementVelocity: 0
    };
    
    // Learning thresholds
    this.thresholds = {
      minConfidenceForAction: 0.6,
      maxErrorFrequency: 3, // per hour
      reflectionInterval: 60000, // 1 minute
      adaptationThreshold: 5 // pattern occurrences before adaptation
    };
    
    // Current reflection state
    this.currentReflection = null;
    this.isReflecting = false;
    
    this.initializeReflectionLoop();
  }
  
  /**
   * Initialize the continuous reflection loop
   */
  initializeReflectionLoop() {
    console.log('[HEIDI REFLECTION] Reflection engine activated');
    console.log('[HEIDI REFLECTION] Starting continuous learning loop...');
    
    // Start reflection cycle
    setInterval(() => this.performReflectionCycle(), this.thresholds.reflectionInterval);
    
    // Listen to Heidi events for real-time reflection
    this.setupEventListeners();
  }
  
  /**
   * Setup event listeners for real-time reflection triggers
   */
  setupEventListeners() {
    // Reflect on every interaction
    this.heidi.on('human_interaction', (interaction) => {
      this.queueReflection('interaction', interaction);
    });
    
    // Reflect on system alerts
    this.heidi.on('high_violation_risk', (alert) => {
      this.queueReflection('risk_alert', alert);
    });
    
    // Reflect on value leaks
    this.heidi.on('value_leak_detected', (leak) => {
      this.queueReflection('value_leak', leak);
    });
    
    // Reflect on proof of work
    this.heidi.on('proof_of_work_created', (certification) => {
      this.queueReflection('proof_of_work', certification);
    });
  }
  
  /**
   * Queue a reflection for processing
   */
  queueReflection(type, data) {
    const reflection = {
      id: uuidv4(),
      type,
      data,
      timestamp: new Date().toISOString(),
      processed: false
    };
    
    this.reflectionHistory.push(reflection);
    
    // Keep history manageable
    if (this.reflectionHistory.length > 1000) {
      this.reflectionHistory = this.reflectionHistory.slice(-500);
    }
  }
  
  /**
   * Main reflection cycle - analyzes recent actions and generates insights
   */
  async performReflectionCycle() {
    if (this.isReflecting) {
      return; // Skip if already reflecting
    }
    
    this.isReflecting = true;
    this.currentReflection = {
      cycleId: uuidv4(),
      startTime: Date.now(),
      insights: [],
      adaptations: [],
      confidenceUpdates: []
    };
    
    try {
      console.log(`[HEIDI REFLECTION] Starting reflection cycle ${this.currentReflection.cycleId}`);
      
      // 1. Analyze recent unprocessed reflections
      await this.analyzeRecentReflections();
      
      // 2. Update performance metrics
      this.updatePerformanceMetrics();
      
      // 3. Detect patterns needing adaptation
      await this.detectAdaptationPatterns();
      
      // 4. Generate adaptive strategies
      await this.generateAdaptiveStrategies();
      
      // 5. Update confidence models
      this.updateConfidenceModels();
      
      // 6. Persist insights
      await this.persistReflectionResults();
      
      // 7. Emit adaptation events
      this.emitAdaptationEvents();
      
      console.log(`[HEIDI REFLECTION] Cycle complete: ${this.currentReflection.insights.length} insights, ${this.currentReflection.adaptations.length} adaptations`);
      
    } catch (error) {
      console.error('[HEIDI REFLECTION] Reflection cycle error:', error);
      this.emit('reflection_error', error);
    } finally {
      this.isReflecting = false;
      this.currentReflection = null;
    }
  }
  
  /**
   * Analyze recent unprocessed reflections
   */
  async analyzeRecentReflections() {
    const unprocessed = this.reflectionHistory.filter(r => !r.processed);
    const recent = unprocessed.slice(-50); // Last 50 unprocessed events
    
    for (const reflection of recent) {
      const insight = await this.generateInsight(reflection);
      if (insight) {
        this.currentReflection.insights.push(insight);
        reflection.processed = true;
        reflection.insight = insight;
      }
    }
  }
  
  /**
   * Generate insight from a single reflection
   */
  async generateInsight(reflection) {
    switch (reflection.type) {
      case 'interaction':
        return this.analyzeInteraction(reflection.data);
      case 'risk_alert':
        return this.analyzeRiskAlert(reflection.data);
      case 'value_leak':
        return this.analyzeValueLeak(reflection.data);
      case 'proof_of_work':
        return this.analyzeProofOfWork(reflection.data);
      default:
        return null;
    }
  }
  
  /**
   * Analyze human interaction for patterns
   */
  analyzeInteraction(interaction) {
    const insight = {
      type: 'interaction_pattern',
      timestamp: new Date().toISOString(),
      confidence: 0.5,
      implications: [],
      recommendations: []
    };
    
    // Detect response time patterns
    if (interaction.responseTime > 10000) {
      insight.implications.push('slow_response_pattern');
      insight.recommendations.push('Consider simplifying interface for this target');
      insight.confidence += 0.2;
    }
    
    // Detect stress patterns
    if (interaction.biometricIndicators.system_stress > 0.7) {
      insight.implications.push('high_stress_interaction');
      insight.recommendations.push('Add stress reduction prompts');
      insight.confidence += 0.3;
    }
    
    // Detect ignore patterns
    if (interaction.type === 'ignore' && interaction.context.priority === 'high') {
      insight.implications.push('critical_ignore_pattern');
      insight.recommendations.push('Review alert prioritization');
      insight.confidence += 0.4;
    }
    
    return insight.confidence > 0.6 ? insight : null;
  }
  
  /**
   * Analyze risk alert for systemic issues
   */
  analyzeRiskAlert(alert) {
    const insight = {
      type: 'systemic_risk',
      timestamp: new Date().toISOString(),
      confidence: alert.risk,
      implications: ['violation_probability'],
      recommendations: [alert.recommendation.action],
      severity: alert.risk > 0.9 ? 'critical' : 'high'
    };
    
    // Check if this is a recurring pattern
    const recentRiskAlerts = this.reflectionHistory
      .filter(r => r.type === 'risk_alert' && Date.now() - new Date(r.timestamp).getTime() < 3600000)
      .length;
    
    if (recentRiskAlerts > 3) {
      insight.implications.push('repeated_risk_pattern');
      insight.recommendations.push('Implement systemic intervention');
      insight.confidence = Math.min(1, insight.confidence + 0.2);
    }
    
    return insight;
  }
  
  /**
   * Analyze value leak for automation opportunities
   */
  analyzeValueLeak(leak) {
    const insight = {
      type: 'automation_opportunity',
      timestamp: new Date().toISOString(),
      confidence: leak.automationReadiness,
      implications: ['revenue_opportunity', 'efficiency_gain'],
      recommendations: [],
      estimatedValue: leak.estimatedValue
    };
    
    if (leak.automationReadiness > 0.8) {
      insight.recommendations.push('High priority for automation');
    } else if (leak.automationReadiness > 0.5) {
      insight.recommendations.push('Consider for semi-automation');
    } else {
      insight.recommendations.push('Monitor for pattern emergence');
    }
    
    return insight.confidence > 0.5 ? insight : null;
  }
  
  /**
   * Analyze proof of work for quality patterns
   */
  analyzeProofOfWork(certification) {
    const insight = {
      type: 'quality_pattern',
      timestamp: new Date().toISOString(),
      confidence: certification.qualityScore,
      implications: [],
      recommendations: []
    };
    
    // Low quality patterns
    if (certification.qualityScore < 0.7) {
      insight.implications.push('quality_degradation');
      insight.recommendations.push('Review production conditions');
      
      // Check operator stress
      if (certification.humanOperator.stressLevel > 0.7) {
        insight.implications.push('operator_stress_impact');
        insight.recommendations.push('Implement stress monitoring');
      }
    }
    
    // High quality patterns
    if (certification.qualityScore > 0.9) {
      insight.implications.push('optimal_conditions');
      insight.recommendations.push('Document and replicate conditions');
    }
    
    return insight.confidence > 0.6 ? insight : null;
  }
  
  /**
   * Update performance metrics based on recent reflections
   */
  updatePerformanceMetrics() {
    const recentReflections = this.reflectionHistory.slice(-100);
    
    // Calculate task success rate
    const successfulTasks = recentReflections.filter(r => 
      r.type === 'proof_of_work' && r.data?.qualityScore > 0.7
    ).length;
    const totalTasks = recentReflections.filter(r => r.type === 'proof_of_work').length;
    this.performanceMetrics.taskSuccessRate = totalTasks > 0 ? successfulTasks / totalTasks : 0;
    
    // Calculate average confidence
    const insightsWithConfidence = this.currentReflection.insights.filter(i => i.confidence);
    if (insightsWithConfidence.length > 0) {
      this.performanceMetrics.averageConfidence = 
        insightsWithConfidence.reduce((sum, i) => sum + i.confidence, 0) / insightsWithConfidence.length;
    }
    
    // Track error frequency
    recentReflections.forEach(r => {
      if (r.type === 'risk_alert') {
        const errorType = r.data.recommendation.reason || 'unknown';
        this.performanceMetrics.errorFrequency.set(errorType, 
          (this.performanceMetrics.errorFrequency.get(errorType) || 0) + 1);
      }
    });
    
    // Calculate improvement velocity (insights per hour)
    const hourlyInsights = this.currentReflection.insights.length / (this.thresholds.reflectionInterval / 3600000);
    this.performanceMetrics.improvementVelocity = hourlyInsights;
  }
  
  /**
   * Detect patterns that need adaptation
   */
  async detectAdaptationPatterns() {
    const patterns = new Map();
    
    // Group insights by implication
    this.currentReflection.insights.forEach(insight => {
      insight.implications.forEach(implication => {
        if (!patterns.has(implication)) {
          patterns.set(implication, {
            count: 0,
            insights: [],
            confidence: 0,
            lastSeen: insight.timestamp
          });
        }
        
        const pattern = patterns.get(implication);
        pattern.count++;
        pattern.insights.push(insight);
        pattern.confidence = Math.min(1, pattern.confidence + insight.confidence * 0.1);
        pattern.lastSeen = insight.timestamp;
      });
    });
    
    // Identify patterns needing adaptation
    patterns.forEach((pattern, implication) => {
      if (pattern.count >= this.thresholds.adaptationThreshold && pattern.confidence > 0.7) {
        this.currentReflection.adaptations.push({
          type: 'pattern_adaptation',
          pattern: implication,
          occurrences: pattern.count,
          confidence: pattern.confidence,
          strategy: this.generateAdaptationStrategy(implication, pattern)
        });
      }
    });
  }
  
  /**
   * Generate adaptation strategy for a pattern
   */
  generateAdaptationStrategy(pattern, data) {
    const strategies = {
      'slow_response_pattern': {
        action: 'interface_optimization',
        priority: 'medium',
        implementation: 'Simplify UI elements for slow-response targets',
        expectedImpact: 0.3
      },
      'high_stress_interaction': {
        action: 'stress_intervention',
        priority: 'high',
        implementation: 'Add proactive stress reduction prompts',
        expectedImpact: 0.5
      },
      'critical_ignore_pattern': {
        action: 'alert_system_overhaul',
        priority: 'critical',
        implementation: 'Redesign alert prioritization and presentation',
        expectedImpact: 0.7
      },
      'repeated_risk_pattern': {
        action: 'systemic_intervention',
        priority: 'critical',
        implementation: 'Implement automated safeguards for recurring risks',
        expectedImpact: 0.8
      },
      'quality_degradation': {
        action: 'quality_control_enhancement',
        priority: 'high',
        implementation: 'Enhance real-time quality monitoring',
        expectedImpact: 0.6
      }
    };
    
    return strategies[pattern] || {
      action: 'monitor_pattern',
      priority: 'low',
      implementation: 'Continue monitoring for pattern evolution',
      expectedImpact: 0.1
    };
  }
  
  /**
   * Generate adaptive strategies for detected patterns
   */
  async generateAdaptiveStrategies() {
    // This is where Heidi would implement the actual adaptations
    // For now, we'll just prepare the strategies
    
    this.currentReflection.adaptations.forEach(adaptation => {
      // Store adaptation for future reference
      this.adaptivePatterns.set(adaptation.pattern, adaptation);
      
      console.log(`[HEIDI REFLECTION] Adaptation strategy prepared: ${adaptation.pattern} -> ${adaptation.strategy.action}`);
    });
  }
  
  /**
   * Update confidence models based on reflection outcomes
   */
  updateConfidenceModels() {
    // Adjust confidence thresholds based on performance
    if (this.performanceMetrics.taskSuccessRate < 0.7) {
      this.thresholds.minConfidenceForAction = Math.min(0.8, this.thresholds.minConfidenceForAction + 0.05);
    } else if (this.performanceMetrics.taskSuccessRate > 0.9) {
      this.thresholds.minConfidenceForAction = Math.max(0.5, this.thresholds.minConfidenceForAction - 0.05);
    }
    
    // Track confidence updates
    this.currentReflection.confidenceUpdates.push({
      previousThreshold: this.thresholds.minConfidenceForAction - 0.05,
      newThreshold: this.thresholds.minConfidenceForAction,
      reason: 'performance_based_adjustment',
      successRate: this.performanceMetrics.taskSuccessRate
    });
  }
  
  /**
   * Persist reflection results to database
   */
  async persistReflectionResults() {
    try {
      const reflectionData = {
        cycle_id: this.currentReflection.cycleId,
        insights: this.currentReflection.insights,
        adaptations: this.currentReflection.adaptations,
        confidence_updates: this.currentReflection.confidenceUpdates,
        performance_metrics: this.performanceMetrics,
        created_at: new Date().toISOString()
      };
      
      await supabase.from('heidi_reflections').insert(reflectionData);
      
      // Also update adaptive patterns
      for (const [pattern, adaptation] of this.adaptivePatterns) {
        await supabase.from('heidi_adaptive_patterns').upsert({
          pattern,
          adaptation,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'pattern'
        });
      }
      
    } catch (error) {
      console.error('[HEIDI REFLECTION] Failed to persist results:', error);
    }
  }
  
  /**
   * Emit adaptation events for other system components
   */
  emitAdaptationEvents() {
    this.currentReflection.adaptations.forEach(adaptation => {
      this.emit('adaptation_required', adaptation);
      
      // Also emit to main Heidi system
      this.heidi.emit('system_adaptation', adaptation);
    });
    
    // Emit performance update
    this.emit('performance_update', this.performanceMetrics);
  }
  
  /**
   * Get current reflection state
   */
  getCurrentReflection() {
    return this.currentReflection;
  }
  
  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return this.performanceMetrics;
  }
  
  /**
   * Get adaptive patterns
   */
  getAdaptivePatterns() {
    return Array.from(this.adaptivePatterns.values());
  }
  
  /**
   * Manual reflection trigger for testing
   */
  async triggerManualReflection() {
    await this.performReflectionCycle();
  }
}

module.exports = HeidiReflectionEngine;
