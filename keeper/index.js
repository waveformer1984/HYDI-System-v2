/**
 * KEEPER - ProtoForge Secret Management System
 * The paranoid bouncer between agents and secrets
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class Keeper {
  constructor(vault, policyEngine) {
    this.vault = vault;
    this.policyEngine = policyEngine;
    this.auditLog = [];
  }

  /**
   * Handle agent requests - NEVER returns raw secrets
   */
  async handle(request, agentId) {
    const requestId = this.generateRequestId();
    const timestamp = new Date().toISOString();
    
    // Log request attempt (sanitized)
    this.log({
      requestId,
      agent: agentId,
      action: request.action,
      timestamp,
      status: 'attempted'
    });

    try {
      // 1. Authorize the agent
      if (!this.policyEngine.authorized(agentId, request)) {
        throw new Error(`Agent ${agentId} not authorized for ${request.action}`);
      }

      // 2. Get secret from vault (NEVER exposed to agent)
      const secret = await this.vault.get(request.secretRef);
      
      // 3. Execute action with secret
      const result = await this.execute(request, secret);
      
      // 4. Sanitize result
      const sanitized = this.sanitize(result);
      
      // 5. Log success (no secrets!)
      this.log({
        requestId,
        agent: agentId,
        action: request.action,
        timestamp,
        status: 'success'
      });

      return {
        success: true,
        data: sanitized,
        requestId
      };

    } catch (error) {
      // Log failure
      this.log({
        requestId,
        agent: agentId,
        action: request.action,
        timestamp,
        status: 'failed',
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        requestId
      };
    }
  }

  /**
   * Execute the actual action with injected secret
   */
  async execute(request, secret) {
    switch (request.action) {
      case 'stripe:create_connect_account':
        return await this.stripeCreateConnectAccount(request.payload, secret);
      
      case 'stripe:transfer':
        return await this.stripeTransfer(request.payload, secret);
      
      case 'stripe:retrieve_account':
        return await this.stripeRetrieveAccount(request.payload, secret);
      
      case 'email:send':
        return await this.sendEmail(request.payload, secret);
      
      case 'webhook:verify':
        return await this.verifyWebhook(request.payload, secret);
      
      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
  }

  /**
   * Stripe: Create Connect Account
   */
  async stripeCreateConnectAccount(payload, stripeKey) {
    const Stripe = require('stripe');
    const stripe = new Stripe(stripeKey);
    
    const account = await stripe.accounts.create({
      type: payload.type || 'express',
      country: payload.country || 'US',
      email: payload.email,
      capabilities: payload.capabilities || {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      business_profile: payload.business_profile,
      metadata: payload.metadata
    });

    return account;
  }

  /**
   * Stripe: Transfer funds
   */
  async stripeTransfer(payload, stripeKey) {
    const Stripe = require('stripe');
    const stripe = new Stripe(stripeKey);
    
    const transfer = await stripe.transfers.create({
      amount: payload.amount,
      currency: payload.currency || 'usd',
      destination: payload.destination,
      metadata: payload.metadata
    });

    return transfer;
  }

  /**
   * Stripe: Retrieve account
   */
  async stripeRetrieveAccount(payload, stripeKey) {
    const Stripe = require('stripe');
    const stripe = new Stripe(stripeKey);
    
    const account = await stripe.accounts.retrieve(payload.accountId);
    return account;
  }

  /**
   * Send email (example with Resend)
   */
  async sendEmail(payload, emailKey) {
    // Implementation would use email service with injected key
    return {
      id: 'email_' + this.generateRequestId(),
      to: payload.to,
      status: 'sent'
    };
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhook(payload, webhookSecret) {
    const { signature, body } = payload;
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body, 'utf8')
      .digest('hex');

    const isValid = signature === `t=${payload.timestamp},${expectedSignature}`;
    
    return { valid: isValid };
  }

  /**
   * Sanitize results - strip all secrets
   */
  sanitize(result) {
    // Deep clone to avoid mutation
    const clean = JSON.parse(JSON.stringify(result));
    
    // Remove known secret fields
    const secretFields = [
      'api_key',
      'secret',
      'token',
      'key',
      'password',
      'webhook_secret'
    ];

    const stripSecrets = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(stripSecrets);
      } else if (obj && typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          const keyLower = key.toLowerCase();
          if (secretFields.some(field => keyLower.includes(field))) {
            cleaned[key] = '[REDACTED]';
          } else {
            cleaned[key] = stripSecrets(value);
          }
        }
        return cleaned;
      }
      return obj;
    };

    return stripSecrets(clean);
  }

  /**
   * Issue short-lived SSE token
   */
  issueToken(user, ttl = '10m') {
    const payload = {
      user,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (10 * 60) // 10 minutes
    };

    return jwt.sign(payload, this.vault.getSigningKey());
  }

  /**
   * Generate request ID for tracking
   */
  generateRequestId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Audit logging (NEVER logs secrets)
   */
  log(entry) {
    this.auditLog.push({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    });

    // In production, send to secure logging service
    console.log(`[KEEPER AUDIT] ${entry.agent} - ${entry.action} - ${entry.status}`);
  }

  /**
   * Get audit log
   */
  getAuditLog(agentId = null) {
    if (agentId) {
      return this.auditLog.filter(entry => entry.agent === agentId);
    }
    return this.auditLog;
  }
}

module.exports = Keeper;
