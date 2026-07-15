/**
 * Simple Keymaker - API Key → Tier Mapping
 * No database, no drama, just working code
 */

class SimpleKeymaker {
  constructor() {
    this.apiKeys = {};

    // These well-known strings grant tier access to any caller who knows
    // them — fine for local dev against a throwaway database, a live
    // authentication bypass in any real deployment. Never register them
    // when NODE_ENV=production. See ISSUES_FOUND.md.
    if (process.env.NODE_ENV !== 'production') {
      this.apiKeys['sk_test_starter_123'] = { tier: 'starter', name: 'Test Starter Key' };
      this.apiKeys['sk_test_pro_456'] = { tier: 'pro', name: 'Test Pro Key' };
      this.apiKeys['sk_test_enterprise_789'] = { tier: 'enterprise', name: 'Test Enterprise Key' };
    }

    // Only register a production key if its env var is actually set —
    // the previous version keyed these off `process.env.X || ''`, which
    // registered an empty-string API key (mapped to a real tier) whenever
    // the env var was unset.
    if (process.env.STARTER_API_KEY) {
      this.apiKeys[process.env.STARTER_API_KEY] = { tier: 'starter', name: 'Production Starter' };
    }
    if (process.env.PRO_API_KEY) {
      this.apiKeys[process.env.PRO_API_KEY] = { tier: 'pro', name: 'Production Pro' };
    }
    if (process.env.ENTERPRISE_API_KEY) {
      this.apiKeys[process.env.ENTERPRISE_API_KEY] = { tier: 'enterprise', name: 'Production Enterprise' };
    }

    console.log('[SIMPLE KEYMAKER] Initialized with ' + Object.keys(this.apiKeys).length + ' keys');
  }
  
  middleware() {
    return (req, res, next) => {
      console.log('[SIMPLE KEYMAKER] Request:', req.method, req.path);
      
      // Skip public paths, GET requests, and test endpoints
      if (req.method === 'GET' || req.path === '/health' || req.path === '/integrity' || req.path.startsWith('/infrastructure') || req.path === '/bare-test') {
        console.log('[SIMPLE KEYMAKER] Skipping auth for:', req.path);
        return next();
      }
      
      console.log('[SIMPLE KEYMAKER] Checking auth for:', req.method, req.path);
      
      // Get API key from header or query
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      console.log('[SIMPLE KEYMAKER] API Key found:', !!apiKey);
      
      if (!apiKey) {
        return res.status(401).json({
          error: 'API key required',
          hint: 'Add x-api-key header or ?api_key= parameter'
        });
      }
      
      // Validate key
      const keyInfo = this.apiKeys[apiKey];
      if (!keyInfo) {
        return res.status(401).json({
          error: 'Invalid API key',
          hint: 'Check your API key or contact support'
        });
      }
      
      // Attach key info to request
      req.apiKey = {
        key: apiKey,
        tier: keyInfo.tier,
        name: keyInfo.name,
        validated: true
      };
      
      console.log(`[SIMPLE KEYMAKER] ${keyInfo.tier} access granted via ${keyInfo.name}`);
      next();
    };
  }
  
  // Helper method to check tier access
  static checkTierAccess(requiredTier, userTier) {
    const tierLevels = { starter: 1, pro: 2, enterprise: 3 };
    return tierLevels[userTier] >= tierLevels[requiredTier];
  }
}

module.exports = SimpleKeymaker;
