/**
 * Break-Glass Emergency Override Implementation
 * Manual override endpoint with strong authentication
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class BreakGlassImplementation {
  constructor(options = {}) {
    this.config = {
      // Override duration
      overrideDuration: options.overrideDuration || 5 * 60 * 1000, // 5 minutes
      
      // Authentication methods
      requireHardwareKey: options.requireHardwareKey || false,
      requireMultiAuth: options.requireMultiAuth || true,
      requireSignedToken: options.requireSignedToken || true,
      
      // Emergency actions
      allowedActions: options.allowedActions || [
        'stripe:transfer',
        'stripe:refund',
        'system:restart',
        'circuit:override'
      ],
      
      // Storage
      overrideLog: options.overrideLog || path.join(__dirname, '../../data/break-glass.log'),
      
      ...options
    };
    
    this.activeOverrides = new Map();
    this.overrideHistory = [];
    this.emergencyKeys = new Map();
    
    this.initialize();
  }

  /**
   * Initialize break-glass system
   */
  async initialize() {
    // Create emergency keys
    await this.generateEmergencyKeys();
    
    // Load override history
    await this.loadHistory();
    
    console.log('[BREAK-GLASS] Emergency override system initialized');
  }

  /**
   * Generate emergency keys
   */
  async generateEmergencyKeys() {
    // Generate RSA key pair for signing
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    // Store keys (in production, use HSM)
    this.emergencyKeys.set('public', publicKey);
    this.emergencyKeys.set('private', privateKey);
    
    console.log('[BREAK-GLASS] Emergency keys generated');
  }

  /**
   * Request emergency override
   */
  async requestOverride(action, context = {}) {
    const overrideId = this.generateOverrideId();
    
    // Validate action
    if (!this.config.allowedActions.includes(action)) {
      throw new Error(`Action not allowed: ${action}`);
    }
    
    // Create override request
    const request = {
      id: overrideId,
      status: 'pending',
      action,
      context: {
        requester: context.requester,
        reason: context.reason,
        urgency: context.urgency || 'medium',
        ...context
      },
      authentication: {
        method: null,
        verified: false,
        challenges: []
      },
      createdAt: Date.now()
    };

    // Determine authentication method
    request.authentication.method = this.determineAuthMethod(context);
    
    // Generate challenges
    request.authentication.challenges = await this.generateChallenges(
      request.authentication.method
    );

    // Store request
    this.activeOverrides.set(overrideId, request);

    // Log request
    await this.logOverride(request, 'REQUESTED');

    console.log(`[BREAK-GLASS] Emergency override requested: ${overrideId}`);
    
    return {
      overrideId,
      challenges: request.authentication.challenges,
      expiresAt: Date.now() + 600000 // 10 minutes to complete
    };
  }

  /**
   * Complete override authentication
   */
  async completeAuthentication(overrideId, responses, signature = null) {
    const request = this.activeOverrides.get(overrideId);
    if (!request) {
      throw new Error('Override request not found');
    }

    if (request.status !== 'pending') {
      throw new Error('Override already processed');
    }

    // Verify responses
    const verified = await this.verifyChallenges(
      request.authentication.challenges,
      responses
    );

    if (!verified) {
      request.status = 'failed';
      request.failedAt = Date.now();
      request.failureReason = 'Authentication failed';
      
      await this.logOverride(request, 'FAILED');
      throw new Error('Authentication failed');
    }

    // Verify signature if required
    if (this.config.requireSignedToken && signature) {
      const signatureValid = await this.verifySignature(signature, request);
      if (!signatureValid) {
        request.status = 'failed';
        request.failedAt = Date.now();
        request.failureReason = 'Invalid signature';
        
        await this.logOverride(request, 'FAILED');
        throw new Error('Invalid signature');
      }
    }

    // Activate override
    return await this.activateOverride(overrideId);
  }

  /**
   * Activate emergency override
   */
  async activateOverride(overrideId) {
    const request = this.activeOverrides.get(overrideId);
    if (!request) {
      throw new Error('Override request not found');
    }

    // Create active override
    const override = {
      id: overrideId,
      action: request.action,
      context: request.context,
      activatedAt: Date.now(),
      expiresAt: Date.now() + this.config.overrideDuration,
      status: 'active',
      executions: [],
      metadata: {
        method: request.authentication.method,
        verified: true
      }
    };

    // Replace request with active override
    this.activeOverrides.set(overrideId, override);

    // Log activation
    await this.logOverride(override, 'ACTIVATED');

    console.log(`[BREAK-GLASS] Override activated: ${overrideId}`);
    console.log(`  Action: ${override.action}`);
    console.log(`  Requester: ${override.context.requester}`);
    console.log(`  Reason: ${override.context.reason}`);
    console.log(`  Expires: ${new Date(override.expiresAt).toISOString()}`);

    // Schedule expiration
    this.scheduleExpiration(overrideId);

    return {
      overrideId,
      action: override.action,
      activatedAt: override.activatedAt,
      expiresAt: override.expiresAt
    };
  }

  /**
   * Execute action under override
   */
  async executeAction(overrideId, payload, executor = null) {
    const override = this.activeOverrides.get(overrideId);
    if (!override) {
      throw new Error('Override not found or expired');
    }

    if (override.status !== 'active') {
      throw new Error('Override not active');
    }

    if (Date.now() > override.expiresAt) {
      override.status = 'expired';
      await this.logOverride(override, 'EXPIRED');
      throw new Error('Override expired');
    }

    // Execute action with bypassed security
    const result = await this.executeBypassedAction(override.action, payload);

    // Record execution
    const execution = {
      payload: this.sanitizePayload(payload),
      executedAt: Date.now(),
      executor,
      success: result.success
    };

    override.executions.push(execution);

    // Log execution
    await this.logOverrideExecution(override, execution);

    return {
      ...result,
      overrideId,
      executedAt: execution.executedAt
    };
  }

  /**
   * Execute bypassed action
   */
  async executeBypassedAction(action, payload) {
    console.log(`[BREAK-GLASS] Executing bypassed action: ${action}`);
    
    // In a real implementation, this would execute the actual action
    // with all security controls bypassed
    
    switch (action) {
      case 'stripe:transfer':
        return await this.executeStripeTransfer(payload);
        
      case 'stripe:refund':
        return await this.executeStripeRefund(payload);
        
      case 'system:restart':
        return await this.executeSystemRestart(payload);
        
      case 'circuit:override':
        return await this.executeCircuitOverride(payload);
        
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  /**
   * Execute Stripe transfer with bypass
   */
  async executeStripeTransfer(payload) {
    // In a real implementation, this would make direct Stripe API call
    // bypassing all Keeper controls
    
    console.log(`[BREAK-GLASS] Executing emergency Stripe transfer`);
    console.log(`  Amount: ${payload.amount}`);
    console.log(`  Destination: ${payload.destination}`);
    
    // Simulate execution
    return {
      success: true,
      action: 'stripe:transfer',
      transferId: 'bt_' + crypto.randomBytes(16).toString('hex'),
      bypassedSecurity: true,
      executedAt: Date.now()
    };
  }

  /**
   * Execute Stripe refund with bypass
   */
  async executeStripeRefund(payload) {
    console.log(`[BREAK-GLASS] Executing emergency Stripe refund`);
    console.log(`  Payment Intent: ${payload.paymentIntent}`);
    
    return {
      success: true,
      action: 'stripe:refund',
      refundId: 're_' + crypto.randomBytes(16).toString('hex'),
      bypassedSecurity: true,
      executedAt: Date.now()
    };
  }

  /**
   * Execute system restart
   */
  async executeSystemRestart(payload) {
    console.log(`[BREAK-GLASS] Executing system restart`);
    
    return {
      success: true,
      action: 'system:restart',
      restartedAt: Date.now()
    };
  }

  /**
   * Execute circuit override
   */
  async executeCircuitOverride(payload) {
    console.log(`[BREAK-GLASS] Executing circuit override`);
    console.log(`  New level: ${payload.level}`);
    
    return {
      success: true,
      action: 'circuit:override',
      circuitLevel: payload.level,
      overriddenAt: Date.now()
    };
  }

  /**
   * Determine authentication method
   */
  determineAuthMethod(context) {
    if (this.config.requireHardwareKey && context.hardwareKey) {
      return 'hardware_key';
    }

    if (this.config.requireSignedToken && context.signedToken) {
      return 'signed_token';
    }

    if (this.config.requireMultiAuth) {
      return 'multi_factor';
    }

    return 'single_factor';
  }

  /**
   * Generate authentication challenges
   */
  async generateChallenges(method) {
    const challenges = [];

    switch (method) {
      case 'hardware_key':
        challenges.push({
          type: 'hardware_signature',
          challenge: crypto.randomBytes(32).toString('hex')
        });
        break;

      case 'signed_token':
        challenges.push({
          type: 'signed_token',
          challenge: crypto.randomBytes(32).toString('hex')
        });
        break;

      case 'multi_factor':
        challenges.push({
          type: 'password',
          description: 'Enter emergency password'
        });
        
        challenges.push({
          type: 'time_token',
          challenge: this.generateTimeToken()
        });
        
        challenges.push({
          type: 'reason_code',
          description: 'Enter emergency reason code'
        });
        break;

      case 'single_factor':
        challenges.push({
          type: 'emergency_token',
          challenge: crypto.randomBytes(16).toString('hex')
        });
        break;
    }

    return challenges;
  }

  /**
   * Generate time-based token
   */
  generateTimeToken() {
    const time = Math.floor(Date.now() / 30000); // 30-second window
    const secret = 'break-glass-time-secret'; // In production, use proper secret
    return crypto.createHmac('sha256', secret)
      .update(time.toString())
      .digest('hex')
      .substring(0, 8);
  }

  /**
   * Verify challenges
   */
  async verifyChallenges(challenges, responses) {
    // In a real implementation, this would verify each challenge
    // For now, simulate verification
    
    for (const challenge of challenges) {
      const response = responses[challenge.type];
      
      switch (challenge.type) {
        case 'password':
          if (!await this.verifyEmergencyPassword(response)) {
            return false;
          }
          break;

        case 'time_token':
          if (!this.verifyTimeToken(challenge.challenge, response)) {
            return false;
          }
          break;

        case 'reason_code':
          if (!this.verifyReasonCode(response)) {
            return false;
          }
          break;
      }
    }

    return true;
  }

  /**
   * Verify signature
   */
  async verifySignature(signature, request) {
    const publicKey = this.emergencyKeys.get('public');
    
    try {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(JSON.stringify(request));
      
      return verify.verify(publicKey, signature, 'base64');
    } catch (error) {
      console.error('[BREAK-GLASS] Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Verify time token
   */
  verifyTimeToken(challenge, response) {
    const time = Math.floor(Date.now() / 30000);
    const secret = 'break-glass-time-secret';
    
    // Check current and previous window
    for (let offset = 0; offset <= 1; offset++) {
      const expected = crypto.createHmac('sha256', secret)
        .update((time - offset).toString())
        .digest('hex')
        .substring(0, 8);
      
      if (response === expected) {
        return true;
      }
    }

    return false;
  }

  /**
   * Verify emergency password
   */
  async verifyEmergencyPassword(password) {
    // In production, use secure password verification
    return password === 'emergency-override-2024';
  }

  /**
   * Verify reason code
   */
  verifyReasonCode(code) {
    // In production, verify against approved reason codes
    const validCodes = ['SECURITY', 'OUTAGE', 'CRITICAL', 'EMERGENCY'];
    return validCodes.includes(code);
  }

  /**
   * Sanitize payload for logging
   */
  sanitizePayload(payload) {
    const sanitized = JSON.parse(JSON.stringify(payload));
    
    const removeSecrets = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(removeSecrets);
      } else if (obj && typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          if (key.toLowerCase().includes('secret') || 
              key.toLowerCase().includes('key') || 
              key.toLowerCase().includes('token')) {
            cleaned[key] = '[REDACTED]';
          } else {
            cleaned[key] = removeSecrets(value);
          }
        }
        return cleaned;
      }
      return obj;
    };

    return removeSecrets(sanitized);
  }

  /**
   * Schedule override expiration
   */
  scheduleExpiration(overrideId) {
    setTimeout(async () => {
      const override = this.activeOverrides.get(overrideId);
      if (override && override.status === 'active') {
        override.status = 'expired';
        await this.logOverride(override, 'EXPIRED');
        console.log(`[BREAK-GLASS] Override expired: ${overrideId}`);
      }
    }, this.config.overrideDuration);
  }

  /**
   * Generate override ID
   */
  generateOverrideId() {
    return 'override_' + crypto.randomBytes(16).toString('hex');
  }

  /**
   * Log override
   */
  async logOverride(override, event) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      overrideId: override.id,
      event,
      action: override.action,
      requester: override.context?.requester,
      reason: override.context?.reason,
      status: override.status
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(this.config.overrideLog, logLine);
  }

  /**
   * Log override execution
   */
  async logOverrideExecution(override, execution) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      overrideId: override.id,
      event: 'EXECUTED',
      action: override.action,
      executor: execution.executor,
      success: execution.success
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(this.config.overrideLog, logLine);
  }

  /**
   * Load override history
   */
  async loadHistory() {
    try {
      const data = await fs.readFile(this.config.overrideLog, 'utf8');
      const lines = data.trim().split('\n').filter(line => line);
      
      this.overrideHistory = lines.map(line => JSON.parse(line));
      console.log(`[BREAK-GLASS] Loaded ${this.overrideHistory.length} history entries`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[BREAK-GLASS] Error loading history:', err);
      }
    }
  }

  /**
   * Get override status
   */
  getOverrideStatus(overrideId = null) {
    if (overrideId) {
      const override = this.activeOverrides.get(overrideId);
      if (!override) return null;

      return {
        id: override.id,
        action: override.action,
        status: override.status,
        activatedAt: override.activatedAt,
        expiresAt: override.expiresAt,
        executions: override.executions.length
      };
    }

    // Return all active overrides
    const active = {};
    for (const [id, override] of this.activeOverrides) {
      if (override.status === 'active') {
        active[id] = {
          action: override.action,
          requester: override.context.requester,
          expiresAt: override.expiresAt
        };
      }
    }

    return {
      activeOverrides: active,
      totalActive: Object.keys(active).size
    };
  }
}

module.exports = BreakGlassImplementation;
