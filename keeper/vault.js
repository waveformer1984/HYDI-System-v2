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

  async set(key, value) {
    const encrypted = this.encrypt(JSON.stringify(value));
    this.secrets.set(key, encrypted);
  }

  async get(key) {
    const encrypted = this.secrets.get(key);
    if (!encrypted) throw new Error(`Secret not found: ${key}`);
    return JSON.parse(this.decrypt(encrypted));
  }

  async delete(key) {
    if (!this.secrets.has(key)) throw new Error(`Secret not found: ${key}`);
    this.secrets.delete(key);
  }

  list() {
    return Array.from(this.secrets.keys());
  }

  _normalizeKey() {
    const k = this.encryptionKey;
    if (Buffer.isBuffer(k) && k.length === 32) return k;
    return crypto.createHash('sha256').update(Buffer.isBuffer(k) ? k : String(k)).digest();
  }

  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this._normalizeKey(), iv);
    cipher.setAAD(Buffer.from('keeper-v1', 'utf8'));
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { encrypted, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
  }

  decrypt(encryptedData) {
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this._normalizeKey(),
      Buffer.from(encryptedData.iv, 'hex')
    );
    decipher.setAAD(Buffer.from('keeper-v1', 'utf8'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  generateKey() {
    return crypto.randomBytes(32);
  }

  getSigningKey() {
    return this.encryptionKey;
  }

  async initialize() {
    const refs = [
      ['stripe/live_key',      { type: 'api_key', service: 'stripe',   environment: 'live', rotation: '90d' }],
      ['stripe/test_key',      { type: 'api_key', service: 'stripe',   environment: 'test', rotation: '30d' }],
      ['stripe/webhook_secret',{ type: 'webhook', service: 'stripe',   rotation: '180d' }],
      ['email/resend_key',     { type: 'api_key', service: 'resend',   rotation: '90d' }],
      ['supabase/service_role',{ type: 'api_key', service: 'supabase', rotation: '180d' }],
    ];
    for (const [key, meta] of refs) {
      await this.set(key, { ...meta, lastRotated: new Date().toISOString() });
    }
    console.log('[VAULT] Initialized with default secret references');
    console.log('[VAULT] ⚠️  Remember to set actual secret values in production!');
  }

  async rotate(key) {
    const secret = await this.get(key);
    secret.lastRotated = new Date().toISOString();
    await this.set(key, secret);
    console.log(`[VAULT] Rotated secret: ${key}`);
    return secret;
  }

  needsRotation(key) {
    const secret = this.secrets.get(key);
    if (!secret) return false;
    const days = { '30d': 30, '90d': 90, '180d': 180 }[secret.rotation] || 90;
    return (Date.now() - new Date(secret.lastRotated).getTime()) > days * 864e5;
  }

  export() {
    return { secrets: Object.fromEntries(this.secrets), timestamp: new Date().toISOString() };
  }

  import(data) {
    this.secrets = new Map(Object.entries(data.secrets));
    console.log('[VAULT] Imported secrets from backup');
  }
}

module.exports = Vault;
