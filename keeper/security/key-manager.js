/**
 * Production-Grade Key Management
 * Because "storing private keys in files" is how breaches happen
 */

const keytar = require('keytar'); // OS keychain integration
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class KeyManager {
  constructor(serviceName = 'protoforge-keeper') {
    this.serviceName = serviceName;
    this.keychain = keytar;
    this.unlockedKeys = new Map();
    this.masterKey = null;
    this.keyCacheTimeout = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Initialize with master key derivation
   */
  async initialize(passphrase) {
    // Derive master key from passphrase
    this.masterKey = crypto.scryptSync(passphrase, 'keeper-salt', 32);
    
    // Check if this is first time setup
    const hasKeys = await this.hasStoredKeys();
    
    if (!hasKeys) {
      console.log('[KEYS] First time setup - generating master key pair');
      await this.generateMasterKeyPair();
    }
    
    console.log('[KEYS] Key manager initialized');
  }

  /**
   * Generate and store master key pair
   */
  async generateMasterKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Encrypt private key with master key
    const encryptedPrivateKey = this.encryptWithMasterKey(privateKey);
    
    // Store in OS keychain
    await this.keychain.setPassword(
      this.serviceName,
      'master-private',
      encryptedPrivateKey
    );
    
    await this.keychain.setPassword(
      this.serviceName,
      'master-public',
      publicKey
    );
  }

  /**
   * Generate agent key pair
   */
  async generateAgentKey(agentId, passphrase = null) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Encrypt private key
    let encryptedPrivateKey;
    if (passphrase) {
      // Agent-specific passphrase
      const key = crypto.scryptSync(passphrase, `agent-${agentId}`, 32);
      encryptedPrivateKey = this.encryptKey(privateKey, key);
    } else {
      // Use master key
      encryptedPrivateKey = this.encryptWithMasterKey(privateKey);
    }

    // Store in keychain
    await this.keychain.setPassword(
      this.serviceName,
      `agent-${agentId}-private`,
      encryptedPrivateKey
    );
    
    await this.keychain.setPassword(
      this.serviceName,
      `agent-${agentId}-public`,
      publicKey
    );

    // Cache if unlocked
    if (this.unlockedKeys.has(agentId) || !passphrase) {
      this.unlockedKeys.set(agentId, {
        privateKey,
        publicKey,
        unlockedAt: Date.now()
      });
    }

    console.log(`[KEYS] Generated keys for agent: ${agentId}`);
    
    return { publicKey, privateKey: passphrase ? '[ENCRYPTED]' : privateKey };
  }

  /**
   * Unlock agent private key
   */
  async unlockAgentKey(agentId, passphrase = null) {
    // Check cache first
    const cached = this.unlockedKeys.get(agentId);
    if (cached && Date.now() - cached.unlockedAt < this.keyCacheTimeout) {
      return cached.privateKey;
    }

    // Retrieve from keychain
    const encryptedPrivateKey = await this.keychain.getPassword(
      this.serviceName,
      `agent-${agentId}-private`
    );

    if (!encryptedPrivateKey) {
      throw new Error(`No keys found for agent: ${agentId}`);
    }

    // Decrypt
    let privateKey;
    if (passphrase) {
      const key = crypto.scryptSync(passphrase, `agent-${agentId}`, 32);
      privateKey = this.decryptKey(encryptedPrivateKey, key);
    } else {
      privateKey = this.decryptWithMasterKey(encryptedPrivateKey);
    }

    // Get public key
    const publicKey = await this.keychain.getPassword(
      this.serviceName,
      `agent-${agentId}-public`
    );

    // Cache
    this.unlockedKeys.set(agentId, {
      privateKey,
      publicKey,
      unlockedAt: Date.now()
    });

    console.log(`[KEYS] Unlocked keys for agent: ${agentId}`);
    return privateKey;
  }

  /**
   * Lock agent key (clear from memory)
   */
  lockAgentKey(agentId) {
    this.unlockedKeys.delete(agentId);
    console.log(`[KEYS] Locked keys for agent: ${agentId}`);
  }

  /**
   * Lock all keys
   */
  lockAll() {
    this.unlockedKeys.clear();
    console.log('[KEYS] All keys locked');
  }

  /**
   * Rotate agent keys
   */
  async rotateAgentKey(agentId) {
    // Generate new keys
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Backup old keys
    const oldEncrypted = await this.keychain.getPassword(
      this.serviceName,
      `agent-${agentId}-private`
    );
    
    await this.keychain.setPassword(
      this.serviceName,
      `agent-${agentId}-private-backup-${Date.now()}`,
      oldEncrypted
    );

    // Store new keys
    const encryptedPrivateKey = this.encryptWithMasterKey(privateKey);
    
    await this.keychain.setPassword(
      this.serviceName,
      `agent-${agentId}-private`,
      encryptedPrivateKey
    );
    
    await this.keychain.setPassword(
      this.serviceName,
      `agent-${agentId}-public`,
      publicKey
    );

    // Update cache
    this.unlockedKeys.set(agentId, {
      privateKey,
      publicKey,
      unlockedAt: Date.now()
    });

    console.log(`[KEYS] Rotated keys for agent: ${agentId}`);
    
    return {
      newPublicKey: publicKey,
      rotatedAt: new Date().toISOString()
    };
  }

  /**
   * Revoke agent keys
   */
  async revokeAgentKey(agentId) {
    // Remove from keychain
    await this.keychain.deletePassword(
      this.serviceName,
      `agent-${agentId}-private`
    );
    
    await this.keychain.deletePassword(
      this.serviceName,
      `agent-${agentId}-public`
    );

    // Clear from memory
    this.unlockedKeys.delete(agentId);

    console.log(`[KEYS] Revoked keys for agent: ${agentId}`);
  }

  /**
   * Check if agent has keys
   */
  async hasAgentKeys(agentId) {
    try {
      const privateKey = await this.keychain.getPassword(
        this.serviceName,
        `agent-${agentId}-private`
      );
      return !!privateKey;
    } catch {
      return false;
    }
  }

  /**
   * Check if any keys are stored
   */
  async hasStoredKeys() {
    try {
      const key = await this.keychain.getPassword(
        this.serviceName,
        'master-public'
      );
      return !!key;
    } catch {
      return false;
    }
  }

  /**
   * Get key status
   */
  async getKeyStatus() {
    const status = {
      masterKeyStored: await this.hasStoredKeys(),
      unlockedAgents: Array.from(this.unlockedKeys.keys()),
      totalAgents: 0
    };

    // Count agents (this is platform-dependent)
    // In production, maintain a registry
    console.log('[KEYS] Key status:', status);
    
    return status;
  }

  /**
   * Backup keys (encrypted)
   */
  async backup(backupPath, backupPassphrase) {
    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      keys: {}
    };

    // Backup all agent keys
    // This would need a registry of agents
    const agents = ['finance-agent', 'heidi-agent']; // Example
    
    for (const agentId of agents) {
      try {
        const encryptedPrivate = await this.keychain.getPassword(
          this.serviceName,
          `agent-${agentId}-private`
        );
        
        const publicKey = await this.keychain.getPassword(
          this.serviceName,
          `agent-${agentId}-public`
        );

        if (encryptedPrivate && publicKey) {
          backup.keys[agentId] = {
            encryptedPrivate,
            publicKey
          };
        }
      } catch {
        // Agent doesn't exist
      }
    }

    // Encrypt backup
    const backupKey = crypto.scryptSync(backupPassphrase, 'backup-salt', 32);
    const encryptedBackup = this.encryptKey(JSON.stringify(backup), backupKey);
    
    await fs.writeFile(backupPath, encryptedBackup);
    console.log(`[KEYS] Backup created: ${backupPath}`);
  }

  /**
   * Restore keys from backup
   */
  async restore(backupPath, backupPassphrase) {
    const encryptedBackup = await fs.readFile(backupPath, 'utf8');
    
    const backupKey = crypto.scryptSync(backupPassphrase, 'backup-salt', 32);
    const backup = JSON.parse(this.decryptKey(encryptedBackup, backupKey));
    
    // Restore keys
    for (const [agentId, keyData] of Object.entries(backup.keys)) {
      await this.keychain.setPassword(
        this.serviceName,
        `agent-${agentId}-private`,
        keyData.encryptedPrivate
      );
      
      await this.keychain.setPassword(
        this.serviceName,
        `agent-${agentId}-public`,
        keyData.publicKey
      );
    }
    
    console.log(`[KEYS] Restored ${Object.keys(backup.keys).length} agent keys`);
  }

  /**
   * Helper methods
   */
  encryptWithMasterKey(data) {
    if (!this.masterKey) {
      throw new Error('Master key not initialized');
    }
    return this.encryptKey(data, this.masterKey);
  }

  decryptWithMasterKey(encryptedData) {
    if (!this.masterKey) {
      throw new Error('Master key not initialized');
    }
    return this.decryptKey(encryptedData, this.masterKey);
  }

  encryptKey(data, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', key);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    });
  }

  decryptKey(encryptedData, key) {
    const { encrypted, iv, authTag } = JSON.parse(encryptedData);
    
    const decipher = crypto.createDecipher('aes-256-gcm', key);
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Cleanup expired cache entries
   */
  cleanup() {
    const now = Date.now();
    
    for (const [agentId, keyData] of this.unlockedKeys) {
      if (now - keyData.unlockedAt > this.keyCacheTimeout) {
        this.unlockedKeys.delete(agentId);
      }
    }
  }
}

module.exports = KeyManager;
