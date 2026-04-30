/**
 * Break-Glass Emergency Override System
 * Because systems fail. Always. Eventually.
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class BreakGlassSystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      // Override duration
      overrideDuration: options.overrideDuration || 5 * 60 * 1000, // 5 minutes
      
      // Authentication methods
      requireHardwareKey: options.requireHardwareKey || false,
      requireMultiAuth: options.requireMultiAuth || true,
      
      // Limits during override
      maxActionsPerOverride: options.maxActionsPerOverride || 10,
      allowedActions: options.allowedActions || ['*'], // All actions by default
      
      // Audit requirements
      requireReason: options.requireReason !== false,
      requireApprovalCode: options.requireApprovalCode || false,
      
      // Storage
      overrideLog: options.overrideLog || path.join(__dirname, '../../data/break-glass.log'),
      
      ...options
    };
    
    // State
    this.activeOverrides = new Map();
    this.overrideHistory = [];
    this.approvalCodes = new Map();
    
    // Initialize
    this.initialize();
  }

  /**
   * Initialize break-glass system
   */
  async initialize() {
    // Generate approval codes if required
    if (this.options.requireApprovalCode) {
      await this.generateApprovalCodes();
    }
    
    // Load override history
    await this.loadHistory();
    
    console.log('[BREAK-GLASS] Emergency override system initialized');
  }

  /**
   * Request emergency override
   */
  async requestOverride(context = {}) {
    const overrideId = this.generateOverrideId();
    
    // Validate context
    this.validateContext(context);
    
    // Create override request
    const request = {
      id: overrideId,
      status: 'pending',
      requestedAt: Date.now(),
      context: {
        requester: context.requester,
        reason: context.reason,
        urgency: context.urgency || 'medium',
        affectedSystems: context.affectedSystems || [],
        ...context
      },
      authentication: {
        method: null,
        verified: false,
        challenges: []
      }
    };

    // Determine authentication method
    request.authentication.method = this.determineAuthMethod(context);
    
    // Generate challenges
    request.authentication.challenges = await this.generateChallenges(
      request.authentication.method
    );

    // Store request
    this.activeOverrides.set(overrideId, request);

    // Emit event
    this.emit('overrideRequested', request);

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
  async completeAuthentication(overrideId, responses) {
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
      
      this.emit('authenticationFailed', request);
      throw new Error('Authentication failed');
    }

    // Activate override
    return await this.activateOverride(overrideId, verified);
  }

  /**
   * Activate emergency override
   */
  async activateOverride(overrideId, authData) {
    const request = this.activeOverrides.get(overrideId);
    if (!request) {
      throw new Error('Override request not found');
    }

    // Create active override
    const override = {
      id: overrideId,
      activatedAt: Date.now(),
      expiresAt: Date.now() + this.options.overrideDuration,
      status: 'active',
      actions: [],
      authentication: authData,
      context: request.context,
      limits: {
        maxActions: this.options.maxActionsPerOverride,
        allowedActions: this.options.allowedActions,
        actionsUsed: 0
      }
    };

    // Replace request with active override
    this.activeOverrides.set(overrideId, override);

    // Log activation
    await this.logOverride(override, 'ACTIVATED');

    // Emit event
    this.emit('overrideActivated', override);

    console.log(`[BREAK-GLASS] Override activated: ${overrideId}`);
    console.log(`  Requester: ${override.context.requester}`);
    console.log(`  Reason: ${override.context.reason}`);
    console.log(`  Expires: ${new Date(override.expiresAt).toISOString()}`);

    // Schedule expiration
    this.scheduleExpiration(overrideId);

    return {
      overrideId,
      activatedAt: override.activatedAt,
      expiresAt: override.expiresAt,
      permissions: {
        maxActions: override.limits.maxActions,
        allowedActions: override.limits.allowedActions
      }
    };
  }

  /**
   * Execute action under override
   */
  async executeAction(overrideId, action, payload) {
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

    // Check limits
    if (override.limits.actionsUsed >= override.limits.maxActions) {
      throw new Error('Action limit exceeded');
    }

    // Check if action is allowed
    if (!this.isActionAllowed(action, override.limits.allowedActions)) {
      throw new Error(`Action not allowed: ${action}`);
    }

    // Execute action with bypassed security
    const result = await this.executeBypassedAction(action, payload);

    // Record action
    const actionRecord = {
      action,
      payload: this.sanitizePayload(payload),
      executedAt: Date.now(),
      success: result.success
    };

    override.actions.push(actionRecord);
    override.limits.actionsUsed++;

    // Log action
    await this.logOverrideAction(override, actionRecord);

    // Check if limit reached
    if (override.limits.actionsUsed >= override.limits.maxActions) {
      override.status = 'completed';
      await this.logOverride(override, 'COMPLETED');
      this.emit('overrideCompleted', override);
    }

    return {
      ...result,
      overrideId,
      actionsRemaining: override.limits.maxActions - override.limits.actionsUsed
    };
  }

  /**
   * Revoke override
   */
  async revokeOverride(overrideId, reason = 'manual revocation') {
    const override = this.activeOverrides.get(overrideId);
    if (!override) {
      throw new Error('Override not found');
    }

    override.status = 'revoked';
    override.revokedAt = Date.now();
    override.revocationReason = reason;

    await this.logOverride(override, 'REVOKED');
    this.emit('overrideRevoked', override);

    console.log(`[BREAK-GLASS] Override revoked: ${overrideId} - ${reason}`);
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
        status: override.status,
        activatedAt: override.activatedAt,
        expiresAt: override.expiresAt,
        actionsUsed: override.limits.actionsUsed,
        maxActions: override.limits.maxActions,
        requester: override.context.requester,
        reason: override.context.reason
      };
    }

    // Return all active overrides
    const active = {};
    for (const [id, override] of this.activeOverrides) {
      if (override.status === 'active') {
        active[id] = {
          requester: override.context.requester,
          actionsUsed: override.limits.actionsUsed,
          expiresAt: override.expiresAt
        };
      }
    }

    return {
      activeOverrides: active,
      totalActive: Object.keys(active).length
    };
  }

  /**
   * Generate approval codes
   */
  async generateApprovalCodes() {
    const codes = {};
    const approvers = ['admin', 'security', 'ops']; // Configurable approvers

    for (const approver of approvers) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes[approver] = code;
      this.approvalCodes.set(approver, code);
    }

    // Store securely (in real implementation, use secure storage)
    await fs.writeFile(
      path.join(__dirname, '../../data/approval-codes.json'),
      JSON.stringify(codes, null, 2),
      { mode: 0o600 }
    );

    console.log('[BREAK-GLASS] Generated approval codes for approvers');
  }

  /**
   * Get system health for emergency decisions
   */
  async getSystemHealth() {
    // In real implementation, gather from all systems
    return {
      circuits: {
        total: 10,
        open: 2,
        degraded: 3
      },
      services: {
        authentication: 'degraded',
        database: 'operational',
        network: 'limited'
      },
      lastIncident: {
        time: new Date().toISOString(),
        type: 'circuit_breaker',
        severity: 'medium'
      }
    };
  }

  /**
   * Private helper methods
   */
  validateContext(context) {
    if (!context.requester) {
      throw new Error('Requester required');
    }

    if (this.options.requireReason && !context.reason) {
      throw new Error('Reason required');
    }

    if (!context.urgency || !['low', 'medium', 'high', 'critical'].includes(context.urgency)) {
      throw new Error('Valid urgency required');
    }
  }

  determineAuthMethod(context) {
    if (this.options.requireHardwareKey && context.hardwareKey) {
      return 'hardware_key';
    }

    if (this.options.requireMultiAuth) {
      return 'multi_factor';
    }

    return 'single_factor';
  }

  async generateChallenges(method) {
    const challenges = [];

    switch (method) {
      case 'hardware_key':
        challenges.push({
          type: 'hardware_signature',
          challenge: crypto.randomBytes(32).toString('hex')
        });
        break;

      case 'multi_factor':
        challenges.push({
          type: 'password',
          description: 'Enter emergency password'
        });
        
        challenges.push({
          type: 'approval_code',
          description: 'Enter 2-digit approval code from authorized approver'
        });

        challenges.push({
          type: 'time_token',
          challenge: this.generateTimeToken()
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

  async verifyChallenges(challenges, responses) {
    // In real implementation, verify each challenge
    for (const challenge of challenges) {
      const response = responses[challenge.type];
      
      switch (challenge.type) {
        case 'password':
          if (!await this.verifyEmergencyPassword(response)) {
            return false;
          }
          break;

        case 'approval_code':
          if (!this.verifyApprovalCode(response)) {
            return false;
          }
          break;

        case 'time_token':
          if (!this.verifyTimeToken(challenge.challenge, response)) {
            return false;
          }
          break;

        // Add other verification methods
      }
    }

    return true;
  }

  generateTimeToken() {
    const time = Math.floor(Date.now() / 30000); // 30-second window
    const secret = 'break-glass-secret'; // In real implementation, use proper secret
    return crypto.createHmac('sha256', secret)
      .update(time.toString())
      .digest('hex')
      .substring(0, 8);
  }

  verifyTimeToken(challenge, response) {
    const time = Math.floor(Date.now() / 30000);
    const secret = 'break-glass-secret';
    
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

  verifyApprovalCode(code) {
    // Check against any approver code
    for (const [approver, storedCode] of this.approvalCodes) {
      if (code === storedCode) {
        console.log(`[BREAK-GLASS] Approval code verified by ${approver}`);
        return true;
      }
    }
    return false;
  }

  async verifyEmergencyPassword(password) {
    // In real implementation, use secure password verification
    return password === 'emergency-override-2024'; // Example
  }

  isActionAllowed(action, allowedActions) {
    if (allowedActions.includes('*')) {
      return true;
    }
    return allowedActions.includes(action);
  }

  sanitizePayload(payload) {
    // Remove sensitive data from logging
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

  async executeBypassedAction(action, payload) {
    // Execute action with all security bypassed
    // In real implementation, this would call the actual action handlers
    console.log(`[BREAK-GLASS] Executing bypassed action: ${action}`);
    
    // Simulate execution
    return {
      success: true,
      action,
      executedAt: Date.now(),
      bypassedSecurity: true
    };
  }

  scheduleExpiration(overrideId) {
    setTimeout(async () => {
      const override = this.activeOverrides.get(overrideId);
      if (override && override.status === 'active') {
        override.status = 'expired';
        await this.logOverride(override, 'EXPIRED');
        this.emit('overrideExpired', override);
        console.log(`[BREAK-GLASS] Override expired: ${overrideId}`);
      }
    }, this.options.overrideDuration);
  }

  generateOverrideId() {
    return 'override_' + crypto.randomBytes(16).toString('hex');
  }

  async logOverride(override, event) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      overrideId: override.id,
      event,
      requester: override.context.requester,
      reason: override.context.reason,
      actionsUsed: override.limits?.actionsUsed || 0
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(this.options.overrideLog, logLine);
  }

  async logOverrideAction(override, action) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      overrideId: override.id,
      action: 'EXECUTED',
      actionType: action.action,
      success: action.success
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(this.options.overrideLog, logLine);
  }

  async loadHistory() {
    try {
      const data = await fs.readFile(this.options.overrideLog, 'utf8');
      const lines = data.trim().split('\n').filter(line => line);
      
      this.overrideHistory = lines.map(line => JSON.parse(line));
      console.log(`[BREAK-GLASS] Loaded ${this.overrideHistory.length} history entries`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[BREAK-GLASS] Error loading history:', err);
      }
    }
  }
}

module.exports = BreakGlassSystem;
