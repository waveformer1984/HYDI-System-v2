/**
 * L1/L2/L3 Cache Hierarchy for Stripe/Subscription Validation
 * Prevents hammering Stripe/DB with repeated checks
 * Includes negative state caching for expired subscriptions
 */

const logger = require('../../lib/structured-logger').child({ component: 'SubscriptionCache' });

class SubscriptionCache {
  constructor() {
    // L1: In-memory (5 min TTL) - ultra fast
    this.l1Cache = new Map();
    this.l1TTL = 5 * 60 * 1000; // 5 minutes
    
    // L2: Simulated Redis cache (10-15 min TTL) - shared across instances
    this.l2Cache = new Map(); // In real prod, use Redis
    this.l2TTL = 10 * 60 * 1000; // 10 minutes
    
    // Cache stats
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      dbHits: 0
    };
    
    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Get subscription with L1/L2/L3 hierarchy
   * Flow: L1 -> L2 -> Stripe/DB
   */
  async get(apiKey, fetchFromDB) {
    const cacheKey = this.hashKey(apiKey);
    
    // L1 CHECK: In-memory (5 min)
    const l1Entry = this.l1Cache.get(cacheKey);
    if (l1Entry && Date.now() < l1Entry.expiresAt) {
      this.stats.l1Hits++;
      return {
        ...l1Entry.data,
        _cache: { level: 'L1', hit: true }
      };
    }
    
    // L2 CHECK: Simulated Redis (10-15 min)
    const l2Entry = this.l2Cache.get(cacheKey);
    if (l2Entry && Date.now() < l2Entry.expiresAt) {
      this.stats.l2Hits++;
      // Promote to L1
      this.l1Cache.set(cacheKey, {
        data: l2Entry.data,
        expiresAt: Date.now() + this.l1TTL
      });
      return {
        ...l2Entry.data,
        _cache: { level: 'L2', hit: true }
      };
    }
    
    // L3 CHECK: Stripe/DB (source of truth)
    this.stats.l2Misses++;
    const dbData = await fetchFromDB(apiKey);
    this.stats.dbHits++;
    
    // Cache result (including negative states)
    await this.set(cacheKey, dbData);
    
    return {
      ...dbData,
      _cache: { level: 'L3', hit: false }
    };
  }

  /**
   * Set cache entry in both L1 and L2
   * Caches negative states too (expired subscriptions)
   */
  async set(cacheKey, data) {
    const isNegative = !data || data.status === 'expired' || data.status === 'canceled';
    
    // Shorter TTL for negative states (2 min) to avoid long-term false negatives
    const ttl = isNegative ? 2 * 60 * 1000 : this.l1TTL;
    
    // L1 Cache
    this.l1Cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + ttl
    });
    
    // L2 Cache (longer TTL, but shorter for negatives)
    const l2Ttl = isNegative ? 5 * 60 * 1000 : this.l2TTL;
    this.l2Cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + l2Ttl
    });
    
    return true;
  }

  /**
   * Invalidate cache entry (on subscription change)
   */
  invalidate(apiKey) {
    const cacheKey = this.hashKey(apiKey);
    this.l1Cache.delete(cacheKey);
    this.l2Cache.delete(cacheKey);
    return true;
  }

  /**
   * Hash API key for cache key
   */
  hashKey(apiKey) {
    // Simple hash - in prod use crypto
    let hash = 0;
    for (let i = 0; i < apiKey.length; i++) {
      hash = ((hash << 5) - hash) + apiKey.charCodeAt(i);
      hash = hash & hash;
    }
    return `key_${hash}`;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.l1Hits + this.stats.l1Misses;
    const l1Rate = total > 0 ? (this.stats.l1Hits / total * 100).toFixed(1) : 0;
    const l2Rate = this.stats.l2Hits + this.stats.l2Misses > 0 
      ? (this.stats.l2Hits / (this.stats.l2Hits + this.stats.l2Misses) * 100).toFixed(1) 
      : 0;
    
    return {
      l1: { hits: this.stats.l1Hits, misses: this.stats.l1Misses, hitRate: l1Rate },
      l2: { hits: this.stats.l2Hits, misses: this.stats.l2Misses, hitRate: l2Rate },
      db: { hits: this.stats.dbHits },
      entries: {
        l1: this.l1Cache.size,
        l2: this.l2Cache.size
      }
    };
  }

  /**
   * Cleanup expired entries
   */
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      let l1Cleaned = 0;
      let l2Cleaned = 0;
      
      // Clean L1
      for (const [key, entry] of this.l1Cache) {
        if (now > entry.expiresAt) {
          this.l1Cache.delete(key);
          l1Cleaned++;
        }
      }
      
      // Clean L2
      for (const [key, entry] of this.l2Cache) {
        if (now > entry.expiresAt) {
          this.l2Cache.delete(key);
          l2Cleaned++;
        }
      }
      
      if (l1Cleaned > 0 || l2Cleaned > 0) {
        logger.info('Cache cleanup', { l1Cleaned, l2Cleaned });
      }
    }, 60 * 1000); // Every minute
  }
}

module.exports = SubscriptionCache;
