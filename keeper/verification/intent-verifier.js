/**
 * Intent Verification Layer
 * Detects when agents are about to do something dumb
 */

class IntentVerifier {
  constructor() {
    this.anomalyThresholds = {
      max_single_transfer: 50000, // $500
      max_hourly_volume: 100000, // $1000
      max_webhook_burst: 50, // per 2 seconds
      max_failed_auth: 5,
      suspicious_countries: ['XX', 'ZZ'], // High-risk
      velocity_limit: 1000 // requests per minute
    };

    this.agentProfiles = new Map();
    this.globalStats = {
      totalVolume: 0,
      hourlyVolume: 0,
      lastHourReset: Date.now()
    };
  }

  /**
   * Verify intent before execution
   */
  async verifyIntent(agentId, action, payload, context = {}) {
    const verification = {
      passed: true,
      riskScore: 0,
      flags: [],
      anomalies: []
    };

    // 1. Payload sanity check
    this.checkPayloadSanity(action, payload, verification);

    // 2. Anomaly detection
    await this.detectAnomalies(agentId, action, payload, context, verification);

    // 3. Velocity checks
    this.checkVelocity(agentId, action, verification);

    // 4. Pattern analysis
    this.analyzePatterns(agentId, action, payload, verification);

    // 5. Context validation
    this.validateContext(context, verification);

    // Decision
    if (verification.riskScore > 0.8) {
      verification.passed = false;
      verification.blockReason = 'High risk score';
    } else if (verification.riskScore > 0.6) {
      verification.requiresReview = true;
    }

    return verification;
  }

  /**
   * Check payload for obvious issues
   */
  checkPayloadSanity(action, payload, verification) {
    // Amount checks
    if (payload.amount) {
      if (payload.amount < 0) {
        verification.flags.push('Negative amount');
        verification.riskScore += 0.5;
      }

      if (payload.amount > this.anomalyThresholds.max_single_transfer) {
        verification.anomalies.push({
          type: 'LARGE_AMOUNT',
          value: payload.amount,
          threshold: this.anomalyThresholds.max_single_transfer
        });
        verification.riskScore += 0.7;
      }

      // Round number suspicion (automated)
      if (payload.amount % 10000 === 0 && payload.amount > 100000) {
        verification.flags.push('Suspicious round amount');
        verification.riskScore += 0.3;
      }
    }

    // Destination checks
    if (payload.destination) {
      // New destination?
      const profile = this.getAgentProfile(agentId);
      if (!profile.knownDestinations.has(payload.destination)) {
        verification.flags.push('New destination');
        verification.riskScore += 0.4;
      }

      // Blacklisted destinations
      if (this.isBlacklisted(payload.destination)) {
        verification.passed = false;
        verification.blockReason = 'Blacklisted destination';
        verification.riskScore = 1.0;
      }
    }

    // Email checks
    if (payload.to || payload.recipients) {
      const recipients = payload.to || payload.recipients;
      if (Array.isArray(recipients) && recipients.length > 1000) {
        verification.anomalies.push({
          type: 'MASS_EMAIL',
          count: recipients.length
        });
        verification.riskScore += 0.8;
      }
    }

    // Structured data checks
    if (action.includes('stripe') && !this.validateStripePayload(payload)) {
      verification.flags.push('Invalid Stripe payload structure');
      verification.riskScore += 0.3;
    }
  }

  /**
   * Detect anomalies using statistical analysis
   */
  async detectAnomalies(agentId, action, payload, context, verification) {
    const profile = this.getAgentProfile(agentId);
    const now = Date.now();

    // Frequency anomaly
    const recentActions = profile.actions.filter(a => 
      now - a.timestamp < 60000 // Last minute
    );

    if (recentActions.length > 100) {
      verification.anomalies.push({
        type: 'HIGH_FREQUENCY',
        count: recentActions.length,
        window: '1 minute'
      });
      verification.riskScore += 0.6;
    }

    // Volume anomaly
    if (payload.amount) {
      const hourlyTotal = profile.actions
        .filter(a => now - a.timestamp < 3600000) // Last hour
        .reduce((sum, a) => sum + (a.amount || 0), 0) + payload.amount;

      if (hourlyTotal > this.anomalyThresholds.max_hourly_volume) {
        verification.anomalies.push({
          type: 'HIGH_VOLUME',
          amount: hourlyTotal,
          threshold: this.anomalyThresholds.max_hourly_volume
        });
        verification.riskScore += 0.8;
      }

      // Update global volume
      this.globalStats.hourlyVolume += payload.amount;
      if (this.globalStats.hourlyVolume > this.anomalyThresholds.max_hourly_volume * 10) {
        verification.anomalies.push({
          type: 'GLOBAL_VOLUME_SPIKE',
          amount: this.globalStats.hourlyVolume
        });
        verification.riskScore += 0.5;
      }
    }

    // Time-based anomaly
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      if (!profile.worksNightShift) {
        verification.flags.push('Unusual hours');
        verification.riskScore += 0.3;
      }
    }

    // Geographic anomaly
    if (context.ip) {
      const geo = await this.getGeoFromIP(context.ip);
      if (geo && this.anomalyThresholds.suspicious_countries.includes(geo.country)) {
        verification.anomalies.push({
          type: 'SUSPICIOUS_LOCATION',
          country: geo.country
        });
        verification.riskScore += 0.7;
      }
    }

    // Behavioral anomaly
    this.detectBehavioralAnomalies(agentId, action, payload, verification);
  }

  /**
   * Check request velocity
   */
  checkVelocity(agentId, action, verification) {
    const profile = this.getAgentProfile(agentId);
    const now = Date.now();
    const window = 60000; // 1 minute

    // Clean old requests
    profile.velocityHistory = profile.velocityHistory.filter(
      t => now - t < window
    );

    // Add current request
    profile.velocityHistory.push(now);

    // Check limit
    if (profile.velocityHistory.length > this.anomalyThresholds.velocity_limit) {
      verification.anomalies.push({
        type: 'VELOCITY_LIMIT_EXCEEDED',
        requests: profile.velocityHistory.length,
        limit: this.anomalyThresholds.velocity_limit
      });
      verification.riskScore += 0.9;
    }
  }

  /**
   * Analyze patterns for suspicious behavior
   */
  analyzePatterns(agentId, action, payload, verification) {
    const profile = this.getAgentProfile(agentId);

    // Sequential pattern detection
    if (profile.lastActions) {
      const lastThree = profile.lastActions.slice(-3);
      
      // Repeated same action to different destinations
      if (lastThree.length === 3 && 
          lastThree.every(a => a.action === action) &&
          new Set(lastThree.map(a => a.destination)).size === 3) {
        verification.flags.push('Spray pattern detected');
        verification.riskScore += 0.5;
      }

      // Rapid escalation
      if (payload.amount && lastThree.some(a => a.amount)) {
        const amounts = [...lastThree.map(a => a.amount || 0), payload.amount];
        if (amounts[3] > amounts[0] * 10) {
          verification.anomalies.push({
            type: 'RAPID_ESCALATION',
            from: amounts[0],
            to: amounts[3]
          });
          verification.riskScore += 0.6;
        }
      }
    }

    // Update history
    profile.lastActions = (profile.lastActions || []).slice(-9);
    profile.lastActions.push({
      action,
      amount: payload.amount,
      destination: payload.destination,
      timestamp: Date.now()
    });
  }

  /**
   * Validate context information
   */
  validateContext(context, verification) {
    // User agent analysis
    if (context.userAgent) {
      const ua = context.userAgent.toLowerCase();
      if (ua.includes('bot') || ua.includes('crawler')) {
        verification.flags.push('Bot-like user agent');
        verification.riskScore += 0.4;
      }
    }

    // Request origin
    if (context.origin && !this.isAllowedOrigin(context.origin)) {
      verification.flags.push('Unauthorized origin');
      verification.riskScore += 0.5;
    }

    // Authentication method
    if (!context.authMethod || context.authMethod === 'none') {
      verification.flags.push('No authentication');
      verification.riskScore += 0.8;
    }
  }

  /**
   * Behavioral anomaly detection
   */
  detectBehavioralAnomalies(agentId, action, payload, verification) {
    const profile = this.getAgentProfile(agentId);

    // Learning: establish baseline
    if (profile.actionStats[action]) {
      const stats = profile.actionStats[action];
      
      // Z-score for amount
      if (payload.amount && stats.avgAmount && stats.stdAmount) {
        const zScore = Math.abs(payload.amount - stats.avgAmount) / stats.stdAmount;
        if (zScore > 3) {
          verification.anomalies.push({
            type: 'STATISTICAL_OUTLIER',
            zScore: zScore.toFixed(2)
          });
          verification.riskScore += 0.4;
        }
      }

      // Time since last action
      if (stats.lastAction) {
        const timeSince = Date.now() - stats.lastAction;
        const avgInterval = stats.avgInterval || 300000; // 5 minutes default
        
        if (timeSince < avgInterval * 0.1) {
          verification.flags.push('Unusual frequency');
          verification.riskScore += 0.3;
        }
      }
    }

    // Update stats
    this.updateActionStats(profile, action, payload);
  }

  /**
   * Update action statistics for learning
   */
  updateActionStats(profile, action, payload) {
    if (!profile.actionStats[action]) {
      profile.actionStats[action] = {
        count: 0,
        amounts: [],
        intervals: [],
        avgAmount: 0,
        stdAmount: 0,
        avgInterval: 300000,
        lastAction: null
      };
    }

    const stats = profile.actionStats[action];
    stats.count++;
    stats.lastAction = Date.now();

    if (payload.amount) {
      stats.amounts.push(payload.amount);
      // Keep only last 100 values
      if (stats.amounts.length > 100) {
        stats.amounts.shift();
      }
      
      // Calculate avg and std
      stats.avgAmount = stats.amounts.reduce((a, b) => a + b, 0) / stats.amounts.length;
      const variance = stats.amounts.reduce((sum, val) => 
        sum + Math.pow(val - stats.avgAmount, 2), 0) / stats.amounts.length;
      stats.stdAmount = Math.sqrt(variance);
    }
  }

  /**
   * Helper methods
   */
  getAgentProfile(agentId) {
    if (!this.agentProfiles.has(agentId)) {
      this.agentProfiles.set(agentId, {
        knownDestinations: new Set(),
        actions: [],
        velocityHistory: [],
        lastActions: [],
        actionStats: {},
        worksNightShift: false,
        createdAt: Date.now()
      });
    }
    return this.agentProfiles.get(agentId);
  }

  validateStripePayload(payload) {
    // Basic structure validation
    if (!payload.destination && !payload.account_id) {
      return false;
    }
    if (payload.amount && (typeof payload.amount !== 'number' || payload.amount <= 0)) {
      return false;
    }
    return true;
  }

  isBlacklisted(destination) {
    // In real implementation, check against blacklist
    return destination.includes('blacklisted');
  }

  isAllowedOrigin(origin) {
    const allowed = [
      'https://protoforge.com',
      'https://app.protoforge.com',
      'https://api.protoforge.com'
    ];
    return allowed.includes(origin);
  }

  async getGeoFromIP(ip) {
    // In real implementation, use GeoIP service
    return { country: 'US' };
  }

  /**
   * Get verification report
   */
  getReport(agentId) {
    const profile = this.getAgentProfile(agentId);
    return {
      agentId,
      riskFactors: verification.anomalies,
      behaviorProfile: {
        avgAmount: Object.values(profile.actionStats)
          .map(s => s.avgAmount)
          .filter(a => a)
          .reduce((a, b) => a + b, 0) / Object.keys(profile.actionStats).length,
        knownDestinations: profile.knownDestinations.size,
        actionFrequency: profile.actions.length,
        riskScore: this.calculateOverallRisk(agentId)
      }
    };
  }

  calculateOverallRisk(agentId) {
    // Complex risk calculation based on all factors
    const profile = this.getAgentProfile(agentId);
    let risk = 0;

    // Factor in anomalies
    risk += profile.anomalies?.length * 0.1 || 0;

    // Factor in velocity
    risk += Math.min(profile.velocityHistory?.length / 100, 1) * 0.3;

    // Factor in time patterns
    const recentHour = profile.actions.filter(a => 
      Date.now() - a.timestamp < 3600000
    ).length;
    risk += Math.min(recentHour / 50, 1) * 0.2;

    return Math.min(risk, 1);
  }
}

module.exports = IntentVerifier;
