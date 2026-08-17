/**
 * @deprecated KEEPER Policy Engine is superseded by lib/protoforge/policy-engine.js.
 * Replacement: lib/protoforge/policy-engine.js or compatibility/policy-legacy.js
 * Migration: Evaluate hypotheses with the canonical DSL PolicyEngine. Removal target: Phase 5.
 *
 * KEEPER Policy Engine
 * Defines what agents can do
 */

class PolicyEngine {
  constructor() {
    // Agent permissions - whitelist approach
    this.policies = {
      'finance-agent': [
        'stripe:create_connect_account',
        'stripe:transfer',
        'stripe:retrieve_account',
        'stripe:list_accounts',
        'email:send_payout_notification'
      ],
      'heidi-agent': [
        'stripe:retrieve_account',
        'email:send_alert',
        'webhook:verify'
      ],
      'outreach-agent': [
        'email:send_newsletter',
        'email:send_onboarding'
      ],
      'monitoring-agent': [
        'webhook:verify',
        'system:health_check'
      ]
    };

    // Rate limits per agent
    this.rateLimits = {
      'finance-agent': { requests: 100, window: '1h' },
      'heidi-agent': { requests: 1000, window: '1h' },
      'outreach-agent': { requests: 500, window: '1h' },
      'monitoring-agent': { requests: 2000, window: '1h' }
    };

    // Track usage
    this.usage = {};
  }

  /**
   * Check if agent is authorized for action
   */
  authorized(agentId, request) {
    // 1. Check if agent exists
    if (!this.policies[agentId]) {
      console.log(`[POLICY] Unknown agent: ${agentId}`);
      return false;
    }

    // 2. Check action permission
    const allowedActions = this.policies[agentId];
    if (!allowedActions.includes(request.action)) {
      console.log(`[POLICY] Agent ${agentId} not authorized for ${request.action}`);
      return false;
    }

    // 3. Check rate limits
    if (!this.checkRateLimit(agentId)) {
      console.log(`[POLICY] Agent ${agentId} exceeded rate limit`);
      return false;
    }

    // 4. Additional checks based on action
    if (request.action.startsWith('stripe:')) {
      return this.checkStripePolicy(agentId, request);
    }

    return true;
  }

  /**
   * Check rate limiting
   */
  checkRateLimit(agentId) {
    const now = Date.now();
    const limit = this.rateLimits[agentId];
    
    if (!limit) return true;

    const windowMs = this.parseWindow(limit.window);
    const key = `${agentId}:${Math.floor(now / windowMs)}`;
    
    if (!this.usage[key]) {
      this.usage[key] = 0;
    }

    if (this.usage[key] >= limit.requests) {
      return false;
    }

    this.usage[key]++;
    return true;
  }

  /**
   * Parse window string to milliseconds
   */
  parseWindow(window) {
    const units = {
      's': 1000,
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000
    };
    
    const match = window.match(/^(\d+)([smhd])$/);
    if (!match) return 60 * 60 * 1000; // Default 1 hour
    
    const [, num, unit] = match;
    return parseInt(num) * units[unit];
  }

  /**
   * Additional Stripe-specific policies
   */
  checkStripePolicy(agentId, request) {
    // Only finance-agent can create accounts or transfer funds
    if (request.action === 'stripe:create_connect_account' || 
        request.action === 'stripe:transfer') {
      return agentId === 'finance-agent';
    }

    // Transfer amount limits
    if (request.action === 'stripe:transfer') {
      const amount = request.payload?.amount || 0;
      if (amount > 10000000) { // $100,000 limit
        console.log(`[POLICY] Transfer amount exceeds limit: ${amount}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Add or update agent policy
   */
  updatePolicy(agentId, actions, rateLimit) {
    this.policies[agentId] = actions;
    if (rateLimit) {
      this.rateLimits[agentId] = rateLimit;
    }
  }

  /**
   * Get agent policy
   */
  getPolicy(agentId) {
    return {
      actions: this.policies[agentId] || [],
      rateLimit: this.rateLimits[agentId] || { requests: 100, window: '1h' }
    };
  }
}

module.exports = PolicyEngine;
