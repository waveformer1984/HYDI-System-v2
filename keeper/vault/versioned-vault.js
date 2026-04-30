/**
 * Versioned Vault - Because rotation without versioning is chaos
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class VersionedVault {
  constructor(options = {}) {
    this.secrets = new Map();
    this.encryptionKey = options.encryptionKey || this.generateKey();
    this.algorithm = 'aes-256-gcm';
    this.versionHistory = new Map();
    this.auditLog = [];
  }

  /**
   * Store a secret with versioning
   */
  async set(key, value, metadata = {}) {
    const versions = this.versionHistory.get(key) || {};
    const nextVersion = this.getNextVersion(versions);
    
    const versionedValue = {
      ...value,
      version: nextVersion,
      createdAt: new Date().toISOString(),
      createdBy: metadata.createdBy || 'system',
      rotationReason: metadata.rotationReason || 'initial',
      ...metadata
    };

    // Encrypt the versioned value
    const encrypted = this.encrypt(JSON.stringify(versionedValue));
    
    // Store in versions map
    versions[nextVersion] = encrypted;
    this.versionHistory.set(key, versions);

    // Set active version
    this.secrets.set(key, {
      active: nextVersion,
      versions: versions
    });

    // Log the operation
    this.logOperation('SET', key, nextVersion, metadata);

    return nextVersion;
  }

  /**
   * Get the active version of a secret
   */
  async get(key) {
    const secretInfo = this.secrets.get(key);
    if (!secretInfo) {
      throw new Error(`Secret not found: ${key}`);
    }

    const activeVersion = secretInfo.active;
    const encrypted = secretInfo.versions[activeVersion];
    
    if (!encrypted) {
      throw new Error(`Active version not found: ${key}:${activeVersion}`);
    }

    const decrypted = this.decrypt(encrypted);
    const secret = JSON.parse(decrypted);

    // Log access
    this.logOperation('GET', key, activeVersion);

    // Return without version info (unless requested)
    const { version, createdAt, ...cleanSecret } = secret;
    return cleanSecret;
  }

  /**
   * Get a specific version of a secret
   */
  async getVersion(key, version) {
    const versions = this.versionHistory.get(key);
    if (!versions || !versions[version]) {
      throw new Error(`Version not found: ${key}:${version}`);
    }

    const decrypted = this.decrypt(versions[version]);
    const secret = JSON.parse(decrypted);

    this.logOperation('GET_VERSION', key, version);

    return secret;
  }

  /**
   * Create a new version (rotation)
   */
  async rotate(key, newValue, metadata = {}) {
    const current = await this.getVersion(key, (await this.getActiveVersion(key)));
    
    // Deactivate old version
    await this.deactivateVersion(key, current.version);

    // Create new version
    const newVersion = await this.set(key, newValue, {
      ...metadata,
      rotationReason: metadata.rotationReason || 'scheduled_rotation',
      previousVersion: current.version
    });

    // Update version chain
    const versions = this.versionHistory.get(key);
    versions[newVersion].previousVersion = current.version;

    console.log(`[VAULT] Rotated ${key}: v${current.version} → v${newVersion}`);
    
    return {
      oldVersion: current.version,
      newVersion: newVersion,
      rotatedAt: new Date().toISOString()
    };
  }

  /**
   * Switch active version
   */
  async switchVersion(key, version, reason = 'manual') {
    const versions = this.versionHistory.get(key);
    if (!versions || !versions[version]) {
      throw new Error(`Version not found: ${key}:${version}`);
    }

    const oldActive = this.secrets.get(key).active;
    this.secrets.get(key).active = version;

    this.logOperation('SWITCH_VERSION', key, version, { 
      oldVersion: oldActive, 
      reason 
    });

    console.log(`[VAULT] Switched ${key}: v${oldActive} → v${version}`);
  }

  /**
   * Deactivate a version (mark as inactive)
   */
  async deactivateVersion(key, version) {
    const versions = this.versionHistory.get(key);
    if (versions && versions[version]) {
      const decrypted = this.decrypt(versions[version]);
      const secret = JSON.parse(decrypted);
      secret.status = 'inactive';
      secret.deactivatedAt = new Date().toISOString();
      
      versions[version] = this.encrypt(JSON.stringify(secret));
      
      this.logOperation('DEACTIVATE', key, version);
    }
  }

  /**
   * Delete a version (permanent, with confirmation)
   */
  async deleteVersion(key, version, confirm = false) {
    if (!confirm) {
      throw new Error('Deletion requires explicit confirmation');
    }

    const versions = this.versionHistory.get(key);
    if (!versions || !versions[version]) {
      throw new Error(`Version not found: ${key}:${version}`);
    }

    // Don't allow deleting active version
    if (this.secrets.get(key).active === version) {
      throw new Error('Cannot delete active version');
    }

    delete versions[version];
    
    this.logOperation('DELETE', key, version);
    
    console.log(`[VAULT] Deleted version: ${key}:${version}`);
  }

  /**
   * Get all versions info (without values)
   */
  async getVersions(key) {
    const versions = this.versionHistory.get(key) || {};
    const active = this.secrets.get(key)?.active;
    
    const versionInfo = {};
    
    for (const [versionNum, encrypted] of Object.entries(versions)) {
      const decrypted = this.decrypt(encrypted);
      const secret = JSON.parse(decrypted);
      
      versionInfo[versionNum] = {
        version: secret.version,
        createdAt: secret.createdAt,
        createdBy: secret.createdBy,
        status: secret.status || 'active',
        rotationReason: secret.rotationReason,
        isActive: versionNum === active
      };
    }

    return versionInfo;
  }

  /**
   * Check if secret needs rotation
   */
  needsRotation(key, maxAge = 90) {
    const versions = this.versionHistory.get(key);
    if (!versions) return false;

    const active = this.secrets.get(key).active;
    const encrypted = versions[active];
    
    const decrypted = this.decrypt(encrypted);
    const secret = JSON.parse(decrypted);

    const age = Date.now() - new Date(secret.createdAt).getTime();
    const maxAgeMs = maxAge * 24 * 60 * 60 * 1000;

    return age > maxAgeMs;
  }

  /**
   * Get secrets that need rotation
   */
  async getRotationCandidates(maxAge = 90) {
    const candidates = [];
    
    for (const [key] of this.secrets) {
      if (this.needsRotation(key, maxAge)) {
        const versions = await this.getVersions(key);
        const active = Object.values(versions).find(v => v.isActive);
        
        candidates.push({
          key,
          activeVersion: active.version,
          age: active.createdAt,
          daysOld: Math.floor((Date.now() - new Date(active.createdAt).getTime()) / (24 * 60 * 60 * 1000))
        });
      }
    }

    return candidates.sort((a, b) => b.daysOld - a.daysOld);
  }

  /**
   * Audit trail for a secret
   */
  async getAuditTrail(key) {
    return this.auditLog
      .filter(entry => entry.key === key)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Rollback to previous version
   */
  async rollback(key, reason = 'emergency') {
    const versions = await this.getVersions(key);
    const current = Object.values(versions).find(v => v.isActive);
    
    // Find previous version
    const versionNumbers = Object.keys(versions).map(Number).sort((a, b) => b - a);
    const currentIndex = versionNumbers.indexOf(parseInt(current.version));
    
    if (currentIndex === versionNumbers.length - 1) {
      throw new Error('No previous version to rollback to');
    }

    const previousVersion = versionNumbers[currentIndex + 1];
    
    // Switch to previous
    await this.switchVersion(key, previousVersion.toString(), `rollback: ${reason}`);
    
    // Deactivate current
    await this.deactivateVersion(key, current.version);

    console.log(`[VAULT] Rollback ${key}: v${current.version} → v${previousVersion}`);
    
    return {
      from: current.version,
      to: previousVersion.toString(),
      reason
    };
  }

  /**
   * Export vault state (for backup)
   */
  async export(includeInactive = false) {
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      secrets: {}
    };

    for (const [key, secretInfo] of this.secrets) {
      exportData.secrets[key] = {
        active: secretInfo.active,
        versions: {}
      };

      for (const [version, encrypted] of Object.entries(secretInfo.versions)) {
        if (includeInactive || version === secretInfo.active) {
          exportData.secrets[key].versions[version] = encrypted;
        }
      }
    }

    return exportData;
  }

  /**
   * Import vault state (from backup)
   */
  async import(data, merge = false) {
    if (!merge) {
      this.secrets.clear();
      this.versionHistory.clear();
    }

    for (const [key, secretData] of Object.entries(data.secrets)) {
      this.versionHistory.set(key, secretData.versions);
      this.secrets.set(key, {
        active: secretData.active,
        versions: secretData.versions
      });
    }

    console.log(`[VAULT] Imported ${Object.keys(data.secrets).length} secrets`);
  }

  /**
   * Helper methods
   */
  getNextVersion(versions) {
    const versionNumbers = Object.keys(versions).map(Number);
    return versionNumbers.length > 0 ? Math.max(...versionNumbers) + 1 : 1;
  }

  async getActiveVersion(key) {
    return this.secrets.get(key)?.active;
  }

  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
    cipher.setAAD(Buffer.from('vault-v2', 'utf8'));
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  decrypt(encryptedData) {
    const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
    decipher.setAAD(Buffer.from('vault-v2', 'utf8'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  generateKey() {
    return crypto.randomBytes(32);
  }

  logOperation(operation, key, version, metadata = {}) {
    const entry = {
      operation,
      key,
      version,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    this.auditLog.push(entry);

    // Keep log size manageable
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }

    console.log(`[VAULT AUDIT] ${operation} ${key}:${version}`);
  }

  /**
   * Initialize with versioned secrets
   */
  async initialize() {
    await this.set('stripe/live_key', {
      type: 'api_key',
      service: 'stripe',
      environment: 'live',
      value: 'sk_live_placeholder'
    }, {
      createdBy: 'initializer',
      rotationPeriod: '90d'
    });

    await this.set('stripe/webhook_secret', {
      type: 'webhook',
      service: 'stripe',
      value: 'whsec_placeholder'
    }, {
      createdBy: 'initializer',
      rotationPeriod: '180d'
    });

    console.log('[VAULT] Initialized with versioned secrets');
  }
}

module.exports = VersionedVault;
