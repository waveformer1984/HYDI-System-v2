/**
 * GLOBAL CONSTRAINT ENFORCER - The Missing Fourth Control Axis
 * 
 * This is not AI. This is discipline.
 * 
 * Right now we have:
 * - Performance (local optimization)
 * - Revenue (short-term greed)  
 * - Drift (reactive correction)
 * 
 * MISSING: System Stability as first-class metric
 * 
 * Global Constraint Enforcer must:
 * 1. Suppress local optimization
 * 2. Enforce global consistency  
 * 3. Sacrifice short-term wins for long-term stability
 * 4. Prevent greedy monetization collapse
 */

const EventEmitter = require('events');

class GlobalConstraintEnforcer extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Stability thresholds
      minExplorationRate: config.minExplorationRate || 0.15, // 15% forced exploration
      maxVolatilityScore: config.maxVolatilityScore || 0.3,
      minSampleThreshold: config.minSampleThreshold || 10,
      
      // Time horizons for stability
      shortHorizon: config.shortHorizon || 3600000, // 1 hour
      mediumHorizon: config.mediumHorizon || 86400000, // 24 hours  
      longHorizon: config.longHorizon || 604800000, // 7 days
      
      // Decay rates
      performanceDecayRate: config.performanceDecayRate || 0.1, // 10% per hour
      oldDataCutoff: config.oldDataCutoff || 2592000000, // 30 days
      
      // Revenue constraints
      maxRevenueVolatility: config.maxRevenueVolatility || 0.5,
      revenueStabilityWeight: config.revenueStabilityWeight || 0.4,
      
      // Governance settings
      enableVolatilityPenalty: config.enableVolatilityPenalty !== false,
      enableExplorationEnforcement: config.enableExplorationEnforcement !== false,
      enableLongHorizonTracking: config.enableLongHorizonTracking !== false
    };
    
    // System stability tracking
    this.stabilityMetrics = {
      performanceConsistency: 0,
      modelSelectionVariance: 0,
      actionReliability: 0,
      revenueVolatility: 0,
      overallStabilityScore: 0,
      
      // Historical tracking
      performanceHistory: [],
      selectionHistory: [],
      actionHistory: [],
      revenueHistory: []
    };
    
    // Constraint violations
    this.violations = {
      overfitting: [],
      volatility: [],
      greed: [],
      instability: []
    };
    
    // Exploration tracking
    this.explorationState = {
      requiredRate: this.config.minExplorationRate,
      currentRate: 0,
      explorationBudget: 0,
      lastExploration: 0
    };
    
    // Long-horizon tracking
    this.longHorizonMetrics = {
      dayWindow: [],
      weekWindow: [],
      monthWindow: []
    };
    
    console.log('[GLOBAL CONSTRAINT ENFORCER] Initialized');
    console.log(`[GCE] Exploration rate: ${this.config.minExplorationRate * 100}%`);
    console.log(`[GCE] Max volatility: ${this.config.maxVolatilityScore}`);
  }
  
  /**
   * GOVERNANCE 1: Prevent Overfitting in Model Selection
   */
  
  enforceExplorationConstraint(modelSelection, availableModels) {
    console.log(`[GCE] Enforcing exploration constraint...`);
    
    // Calculate current exploration rate
    const recentSelections = this.getRecentSelections(this.config.shortHorizon);
    const totalSelections = recentSelections.length;
    const uniqueModels = new Set(recentSelections.map(s => s.modelId)).size;
    
    this.explorationState.currentRate = totalSelections > 0 ? uniqueModels / availableModels.length : 0;
    
    // Check if exploration is required
    const needsExploration = this.explorationState.currentRate < this.config.minExplorationRate;
    
    if (needsExploration) {
      console.log(`[GCE] Exploration required. Current: ${(this.explorationState.currentRate * 100).toFixed(1)}%, Required: ${(this.config.minExplorationRate * 100).toFixed(1)}%`);
      
      // Force exploration by selecting a less-used model
      const explorationCandidate = this.selectExplorationCandidate(modelSelection, availableModels, recentSelections);
      
      if (explorationCandidate) {
        this.explorationState.lastExploration = Date.now();
        this.explorationState.explorationBudget++;
        
        console.log(`[GCE] Forced exploration: ${explorationCandidate.modelId} (overriding ${modelSelection.modelId})`);
        
        // Log overfitting prevention
        this.violations.overfitting.push({
          timestamp: Date.now(),
          type: 'exploration_enforced',
          original: modelSelection.modelId,
          forced: explorationCandidate.modelId,
          explorationRate: this.explorationState.currentRate
        });
        
        return explorationCandidate;
      }
    }
    
    return modelSelection; // No override needed
  }
  
  selectExplorationCandidate(currentSelection, availableModels, recentSelections) {
    // Count recent usage
    const usageCounts = new Map();
    for (const selection of recentSelections) {
      usageCounts.set(selection.modelId, (usageCounts.get(selection.modelId) || 0) + 1);
    }
    
    // Find least recently used models
    const candidates = availableModels.filter(model => {
      const usage = usageCounts.get(model.id) || 0;
      return usage < Math.max(1, recentSelections.length / availableModels.length);
    });
    
    if (candidates.length === 0) {
      return null; // No suitable candidate
    }
    
    // Select from candidates with some randomness
    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }
  
  /**
   * GOVERNANCE 2: Penalize Volatility
   */
  
  calculateVolatilityPenalty(metrics) {
    if (!this.config.enableVolatilityPenalty) {
      return 0;
    }
    
    // Model selection variance
    const selectionVariance = this.calculateSelectionVariance();
    
    // Performance consistency
    const performanceConsistency = this.calculatePerformanceConsistency(metrics);
    
    // Revenue volatility
    const revenueVolatility = this.calculateRevenueVolatility();
    
    // Overall volatility score
    const volatilityScore = (selectionVariance + (1 - performanceConsistency) + revenueVolatility) / 3;
    
    // Check if volatility exceeds threshold
    if (volatilityScore > this.config.maxVolatilityScore) {
      console.warn(`[GCE] High volatility detected: ${volatilityScore.toFixed(3)} > ${this.config.maxVolatilityScore}`);
      
      this.violations.volatility.push({
        timestamp: Date.now(),
        score: volatilityScore,
        components: {
          selectionVariance,
          performanceConsistency,
          revenueVolatility
        }
      });
    }
    
    // Return penalty (higher volatility = higher penalty)
    return Math.max(0, volatilityScore - this.config.maxVolatilityScore);
  }
  
  calculateSelectionVariance() {
    const recentSelections = this.getRecentSelections(this.config.shortHorizon);
    
    if (recentSelections.length < 10) {
      return 0; // Not enough data
    }
    
    // Calculate distribution variance
    const modelCounts = new Map();
    for (const selection of recentSelections) {
      modelCounts.set(selection.modelId, (modelCounts.get(selection.modelId) || 0) + 1);
    }
    
    const total = recentSelections.length;
    const expected = total / modelCounts.size;
    
    let variance = 0;
    for (const count of modelCounts.values()) {
      variance += Math.pow(count - expected, 2);
    }
    
    return variance / (modelCounts.size * expected * expected);
  }
  
  calculatePerformanceConsistency(_metrics) {
    const recentPerformance = this.getRecentPerformance(this.config.shortHorizon);
    
    if (recentPerformance.length < 5) {
      return 0.5; // Default consistency
    }
    
    // Calculate performance variance
    const avgPerformance = recentPerformance.reduce((sum, p) => sum + p.successRate, 0) / recentPerformance.length;
    
    let variance = 0;
    for (const perf of recentPerformance) {
      variance += Math.pow(perf.successRate - avgPerformance, 2);
    }
    
    variance = variance / recentPerformance.length;
    
    // Convert variance to consistency (lower variance = higher consistency)
    const consistency = Math.max(0, 1 - variance);
    
    return consistency;
  }
  
  calculateRevenueVolatility() {
    const recentRevenue = this.getRecentRevenue(this.config.mediumHorizon);
    
    if (recentRevenue.length < 3) {
      return 0; // Not enough data
    }
    
    // Calculate revenue coefficient of variation
    const avgRevenue = recentRevenue.reduce((sum, r) => sum + r.amount, 0) / recentRevenue.length;
    
    if (avgRevenue === 0) {
      return 0;
    }
    
    let variance = 0;
    for (const revenue of recentRevenue) {
      variance += Math.pow(revenue.amount - avgRevenue, 2);
    }
    
    variance = variance / recentRevenue.length;
    const coefficientOfVariation = Math.sqrt(variance) / avgRevenue;
    
    return Math.min(1, coefficientOfVariation);
  }
  
  /**
   * GOVERNANCE 3: Enforce Long-Horizon Reward Tracking
   */
  
  calculateLongHorizonStability() {
    if (!this.config.enableLongHorizonTracking) {
      return 0.5; // Default stability
    }
    
    const dayStability = this.calculateWindowStability('dayWindow', this.config.shortHorizon);
    const weekStability = this.calculateWindowStability('weekWindow', this.config.mediumHorizon);
    const monthStability = this.calculateWindowStability('monthWindow', this.config.longHorizon);
    
    // Weight more recent windows more heavily
    const weightedStability = (dayStability * 0.5) + (weekStability * 0.3) + (monthStability * 0.2);
    
    return weightedStability;
  }
  
  calculateWindowStability(windowName, _horizon) {
    const window = this.longHorizonMetrics[windowName];
    
    if (window.length < 2) {
      return 0.5; // Default stability
    }
    
    // Calculate trend stability
    const recent = window.slice(-5); // Last 5 data points
    if (recent.length < 2) {
      return 0.5;
    }
    
    // Check if trend is stable (not oscillating wildly)
    let trendChanges = 0;
    for (let i = 1; i < recent.length; i++) {
      const current = recent[i].stabilityScore;
      const previous = recent[i - 1].stabilityScore;
      
      if (Math.abs(current - previous) > 0.2) {
        trendChanges++;
      }
    }
    
    const stability = 1 - (trendChanges / (recent.length - 1));
    return Math.max(0, Math.min(1, stability));
  }
  
  /**
   * GOVERNANCE 4: Override Revenue Greed
   */
  
  checkRevenueGreed(action, revenueImpact) {
    if (revenueImpact <= 0) {
      return { allowed: true, reason: 'no_revenue_impact' };
    }
    
    // Check for greedy patterns
    const revenueVolatility = this.calculateRevenueVolatility();
    
    // High revenue + high volatility = potential greed
    if (revenueImpact > 100 && revenueVolatility > this.config.maxRevenueVolatility) {
      console.warn(`[GCE] Potential revenue greed detected: $${revenueImpact} with volatility ${revenueVolatility.toFixed(3)}`);
      
      this.violations.greed.push({
        timestamp: Date.now(),
        action: action.type,
        revenueImpact,
        volatility: revenueVolatility,
        decision: 'blocked'
      });
      
      return {
        allowed: false,
        reason: 'revenue_greed_detected',
        revenueImpact,
        volatility: revenueVolatility
      };
    }
    
    // Check long-term revenue stability
    const longTermStability = this.calculateLongHorizonStability();
    if (longTermStability < 0.3 && revenueImpact > 50) {
      console.warn(`[GCE] Blocking revenue action due to long-term instability: ${longTermStability.toFixed(3)}`);
      
      return {
        allowed: false,
        reason: 'long_term_instability',
        longTermStability,
        revenueImpact
      };
    }
    
    return { allowed: true, reason: 'revenue_acceptable' };
  }
  
  /**
   * SYSTEM STABILITY SCORE CALCULATION
   */
  
  calculateSystemStability() {
    // Component calculations
    const performanceConsistency = this.calculatePerformanceConsistency(null);
    const modelSelectionVariance = this.calculateSelectionVariance();
    const actionReliability = this.calculateActionReliability();
    const revenueVolatility = this.calculateRevenueVolatility();
    
    // Normalize components (0-1 scale, higher is better)
    const normalizedPerformance = performanceConsistency;
    const normalizedSelection = 1 - Math.min(1, modelSelectionVariance);
    const normalizedAction = actionReliability;
    const normalizedRevenue = 1 - Math.min(1, revenueVolatility);
    
    // Calculate overall stability score
    const overallStability = (normalizedPerformance + normalizedSelection + normalizedAction + normalizedRevenue) / 4;
    
    // Update stability metrics
    this.stabilityMetrics = {
      performanceConsistency: normalizedPerformance,
      modelSelectionVariance: modelSelectionVariance,
      actionReliability: normalizedAction,
      revenueVolatility: revenueVolatility,
      overallStabilityScore: overallStability
    };
    
    // Store in history
    this.stabilityMetrics.performanceHistory.push(normalizedPerformance);
    this.stabilityMetrics.selectionHistory.push(modelSelectionVariance);
    this.stabilityMetrics.actionHistory.push(normalizedAction);
    this.stabilityMetrics.revenueHistory.push(revenueVolatility);
    
    // Keep histories manageable
    const maxLength = 1000;
    if (this.stabilityMetrics.performanceHistory.length > maxLength) {
      this.stabilityMetrics.performanceHistory = this.stabilityMetrics.performanceHistory.slice(-maxLength);
    }
    if (this.stabilityMetrics.selectionHistory.length > maxLength) {
      this.stabilityMetrics.selectionHistory = this.stabilityMetrics.selectionHistory.slice(-maxLength);
    }
    if (this.stabilityMetrics.actionHistory.length > maxLength) {
      this.stabilityMetrics.actionHistory = this.stabilityMetrics.actionHistory.slice(-maxLength);
    }
    if (this.stabilityMetrics.revenueHistory.length > maxLength) {
      this.stabilityMetrics.revenueHistory = this.stabilityMetrics.revenueHistory.slice(-maxLength);
    }
    
    return overallStability;
  }
  
  calculateActionReliability() {
    const recentActions = this.getRecentActions(this.config.shortHorizon);
    
    if (recentActions.length < 5) {
      return 0.5; // Default reliability
    }
    
    const successCount = recentActions.filter(a => a.success).length;
    const reliability = successCount / recentActions.length;
    
    return reliability;
  }
  
  /**
   * GOVERNANCE ENFORCEMENT ENTRY POINT
   */
  
  enforceConstraints(decision, action, _context) {
    console.log(`[GCE] Enforcing global constraints...`);
    
    const enforcement = {
      original: { decision, action },
      overrides: [],
      penalties: [],
      finalDecision: decision,
      finalAction: action,
      allowed: true,
      reason: 'all_constraints_satisfied'
    };
    
    // 1. Enforce exploration constraint
    if (decision.model) {
      const explorationOverride = this.enforceExplorationConstraint(decision, []);
      if (explorationOverride.modelId !== decision.model.id) {
        enforcement.overrides.push({
          type: 'exploration',
          reason: 'prevent_overfitting',
          original: decision.model.id,
          override: explorationOverride.modelId
        });
        enforcement.finalDecision = { ...decision, model: explorationOverride };
      }
    }
    
    // 2. Calculate volatility penalty
    const volatilityPenalty = this.calculateVolatilityPenalty(null);
    if (volatilityPenalty > 0) {
      enforcement.penalties.push({
        type: 'volatility',
        amount: volatilityPenalty,
        reason: 'high_system_volatility'
      });
      
      // Apply penalty to decision confidence
      enforcement.finalDecision.confidence = Math.max(0.1, enforcement.finalDecision.confidence - volatilityPenalty);
    }
    
    // 3. Check revenue greed
    if (action.revenueImpact > 0) {
      const greedCheck = this.checkRevenueGreed(action, action.revenueImpact);
      if (!greedCheck.allowed) {
        enforcement.overrides.push({
          type: 'revenue',
          reason: greedCheck.reason,
          blocked: true
        });
        enforcement.allowed = false;
        enforcement.reason = greedCheck.reason;
      }
    }
    
    // 4. Update system stability
    const stabilityScore = this.calculateSystemStability();
    
    // 5. Block if stability is too low
    if (stabilityScore < 0.2) {
      enforcement.overrides.push({
        type: 'stability',
        reason: 'system_instability',
        stabilityScore
      });
      enforcement.allowed = false;
      enforcement.reason = 'system_too_unstable';
    }
    
    // Emit enforcement event
    this.emit('constraints_enforced', enforcement);
    
    console.log(`[GCE] Constraints enforced: ${enforcement.overrides.length} overrides, ${enforcement.penalties.length} penalties`);
    console.log(`[GCE] System stability: ${stabilityScore.toFixed(3)}`);
    
    return enforcement;
  }
  
  /**
   * DATA TRACKING METHODS
   */
  
  recordModelSelection(modelId, taskId) {
    this.stabilityMetrics.selectionHistory.push({
      timestamp: Date.now(),
      modelId,
      taskId
    });
  }
  
  recordPerformance(modelId, taskType, successRate, cost, latency) {
    this.stabilityMetrics.performanceHistory.push({
      timestamp: Date.now(),
      modelId,
      taskType,
      successRate,
      cost,
      latency
    });
  }
  
  recordAction(actionType, success, revenueImpact = 0) {
    this.stabilityMetrics.actionHistory.push({
      timestamp: Date.now(),
      actionType,
      success,
      revenueImpact
    });
  }
  
  recordRevenue(amount, source) {
    this.stabilityMetrics.revenueHistory.push({
      timestamp: Date.now(),
      amount,
      source
    });
    
    // Update long-horizon tracking
    this.updateLongHorizonTracking(amount);
  }
  
  updateLongHorizonTracking(amount) {
    const now = Date.now();
    const dataPoint = { timestamp: now, amount, stabilityScore: this.stabilityMetrics.overallStabilityScore };
    
    // Update day window
    this.longHorizonMetrics.dayWindow.push(dataPoint);
    this.longHorizonMetrics.dayWindow = this.longHorizonMetrics.dayWindow.filter(d => now - d.timestamp < this.config.shortHorizon);
    
    // Update week window  
    this.longHorizonMetrics.weekWindow.push(dataPoint);
    this.longHorizonMetrics.weekWindow = this.longHorizonMetrics.weekWindow.filter(d => now - d.timestamp < this.config.mediumHorizon);
    
    // Update month window
    this.longHorizonMetrics.monthWindow.push(dataPoint);
    this.longHorizonMetrics.monthWindow = this.longHorizonMetrics.monthWindow.filter(d => now - d.timestamp < this.config.longHorizon);
  }
  
  /**
   * DATA RETRIEVAL METHODS
   */
  
  getRecentSelections(horizon) {
    const cutoff = Date.now() - horizon;
    return this.stabilityMetrics.selectionHistory.filter(s => s.timestamp > cutoff);
  }
  
  getRecentPerformance(horizon) {
    const cutoff = Date.now() - horizon;
    return this.stabilityMetrics.performanceHistory.filter(p => p.timestamp > cutoff);
  }
  
  getRecentActions(horizon) {
    const cutoff = Date.now() - horizon;
    return this.stabilityMetrics.actionHistory.filter(a => a.timestamp > cutoff);
  }
  
  getRecentRevenue(horizon) {
    const cutoff = Date.now() - horizon;
    return this.stabilityMetrics.revenueHistory.filter(r => r.timestamp > cutoff);
  }
  
  /**
   * STATUS AND MONITORING
   */
  
  getSystemStatus() {
    return {
      stabilityMetrics: { ...this.stabilityMetrics },
      explorationState: { ...this.explorationState },
      violations: {
        overfitting: this.violations.overfitting.length,
        volatility: this.violations.volatility.length,
        greed: this.violations.greed.length,
        instability: this.violations.instability.length
      },
      longHorizonMetrics: {
        dayWindow: this.longHorizonMetrics.dayWindow.length,
        weekWindow: this.longHorizonMetrics.weekWindow.length,
        monthWindow: this.longHorizonMetrics.monthWindow.length
      },
      config: this.config
    };
  }
  
  getGovernanceReport() {
    return {
      overallStability: this.stabilityMetrics.overallStabilityScore,
      explorationRate: this.explorationState.currentRate,
      requiredExploration: this.config.minExplorationRate,
      volatilityScore: this.calculateSelectionVariance(),
      recentViolations: {
        overfitting: this.violations.overfitting.slice(-5),
        volatility: this.violations.volatility.slice(-5),
        greed: this.violations.greed.slice(-5),
        instability: this.violations.instability.slice(-5)
      },
      longHorizonStability: this.calculateLongHorizonStability(),
      governanceActions: {
        explorationEnforced: this.violations.overfitting.length,
        volatilityPenalties: this.violations.volatility.length,
        revenueBlocked: this.violations.greed.length,
        instabilityBlocked: this.violations.instability.length
      }
    };
  }
  
  async reset() {
    // Reset all metrics
    this.stabilityMetrics = {
      performanceConsistency: 0,
      modelSelectionVariance: 0,
      actionReliability: 0,
      revenueVolatility: 0,
      overallStabilityScore: 0,
      performanceHistory: [],
      selectionHistory: [],
      actionHistory: [],
      revenueHistory: []
    };
    
    // Reset violations
    this.violations = {
      overfitting: [],
      volatility: [],
      greed: [],
      instability: []
    };
    
    // Reset exploration state
    this.explorationState = {
      requiredRate: this.config.minExplorationRate,
      currentRate: 0,
      explorationBudget: 0,
      lastExploration: 0
    };
    
    // Reset long-horizon tracking
    this.longHorizonMetrics = {
      dayWindow: [],
      weekWindow: [],
      monthWindow: []
    };
    
    console.log('[GCE] Global Constraint Enforcer reset completed');
  }
}

module.exports = GlobalConstraintEnforcer;
