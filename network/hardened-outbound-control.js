/**
 * Hardened Outbound Network Control
 * DNS pinning + certificate fingerprint validation
 */

const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const crypto = require('crypto');

class HardenedOutboundControl {
  constructor(options = {}) {
    // Domain → IP mapping cache
    this.ipCache = new Map();
    
    // Certificate fingerprint cache
    this.certFingerprints = new Map();
    
    // Configuration
    this.config = {
      // Allowed domains with their expected fingerprints
      allowedDomains: {
        'api.stripe.com': {
          ips: [], // Will be populated
          certFingerprint: null, // Will be populated
          lastRefresh: 0,
          refreshInterval: 24 * 60 * 60 * 1000 // 24 hours
        }
      },
      
      // DNS settings
      dnsTimeout: 5000,
      dnsCacheTTL: 60 * 60 * 1000, // 1 hour
      
      // Certificate settings
      certValidation: true,
      certPinMode: 'strict', // 'strict' or 'lax'
      
      ...options
    };
    
    this.initializeDomainCache();
  }

  /**
   * Initialize domain cache with current IPs and certificates
   */
  async initializeDomainCache() {
    for (const [domain, config] of Object.entries(this.config.allowedDomains)) {
      await this.refreshDomainCache(domain);
    }
  }

  /**
   * Refresh domain cache (IPs and certificate)
   */
  async refreshDomainCache(domain) {
    const config = this.config.allowedDomains[domain];
    
    try {
      // Resolve IPs
      const addresses = await Promise.race([
        dns.resolve4(domain),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('DNS timeout')), this.config.dnsTimeout)
        )
      ]);
      
      // Get certificate fingerprint
      const certFingerprint = await this.getCertificateFingerprint(domain);
      
      // Update cache
      this.ipCache.set(domain, {
        ips: addresses,
        timestamp: Date.now(),
        ttl: this.config.dnsCacheTTL
      });
      
      this.certFingerprints.set(domain, {
        fingerprint: certFingerprint,
        timestamp: Date.now()
      });
      
      // Update config
      config.ips = addresses;
      config.certFingerprint = certFingerprint;
      config.lastRefresh = Date.now();
      
      console.log(`[OUTBOUND] Refreshed cache for ${domain}: ${addresses.join(', ')}`);
      
    } catch (error) {
      console.error(`[OUTBOUND] Failed to refresh ${domain}:`, error.message);
      
      // Keep old cache if available
      const cached = this.ipCache.get(domain);
      if (!cached) {
        throw new Error(`No cache available for ${domain} and refresh failed`);
      }
    }
  }

  /**
   * Get certificate fingerprint for domain
   */
  async getCertificateFingerprint(domain) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: domain,
        port: 443,
        method: 'GET',
        path: '/',
        rejectUnauthorized: false, // We'll verify manually
        timeout: 5000
      };
      
      const req = https.request(options, (res) => {
        const cert = res.socket.getPeerCertificate();
        if (cert) {
          // Calculate SHA-256 fingerprint
          const fingerprint = crypto.createHash('sha256')
            .update(cert.raw)
            .digest('hex')
            .toUpperCase();
          
          resolve(fingerprint);
        } else {
          reject(new Error('No certificate'));
        }
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Certificate timeout'));
      });
      
      req.end();
    });
  }

  /**
   * Make hardened HTTPS request
   */
  async makeSecureRequest(url, requestOptions = {}) {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    // Verify domain is allowed
    if (!this.config.allowedDomains[domain]) {
      throw new Error(`Domain not allowed: ${domain}`);
    }
    
    // Get cached IPs
    const cachedIPs = this.ipCache.get(domain);
    if (!cachedIPs || Date.now() - cachedIPs.timestamp > cachedIPs.ttl) {
      await this.refreshDomainCache(domain);
    }
    
    const domainConfig = this.config.allowedDomains[domain];
    const ips = this.ipCache.get(domain).ips;
    
    // Try each IP until one works
    let lastError;
    for (const ip of ips) {
      try {
        const result = await this.makeRequestToIP(ip, urlObj, requestOptions, domainConfig);
        
        // On success, refresh cache periodically
        if (Date.now() - domainConfig.lastRefresh > domainConfig.refreshInterval) {
          // Background refresh
          this.refreshDomainCache(domain).catch(() => {}); // Ignore errors
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        console.warn(`[OUTBOUND] Failed to connect to ${domain} at ${ip}: ${error.message}`);
      }
    }
    
    throw new Error(`All IPs failed for ${domain}. Last error: ${lastError.message}`);
  }

  /**
   * Make request to specific IP with certificate validation
   */
  async makeRequestToIP(ip, urlObj, requestOptions, domainConfig) {
    const port = urlObj.port || 443;
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: ip,
        port: port,
        path: urlObj.pathname + urlObj.search,
        method: requestOptions.method || 'GET',
        headers: {
          ...requestOptions.headers,
          'Host': urlObj.hostname // Important for SNI and virtual hosting
        },
        timeout: requestOptions.timeout || 30000,
        // Enhanced certificate validation
        rejectUnauthorized: true,
        checkServerIdentity: this.config.certValidation ? 
          (servername, cert) => this.validateCertificate(servername, cert, domainConfig) : 
          undefined
      };
      
      // Add body if present
      if (requestOptions.body) {
        options.headers['Content-Length'] = Buffer.byteLength(requestOptions.body);
      }
      
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            cert: res.socket.getPeerCertificate ? res.socket.getPeerCertificate() : null,
            connectedIP: ip
          });
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      // Send body if present
      if (requestOptions.body) {
        req.write(requestOptions.body);
      }
      
      req.end();
    });
  }

  /**
   * Validate certificate against expectations
   */
  validateCertificate(hostname, cert, domainConfig) {
    // Check certificate matches hostname
    if (cert.subject?.CN !== hostname && 
        !cert.subjectaltname?.includes(`DNS:${hostname}`)) {
      return new Error(`Certificate does not match hostname: ${hostname}`);
    }
    
    // Check certificate validity
    const now = new Date();
    if (now < new Date(cert.valid_from) || 
        now > new Date(cert.valid_to)) {
      return new Error('Certificate not valid at this time');
    }
    
    // Check fingerprint if in strict mode
    if (this.config.certPinMode === 'strict' && domainConfig.certFingerprint) {
      const certFingerprint = crypto.createHash('sha256')
        .update(cert.raw)
        .digest('hex')
        .toUpperCase();
      
      if (certFingerprint !== domainConfig.certFingerprint) {
        console.error(`[OUTBOUND] Certificate fingerprint mismatch for ${hostname}`);
        console.error(`  Expected: ${domainConfig.certFingerprint}`);
        console.error(`  Actual: ${certFingerprint}`);
        return new Error(`Certificate fingerprint mismatch for ${hostname}`);
      }
    }
    
    // Check certificate chain
    if (cert.issuer && cert.issuer.CN) {
      // Additional checks can be added here
    }
    
    return undefined; // No error
  }

  /**
   * Get domain statistics
   */
  getDomainStats() {
    const stats = {};
    
    for (const [domain, config] of Object.entries(this.config.allowedDomains)) {
      const cached = this.ipCache.get(domain);
      const certCached = this.certFingerprints.get(domain);
      
      stats[domain] = {
        ips: cached?.ips || [],
        lastRefresh: config.lastRefresh,
        certFingerprint: certCached?.fingerprint || null,
        cacheAge: cached ? Date.now() - cached.timestamp : null
      };
    }
    
    return stats;
  }

  /**
   * Force refresh all domains
   */
  async refreshAllDomains() {
    console.log('[OUTBOUND] Refreshing all domain caches...');
    
    const results = {};
    
    for (const domain of Object.keys(this.config.allowedDomains)) {
      try {
        await this.refreshDomainCache(domain);
        results[domain] = { success: true };
      } catch (error) {
        results[domain] = { success: false, error: error.message };
      }
    }
    
    return results;
  }
}

module.exports = HardenedOutboundControl;
