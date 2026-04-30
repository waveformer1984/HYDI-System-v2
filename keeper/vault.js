/**
 * KEEPER Vault - Secure Secret Storage
 * Can be swapped with HashiCorp Vault, AWS SM, etc.
 */

const crypto = require('crypto');

class Vault {
  constructor(options = {}) {
    this.secrets = new Map();
    this.encryptionKey = options.encryptionKey || this.generateKey();
    this.algorithm = 'aes-256-gcm';
  }

  /**
   * Store a secret
   */
  async set(key, value) {
    const encrypted = this.encrypt(JSON.stringify(value));
    this.secrets.set(key, encrypted);
  }

  /**
   * Retrieve a secret
   */
  async get(key) {
    const encrypted = this.secrets.get(key);
    if (!encrypted) {
      throw new Error(`Secret not found: ${key}`);
    }
    
    const decrypted = this.decrypt(encrypted);
    return JSON.parse(decrypted);
  }

  /**
   * Delete a secret
   */
  async delete(key) {
    if (!this.secrets.has(key)) {
      throw new Error(`Secret not found: ${key}`);
    }
    this.secrets.delete(key);
  }

  /**
   * List secret keys (without values)
   */
  list() {
    return Array.from(this.secrets.keys());
  }

  /**
   * Encrypt data
   */
  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
    cipher.setAAD(Buffer.from('keeper-v1', 'utf8'));
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Decrypt data
   */
  decrypt(encryptedData) {
    const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
    decipher.setAAD(Buffer.from('keeper-v1', 'utf8'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Generate encryption key
   */
  generateKey() {
    return crypto.randomBytes(32);
  }

  /**
   * Get signing key for JWT
   */
  getSigningKey() {
    // In production, use a separate key for signing
    return this.encryptionKey;
  }

  /**
   * Initialize with default secrets
   */
  async initialize() {
    // Store secret references (not actual secrets in code)
    await this.set('stripe/live_key', {
      type: 'api_key',
      service: 'stripe',
      environment: 'live',
      rotation: '90d',
      lastRotated: new Date().toISOString()
    });

    await this.set('stripe/test_key', {
      type: 'api_key',
      service: 'stripe',
      environment: 'test',
      rotation: '30d',
      lastRotated: new Date().toISOString()
    });

    await this.set('stripe/webhook_secret', {
      type: 'webhook',
      service: 'stripe',
      rotation: '180d',
      lastRotated: new Date().toISOString()
    });

    await this.set('email/resend_key', {
      type: 'api_key',
      service: 'resend',
      rotation: '90d',
      lastRotated: new Date().toISOString()
    });

    await this.set('supabase/service_role', {
      type: 'api_key',
      service: 'supabase',
      rotation: '180d',
      lastRotated: new Date().toISOString()
    });

    console.log('[VAULT] Initialized with default secret references');
    console.log('[VAULT] ⚠️  Remember to set actual secret values in production!');
  }

  /**
   * Rotate a secret
   */
  async rotate(key) {
    const secret = await this.get(key);
    secret.lastRotated = new Date().toISOString();
    await this.set(key, secret);
    
    console.log(`[VAULT] Rotated secret: ${key}`);
    return secret;
  }

  /**
   * Check if secret needs rotation
   */
  needsRotation(key) {
    const secret = this.secrets.get(key);
    if (!secret) return false;
    
    const rotationDays = {
      '30d': 30,
      '90d': 90,
      '180d': 180
    };
    
    const days = rotationDays[secret.rotation] || 90;
    const lastRotated = new Date(secret.lastRotated);
    const now = new Date();
    
    return (now - lastRotated) > (days * 24 * 60 * 60 * 1000);
  }

  /**
   * Export for backup (encrypted)
   */
  export() {
    return {
      secrets: Object.fromEntries(this.secrets),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Import from backup
   */
  import(data) {
    this.secrets = new Map(Object.entries(data.secrets));
    console.log('[VAULT] Imported secrets from backup');
  }
}

module.exports = Vault;
