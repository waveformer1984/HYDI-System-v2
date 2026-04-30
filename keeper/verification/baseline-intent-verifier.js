/**
 * Baseline-Training Intent Verifier
 * Because "statistical anomaly detection" is useless without data
 */

const fs = require('fs').promises;
const path = require('path');

class BaselineIntentVerifier {
  constructor(options = {}) {
    this.baselineFile = options.baselineFile || path.join(__dirname, '../../data/baselines.json');
    this.baselines = new Map();
    this.strictMode = options.strictMode !== false; // Default to strict on day 1
    this.minimumSamples = options.minimumSamples || 50;
    this.learningPeriod = options.learningPeriod || 7 * 24 * 60 * 60 * 1000; // 7 days
    
    // Hard limits that never change
    this.hardLimits = {
      'stripe:transfer': {
        maxAmount: 100000, // $1000
        maxPerHour: 10,
        maxPerDay: 100
      },
      'stripe:create_connect_account': {
        maxPerDay: 5,
        allowedCountries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'NL', 'IE']
      },
      'email:send': {
        maxPerHour: 200,
        maxRecipients: 1000
      }
    };
    
    this.loadBaselines();
  }

  /**
   * Verify intent with baseline awareness
   */
  async verifyIntent(agentId, action, payload, context = {}) {
    const verification = {
      passed: true,
      riskScore: 0,
      flags: [],
      mode: this.getVerificationMode(action),
      hardLimitHit: false
    };

    // Always check hard limits first
    this.checkHardLimits(action, payload, verification);
    
    if (verification.hardLimitHit) {
      verification.passed = false;
      verification.blockReason = 'Hard limit exceeded';
      return verification;
    }

    // Get baseline for this agent/action
    const baseline = this.getBaseline(agentId, action);
    
    if (baseline.samples < this.minimumSamples) {
      // Not enough data - use strict mode
      verification.mode = 'strict';
      verification.flags.push('Insufficient baseline data');
      
      // Apply conservative rules
      this.applyConservativeRules(action, payload, verification);
    } else {
      // Have baseline - use learned patterns
      verification.mode = 'learned';
      this.checkAgainstBaseline(baseline, payload, verification);
    }

    // Always check for obvious attacks
    this.checkAttackPatterns(payload, verification);

    // Update baseline with this request (if it passes)
    if (verification.passed) {
      this.updateBaseline(agentId, action, payload, context);
    }

    return verification;
  }

  /**
   * Get verification mode based on data availability
   */
  getVerificationMode(action) {
    const agentBaselines = Array.from(this.baselines.values())
      .filter(b => b.action === action);
    
    const totalSamples = agentBaselines.reduce((sum, b) => sum + b.samples, 0);
    
    if (totalSamples < this.minimumSamples * 3) {
      return 'strict';
    } else if (Date.now() - this.getOldestSample(action) < this.learningPeriod) {
      return 'learning';
    } else {
      return 'operational';
    }
  }

  /**
   * Check hard limits (never bypassed)
   */
  checkHardLimits(action, payload, verification) {
    const limits = this.hardLimits[action];
    if (!limits) return;

    // Amount limits
    if (payload.amount && limits.maxAmount) {
      if (payload.amount > limits.maxAmount) {
        verification.hardLimitHit = true;
        verification.flags.push(`Amount ${payload.amount} exceeds hard limit ${limits.maxAmount}`);
        verification.riskScore = 1.0;
      }
    }

    // Frequency limits
    if (limits.maxPerHour || limits.maxPerDay) {
      const now = Date.now();
      const recent = this.getRecentRequests(action, now);
      
      if (limits.maxPerHour && recent.hourly >= limits.maxPerHour) {
        verification.hardLimitHit = true;
        verification.flags.push(`Hourly limit exceeded: ${recent.hourly}/${limits.maxPerHour}`);
        verification.riskScore = 1.0;
      }
      
      if (limits.maxPerDay && recent.daily >= limits.maxPerDay) {
        verification.hardLimitHit = true;
        verification.flags.push(`Daily limit exceeded: ${recent.daily}/${limits.maxPerDay}`);
        verification.riskScore = 1.0;
      }
    }

    // Country limits
    if (payload.country && limits.allowedCountries) {
      if (!limits.allowedCountries.includes(payload.country)) {
        verification.hardLimitHit = true;
        verification.flags.push(`Country ${payload.country} not in allowlist`);
        verification.riskScore = 1.0;
      }
    }
  }

  /**
   * Apply conservative rules when no baseline
   */
  applyConservativeRules(action, payload, verification) {
    // Be extra careful with new agents
    switch (action) {
      case 'stripe:transfer':
        // Conservative amount: 1/10 of hard limit
        if (payload.amount > this.hardLimits[action].maxAmount * 0.1) {
          verification.flags.push('Conservative amount limit');
          verification.riskScore += 0.5;
        }
        
        // First transfer requires approval
        verification.requiresApproval = true;
        break;
        
      case 'stripe:create_connect_account':
        // Always require approval for new agents
        verification.requiresApproval = true;
        verification.riskScore += 0.3;
        break;
        
      case 'email:send':
        // Limit to 10% of normal rate
        if (payload.recipients && payload.recipients.length > 100) {
          verification.flags.push('Conservative recipient limit');
          verification.riskScore += 0.4;
        }
        break;
    }
  }

  /**
   * Check against learned baseline
   */
  checkAgainstBaseline(baseline, payload, verification) {
    // Amount deviation
    if (payload.amount && baseline.stats.amount) {
      const zScore = Math.abs(payload.amount - baseline.stats.amount.mean) / baseline.stats.amount.std;
      
      if (zScore > 3) {
        verification.anomalies.push({
          type: 'amount_outlier',
          zScore: zScore.toFixed(2),
          deviation: ((payload.amount - baseline.stats.amount.mean) / baseline.stats.amount.mean * 100).toFixed(1) + '%'
        });
        verification.riskScore += Math.min(zScore / 10, 0.5);
      }
    }

    // Time patterns
    const hour = new Date().getHours();
    if (baseline.stats.hourlyDistribution) {
      const expectedRequests = baseline.stats.hourlyDistribution[hour] || 0;
      const recentHourly = this.getRecentRequests(baseline.action, Date.now()).hourly;
      
      if (expectedRequests > 0 && recentHourly > expectedRequests * 3) {
        verification.flags.push('Unusual hourly frequency');
        verification.riskScore += 0.3;
      }
    }

    // Destination patterns
    if (payload.destination && baseline.stats.destinations) {
      if (!baseline.stats.destinations.has(payload.destination)) {
        verification.flags.push('New destination');
        verification.riskScore += 0.4;
      }
    }
  }

  /**
   * Check for obvious attack patterns
   */
  checkAttackPatterns(payload, verification) {
    // Round numbers (automation)
    if (payload.amount && payload.amount % 10000 === 0 && payload.amount > 100000) {
      verification.flags.push('Suspicious round amount');
      verification.riskScore += 0.3;
    }

    // Max values (testing limits)
    if (payload.amount === this.hardLimits[payload.action]?.maxAmount) {
      verification.flags.push('At maximum limit');
      verification.riskScore += 0.2;
    }

    // Rapid sequences
    const key = `${payload.agent || 'unknown'}:${payload.action}`;
    const lastRequest = this.lastRequests?.get(key);
    if (lastRequest && Date.now() - lastRequest < 1000) {
      verification.flags.push('Rapid requests');
      verification.riskScore += 0.4;
    }
    this.lastRequests?.set(key, Date.now());
  }

  /**
   * Get or create baseline
   */
  getBaseline(agentId, action) {
    const key = `${agentId}:${action}`;
    
    if (!this.baselines.has(key)) {
      this.baselines.set(key, {
        agentId,
        action,
        samples: 0,
        stats: {
          amount: { mean: 0, std: 0, values: [] },
          hourlyDistribution: new Array(24).fill(0),
          destinations: new Set(),
          timestamps: []
        },
        createdAt: Date.now(),
        lastUpdated: Date.now()
      });
    }
    
    return this.baselines.get(key);
  }

  /**
   * Update baseline with new data
   */
  updateBaseline(agentId, action, payload, context) {
    const baseline = this.getBaseline(agentId, action);
    baseline.samples++;
    baseline.lastUpdated = Date.now();

    // Update amount statistics
    if (payload.amount) {
      const amounts = baseline.stats.amount.values;
      amounts.push(payload.amount);
      
      // Keep only last 1000 values
      if (amounts.length > 1000) {
        amounts.shift();
      }
      
      // Calculate mean and std
      const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const variance = amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / amounts.length;
      
      baseline.stats.amount = {
        mean,
        std: Math.sqrt(variance),
        values: amounts
      };
    }

    // Update hourly distribution
    const hour = new Date().getHours();
    baseline.stats.hourlyDistribution[hour]++;

    // Update destinations
    if (payload.destination) {
      baseline.stats.destinations.add(payload.destination);
    }

    // Update timestamps
    baseline.stats.timestamps.push(Date.now());
    
    // Save periodically
    if (baseline.samples % 10 === 0) {
      this.saveBaselines();
    }
  }

  /**
   * Get recent request counts
   */
  getRecentRequests(action, now) {
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;
    
    let hourly = 0;
    let daily = 0;
    
    for (const baseline of this.baselines.values()) {
      if (baseline.action === action) {
        hourly += baseline.stats.timestamps.filter(t => t > hourAgo).length;
        daily += baseline.stats.timestamps.filter(t > t > dayAgo).length;
      }
    }
    
    return { hourly, daily };
  }

  /**
   * Get oldest sample timestamp
   */
  getOldestSample(action) {
    let oldest = Date.now();
    
    for (const baseline of this.baselines.values()) {
      if (baseline.action === action && baseline.createdAt < oldest) {
        oldest = baseline.createdAt;
      }
    }
    
    return oldest;
  }

  /**
   * Load baselines from disk
   */
  async loadBaselines() {
    try {
      const data = await fs.readFile(this.baselineFile, 'utf8');
      const baselines = JSON.parse(data);
      
      // Convert Sets back from arrays
      for (const [key, baseline] of Object.entries(baselines)) {
        if (baseline.stats.destinations) {
          baseline.stats.destinations = new Set(baseline.stats.destinations);
        }
        this.baselines.set(key, baseline);
      }
      
      console.log(`[BASELINE] Loaded ${this.baselines.size} baselines`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[BASELINE] Error loading baselines:', err);
      }
    }
    
    // Initialize request tracking
    this.lastRequests = new Map();
  }

  /**
   * Save baselines to disk
   */
  async saveBaselines() {
    try {
      // Convert Sets to arrays for JSON serialization
      const serializable = {};
      for (const [key, baseline] of this.baselines) {
        serializable[key] = {
          ...baseline,
          stats: {
            ...baseline.stats,
            destinations: Array.from(baseline.stats.destinations)
          }
        };
      }
      
      await fs.writeFile(this.baselineFile, JSON.stringify(serializable, null, 2));
    } catch (err) {
      console.error('[BASELINE] Error saving baselines:', err);
    }
  }

  /**
   * Get baseline statistics
   */
  getBaselineStats() {
    const stats = {
      totalBaselines: this.baselines.size,
      agentsWithBaselines: new Set(),
      actionsWithBaselines: new Set(),
      learningProgress: {}
    };
    
    for (const baseline of this.baselines.values()) {
      stats.agentsWithBaselines.add(baseline.agentId);
      stats.actionsWithBaselines.add(baseline.action);
      
      if (!stats.learningProgress[baseline.action]) {
        stats.learningProgress[baseline.action] = {
          totalSamples: 0,
          agentsCount: 0
        };
      }
      
      stats.learningProgress[baseline.action].totalSamples += baseline.samples;
      stats.learningProgress[baseline.action].agentsCount++;
    }
    
    stats.agentsWithBaselines = Array.from(stats.agentsWithBaselines);
    stats.actionsWithBaselines = Array.from(stats.actionsWithBaselines);
    
    return stats;
  }

  /**
   * Reset baseline (for compromised agents)
   */
  resetBaseline(agentId, action = null) {
    const toDelete = [];
    
    for (const [key, baseline] of this.baselines) {
      if (baseline.agentId === agentId && (!action || baseline.action === action)) {
        toDelete.push(key);
      }
    }
    
    toDelete.forEach(key => this.baselines.delete(key));
    
    console.log(`[BASELINE] Reset ${toDelete.length} baselines for agent: ${agentId}`);
    this.saveBaselines();
  }
}

module.exports = BaselineIntentVerifier;
