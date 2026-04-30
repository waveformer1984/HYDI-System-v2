// CASCADE Event Fingerprint System
// Deterministic fingerprinting using SHA-256 with sliding TTL cache

const crypto = require('crypto');

class CascadeEventFingerprint {
  constructor() {
    // Fingerprint cache with TTL (15 seconds window)
    this.fingerprintCache = new Map();
    this.ttlWindow = 15000; // 15 seconds
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredFingerprints();
    }, 5000); // Clean every 5 seconds
    
    // Statistics
    this.stats = {
      fingerprintsGenerated: 0,
      duplicatesBlocked: 0,
      cacheSize: 0,
      lastCleanup: null
    };
    
    console.log('[FINGERPRINT] Initialized with 15s TTL window');
  }

  // Generate deterministic fingerprint from normalized event
  generateFingerprint(event) {
    // Normalize event for consistent fingerprinting
    const normalized = this.normalizeEvent(event);
    
    // Create SHA-256 hash
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
    
    this.stats.fingerprintsGenerated++;
    
    return fingerprint;
  }

  // Normalize event for consistent fingerprinting
  normalizeEvent(event) {
    // Create normalized representation
    const normalized = {
      // Core fields in specific order
      source: event.source,
      type: event.type,
      // Sort payload keys for consistency
      payload: this.sortObjectKeys(event.payload || {}),
      // Round timestamp to second precision to avoid microsecond differences
      timestamp: event.timestamp ? event.timestamp.substring(0, 19) + 'Z' : null
    };
    
    // Remove null/undefined values
    return this.removeNullValues(normalized);
  }

  // Sort object keys recursively for consistent serialization
  sortObjectKeys(obj) {
    if (Array.isArray(obj)) {
      return obj.map(item => 
        typeof item === 'object' && item !== null ? this.sortObjectKeys(item) : item
      );
    } else if (typeof obj === 'object' && obj !== null) {
      const sorted = {};
      Object.keys(obj)
        .sort()
        .forEach(key => {
          sorted[key] = typeof obj[key] === 'object' && obj[key] !== null 
            ? this.sortObjectKeys(obj[key]) 
            : obj[key];
        });
      return sorted;
    }
    return obj;
  }

  // Remove null/undefined values
  removeNullValues(obj) {
    if (Array.isArray(obj)) {
      return obj
        .filter(item => item !== null && item !== undefined)
        .map(item => typeof item === 'object' ? this.removeNullValues(item) : item);
    } else if (typeof obj === 'object' && obj !== null) {
      const cleaned = {};
      Object.keys(obj).forEach(key => {
        if (obj[key] !== null && obj[key] !== undefined) {
          cleaned[key] = typeof obj[key] === 'object' 
            ? this.removeNullValues(obj[key]) 
            : obj[key];
        }
      });
      return cleaned;
    }
    return obj;
  }

  // Check if fingerprint is duplicate
  isDuplicate(fingerprint) {
    const now = Date.now();
    const existing = this.fingerprintCache.get(fingerprint);
    
    if (!existing) {
      // First time seeing this fingerprint
      this.fingerprintCache.set(fingerprint, {
        firstSeen: now,
        lastSeen: now,
        count: 1
      });
      this.updateCacheSize();
      return false;
    }
    
    // Check if within TTL window
    if (now - existing.firstSeen < this.ttlWindow) {
      // Duplicate within window
      existing.lastSeen = now;
      existing.count++;
      this.stats.duplicatesBlocked++;
      return true;
    }
    
    // Outside TTL window, treat as new
    this.fingerprintCache.set(fingerprint, {
      firstSeen: now,
      lastSeen: now,
      count: 1
    });
    this.updateCacheSize();
    return false;
  }

  // Process event with fingerprint check
  processEvent(event) {
    const fingerprint = this.generateFingerprint(event);
    
    if (this.isDuplicate(fingerprint)) {
      return {
        isDuplicate: true,
        fingerprint: fingerprint,
        reason: 'duplicate_within_ttl_window',
        ttlWindow: this.ttlWindow,
        blocked: true
      };
    }
    
    return {
      isDuplicate: false,
      fingerprint: fingerprint,
      blocked: false
    };
  }

  // Clean up expired fingerprints
  cleanupExpiredFingerprints() {
    const now = Date.now();
    const toDelete = [];
    
    this.fingerprintCache.forEach((data, fingerprint) => {
      if (now - data.lastSeen > this.ttlWindow) {
        toDelete.push(fingerprint);
      }
    });
    
    toDelete.forEach(fingerprint => {
      this.fingerprintCache.delete(fingerprint);
    });
    
    if (toDelete.length > 0) {
      this.stats.lastCleanup = new Date().toISOString();
      this.updateCacheSize();
    }
  }

  // Update cache size statistic
  updateCacheSize() {
    this.stats.cacheSize = this.fingerprintCache.size;
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      ttlWindow: this.ttlWindow,
      duplicateRate: this.stats.fingerprintsGenerated > 0 
        ? (this.stats.duplicatesBlocked / this.stats.fingerprintsGenerated * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  // Get detailed fingerprint report
  getReport(limit = 100) {
    const fingerprints = Array.from(this.fingerprintCache.entries())
      .map(([fingerprint, data]) => ({
        fingerprint: fingerprint.substring(0, 16) + '...',
        firstSeen: new Date(data.firstSeen).toISOString(),
        lastSeen: new Date(data.lastSeen).toISOString(),
        count: data.count,
        age: Date.now() - data.firstSeen
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    
    return {
      summary: this.getStats(),
      topFingerprints: fingerprints,
      generated_at: new Date().toISOString()
    };
  }

  // Clear all fingerprints
  clearAll() {
    this.fingerprintCache.clear();
    this.stats.fingerprintsGenerated = 0;
    this.stats.duplicatesBlocked = 0;
    this.updateCacheSize();
    console.log('[FINGERPRINT] All fingerprints cleared');
  }

  // Stop the fingerprint system
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    console.log('[FINGERPRINT] Stopped');
  }
}

module.exports = CascadeEventFingerprint;
