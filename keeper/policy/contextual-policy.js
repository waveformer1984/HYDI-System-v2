/**
 * Contextual Policy Engine v2
 * Because static policies are for amateurs
 */

const cron = require('node-cron');

class ContextualPolicyEngine {
  constructor() {
    // Context-aware policies
    this.policies = {
      'finance-agent': {
        'stripe:transfer': {
          max_amount: 10000, // $100 USD
          requires_approval_above: 5000, // $50 USD
          allowed_hours: '08:00-18:00',
          allowed_days: 'MON-FRI',
          max_daily_transfers: 50,
          cooldown_between: 30, // seconds
          risk_factors: {
            new_destination: 0.8,
            large_amount: 0.6,
            off_hours: 0.9,
            high_frequency: 0.7
          }
        },
        'stripe:create_connect_account': {
          max_per_day: 10,
          requires_approval: true,
          allowed_countries: ['US', 'CA', 'GB', 'AU', 'DE'],
          business_types: ['individual', 'company', 'non_profit']
        }
      },
      'heidi-agent': {
        'email:send': {
          max_per_hour: 100,
          allowed_recipients: ['internal', 'verified-clients'],
          requires_approval_for: ['all-clients', 'external'],
          rate_limit: {
            burst: 10,
            sustained: 1 // per second
          }
        },
        'webhook:verify': {
          max_failures: 5,
          lockout_duration: 300, // 5 minutes
          suspicious_patterns: ['replay', 'invalid_signature']
        }
      }
    };

    // Agent state tracking
    this.agentState = new Map();
    
    // Approval queue
    this.approvalQueue = [];
    
    // Initialize state for known agents
    this.initializeAgentStates();
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Enhanced authorization with context
   */
  async authorized(agentId, request, context = {}) {
    // Get base policy
    const agentPolicies = this.policies[agentId];
    if (!agentPolicies) {
      return { authorized: false, reason: 'Unknown agent' };
    }

    const actionPolicy = agentPolicies[request.action];
    if (!actionPolicy) {
      return { authorized: false, reason: 'Action not permitted' };
    }

    // Get agent state
    const state = this.getAgentState(agentId);
    
    // Context checks
    const checks = [
      this.checkTimeWindow(actionPolicy),
      this.checkRateLimits(agentId, request.action, actionPolicy, state),
      this.checkAmountLimits(request.payload, actionPolicy),
      this.checkRiskFactors(agentId, request, actionPolicy, context),
      this.checkBusinessRules(request.payload, actionPolicy)
    ];

    const results = await Promise.allSettled(checks);
    
    // Analyze results
    const failures = results.filter(r => r.status === 'rejected' || !r.value.allowed);
    const riskScore = this.calculateRiskScore(results, request);

    // Decision matrix
    if (riskScore > 0.8) {
      return {
        authorized: false,
        reason: 'High risk score',
        risk_score: riskScore,
        factors: failures.map(f => f.reason || f.value?.reason)
      };
    }

    if (riskScore > 0.6 || this.requiresApproval(request, actionPolicy, riskScore)) {
      const approvalId = this.queueForApproval(agentId, request, riskScore);
      return {
        authorized: false,
        requires_approval: true,
        approval_id: approvalId,
        risk_score: riskScore,
        reason: 'Manual approval required'
      };
    }

    // Update state
    this.updateAgentState(agentId, request.action, request.payload);

    return {
      authorized: true,
      risk_score: riskScore,
      context: {
        remaining_quota: this.getRemainingQuota(agentId, request.action),
        next_reset: state.nextReset
      }
    };
  }

  /**
   * Check if request is within allowed time window
   */
  checkTimeWindow(policy) {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday

    // Check hours
    if (policy.allowed_hours) {
      const [start, end] = policy.allowed_hours.split('-').map(h => parseInt(h));
      if (hour < start || hour > end) {
        return {
          allowed: false,
          reason: `Outside allowed hours: ${policy.allowed_hours}`
        };
      }
    }

    // Check days
    if (policy.allowed_days) {
      const dayMap = { 'MON': 1, 'TUE': 2, 'WED': 3, 'THU': 4, 'FRI': 5, 'SAT': 6, 'SUN': 0 };
      const allowedDays = policy.allowed_days.split('-').map(d => dayMap[d]);
      
      if (policy.allowed_days === 'MON-FRI' && (day === 0 || day === 6)) {
        return {
          allowed: false,
          reason: 'Weekend operations not allowed'
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check rate limits with burst control
   */
  checkRateLimits(agentId, action, policy, state) {
    const now = Date.now();
    const actionState = state.actions[action] || { count: 0, lastReset: now };

    // Reset if needed
    const resetPeriod = 60 * 60 * 1000; // 1 hour
    if (now - actionState.lastReset > resetPeriod) {
      actionState.count = 0;
      actionState.lastReset = now;
    }

    // Check limits
    if (policy.max_per_hour && actionState.count >= policy.max_per_hour) {
      return {
        allowed: false,
        reason: `Hourly limit exceeded: ${policy.max_per_hour}`
      };
    }

    // Check cooldown
    if (policy.cooldown_between) {
      const timeSinceLast = now - (actionState.lastAction || 0);
      if (timeSinceLast < policy.cooldown_between * 1000) {
        return {
          allowed: false,
          reason: `Cooldown period: ${policy.cooldown_between}s`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check amount limits with dynamic thresholds
   */
  checkAmountLimits(payload, policy) {
    if (!policy.max_amount || !payload.amount) {
      return { allowed: true };
    }

    const amount = payload.amount;
    
    // Dynamic threshold based on history
    const historicalAvg = this.getHistoricalAverage(payload.destination);
    const threshold = Math.min(policy.max_amount, historicalAvg * 3);

    if (amount > threshold) {
      return {
        allowed: false,
        reason: `Amount ${amount} exceeds threshold ${threshold}`
      };
    }

    return { allowed: true };
  }

  /**
   * Risk factor analysis
   */
  checkRiskFactors(agentId, request, policy, context) {
    let riskScore = 0;
    const factors = [];

    // New destination
    if (request.payload.destination && !this.hasSeenDestination(agentId, request.payload.destination)) {
      riskScore += policy.risk_factors?.new_destination || 0.5;
      factors.push('New destination');
    }

    // Large amount
    if (request.payload.amount > (policy.max_amount * 0.8)) {
      riskScore += policy.risk_factors?.large_amount || 0.4;
      factors.push('Large amount');
    }

    // High frequency
    const recentActions = this.getRecentActions(agentId, 300); // 5 minutes
    if (recentActions.length > 10) {
      riskScore += policy.risk_factors?.high_frequency || 0.6;
      factors.push('High frequency');
    }

    // Unusual IP (if provided)
    if (context.ip && !this.isKnownIP(agentId, context.ip)) {
      riskScore += 0.3;
      factors.push('Unknown IP');
    }

    return {
      allowed: riskScore < 0.7,
      risk_score: riskScore,
      factors
    };
  }

  /**
   * Business rules validation
   */
  checkBusinessRules(payload, policy) {
    // Country validation
    if (policy.allowed_countries && payload.country) {
      if (!policy.allowed_countries.includes(payload.country)) {
        return {
          allowed: false,
          reason: `Country ${payload.country} not allowed`
        };
      }
    }

    // Business type validation
    if (policy.business_types && payload.business_type) {
      if (!policy.business_types.includes(payload.business_type)) {
        return {
          allowed: false,
          reason: `Business type ${payload.business_type} not allowed`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Calculate overall risk score
   */
  calculateRiskScore(results, request) {
    let totalScore = 0;
    let weight = 0;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.risk_score) {
        totalScore += result.value.risk_score * (result.value.weight || 1);
        weight += result.value.weight || 1;
      }
    }

    return weight > 0 ? totalScore / weight : 0;
  }

  /**
   * Check if approval is required
   */
  requiresApproval(request, policy, riskScore) {
    // Explicit approval requirement
    if (policy.requires_approval) return true;

    // Amount-based approval
    if (policy.requires_approval_above && request.payload?.amount > policy.requires_approval_above) {
      return true;
    }

    // Risk-based approval
    if (riskScore > 0.6) return true;

    return false;
  }

  /**
   * Queue for manual approval
   */
  queueForApproval(agentId, request, riskScore) {
    const approval = {
      id: this.generateId(),
      agent_id: agentId,
      action: request.action,
      payload: this.sanitizeForApproval(request.payload),
      risk_score: riskScore,
      created_at: new Date().toISOString(),
      status: 'pending'
    };

    this.approvalQueue.push(approval);
    
    // Notify human operator
    this.notifyForApproval(approval);

    return approval.id;
  }

  /**
   * Process approval decision
   */
  processApproval(approvalId, approved, approver = 'system') {
    const approval = this.approvalQueue.find(a => a.id === approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    approval.status = approved ? 'approved' : 'rejected';
    approval.decided_at = new Date().toISOString();
    approval.decided_by = approver;

    // Execute if approved
    if (approved) {
      this.executeApprovedRequest(approval);
    }

    return approval;
  }

  /**
   * Get agent state
   */
  getAgentState(agentId) {
    if (!this.agentState.has(agentId)) {
      this.agentState.set(agentId, {
        actions: {},
        destinations: new Set(),
        ips: new Set(),
        created_at: new Date().toISOString(),
        nextReset: this.getNextReset()
      });
    }
    return this.agentState.get(agentId);
  }

  /**
   * Update agent state
   */
  updateAgentState(agentId, action, payload) {
    const state = this.getAgentState(agentId);
    
    // Update action count
    if (!state.actions[action]) {
      state.actions[action] = { count: 0, lastReset: Date.now(), lastAction: 0 };
    }
    state.actions[action].count++;
    state.actions[action].lastAction = Date.now();

    // Track destinations
    if (payload.destination) {
      state.destinations.add(payload.destination);
    }

    // Track IPs if provided
    if (payload.context?.ip) {
      state.ips.add(payload.context.ip);
    }
  }

  /**
   * Helper methods
   */
  hasSeenDestination(agentId, destination) {
    return this.getAgentState(agentId).destinations.has(destination);
  }

  isKnownIP(agentId, ip) {
    return this.getAgentState(agentId).ips.has(ip);
  }

  getHistoricalAverage(destination) {
    // In real implementation, query database
    return 1000; // $10 default
  }

  getRecentActions(agentId, timeWindow) {
    // In real implementation, query recent actions
    return [];
  }

  getRemainingQuota(agentId, action) {
    const state = this.getAgentState(agentId);
    const policy = this.policies[agentId]?.[action];
    const used = state.actions[action]?.count || 0;
    return policy ? Math.max(0, (policy.max_per_hour || Infinity) - used) : Infinity;
  }

  getNextReset() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next.toISOString();
  }

  generateId() {
    return crypto.randomBytes(16).toString('hex');
  }

  sanitizeForApproval(payload) {
    // Remove sensitive fields for approval view
    const sanitized = { ...payload };
    delete sanitized.api_key;
    delete sanitized.secret;
    return sanitized;
  }

  notifyForApproval(approval) {
    console.log(`[APPROVAL] Required: ${approval.agent_id} - ${approval.action} (risk: ${approval.risk_score})`);
    // In production, send to Slack/Email/Dashboard
  }

  executeApprovedRequest(approval) {
    console.log(`[APPROVAL] Executing approved request: ${approval.id}`);
    // Execute the original request
  }

  initializeAgentStates() {
    // Load persisted states
  }

  startPeriodicCleanup() {
    // Clean up old states every hour
    cron.schedule('0 * * * *', () => {
      this.cleanupOldStates();
    });
  }

  cleanupOldStates() {
    // Remove states older than 24 hours
  }
}

module.exports = ContextualPolicyEngine;
