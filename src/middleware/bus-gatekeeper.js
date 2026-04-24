/**
 * Bus Gatekeeper Middleware
 * Validates subscription status before any message reaches the local models.
 * Prevent the "Permission Leak" — users cannot bypass Heidi and hit
 * local-model-adapter.js directly without a valid Stripe subscription.
 */

const UniversalAgentBus = require('../../modules/universal-agent-bus');

class BusGatekeeper {
  constructor(bus) {
    this.bus = bus || new UniversalAgentBus();
    this.blockedPaths = new Set();
    
    // GATEKEEPER CACHE: 5-minute in-memory cache for valid subscriptions
    // Prevents DB bottlenecks during "Chaos Simulation" load tests
    this.subscriptionCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    // Periodic cache cleanup
    this.startCacheCleanup();
  }

  /**
   * Get cached subscription or fetch from DB
   */
  getCachedSubscription(cacheKey) {
    const cached = this.subscriptionCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < this.cacheTTL) {
      this.cacheHits++;
      return cached.data;
    }
    this.cacheMisses++;
    return null;
  }

  /**
   * Set subscription in cache
   */
  setCachedSubscription(cacheKey, data) {
    this.subscriptionCache.set(cacheKey, {
      data,
      ts: Date.now()
    });
  }

  /**
   * Invalidate cache entry (e.g., on subscription change)
   */
  invalidateCache(cacheKey) {
    this.subscriptionCache.delete(cacheKey);
  }

  /**
   * Start periodic cache cleanup
   */
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, entry] of this.subscriptionCache) {
        if (now - entry.ts > this.cacheTTL) {
          this.subscriptionCache.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`[GATEKEEPER] Cache cleanup: removed ${cleaned} expired entries, ${this.subscriptionCache.size} remaining`);
      }
    }, 60 * 1000); // Clean every minute
  }

  /**
   * Get cache stats for monitoring
   */
  getCacheStats() {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? (this.cacheHits / total * 100).toFixed(1) : 0,
      entries: this.subscriptionCache.size,
      ttlMinutes: this.cacheTTL / 60000
    };
  }

  /**
   * Express middleware: intercepts /api/services/* before execution.
   * Checks the request against the in-memory cache first, then Agent Bus gatekeeper.
   */
  middleware() {
    return async (req, res, next) => {
      // Allow health checks and webhook endpoints
      if (req.path.startsWith('/health') || req.path.startsWith('/webhooks')) {
        return next();
      }

      const subscriptionId = req.user?.subscriptionId || req.headers['x-subscription-id'];
      const customerId = req.user?.customerId || req.user?.id || req.headers['x-customer-id'];
      const tier = req.user?.tier || 'unknown';
      const apiKeyHash = req.user?.apiKeyHash || null;
      
      // CACHE KEY: composite of subscription + customer + service for granular caching
      const serviceId = req.params?.serviceId || req.body?.serviceId || 'default';
      const cacheKey = `${subscriptionId || customerId || apiKeyHash?.slice(0, 16)}:${serviceId}`;

      // CHECK IN-MEMORY CACHE FIRST (prevents DB bottlenecks)
      const cached = this.getCachedSubscription(cacheKey);
      if (cached && cached.allowed) {
        // Cache hit - fast path, no DB hit
        req.busIdentity = {
          customerId: cached.customerId || customerId,
          subscriptionId: cached.subscriptionId || subscriptionId,
          tier: cached.tier || tier,
          apiKeyHash,
          validatedAt: new Date().toISOString(),
          cacheHit: true
        };
        return next();
      }

      // CACHE MISS: Check via Bus (hits DB if needed)
      const gateCheck = await this.bus.gatekeeperCheck({
        identity: {
          customerId,
          subscriptionId,
          tier,
          apiKeyHash
        },
        payload: { serviceId }
      });

      if (!gateCheck) {
        this.bus.logTelemetry('gatekeeper_middleware_rejected', {
          identity: { customerId, subscriptionId, tier },
          path: req.path,
          method: req.method,
          cacheHit: false
        }, { reason: 'subscription_invalid_or_expired' });

        return res.status(403).json({
          success: false,
          error: 'Access denied: subscription not active or service not permitted',
          code: 'GATEKEEPER_BLOCKED',
          path: req.path,
          tier,
          suggestion: 'Upgrade your subscription or contact support'
        });
      }

      // CACHE THE SUCCESSFUL VALIDATION
      this.setCachedSubscription(cacheKey, {
        allowed: true,
        customerId,
        subscriptionId,
        tier: gateCheck.tier || tier,
        servicePermissions: gateCheck.permissions
      });

      // Attach validated identity to request for downstream components
      req.busIdentity = {
        customerId,
        subscriptionId,
        tier: gateCheck.tier || tier,
        apiKeyHash,
        validatedAt: new Date().toISOString(),
        cacheHit: false
      };

      next();
    };
  }

  /**
   * WebSocket gatekeeper: validates connection-level identity.
   */
  wsGatekeeper() {
    return async (ws, req, next) => {
      const subscriptionId = req.headers['x-subscription-id'];
      const apiKey = req.headers['x-api-key'];

      if (!subscriptionId && !apiKey) {
        ws.close(1008, 'Missing authentication headers');
        return;
      }

      const gateCheck = await this.bus.gatekeeperCheck({
        identity: {
          subscriptionId,
          apiKeyHash: apiKey ? this.hashKey(apiKey) : null
        }
      });

      if (!gateCheck) {
        ws.close(1008, 'Subscription validation failed');
        return;
      }

      ws.busIdentity = { subscriptionId, tier: gateCheck.tier };
      next();
    };
  }

  hashKey(key) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}

module.exports = BusGatekeeper;
