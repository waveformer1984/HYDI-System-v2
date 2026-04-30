/**
 * Keymaker Core - Access, Routing, and Permission Management
 * 
 * The Keymaker opens doors to specific places at specific times.
 * Real version: issues "keys" (tokens), knows which "doors" (services/endpoints) exist,
 * decides who gets access and when, routes tasks dynamically based on system state.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

class KeymakerCore extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.name = config.name || 'Keymaker';
    this.version = config.version || '1.0.0';
    
    // Key Registry: services, endpoints, permissions, conditions
    this.registry = new Map();
    this.endpointMap = new Map();
    this.rolePermissions = new Map();
    
    // Token cache with TTL
    this.tokenCache = new Map();
    this.defaultTokenTTL = config.tokenTTL || 3600000; // 1 hour default
    
    // System state for dynamic rules
    this.systemState = {
      loadLevel: 'normal', // normal, elevated, critical
      healthStatus: 'green', // green, yellow, red
      maintenanceMode: false,
      lastUpdated: Date.now()
    };
    
    // Rule engine cache
    this.ruleCache = new Map();
    this.ruleCacheTTL = 30000; // 30 seconds
    
    // Audit log for access events
    this.auditLog = [];
    this.maxAuditLogSize = 10000;
    
    // Dynamic conditions registry
    this.conditions = new Map();
    this.registerDefaultConditions();
    
    // Start background tasks
    this.startTokenCleanup();
    this.startStateUpdate();
    
    console.log(`[KEYMAKER] Initialized ${this.name} v${this.version}`);
  }
  
  // ─────────────────────────────────────────────────────────────
  // KEY REGISTRY
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Register a service in the Key Registry
   */
  registerService(serviceId, config) {
    const service = {
      id: serviceId,
      name: config.name || serviceId,
      description: config.description || '',
      allowedRoles: config.allowedRoles || ['admin'],
      requiredPermissions: config.requiredPermissions || [],
      conditions: config.conditions || [],
      endpoints: config.endpoints || [],
      tier: config.tier || 'starter', // starter, pro, enterprise
      rateLimit: config.rateLimit || { requestsPerMinute: 60 },
      enabled: config.enabled !== false,
      metadata: config.metadata || {},
      registeredAt: new Date().toISOString()
    };
    
    this.registry.set(serviceId, service);
    
    // Map endpoints to service
    service.endpoints.forEach(endpoint => {
      const key = this.normalizeEndpoint(endpoint.path);
      this.endpointMap.set(key, {
        serviceId,
        methods: endpoint.methods || ['GET'],
        conditions: endpoint.conditions || service.conditions
      });
    });
    
    this.emit('service_registered', { serviceId, service });
    return service;
  }
  
  /**
   * Register role permissions
   */
  registerRole(role, permissions) {
    this.rolePermissions.set(role, {
      role,
      permissions: Array.isArray(permissions) ? permissions : [permissions],
      updatedAt: new Date().toISOString()
    });
    this.emit('role_registered', { role, permissions });
  }
  
  /**
   * Get service from registry
   */
  getService(serviceId) {
    return this.registry.get(serviceId);
  }
  
  /**
   * Get all services
   */
  getAllServices() {
    return Array.from(this.registry.values());
  }
  
  /**
   * Get services by tier
   */
  getServicesByTier(tier) {
    const tierHierarchy = { starter: 0, pro: 1, enterprise: 2 };
    const targetLevel = tierHierarchy[tier] ?? 0;
    
    return this.getAllServices().filter(service => {
      const serviceLevel = tierHierarchy[service.tier] ?? 0;
      return serviceLevel <= targetLevel && service.enabled;
    });
  }
  
  /**
   * Find service by endpoint path
   */
  findServiceByEndpoint(path, method = 'GET') {
    const normalized = this.normalizeEndpoint(path);
    const endpoint = this.endpointMap.get(normalized);
    
    if (!endpoint) {
      // Try pattern matching for dynamic routes
      for (const [pattern, data] of this.endpointMap) {
        if (this.matchPattern(normalized, pattern)) {
          if (data.methods.includes(method) || data.methods.includes('*')) {
            return this.registry.get(data.serviceId);
          }
        }
      }
      return null;
    }
    
    if (endpoint.methods.includes(method) || endpoint.methods.includes('*')) {
      return this.registry.get(endpoint.serviceId);
    }
    
    return null;
  }
  
  // ─────────────────────────────────────────────────────────────
  // TOKEN MANAGEMENT
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Issue a temporary access key (token)
   */
  issueToken(identity, options = {}) {
    const tokenId = uuidv4();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + (options.ttl || this.defaultTokenTTL);
    
    const token = {
      id: tokenId,
      type: 'access_key',
      identity: {
        userId: identity.userId || identity.customerId || 'anonymous',
        role: identity.role || 'guest',
        tier: identity.tier || 'starter',
        subscriptionId: identity.subscriptionId || null,
        apiKeyHash: identity.apiKeyHash || null
      },
      scope: options.scope || ['read'],
      services: options.services || [], // Specific services allowed
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresAtMs: expiresAt,
      issuer: this.name,
      signature: this.signToken(tokenId, identity, expiresAt),
      metadata: options.metadata || {}
    };
    
    // Cache token
    this.tokenCache.set(tokenId, {
      token,
      accessCount: 0,
      lastAccess: null,
      accessLog: []
    });
    
    this.emit('token_issued', { tokenId, identity: token.identity, scope: token.scope });
    this.logAudit('token_issued', { tokenId, identity: token.identity });
    
    return token;
  }
  
  /**
   * Validate and consume a token
   */
  validateToken(tokenId) {
    const cached = this.tokenCache.get(tokenId);
    
    if (!cached) {
      return { valid: false, reason: 'token_not_found' };
    }
    
    const { token } = cached;
    const now = Date.now();
    
    // Check expiration
    if (now > token.expiresAtMs) {
      this.tokenCache.delete(tokenId);
      return { valid: false, reason: 'token_expired' };
    }
    
    // Update access tracking
    cached.accessCount++;
    cached.lastAccess = now;
    cached.accessLog.push({ timestamp: now, action: 'validated' });
    
    // Trim access log if too large
    if (cached.accessLog.length > 100) {
      cached.accessLog = cached.accessLog.slice(-50);
    }
    
    this.emit('token_validated', { tokenId, identity: token.identity });
    
    return {
      valid: true,
      token,
      identity: token.identity,
      scope: token.scope,
      services: token.services
    };
  }
  
  /**
   * Revoke a token
   */
  revokeToken(tokenId, reason = 'manual_revoke') {
    const cached = this.tokenCache.get(tokenId);
    if (cached) {
      this.emit('token_revoked', { tokenId, identity: cached.token.identity, reason });
      this.logAudit('token_revoked', { tokenId, reason });
      this.tokenCache.delete(tokenId);
      return true;
    }
    return false;
  }
  
  /**
   * Sign token for integrity
   */
  signToken(tokenId, identity, expiresAt) {
    const secret = process.env.KEYMAKER_SECRET || 'default-secret-change-me';
    const data = `${tokenId}:${identity.userId}:${expiresAt}`;
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }
  
  // ─────────────────────────────────────────────────────────────
  // ACCESS CONTROL
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Check if identity can access service
   */
  checkAccess(identity, serviceId, context = {}) {
    const service = this.registry.get(serviceId);
    
    if (!service) {
      return { allowed: false, reason: 'service_not_found' };
    }
    
    if (!service.enabled) {
      return { allowed: false, reason: 'service_disabled' };
    }
    
    // Check role permissions
    const hasRole = service.allowedRoles.includes(identity.role) || 
                    identity.role === 'admin' ||
                    identity.role === 'system';
    
    if (!hasRole) {
      return { 
        allowed: false, 
        reason: 'insufficient_role',
        required: service.allowedRoles,
        actual: identity.role
      };
    }
    
    // Check tier access
    const tierHierarchy = { starter: 0, pro: 1, enterprise: 2 };
    const userLevel = tierHierarchy[identity.tier] ?? 0;
    const requiredLevel = tierHierarchy[service.tier] ?? 0;
    
    if (userLevel < requiredLevel) {
      return {
        allowed: false,
        reason: 'tier_too_low',
        required: service.tier,
        actual: identity.tier
      };
    }
    
    // Evaluate dynamic conditions
    const conditionResult = this.evaluateConditions(service.conditions, {
      identity,
      service,
      systemState: this.systemState,
      ...context
    });
    
    if (!conditionResult.passed) {
      return {
        allowed: false,
        reason: 'condition_failed',
        condition: conditionResult.failedCondition
      };
    }
    
    // Issue temporary access key for this request
    const accessKey = this.generateAccessKey(identity, serviceId, context);
    
    this.emit('access_granted', { 
      identity, 
      serviceId, 
      accessKey: accessKey.id 
    });
    
    this.logAudit('access_granted', { identity, serviceId });
    
    return {
      allowed: true,
      service,
      accessKey,
      conditions: conditionResult.evaluated
    };
  }
  
  /**
   * Generate temporary access key for a specific request
   */
  generateAccessKey(identity, serviceId, context = {}) {
    const keyId = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 300000; // 5 minutes
    
    return {
      id: keyId,
      serviceId,
      identity: identity.userId || identity.customerId,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      context: {
        requestPath: context.path,
        requestMethod: context.method,
        ...context.metadata
      }
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // DYNAMIC RULE ENGINE
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Register a condition function
   */
  registerCondition(name, evaluator) {
    this.conditions.set(name, evaluator);
  }
  
  /**
   * Evaluate conditions against context
   */
  evaluateConditions(conditions, context) {
    const evaluated = [];
    
    for (const condition of conditions) {
      const result = this.evaluateCondition(condition, context);
      evaluated.push({ condition, result });
      
      if (!result) {
        return {
          passed: false,
          failedCondition: condition,
          evaluated
        };
      }
    }
    
    return { passed: true, evaluated };
  }
  
  /**
   * Evaluate single condition
   */
  evaluateCondition(condition, context) {
    if (typeof condition === 'string') {
      // Simple condition name
      const evaluator = this.conditions.get(condition);
      return evaluator ? evaluator(context) : true;
    }
    
    if (typeof condition === 'object') {
      const { type, params } = condition;
      const evaluator = this.conditions.get(type);
      return evaluator ? evaluator(context, params) : true;
    }
    
    return true;
  }
  
  /**
   * Register default conditions
   */
  registerDefaultConditions() {
    // Rate limit check
    this.registerCondition('rate_limit_ok', (ctx) => {
      // Integration with ModelRateLimiter would go here
      return true;
    });
    
    // System health check
    this.registerCondition('system_health_green', (ctx) => {
      return ctx.systemState.healthStatus === 'green' || 
             ctx.systemState.healthStatus === 'yellow';
    });
    
    // Load level check
    this.registerCondition('load_acceptable', (ctx, params = {}) => {
      const maxLoad = params.maxLoad || 'elevated';
      const levels = { normal: 0, elevated: 1, critical: 2 };
      return levels[ctx.systemState.loadLevel] <= levels[maxLoad];
    });
    
    // Maintenance mode check
    this.registerCondition('not_maintenance', (ctx) => {
      return !ctx.systemState.maintenanceMode;
    });
    
    // Time window check
    this.registerCondition('time_window', (ctx, params = {}) => {
      const now = new Date();
      const hour = now.getHours();
      const { start = 0, end = 24 } = params;
      return hour >= start && hour < end;
    });
    
    // Subscription active check
    this.registerCondition('subscription_active', (ctx) => {
      return ctx.identity?.subscriptionId != null;
    });
    
    // Role check
    this.registerCondition('has_role', (ctx, params = {}) => {
      const requiredRoles = params.roles || ['admin'];
      return requiredRoles.includes(ctx.identity?.role);
    });
  }
  
  /**
   * Update system state for dynamic rules
   */
  updateSystemState(updates) {
    this.systemState = {
      ...this.systemState,
      ...updates,
      lastUpdated: Date.now()
    };
    this.emit('system_state_updated', this.systemState);
  }
  
  // ─────────────────────────────────────────────────────────────
  // ROUTING DECISIONS
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Route request to appropriate service/handler
   */
  routeRequest(path, method, identity, context = {}) {
    const service = this.findServiceByEndpoint(path, method);
    
    if (!service) {
      return {
        routed: false,
        reason: 'no_service_found',
        path,
        method
      };
    }
    
    // Check access
    const access = this.checkAccess(identity, service.id, {
      path,
      method,
      ...context
    });
    
    if (!access.allowed) {
      return {
        routed: false,
        reason: access.reason,
        service: service.id,
        details: access
      };
    }
    
    // Determine execution path based on system state
    const executionPath = this.determineExecutionPath(service, identity, context);
    
    return {
      routed: true,
      service: service.id,
      path: executionPath,
      accessKey: access.accessKey,
      conditions: access.conditions
    };
  }
  
  /**
   * Determine optimal execution path based on system state
   */
  determineExecutionPath(service, identity, context) {
    // Default path
    let path = 'direct';
    
    // Check system load
    if (this.systemState.loadLevel === 'critical') {
      // Route to queue for async processing
      path = 'queued';
    } else if (this.systemState.loadLevel === 'elevated') {
      // Check if user has priority
      if (identity.tier === 'enterprise') {
        path = 'priority';
      } else {
        path = 'standard';
      }
    }
    
    // Check for specific service routing rules
    if (service.metadata?.routingRule) {
      path = this.applyRoutingRule(service.metadata.routingRule, identity, context) || path;
    }
    
    return {
      type: path,
      handler: service.id,
      queue: path === 'queued' ? 'background' : null,
      priority: identity.tier === 'enterprise' ? 'high' : 
                identity.tier === 'pro' ? 'medium' : 'low'
    };
  }
  
  /**
   * Apply custom routing rule
   */
  applyRoutingRule(rule, identity, context) {
    // Parse and apply routing rules
    // e.g., "if(tier=enterprise):priority;else:standard"
    const parts = rule.split(';');
    
    for (const part of parts) {
      const match = part.match(/if\(([^)]+)\):([^;]+)/);
      if (match) {
        const [_, condition, result] = match;
        const [key, value] = condition.split('=');
        if (identity[key] === value) {
          return result;
        }
      }
    }
    
    return null;
  }
  
  // ─────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Normalize endpoint path for matching
   */
  normalizeEndpoint(path) {
    return path.replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
  }
  
  /**
   * Match path against pattern with wildcards
   */
  matchPattern(path, pattern) {
    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '[^/]+')
      .replace(/\/:([^/]+)/g, '/([^/]+)');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }
  
  /**
   * Log audit event
   */
  logAudit(action, data) {
    const entry = {
      id: uuidv4(),
      action,
      data,
      timestamp: new Date().toISOString(),
      systemState: { ...this.systemState }
    };
    
    this.auditLog.push(entry);
    
    // Trim log if too large
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog = this.auditLog.slice(-this.maxAuditLogSize / 2);
    }
  }
  
  /**
   * Get audit log with filtering
   */
  getAuditLog(options = {}) {
    let logs = [...this.auditLog];
    
    if (options.action) {
      logs = logs.filter(e => e.action === options.action);
    }
    
    if (options.since) {
      const since = new Date(options.since).getTime();
      logs = logs.filter(e => new Date(e.timestamp).getTime() >= since);
    }
    
    if (options.limit) {
      logs = logs.slice(-options.limit);
    }
    
    return logs;
  }
  
  /**
   * Get system statistics
   */
  getStats() {
    return {
      services: this.registry.size,
      endpoints: this.endpointMap.size,
      activeTokens: this.tokenCache.size,
      roles: this.rolePermissions.size,
      conditions: this.conditions.size,
      auditLogSize: this.auditLog.length,
      systemState: this.systemState,
      uptime: process.uptime()
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // BACKGROUND TASKS
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Clean up expired tokens
   */
  startTokenCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [tokenId, cached] of this.tokenCache) {
        if (now > cached.token.expiresAtMs) {
          this.tokenCache.delete(tokenId);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`[KEYMAKER] Cleaned ${cleaned} expired tokens`);
      }
    }, 60000); // Clean every minute
  }
  
  /**
   * Update system state periodically
   */
  startStateUpdate() {
    setInterval(() => {
      // This would integrate with actual system metrics
      // For now, update timestamp
      this.systemState.lastUpdated = Date.now();
    }, 30000); // Update every 30 seconds
  }
}

module.exports = KeymakerCore;
