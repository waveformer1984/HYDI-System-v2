'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * SecretVault encrypts sensitive values at rest using AES-256-GCM.
 *
 * The master key is read from HYDI_VAULT_KEY or derived from a passphrase.
 * Values are stored in a local JSON file and are never held in plaintext on disk.
 */
class SecretVault {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      vaultPath: options.vaultPath || path.resolve(__dirname, '../../data/vault.json'),
      keyEnvVar: options.keyEnvVar || 'HYDI_VAULT_KEY',
      ...options,
    };
    this._cache = new Map();
    this._key = null;
  }

  async initialize() {
    const raw = process.env[this.config.keyEnvVar];
    if (!raw) {
      throw new Error(`${this.config.keyEnvVar} is required to unlock the secret vault`);
    }
    this._key = this._deriveKey(raw);
    await this._load();
  }

  _deriveKey(secret) {
    return crypto.createHash('sha256').update(secret).digest();
  }

  async _load() {
    try {
      const data = JSON.parse(await fs.readFile(this.config.vaultPath, 'utf8'));
      this._cache = new Map(Object.entries(data));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this._cache = new Map();
    }
  }

  async _save() {
    await fs.mkdir(path.dirname(this.config.vaultPath), { recursive: true });
    const obj = Object.fromEntries(this._cache);
    await fs.writeFile(this.config.vaultPath, JSON.stringify(obj, null, 2));
  }

  set(name, value) {
    if (!this._key) throw new Error('vault not initialized');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const record = {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted.toString('hex'),
    };
    this._cache.set(name, record);
    return this._save();
  }

  get(name) {
    if (!this._key) throw new Error('vault not initialized');
    const record = this._cache.get(name);
    if (!record) return undefined;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this._key,
      Buffer.from(record.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(record.authTag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(record.data, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  delete(name) {
    const removed = this._cache.delete(name);
    if (removed) return this._save();
    return false;
  }

  rotate(name, newValue) {
    this.set(name, newValue);
  }

  list() {
    return Array.from(this._cache.keys());
  }
}

module.exports = SecretVault;
