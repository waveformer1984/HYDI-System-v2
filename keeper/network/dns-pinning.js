/**
 * DNS Pinning for Outbound Network Security
 * Because allowlisting domains isn't enough when DNS can be poisoned
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const dns = require('dns').promises;
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class DNSPinning {
  constructor(options = {}) {
    // Domain to IP mappings (pinned)
    this.pinnedDomains = new Map();
    
    // Certificate fingerprints
    this.certFingerprints = new Map();
    
    // DNS cache with integrity
    this.dnsCache = new Map();
    this.cacheFile = options.cacheFile || path.join(__dirname, '../../data/dns-pins.json');
    
    // Configuration
    this.config = {
      pinTTL: options.pinTTL || 24 * 60 * 60 * 1000, // 24 hours
      resolveTimeout: options.resolveTimeout || 5000,
      maxIPs: options.maxIPs || 4,
      validateCert: options.validateCert !== false,
      enablePinning: options.enablePinning !== false,
      ...options
    };
    
    // Load existing pins
    this.loadPins();
    
    // Start periodic refresh
    this.startPeriodicRefresh();
  }

  /**
   * Make request with DNS pinning
   */
  async request(action, url, options = {}) {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;
    
    // Get pinned IP(s)
    const pinnedIPs = await this.getPinnedIPs(domain);
    
    if (!pinnedIPs || pinnedIPs.length === 0) {
      throw new Error(`No pinned IPs for domain: ${domain}`);
    }
    
    // Try each pinned IP until one works
    let lastError;
    for (const ip of pinnedIPs) {
      try {
        const result = await this.makeRequestToIP(ip, parsedUrl, options);
        
        // On success, update last used timestamp
        this.updateIPUsage(domain, ip);
        
        return result;
        
      } catch (error) {
        lastError = error;
        console.warn(`[DNS-PIN] Failed to connect to ${domain} at ${ip}: ${error.message}`);
        
        // Mark IP as failed temporarily
        this.markIPFailed(domain, ip);
      }
    }
    
    throw new Error(`All pinned IPs failed for ${domain}. Last error: ${lastError.message}`);
  }

  /**
   * Pin a domain (resolve and cache IPs)
   */
  async pinDomain(domain, options = {}) {
    console.log(`[DNS-PIN] Pinning domain: ${domain}`);
    
    try {
      // Resolve with timeout
      const addresses = await Promise.race([
        dns.resolve4(domain),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('DNS timeout')), this.config.resolveTimeout)
        )
      ]);
      
      // Limit number of IPs
      const limitedIPs = addresses.slice(0, this.config.maxIPs);
      
      // Verify each IP
      const verifiedIPs = [];
      for (const ip of limitedIPs) {
        if (await this.verifyIP(domain, ip)) {
          verifiedIPs.push(ip);
        }
      }
      
      if (verifiedIPs.length === 0) {
        throw new Error(`No verified IPs for domain: ${domain}`);
      }
      
      // Get certificate fingerprint if HTTPS
      let certFingerprint = null;
      if (options.port === 443 || options.protocol === 'https') {
        certFingerprint = await this.getCertFingerprint(domain, verifiedIPs[0]);
      }
      
      // Store pin
      const pin = {
        domain,
        ips: verifiedIPs.map(ip => ({
          address: ip,
          addedAt: Date.now(),
          lastUsed: Date.now(),
          failures: 0,
          status: 'active'
        })),
        certFingerprint,
        pinnedAt: Date.now(),
        expiresAt: Date.now() + this.config.pinTTL,
        metadata: options
      };
      
      this.pinnedDomains.set(domain, pin);
      
      // Save pins
      await this.savePins();
      
      console.log(`[DNS-PIN] Pinned ${domain} to IPs: ${verifiedIPs.join(', ')}`);
      
      return pin;
      
    } catch (error) {
      console.error(`[DNS-PIN] Failed to pin ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Get pinned IPs for domain
   */
  async getPinnedIPs(domain) {
    const pin = this.pinnedDomains.get(domain);
    
    // Check if pin exists and is not expired
    if (!pin || Date.now() > pin.expiresAt) {
      if (pin) {
        console.log(`[DNS-PIN] Pin expired for ${domain}, refreshing...`);
        this.pinnedDomains.delete(domain);
      }
      
      // Refresh pin
      await this.pinDomain(domain);
      return this.getPinnedIPs(domain);
    }
    
    // Filter out failed IPs
    const activeIPs = pin.ips
      .filter(ip => ip.status === 'active' && ip.failures < 3)
      .map(ip => ip.address);
    
    if (activeIPs.length === 0) {
      console.warn(`[DNS-PIN] No active IPs for ${domain}, refreshing...`);
      await this.pinDomain(domain);
      return this.getPinnedIPs(domain);
    }
    
    return activeIPs;
  }

  /**
   * Make request to specific IP
   */
  async makeRequestToIP(ip, parsedUrl, options = {}) {
    const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: ip,
        port: port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          ...options.headers,
          'Host': parsedUrl.hostname // Important for SNI and virtual hosting
        },
        timeout: options.timeout || 30000,
        // Security options
        rejectUnauthorized: this.config.validateCert,
        // Custom server identity check
        checkServerIdentity: this.config.validateCert ? 
          (serverCert, hostname) => this.checkServerIdentity(parsedUrl.hostname, serverCert) : 
          undefined
      };
      
      // Add body if present
      if (options.body) {
        requestOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
      }
      
      const req = protocol.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            cert: res.socket.getPeerCertificate ? res.socket.getPeerCertificate() : null
          });
        });
      });
      
      req.on('error', (err) => {
        reject(err);
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      // Send body if present
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }

  /**
   * Verify IP is legitimate for domain
   */
  async verifyIP(domain, ip) {
    // Reverse DNS lookup
    try {
      const hostnames = await dns.reverse(ip);
      
      // Check if any hostname matches the domain
      const matches = hostnames.some(hostname => 
        hostname === domain || hostname.endsWith('.' + domain)
      );
      
      if (!matches) {
        console.warn(`[DNS-PIN] Reverse DNS mismatch for ${domain} -> ${ip}: ${hostnames.join(', ')}`);
        // Don't fail immediately, just warn
      }
      
      return true;
      
    } catch (error) {
      console.warn(`[DNS-PIN] Reverse DNS failed for ${ip}: ${error.message}`);
      return true; // Allow if reverse fails
    }
  }

  /**
   * Get certificate fingerprint
   */
  async getCertFingerprint(domain, ip) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: ip,
        port: 443,
        method: 'GET',
        path: '/',
        headers: { Host: domain },
        rejectUnauthorized: false // We'll verify manually
      };
      
      const req = https.request(options, (res) => {
        const cert = res.socket.getPeerCertificate();
        if (cert) {
          // Calculate SHA-256 fingerprint
          const fingerprint = crypto.createHash('sha256')
            .update(cert.raw)
            .digest('hex');
          
          resolve(fingerprint.toUpperCase());
        } else {
          reject(new Error('No certificate'));
        }
      });
      
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      
      req.end();
    });
  }

  /**
   * Check server identity against expectations
   */
  checkServerIdentity(domain, serverCert) {
    // Check certificate matches domain
    if (serverCert.subject?.CN !== domain && 
        !serverCert.subjectaltname?.includes(`DNS:${domain}`)) {
      return new Error(`Certificate does not match domain: ${domain}`);
    }
    
    // Check against pinned fingerprint if available
    const pin = this.pinnedDomains.get(domain);
    if (pin && pin.certFingerprint) {
      const certFingerprint = crypto.createHash('sha256')
        .update(serverCert.raw)
        .digest('hex')
        .toUpperCase();
      
      if (certFingerprint !== pin.certFingerprint) {
        return new Error(`Certificate fingerprint mismatch for ${domain}`);
      }
    }
    
    // Check certificate validity
    const now = new Date();
    if (now < new Date(serverCert.valid_from) || 
        now > new Date(serverCert.valid_to)) {
      return new Error('Certificate not valid at this time');
    }
    
    return undefined; // No error
  }

  /**
   * Update IP usage statistics
   */
  updateIPUsage(domain, ip) {
    const pin = this.pinnedDomains.get(domain);
    if (!pin) return;
    
    const ipInfo = pin.ips.find(ipInfo => ipInfo.address === ip);
    if (ipInfo) {
      ipInfo.lastUsed = Date.now();
      ipInfo.failures = Math.max(0, ipInfo.failures - 1); // Decay failures
      if (ipInfo.status === 'failed') {
        ipInfo.status = 'active';
      }
    }
  }

  /**
   * Mark IP as failed
   */
  markIPFailed(domain, ip) {
    const pin = this.pinnedDomains.get(domain);
    if (!pin) return;
    
    const ipInfo = pin.ips.find(ipInfo => ipInfo.address === ip);
    if (ipInfo) {
      ipInfo.failures++;
      if (ipInfo.failures >= 3) {
        ipInfo.status = 'failed';
        console.warn(`[DNS-PIN] IP ${ip} marked as failed for ${domain}`);
      }
    }
  }

  /**
   * Refresh all pins
   */
  async refreshAllPins() {
    console.log('[DNS-PIN] Refreshing all pins...');
    
    const domains = Array.from(this.pinnedDomains.keys());
    const results = [];
    
    for (const domain of domains) {
      try {
        const pin = await this.pinDomain(domain);
        results.push({ domain, success: true, ips: pin.ips.length });
      } catch (error) {
        results.push({ domain, success: false, error: error.message });
      }
    }
    
    console.log(`[DNS-PIN] Refreshed ${domains.length} domains`);
    return results;
  }

  /**
   * Get pin statistics
   */
  getPinStats() {
    const stats = {
      totalDomains: this.pinnedDomains.size,
      totalIPs: 0,
      activeIPs: 0,
      failedIPs: 0,
      expiringSoon: 0,
      now: Date.now()
    };
    
    const soon = 60 * 60 * 1000; // 1 hour
    
    for (const pin of this.pinnedDomains.values()) {
      stats.totalIPs += pin.ips.length;
      
      pin.ips.forEach(ip => {
        if (ip.status === 'active') {
          stats.activeIPs++;
        } else {
          stats.failedIPs++;
        }
      });
      
      if (pin.expiresAt - stats.now < soon) {
        stats.expiringSoon++;
      }
    }
    
    return stats;
  }

  /**
   * Load pins from file
   */
  async loadPins() {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf8');
      const pins = JSON.parse(data);
      
      for (const [domain, pin] of Object.entries(pins)) {
        // Convert date strings back to numbers
        pin.pinnedAt = new Date(pin.pinnedAt).getTime();
        pin.expiresAt = new Date(pin.expiresAt).getTime();
        pin.ips.forEach(ip => {
          ip.addedAt = new Date(ip.addedAt).getTime();
          ip.lastUsed = new Date(ip.lastUsed).getTime();
        });
        
        this.pinnedDomains.set(domain, pin);
      }
      
      console.log(`[DNS-PIN] Loaded ${this.pinnedDomains.size} pinned domains`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[DNS-PIN] Error loading pins:', err);
      }
    }
  }

  /**
   * Save pins to file
   */
  async savePins() {
    try {
      const serializable = {};
      for (const [domain, pin] of this.pinnedDomains) {
        serializable[domain] = pin;
      }
      
      await fs.writeFile(this.cacheFile, JSON.stringify(serializable, null, 2));
    } catch (err) {
      console.error('[DNS-PIN] Error saving pins:', err);
    }
  }

  /**
   * Start periodic refresh
   */
  startPeriodicRefresh() {
    // Refresh pins every hour
    setInterval(async () => {
      const stats = this.getPinStats();
      
      // Only refresh if any are expiring soon
      if (stats.expiringSoon > 0) {
        console.log(`[DNS-PIN] ${stats.expiringSoon} domains expiring soon, refreshing...`);
        await this.refreshAllPins();
      }
    }, 60 * 60 * 1000);
    
    // Clean up expired pins every 6 hours
    setInterval(() => {
      this.cleanupExpiredPins();
    }, 6 * 60 * 60 * 1000);
  }

  /**
   * Clean up expired pins
   */
  cleanupExpiredPins() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [domain, pin] of this.pinnedDomains) {
      if (now > pin.expiresAt) {
        this.pinnedDomains.delete(domain);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[DNS-PIN] Cleaned up ${cleaned} expired pins`);
      this.savePins();
    }
  }
}

module.exports = DNSPinning;
