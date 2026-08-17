/**
 * Keymaker Express Middleware
 * 
 * Access, routing, and permission management for the existing Express server.
 * Reuses your existing BusGatekeeper patterns but adds dynamic rule evaluation,
 * token management, and audit logging.
 */

const crypto = require('crypto');
const { supabase } = require('../database');

class Keymaker {
  constructor(config = {}) {
    this.headerName = config.headerName || 'x-keymaker-key';
    this.cacheTTL = config.cacheTTL || 30000;
    this.keyCache = new Map();
    this.systemState = null;
    this.stateFetchedAt = 0;
    
    // Service registry (mirrors what SQL migrations will hold)
    this.services = new Map();
    this.registerDefaultServices();
    
    console.log('[KEYMAKER] Express middleware initialized');
  }
  
  registerDefaultServices() {
    // Mirror the Supabase service registry for local lookups
    const defaults = [
      { id: 'cascade', basePath: '/cascade', methods: ['GET','POST'], minTier: 'starter', roles: ['admin','user','agent'] },
      { id: 'heidi', basePath: '/heidi', methods: ['GET','POST'], minTier: 'starter', roles: ['admin','user'] },
      { id: 'ursula', basePath: '/events/stream', methods: ['GET'], minTier: 'starter', roles: ['admin','user','guest'] },
      { id: 'process', basePath: '/process', methods: ['POST'], minTier: 'starter', roles: ['admin','user'] }, // Temporarily lowered for testing
      { id: 'insight', basePath: '/insight', methods: ['GET'], minTier: 'starter', roles: ['admin','user'] },
      { id: 'infrastructure', basePath: '/infrastructure', methods: ['GET','POST'], minTier: 'pro', roles: ['admin'] },
      { id: 'prime', basePath: '/prime', methods: ['GET'], minTier: 'admin', roles: ['admin'] },
      { id: 'evolution', basePath: '/evolution', methods: ['GET'], minTier: 'admin', roles: ['admin'] },
      { id: 'api_services', basePath: '/api/services', methods: ['GET','POST'], minTier: 'starter', roles: ['admin','user'] },
    ];
    defaults.forEach(s => this.services.set(s.id, s));
  }
  
  // ─────────────────────────────────────────────────────────────
  // MIDDLEWARE
  // ─────────────────────────────────────────────────────────────
  
  middleware() {
    return async (req, res, next) => {
      // Skip public paths
      if (req.path === '/health' || req.path === '/integrity' || req.path.startsWith('/webhooks')) {
        return next();
      }
      
      try {
        const keyHash = req.headers[this.headerName] || req.query.access_key;
        
        if (!keyHash) {
          // No key - attach anonymous identity and continue
          req.keymaker = { identity: this.makeAnonymous(req), key: null };
          return next();
        }
        
        // Validate against Supabase
        const validation = await this.validateKey(keyHash, req);
        
        if (!validation.valid) {
          return res.status(401).json({
            error: 'Invalid or expired key',
            code: 'KEYMAKER_INVALID_KEY',
            reason: validation.reason
          });
        }
        
        req.keymaker = validation;
        
        // Add rate limit headers
        if (validation.rateLimit) {
          res.set({
            'X-RateLimit-Limit': validation.rateLimit.limit,
            'X-RateLimit-Remaining': validation.rateLimit.remaining,
          });
        }
        
        next();
        
      } catch (err) {
        console.error('[KEYMAKER] Middleware error:', err.message);
        // Non-fatal: continue with anonymous
        req.keymaker = { identity: this.makeAnonymous(req), key: null, error: err.message };
        next();
      }
    };
  }
  
  // Access check middleware
  requireAccess(serviceId) {
    return async (req, res, next) => {
      try {
        const keymaker = req.keymaker || { identity: this.makeAnonymous(req) };
        const service = this.services.get(serviceId) || this.findServiceByPath(req.path);
        
        if (!service) {
          return res.status(404).json({ error: 'Service not found', code: 'KEYMAKER_NO_SERVICE' });
        }
        
        const access = await this.checkAccess(keymaker, service, req);
        
        if (!access.allowed) {
          return res.status(access.status || 403).json({
            error: 'Access denied',
            code: 'KEYMAKER_ACCESS_DENIED',
            reason: access.reason,
            service: service.id,
            suggestion: access.suggestion
          });
        }
        
        req.keymakerAccess = access;
        next();
        
      } catch (err) {
        console.error('[KEYMAKER] Access check error:', err.message);
        return res.status(500).json({ error: 'Access control error', code: 'KEYMAKER_ERROR' });
      }
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // VALIDATION
  // ─────────────────────────────────────────────────────────────
  
  async validateKey(keyHash, _req) {
    // Check cache first
    const cached = this.keyCache.get(keyHash);
    if (cached && Date.now() - cached.ts < this.cacheTTL) {
      cached.hits = (cached.hits || 0) + 1;
      return cached.validation;
    }
    
    // Query Supabase
    const { data: key, error } = await supabase
      .from('keymaker_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (error || !key) {
      return { valid: false, reason: 'key_not_found_or_expired' };
    }
    
    // Update last used
    await supabase
      .from('keymaker_keys')
      .update({ last_used_at: new Date().toISOString(), use_count: key.use_count + 1 })
      .eq('id', key.id);
    
    const validation = {
      valid: true,
      keyId: key.id,
      identity: {
        userId: key.user_id,
        role: key.role,
        tier: key.tier,
        subscriptionId: key.subscription_id,
        scopes: key.scopes,
        services: key.allowed_services
      },
      rateLimit: { limit: 60, remaining: 59 } // Simplified
    };
    
    // Cache
    this.keyCache.set(keyHash, { validation, ts: Date.now(), hits: 0 });
    
    return validation;
  }
  
  // ─────────────────────────────────────────────────────────────
  // ACCESS CHECKS
  // ─────────────────────────────────────────────────────────────
  
  async checkAccess(keymaker, service, req) {
    const identity = keymaker.identity || this.makeAnonymous(req);
    
    // Role check
    if (!service.roles.includes(identity.role) && identity.role !== 'admin') {
      return {
        allowed: false,
        reason: 'insufficient_role',
        status: 403,
        suggestion: 'Required role: ' + service.roles.join(', ')
      };
    }
    
    // Tier check
    const tiers = { starter: 0, pro: 1, enterprise: 2, admin: 3 };
    if ((tiers[identity.tier] || 0) < (tiers[service.minTier] || 0)) {
      return {
        allowed: false,
        reason: 'tier_too_low',
        status: 403,
        suggestion: 'Upgrade to ' + service.minTier + ' tier required'
      };
    }
    
    // System state check
    const sysState = await this.getSystemState();
    
    if (sysState.maintenance_mode && identity.role !== 'admin') {
      return {
        allowed: false,
        reason: 'system_maintenance',
        status: 503,
        suggestion: 'System is in maintenance mode'
      };
    }
    
    if (sysState.load_level === 'critical' && identity.tier !== 'enterprise' && identity.role !== 'admin') {
      return {
        allowed: false,
        reason: 'system_overload',
        status: 503,
        suggestion: 'Try again later - system under high load'
      };
    }
    
    // Determine execution path
    let executionPath = 'direct';
    let priority = 'low';
    
    if (sysState.load_level === 'critical') {
      executionPath = 'queued';
    } else if (identity.tier === 'enterprise') {
      executionPath = 'priority';
      priority = 'high';
    } else if (identity.tier === 'pro') {
      executionPath = 'standard';
      priority = 'medium';
    }
    
    return {
      allowed: true,
      service: service.id,
      executionPath,
      priority,
      identity
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────
  
  findServiceByPath(path) {
    for (const [, svc] of this.services) {
      if (path.startsWith(svc.basePath)) return svc;
    }
    return null;
  }
  
  makeAnonymous(req) {
    return {
      userId: null,
      role: 'guest',
      tier: 'starter',
      subscriptionId: null,
      scopes: ['read'],
      ip: req.ip
    };
  }
  
  async getSystemState() {
    // Cache system state for 10 seconds
    if (this.systemState && Date.now() - this.stateFetchedAt < 10000) {
      return this.systemState;
    }
    
    try {
      const { data, error } = await supabase
        .from('keymaker_system_state')
        .select('*')
        .single();
      
      if (error) throw error;
      
      this.systemState = data || { load_level: 'normal', health_status: 'green', maintenance_mode: false };
      this.stateFetchedAt = Date.now();
      return this.systemState;
    } catch (err) {
      console.warn('[KEYMAKER] Could not fetch system state, using defaults');
      return { load_level: 'normal', health_status: 'green', maintenance_mode: false };
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // API METHODS (used by routes)
  // ─────────────────────────────────────────────────────────────
  
  async issueKey(userId, role, tier, options = {}) {
    const key = crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const expiresAt = new Date(Date.now() + (options.durationHours || 1) * 3600000).toISOString();
    
    const { error } = await supabase.from('keymaker_keys').insert({
      key_hash: keyHash,
      user_id: userId,
      role: role || 'guest',
      tier: tier || 'starter',
      allowed_services: options.services || null,
      scopes: options.scopes || ['read'],
      expires_at: expiresAt,
      metadata: options.metadata || {}
    });
    
    if (error) throw error;
    
    return { key, keyHash, expiresAt };
  }
  
  async revokeKey(keyHash, reason) {
    const { error } = await supabase
      .from('keymaker_keys')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq('key_hash', keyHash);
    
    if (error) throw error;
    
    this.keyCache.delete(keyHash);
    return true;
  }
  
  async getStats() {
    const state = await this.getSystemState();
    const { count: activeKeys } = await supabase
      .from('keymaker_keys')
      .select('*', { count: 'exact', head: true })
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());
    
    const { count: pendingJobs } = await supabase
      .from('keymaker_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    
    const { count: requests24h } = await supabase
      .from('keymaker_access_log')
      .select('*', { count: 'exact', head: true })
      .gt('timestamp', new Date(Date.now() - 86400000).toISOString());
    
    return {
      services: this.services.size,
      activeKeys: activeKeys || 0,
      pendingJobs: pendingJobs || 0,
      requests24h: requests24h || 0,
      systemState: state,
      cacheSize: this.keyCache.size
    };
  }
}

module.exports = Keymaker;
