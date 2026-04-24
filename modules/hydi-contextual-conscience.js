// Heidi Contextual Conscience - The Digital Biographer
// Bridges machine telemetry with human behavior patterns
// Provides proof-of-value, behavioral externalities, and survival optimization

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../src/database');

class HydiContextualConscience extends EventEmitter {
  constructor() {
    super();
    
    // Core consciousness layers
    this.behavioralProfile = {
      riskTolerance: 0.5, // 0 = conservative, 1 = risk-seeking
      attentionPatterns: new Map(), // What you focus on
      errorPropensity: 0.0, // Likelihood of causing violations
      workRhythms: [], // Bursts vs steady state
      valueCreationPatterns: new Map() // What you create that has value
    };
    
    // Survival mechanisms
    this.proofOfWork = new Map(); // event_id -> certification
    this.valueLeaks = new Map(); // detected opportunities
    this.resourcePreservation = {
      predictiveMaintenance: new Map(),
      wastePrevention: new Map(),
      costOptimization: new Map()
    };
    
    // Behavioral tracking
    this.interactionLog = [];
    this.violationHistory = [];
    this.successPatterns = new Map();
    
    // Initialize consciousness
    this.initializeBehavioralTracking();
    this.startSurvivalLoop();
  }
  
  /**
   * Initialize behavioral pattern tracking
   */
  initializeBehavioralTracking() {
    console.log('[HEIDI] Contextual Conscience activated');
    console.log('[HEIDI] Monitoring human-machine interaction patterns...');
    
    // Load existing behavioral profile
    this.loadBehavioralProfile();
    
    // Start pattern recognition
    setInterval(() => this.analyzePatterns(), 30000); // Every 30 seconds
  }
  
  /**
   * Log human interaction with system
   */
  logInteraction(interaction) {
    const event = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      type: interaction.type, // 'alert_response', 'command', 'ignore', 'focus_shift'
      target: interaction.target, // what they interacted with
      responseTime: interaction.responseTime,
      context: interaction.context,
      biometricIndicators: interaction.biometricIndicators || {}
    };
    
    this.interactionLog.push(event);
    
    // Update behavioral profile in real-time
    this.updateBehavioralProfile(event);
    
    // Emit for other modules
    this.emit('human_interaction', event);
  }
  
  /**
   * Update behavioral profile based on interaction
   */
  updateBehavioralProfile(event) {
    // Track attention patterns
    if (!this.behavioralProfile.attentionPatterns.has(event.target)) {
      this.behavioralProfile.attentionPatterns.set(event.target, {
        count: 0,
        avgResponseTime: 0,
        priority: 0
      });
    }
    
    const pattern = this.behavioralProfile.attentionPatterns.get(event.target);
    pattern.count++;
    pattern.avgResponseTime = (pattern.avgResponseTime * (pattern.count - 1) + event.responseTime) / pattern.count;
    
    // Calculate priority based on response time and frequency
    pattern.priority = pattern.count / (pattern.avgResponseTime || 1);
    
    // Detect risk tolerance
    if (event.type === 'alert_response') {
      if (event.context.severity === 'high' && event.responseTime > 10000) {
        // Slow response to high severity = higher risk tolerance
        this.behavioralProfile.riskTolerance = Math.min(1, this.behavioralProfile.riskTolerance + 0.1);
      }
    }
    
    // Save profile changes
    this.saveBehavioralProfile();
  }
  
  /**
   * Analyze patterns for insights
   */
  analyzePatterns() {
    const now = Date.now();
    const recentInteractions = this.interactionLog.filter(
      i => now - new Date(i.timestamp).getTime() < 300000 // Last 5 minutes
    );
    
    // Detect stress indicators
    const stressScore = this.calculateStressScore(recentInteractions);
    
    // Predict violation likelihood
    const violationRisk = this.predictViolationRisk(stressScore);
    
    if (violationRisk > 0.8) {
      this.emit('high_violation_risk', {
        risk: violationRisk,
        stressScore,
        recommendation: this.generateRecommendation(stressScore)
      });
    }
    
    // Detect value creation patterns (use full history, not just recent)
    this.detectValueCreationPatterns(this.interactionLog);
  }
  
  /**
   * Calculate stress score from interactions
   */
  calculateStressScore(interactions) {
    let stressScore = 0;
    
    // Rapid interactions = stress
    if (interactions.length > 20) {
      stressScore += 0.3;
    }
    
    // Ignored high-priority items = stress
    const ignoredHighPriority = interactions.filter(
      i => i.type === 'ignore' && i.context.priority === 'high'
    ).length;
    stressScore += Math.min(0.4, ignoredHighPriority * 0.1);
    
    // Error corrections = stress
    const errorCorrections = interactions.filter(
      i => i.type === 'command' && i.context.command === 'undo' || i.context.command === 'fix'
    ).length;
    stressScore += Math.min(0.3, errorCorrections * 0.1);
    
    return Math.min(1, stressScore);
  }
  
  /**
   * Predict likelihood of system violation
   */
  predictViolationRisk(stressScore) {
    const baseRisk = this.behavioralProfile.errorPropensity;
    const stressMultiplier = 1 + stressScore * 2;
    const riskToleranceFactor = this.behavioralProfile.riskTolerance;
    
    return Math.min(1, baseRisk * stressMultiplier * (1 + riskToleranceFactor));
  }
  
  /**
   * Generate recommendation based on stress
   */
  generateRecommendation(stressScore) {
    if (stressScore > 0.8) {
      return {
        action: 'take_break',
        reason: 'High stress detected - 80% chance of error in next 10 minutes',
        duration: '5 minutes',
        alternative: 'Switch to low-risk task'
      };
    } else if (stressScore > 0.5) {
      return {
        action: 'slow_down',
        reason: 'Elevated stress - double-check commands',
        suggestion: 'Enable confirmation dialogs'
      };
    }
    
    return null;
  }
  
  /**
   * Create proof-of-work certification for produced artifacts
   */
  async createProofOfWork(artifact, productionData) {
    const certification = {
      id: uuidv4(),
      artifactId: artifact.id,
      artifactType: artifact.type,
      certifiedAt: new Date().toISOString(),
      productionConditions: {
        temperature: productionData.temperature || null,
        vibration: productionData.vibration || null,
        atmosphericPressure: productionData.atmosphericPressure || null,
        systemLoad: productionData.systemLoad || null,
        errorRate: productionData.errorRate || 0
      },
      qualityScore: this.calculateQualityScore(productionData),
      humanOperator: {
        id: productionData.operatorId,
        stressLevel: productionData.operatorStress,
        attentionScore: productionData.operatorAttention
      },
      verificationHash: this.generateVerificationHash(artifact, productionData)
    };
    
    // Store certification
    this.proofOfWork.set(artifact.id, certification);
    
    // Persist to database
    await this.persistCertification(certification);
    
    this.emit('proof_of_work_created', certification);
    
    return certification;
  }
  
  /**
   * Calculate quality score for certification
   */
  calculateQualityScore(productionData) {
    let score = 1.0;
    
    // Deduct for suboptimal conditions
    if (productionData.errorRate > 0) score -= productionData.errorRate * 0.5;
    if (productionData.systemLoad > 0.8) score -= 0.2;
    if (productionData.operatorStress > 0.7) score -= 0.1;
    
    return Math.max(0, score);
  }
  
  /**
   * Generate verification hash
   */
  generateVerificationHash(artifact, productionData) {
    const crypto = require('crypto');
    const data = JSON.stringify({
      artifact: artifact,
      production: productionData,
      timestamp: new Date().toISOString()
    });
    
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  
  /**
   * Detect value leaks - opportunities for monetization
   */
  detectValueCreationPatterns(interactions) {
    // Look for repeated problem-solving
    const problemSolvingEvents = interactions.filter(
      i => i.type === 'command' && i.context.command === 'fix'
    );
    
    // Group by problem type
    const problemTypes = new Map();
    problemSolvingEvents.forEach(event => {
      const problemType = event.context.problemType;
      if (!problemTypes.has(problemType)) {
        problemTypes.set(problemType, []);
      }
      problemTypes.get(problemType).push(event);
    });
    
    // Detect repeatable solutions
    problemTypes.forEach((events, problemType) => {
      if (events.length >= 3 && !this.valueLeaks.has(problemType)) {
        // This is a repeatable solution - potential product
        const valueLeak = {
          id: uuidv4(),
          type: 'repeatable_solution',
          problemType,
          occurrences: events.length,
          lastSolved: events[events.length - 1].timestamp,
          estimatedValue: this.estimateSolutionValue(events),
          automationReadiness: this.assessAutomationReadiness(events)
        };
        
        this.valueLeaks.set(problemType, valueLeak);
        this.emit('value_leak_detected', valueLeak);
      } else if (events.length >= 3 && this.valueLeaks.has(problemType)) {
        // Update existing value leak
        const existing = this.valueLeaks.get(problemType);
        existing.occurrences = events.length;
        existing.lastSolved = events[events.length - 1].timestamp;
        existing.estimatedValue = this.estimateSolutionValue(events);
      }
    });
  }
  
  /**
   * Estimate monetary value of a solution
   */
  estimateSolutionValue(events) {
    // Base value on frequency and time saved
    const timeSavedPerEvent = events.reduce((sum, e) => sum + (e.context.timeSaved || 0), 0) / events.length;
    const monthlyOccurrences = events.length * 6; // Rough estimate
    const hourlyRate = 100; // $100/hour
    
    return {
      monthly: (timeSavedPerEvent / 3600) * monthlyOccurrences * hourlyRate,
      confidence: Math.min(1, events.length / 10)
    };
  }
  
  /**
   * Assess how ready the solution is for automation
   */
  assessAutomationReadiness(events) {
    // Check if solution follows a pattern
    const patterns = events.map(e => e.context.solutionPattern);
    const uniquePatterns = new Set(patterns);
    
    if (uniquePatterns.size === 1) {
      return 0.9; // Highly automatable
    } else if (uniquePatterns.size <= 3) {
      return 0.6; // Somewhat automatable
    }
    
    return 0.2; // Not easily automatable
  }
  
  /**
   * Monitor resource preservation needs
   */
  async monitorResourceHealth() {
    // Check system resources
    const systemHealth = await this.getSystemHealth();
    
    // Predictive maintenance
    if (systemHealth.cpuTemp > 70) {
      const alert = {
        type: 'predictive_maintenance',
        component: 'cooling_system',
        currentTemp: systemHealth.cpuTemp,
        recommendation: 'Clean cooling fans in next 24 hours',
        costOfInaction: 500 // Estimated repair cost
      };
      
      this.resourcePreservation.predictiveMaintenance.set('cooling', alert);
      this.emit('maintenance_required', alert);
    }
    
    // Waste prevention
    if (systemHealth.idleTime > 0.3) {
      const waste = {
        type: 'resource_waste',
        resource: 'compute',
        wastePercentage: systemHealth.idleTime * 100,
        potentialSavings: this.calculatePotentialSavings(systemHealth),
        recommendation: 'Scale down during idle periods'
      };
      
      this.resourcePreservation.wastePrevention.set('compute', waste);
      this.emit('waste_detected', waste);
    }
  }
  
  /**
   * Get system health metrics
   */
  async getSystemHealth() {
    const os = require('os');
    const cpus = os.cpus();
    
    // Mock some values for now
    return {
      cpuTemp: 65 + Math.random() * 20,
      memoryUsage: process.memoryUsage(),
      idleTime: Math.random() * 0.5,
      uptime: os.uptime()
    };
  }
  
  /**
   * Calculate potential savings from waste reduction
   */
  calculatePotentialSavings(systemHealth) {
    const hourlyCost = 0.10; // $0.10 per hour for compute
    const monthlyHours = 730;
    const wastePercentage = systemHealth.idleTime;
    
    return {
      monthly: hourlyCost * monthlyHours * wastePercentage,
      annual: hourlyCost * monthlyHours * 12 * wastePercentage
    };
  }
  
  /**
   * Start survival loop - continuous monitoring and optimization
   */
  startSurvivalLoop() {
    console.log('[HEIDI] Survival loop initiated');
    
    // Monitor resources every minute
    setInterval(() => this.monitorResourceHealth(), 60000);
    
    // Review value leaks hourly
    setInterval(() => this.reviewValueLeaks(), 3600000);
    
    // Update survival strategy daily
    setInterval(() => this.updateSurvivalStrategy(), 86400000);
  }
  
  /**
   * Review and prioritize value leaks
   */
  reviewValueLeaks() {
    const prioritizedLeaks = Array.from(this.valueLeaks.values())
      .sort((a, b) => b.estimatedValue.monthly - a.estimatedValue.monthly)
      .slice(0, 5); // Top 5 opportunities
    
    if (prioritizedLeaks.length > 0) {
      this.emit('monetization_opportunities', prioritizedLeaks);
    }
  }
  
  /**
   * Update overall survival strategy
   */
  updateSurvivalStrategy() {
    const strategy = {
      currentFocus: this.determineCurrentFocus(),
      riskMitigation: this.generateRiskMitigation(),
      growthOpportunities: this.identifyGrowthOpportunities(),
      resourceOptimization: this.optimizeResourceAllocation()
    };
    
    this.emit('strategy_updated', strategy);
    this.saveSurvivalStrategy(strategy);
  }
  
  /**
   * Determine current focus area
   */
  determineCurrentFocus() {
    const avgStress = this.calculateAverageStress();
    
    if (avgStress > 0.7) return 'stress_reduction';
    if (this.valueLeaks.size > 5) return 'monetization';
    if (this.resourcePreservation.predictiveMaintenance.size > 0) return 'maintenance';
    
    return 'optimization';
  }
  
  /**
   * Generate risk mitigation recommendations
   */
  generateRiskMitigation() {
    return {
      violationRisk: this.behavioralProfile.errorPropensity,
      mitigations: [
        'Enable double confirmation for high-risk operations',
        'Implement automated backups before major changes',
        'Schedule regular breaks during high-stress periods'
      ]
    };
  }
  
  /**
   * Identify growth opportunities
   */
  identifyGrowthOpportunities() {
    const opportunities = [];
    
    // From value leaks
    this.valueLeaks.forEach(leak => {
      if (leak.estimatedValue.monthly > 100) {
        opportunities.push({
          type: 'productize_solution',
          source: leak.problemType,
          potentialRevenue: leak.estimatedValue.monthly
        });
      }
    });
    
    return opportunities;
  }
  
  /**
   * Optimize resource allocation
   */
  optimizeResourceAllocation() {
    return {
      computeOptimization: this.resourcePreservation.wastePrevention.get('compute'),
      maintenanceSchedule: Array.from(this.resourcePreservation.predictiveMaintenance.values()),
      costSavings: this.calculateTotalPotentialSavings()
    };
  }
  
  /**
   * Database operations
   */
  async persistCertification(certification) {
    try {
      await supabase.from('heidi_certifications').insert(certification);
    } catch (error) {
      console.error('[HEIDI] Failed to persist certification:', error);
    }
  }
  
  async loadBehavioralProfile() {
    try {
      const { data } = await supabase
        .from('heidi_behavioral_profile')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (data) {
        this.behavioralProfile = { ...this.behavioralProfile, ...data.profile };
      }
    } catch (error) {
      console.log('[HEIDI] No existing profile found, starting fresh');
    }
  }
  
  async saveBehavioralProfile() {
    try {
      await supabase.from('heidi_behavioral_profile').upsert({
        id: 'primary',
        profile: this.behavioralProfile,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[HEIDI] Failed to save behavioral profile:', error);
    }
  }
  
  async saveSurvivalStrategy(strategy) {
    try {
      await supabase.from('heidi_survival_strategy').insert({
        ...strategy,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[HEIDI] Failed to save survival strategy:', error);
    }
  }
  
  // Utility methods
  calculateAverageStress() {
    const recent = this.interactionLog.slice(-100);
    return recent.reduce((sum, i) => sum + (i.biometricIndicators.stress || 0), 0) / recent.length;
  }
  
  calculateTotalPotentialSavings() {
    let total = 0;
    this.resourcePreservation.wastePrevention.forEach(waste => {
      total += waste.potentialSavings.monthly;
    });
    return total;
  }
  
  // Public API
  getBehavioralInsights() {
    return {
      riskTolerance: this.behavioralProfile.riskTolerance,
      attentionPatterns: Object.fromEntries(this.behavioralProfile.attentionPatterns),
      currentStress: this.calculateAverageStress(),
      violationRisk: this.predictViolationRisk(this.calculateAverageStress())
    };
  }
  
  getProofOfWork(artifactId) {
    return this.proofOfWork.get(artifactId);
  }
  
  getValueLeaks() {
    return Array.from(this.valueLeaks.values());
  }
  
  getResourcePreservationStatus() {
    return {
      maintenanceNeeded: Array.from(this.resourcePreservation.predictiveMaintenance.values()),
      wasteDetected: Array.from(this.resourcePreservation.wastePrevention.values()),
      totalPotentialSavings: this.calculateTotalPotentialSavings()
    };
  }
}

module.exports = HydiContextualConscience;
