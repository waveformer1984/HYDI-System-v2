/**
 * Local Model Rate Limiter
 * Independent rate limiting for local model calls (separate from Stripe API limits)
 * Prevents hardware bottleneck when multiple Starter users hit document summarization simultaneously
 */

const EventEmitter = require('events');

class ModelRateLimiter extends EventEmitter {
  constructor() {
    super();
    
    // Tier-specific rate limits (requests per minute per model)
    this.tierLimits = {
      starter: {
        requestsPerMinute: 10,
        burstAllowance: 3,  // Allow 3 rapid requests before throttling
        cooldownMs: 6000      // 6 seconds between requests after burst
      },
      pro: {
        requestsPerMinute: 30,
        burstAllowance: 8,
        cooldownMs: 2000      // 2 seconds between requests after burst
      },
      enterprise: {
        requestsPerMinute: 120,
        burstAllowance: 20,
        cooldownMs: 500        // 0.5 seconds between requests after burst
      }
    };
    
    // Model-specific limits (some models are heavier)
    this.modelWeights = {
      'gpt-4-local': 2.0,        // 8B model - 2x weight
      'code-specialist': 1.5,    // CodeLlama - 1.5x weight
      'local-llama': 1.0,        // Standard weight
      'gpt-35-turbo': 1.0,
      'local-classifier': 0.3,   // Classifier is fast - 0.3x weight
      'local-ocr': 0.5,          // OCR is moderate - 0.5x weight
      'code-parser': 0.2,        // Parser is very fast - 0.2x weight
      'bug-finder': 1.0,
      'db-specialist': 0.8,
      'security-scanner': 1.2,
      'predictive-model': 0.5,
      'pricing-engine': 0.3,
      'rule-engine': 0.1         // Rule engine is instantaneous
    };
    
    // Request tracking per user per model
    this.requestLog = new Map(); // userId_modelId -> [{timestamp, weight}]
    
    // Queue for rate-limited requests
    this.requestQueue = [];
    
    // Process queue periodically
    this.startQueueProcessor();
  }
  
  /**
   * Check if a request is allowed
   */
  async checkLimit(userId, modelId, tier) {
    const now = Date.now();
    const key = `${userId}_${modelId}`;
    const limit = this.tierLimits[tier] || this.tierLimits.starter;
    const weight = this.modelWeights[modelId] || 1.0;
    
    // Get recent requests (last minute)
    let requests = this.requestLog.get(key) || [];
    requests = requests.filter(r => now - r.timestamp < 60000);
    
    // Calculate weighted request count
    const weightedCount = requests.reduce((sum, r) => sum + r.weight, 0);
    const weightedLimit = limit.requestsPerMinute * weight;
    
    // Check if within limit
    if (weightedCount < weightedLimit) {
      // Check burst limit
      const recentRequests = requests.filter(r => now - r.timestamp < 5000); // Last 5 seconds
      if (recentRequests.length >= limit.burstAllowance) {
        // Burst exceeded - check cooldown
        const lastRequest = requests[requests.length - 1];
        if (lastRequest && now - lastRequest.timestamp < limit.cooldownMs) {
          // Still in cooldown
          const waitTime = limit.cooldownMs - (now - lastRequest.timestamp);
          return {
            allowed: false,
            reason: 'cooldown',
            waitTime,
            retryAfter: Math.ceil(waitTime / 1000)
          };
        }
      }
      
      // Request allowed
      requests.push({ timestamp: now, weight });
      this.requestLog.set(key, requests);
      
      return {
        allowed: true,
        remaining: Math.floor(weightedLimit - weightedCount - weight),
        resetTime: now + 60000
      };
    }
    
    // Limit exceeded - queue or reject
    const oldestRequest = requests[0];
    const waitTime = 60000 - (now - oldestRequest.timestamp);
    
    return {
      allowed: false,
      reason: 'limit_exceeded',
      waitTime,
      retryAfter: Math.ceil(waitTime / 1000),
      limit: weightedLimit,
      current: weightedCount
    };
  }
  
  /**
   * Middleware for Express routes
   */
  middleware() {
    return async (req, res, next) => {
      // Extract user info from request
      const userId = req.user?.id || req.user?.customerId || 'anonymous';
      const tier = req.user?.tier || 'starter';
      const modelId = req.body?.modelId || req.params?.modelId || 'default';
      
      const result = await this.checkLimit(userId, modelId, tier);
      
      if (result.allowed) {
        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': Math.floor(this.tierLimits[tier].requestsPerMinute * (this.modelWeights[modelId] || 1)),
          'X-RateLimit-Remaining': result.remaining,
          'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
        });
        
        next();
      } else {
        // Rate limit exceeded
        this.emit('rate_limit_exceeded', {
          userId,
          modelId,
          tier,
          reason: result.reason,
          retryAfter: result.retryAfter
        });
        
        res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Local model rate limit exceeded. ${result.reason === 'cooldown' ? 'Burst cooldown active.' : 'Minute limit reached.'}`,
          retryAfter: result.retryAfter,
          tier,
          modelId,
          limit: Math.floor(this.tierLimits[tier].requestsPerMinute * (this.modelWeights[modelId] || 1))
        });
      }
    };
  }
  
  /**
   * Check if Enterprise can cut the line
   */
  async checkEnterprisePriority(userId, modelId, tier) {
    if (tier === 'enterprise') {
      // Enterprise always gets priority
      const now = Date.now();
      const key = `${userId}_${modelId}`;
      let requests = this.requestLog.get(key) || [];
      requests = requests.filter(r => now - r.timestamp < 60000);
      requests.push({ timestamp: now, weight: this.modelWeights[modelId] || 1.0 });
      this.requestLog.set(key, requests);
      
      return { allowed: true, priority: true };
    }
    
    return this.checkLimit(userId, modelId, tier);
  }
  
  /**
   * Start queue processor for rate-limited requests
   */
  startQueueProcessor() {
    setInterval(() => {
      this.processQueue();
    }, 1000);
  }
  
  /**
   * Process queued requests
   */
  async processQueue() {
    const now = Date.now();
    const processed = [];
    
    for (let i = 0; i < this.requestQueue.length; i++) {
      const queued = this.requestQueue[i];
      
      // Check if enough time has passed
      if (now - queued.timestamp >= (queued.waitTime || 0)) {
        const result = await this.checkLimit(queued.userId, queued.modelId, queued.tier);
        
        if (result.allowed) {
          // Execute the queued request
          queued.resolve({ allowed: true, queued: true, waitTime: now - queued.timestamp });
          processed.push(i);
        }
      }
    }
    
    // Remove processed items
    for (let i = processed.length - 1; i >= 0; i--) {
      this.requestQueue.splice(processed[i], 1);
    }
  }
  
  /**
   * Queue a request for later processing
   */
  async queueRequest(userId, modelId, tier, maxWaitMs = 30000) {
    return new Promise((resolve, reject) => {
      const queued = {
        userId,
        modelId,
        tier,
        timestamp: Date.now(),
        maxWaitMs,
        resolve,
        reject
      };
      
      this.requestQueue.push(queued);
      
      // Auto-reject after max wait
      setTimeout(() => {
        const index = this.requestQueue.indexOf(queued);
        if (index >= 0) {
          this.requestQueue.splice(index, 1);
          reject(new Error('Request timed out in rate limit queue'));
        }
      }, maxWaitMs);
    });
  }
  
  /**
   * Get current usage stats for a user
   */
  getUsageStats(userId, modelId) {
    const key = `${userId}_${modelId}`;
    const now = Date.now();
    const requests = (this.requestLog.get(key) || []).filter(r => now - r.timestamp < 60000);
    
    const tier = 'unknown'; // Would need to look up user's tier
    const weight = this.modelWeights[modelId] || 1.0;
    
    return {
      userId,
      modelId,
      requestsInLastMinute: requests.length,
      weightedUsage: requests.reduce((sum, r) => sum + r.weight, 0),
      averageWeight: weight,
      tier
    };
  }
  
  /**
   * Get global stats
   */
  getGlobalStats() {
    const stats = {
      totalTrackedUsers: new Set(),
      activeModels: new Set(),
      queuedRequests: this.requestQueue.length,
      tierBreakdown: { starter: 0, pro: 0, enterprise: 0 }
    };
    
    for (const [key] of this.requestLog) {
      const [userId, modelId] = key.split('_');
      stats.totalTrackedUsers.add(userId);
      stats.activeModels.add(modelId);
    }
    
    return {
      ...stats,
      totalTrackedUsers: stats.totalTrackedUsers.size,
      activeModels: Array.from(stats.activeModels),
      queuedRequests: stats.queuedRequests
    };
  }
}

module.exports = ModelRateLimiter;
