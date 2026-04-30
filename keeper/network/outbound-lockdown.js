/**
 * Outbound Network Lockdown
 * Your "secure proxy" becomes a very helpful attack relay without this
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const net = require('net');
const dns = require('dns').promises;

class OutboundLockdown {
  constructor(options = {}) {
    // Action to allowed domains mapping
    this.allowlist = {
      'stripe:transfer': [
        'api.stripe.com',
        'connect.stripe.com',
        'js.stripe.com'
      ],
      'stripe:create_connect_account': [
        'api.stripe.com',
        'connect.stripe.com'
      ],
      'stripe:retrieve_account': [
        'api.stripe.com'
      ],
      'stripe:list_accounts': [
        'api.stripe.com'
      ],
      'email:send': [
        'api.resend.com',
        'api.sendgrid.com',
        'api.mailgun.net'
      ],
      'email:send_payout_notification': [
        'api.resend.com',
        'api.sendgrid.com',
        'api.mailgun.net'
      ],
      'webhook:verify': [
        // No outbound calls needed
      ],
      'supabase:query': [
        'akbnfovjdcobifeupvbn.supabase.co',
        'api.supabase.com'
      ]
    };

    // IP allowlists for extra security
    this.ipAllowlist = {
      'api.stripe.com': [
        '54.230.128.0/18',
        '54.230.192.0/18',
        '54.239.192.0/18',
        '54.240.128.0/18'
      ],
      'api.resend.com': [
        '52.219.64.0/18',
        '52.92.16.0/20'
      ]
    };

    // Protocol restrictions
    this.allowedProtocols = ['https:', 'http:'];
    
    // Port restrictions
    this.allowedPorts = [443, 80, 8080];
    
    // Request size limits
    this.maxRequestSize = 10 * 1024 * 1024; // 10MB
    
    // Timeout settings
    this.timeouts = {
      connect: 5000,
      socket: 30000,
      request: 60000
    };

    // DNS cache
    this.dnsCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Make a locked-down HTTP request
   */
  async request(action, url, options = {}) {
    // Validate action
    if (!this.allowlist[action]) {
      throw new Error(`Action not allowed for outbound requests: ${action}`);
    }

    // Parse URL
    const parsedUrl = new URL(url);
    
    // Validate protocol
    if (!this.allowedProtocols.includes(parsedUrl.protocol)) {
      throw new Error(`Protocol not allowed: ${parsedUrl.protocol}`);
    }

    // Validate port
    const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
    if (!this.allowedPorts.includes(parseInt(port))) {
      throw new Error(`Port not allowed: ${port}`);
    }

    // Validate domain
    const domain = parsedUrl.hostname;
    if (!this.isDomainAllowed(action, domain)) {
      throw new Error(`Domain not allowed for action ${action}: ${domain}`);
    }

    // Validate IP (if available)
    const ip = await this.resolveDomain(domain);
    if (!this.isIPAllowed(domain, ip)) {
      throw new Error(`IP not allowed for domain ${domain}: ${ip}`);
    }

    // Validate request size
    if (options.body && Buffer.byteLength(options.body) > this.maxRequestSize) {
      throw new Error(`Request too large: ${Buffer.byteLength(options.body)} bytes`);
    }

    // Make request with strict options
    const requestOptions = {
      hostname: ip,
      port: port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        ...this.sanitizeHeaders(options.headers || {}),
        'Host': domain // Important for SNI
      },
      timeout: this.timeouts,
      // Security options
      rejectUnauthorized: true,
      checkServerIdentity: this.checkServerIdentity.bind(this, domain),
      // No follow redirects
      maxRedirects: 0
    };

    // Add body if present
    if (options.body) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
    }

    // Execute request
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    return new Promise((resolve, reject) => {
      const req = protocol.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
          
          // Check response size
          if (data.length > this.maxRequestSize) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      // Add timeouts
      req.setTimeout(this.timeouts.request);

      // Send body if present
      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * Check if domain is allowed for action
   */
  isDomainAllowed(action, domain) {
    const allowedDomains = this.allowlist[action];
    
    // Exact match
    if (allowedDomains.includes(domain)) {
      return true;
    }

    // Subdomain check
    for (const allowed of allowedDomains) {
      if (allowed.startsWith('*.')) {
        const baseDomain = allowed.substring(2);
        if (domain === baseDomain || domain.endsWith('.' + baseDomain)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if IP is allowed for domain
   */
  isIPAllowed(domain, ip) {
    const allowedIPs = this.ipAllowlist[domain];
    
    if (!allowedIPs) {
      // No IP restrictions for this domain
      return true;
    }

    // Check each CIDR range
    for (const cidr of allowedIPs) {
      if (this.isIPInCIDR(ip, cidr)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if IP is in CIDR range
   */
  isIPInCIDR(ip, cidr) {
    const [network, prefixLength] = cidr.split('/');
    const ipInt = this.ipToInt(ip);
    const networkInt = this.ipToInt(network);
    const mask = (0xffffffff << (32 - parseInt(prefixLength))) >>> 0;
    
    return (ipInt & mask) === (networkInt & mask);
  }

  /**
   * Convert IP to integer
   */
  ipToInt(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }

  /**
   * Resolve domain with caching
   */
  async resolveDomain(domain) {
    const cached = this.dnsCache.get(domain);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.ip;
    }

    try {
      const addresses = await dns.resolve4(domain);
      const ip = addresses[0]; // Use first IP
      
      this.dnsCache.set(domain, {
        ip,
        timestamp: Date.now()
      });

      return ip;
    } catch (err) {
      throw new Error(`DNS resolution failed for ${domain}: ${err.message}`);
    }
  }

  /**
   * Sanitize headers to remove sensitive info
   */
  sanitizeHeaders(headers) {
    const sanitized = {};
    
    for (const [key, value] of Object.entries(headers)) {
      const keyLower = key.toLowerCase();
      
      // Remove potentially sensitive headers
      if (keyLower.startsWith('x-') && 
          (keyLower.includes('key') || 
           keyLower.includes('secret') || 
           keyLower.includes('token'))) {
        continue;
      }
      
      sanitized[key] = value;
    }
    
    return sanitized;
  }

  /**
   * Custom server identity check
   */
  checkServerIdentity(domain, serverCert) {
    // Verify certificate matches domain
    if (serverCert.subject?.CN !== domain && 
        !serverCert.subjectaltname?.includes(`DNS:${domain}`)) {
      return new Error(`Certificate does not match domain: ${domain}`);
    }
    
    // Check certificate validity
    const now = new Date();
    if (now < new Date(serverCert.valid_from) || 
        now > new Date(serverCert.valid_to)) {
      return new Error('Certificate not valid at this time');
    }
    
    // In production, you might want to pin certificates
    return undefined; // No error
  }

  /**
   * Add allowed domain for action
   */
  addAllowedDomain(action, domain) {
    if (!this.allowlist[action]) {
      this.allowlist[action] = [];
    }
    
    if (!this.allowlist[action].includes(domain)) {
      this.allowlist[action].push(domain);
      console.log(`[LOCKDOWN] Added domain ${domain} to action ${action}`);
    }
  }

  /**
   * Remove allowed domain for action
   */
  removeAllowedDomain(action, domain) {
    if (this.allowlist[action]) {
      const index = this.allowlist[action].indexOf(domain);
      if (index > -1) {
        this.allowlist[action].splice(index, 1);
        console.log(`[LOCKDOWN] Removed domain ${domain} from action ${action}`);
      }
    }
  }

  /**
   * Get current allowlist
   */
  getAllowlist() {
    return { ...this.allowlist };
  }

  /**
   * Test connectivity to allowed domain
   */
  async testConnectivity(action, domain) {
    if (!this.isDomainAllowed(action, domain)) {
      throw new Error(`Domain not allowed: ${domain}`);
    }

    const ip = await this.resolveDomain(domain);
    
    return {
      domain,
      ip,
      ipAllowed: this.isIPAllowed(domain, ip),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear DNS cache
   */
  clearDNSCache() {
    this.dnsCache.clear();
    console.log('[LOCKDOWN] DNS cache cleared');
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      allowedActions: Object.keys(this.allowlist),
      totalDomains: Object.values(this.allowlist).flat().length,
      cachedDomains: this.dnsCache.size,
      allowedPorts: this.allowedPorts,
      maxRequestSize: this.maxRequestSize
    };
  }
}

module.exports = OutboundLockdown;
