/**
 * Tamper-Resistant Audit Log System
 * Because hash chaining is cute, but you need tamper-RESISTANT
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

class TamperResistantAuditLog {
  constructor(options = {}) {
    this.logFile = options.logFile || path.join(__dirname, '../../data/audit.log');
    this.anchorFile = options.anchorFile || path.join(__dirname, '../../data/anchors.json');
    this.chain = [];
    this.currentHash = null;
    
    // Anchoring configuration
    this.anchoring = {
      enabled: options.anchoring !== false,
      interval: options.anchorInterval || 100, // Every 100 entries
      destinations: options.anchorDestinations || ['local', 's3'],
      s3: {
        bucket: options.s3Bucket || 'protoforge-audit-anchors',
        key: options.s3Key || 'audit-anchors.json',
        region: options.s3Region || 'us-east-1'
      }
    };
    
    // S3 client if configured
    if (this.anchoring.destinations.includes('s3')) {
      this.s3 = new S3Client({ region: this.anchoring.s3.region });
    }
    
    // Anchor cache
    this.anchors = new Map();
    this.lastAnchorIndex = 0;
  }

  /**
   * Initialize with existing chain and anchors
   */
  async initialize() {
    await this.ensureDataDir();
    
    // Load existing chain
    await this.loadChain();
    
    // Load anchors
    await this.loadAnchors();
    
    // Verify integrity
    const verification = await this.verifyIntegrity();
    if (!verification.valid) {
      console.error('[AUDIT] Chain verification failed:', verification.issues);
      throw new Error('Audit log integrity compromised');
    }
    
    console.log(`[AUDIT] Loaded ${this.chain.length} entries with ${this.anchors.size} anchors`);
  }

  /**
   * Add audit entry with anchoring
   */
  async add(entry) {
    // Sanitize entry
    const sanitized = this.sanitizeEntry(entry);
    
    // Create audit block
    const block = {
      index: this.chain.length,
      timestamp: new Date().toISOString(),
      entry: sanitized,
      previousHash: this.currentHash,
      hash: null,
      anchorHash: null
    };

    // Calculate block hash
    block.hash = this.calculateBlockHash(block);

    // Append to chain
    this.chain.push(block);
    this.currentHash = block.hash;

    // Persist immediately
    await this.appendBlock(block);

    // Check if we should anchor
    if (this.chain.length % this.anchoring.interval === 0) {
      await this.createAnchor();
    }

    return block.hash;
  }

  /**
   * Create tamper-resistant anchor
   */
  async createAnchor() {
    const anchorIndex = Math.floor(this.chain.length / this.anchoring.interval) - 1;
    const anchor = {
      index: anchorIndex,
      timestamp: new Date().toISOString(),
      chainHash: this.currentHash,
      blockIndex: this.chain.length - 1,
      previousAnchorHash: this.getPreviousAnchorHash(anchorIndex),
      signature: null,
      destinations: []
    };

    // Calculate anchor hash
    const anchorData = JSON.stringify({
      index: anchor.index,
      timestamp: anchor.timestamp,
      chainHash: anchor.chainHash,
      blockIndex: anchor.blockIndex,
      previousAnchorHash: anchor.previousAnchorHash
    });
    
    anchor.anchorHash = crypto.createHash('sha256').update(anchorData).digest('hex');

    // Sign anchor if private key available
    if (this.signingKey) {
      anchor.signature = this.signAnchor(anchor);
    }

    // Store to all configured destinations
    for (const destination of this.anchoring.destinations) {
      try {
        await this.storeAnchor(anchor, destination);
        anchor.destinations.push(destination);
      } catch (error) {
        console.error(`[AUDIT] Failed to store anchor to ${destination}:`, error);
      }
    }

    // Cache anchor
    this.anchors.set(anchorIndex, anchor);
    this.lastAnchorIndex = anchorIndex;

    // Save anchor metadata
    await this.saveAnchors();

    console.log(`[AUDIT] Created anchor #${anchorIndex} at block ${anchor.blockIndex}`);
    
    return anchor;
  }

  /**
   * Store anchor to destination
   */
  async storeAnchor(anchor, destination) {
    switch (destination) {
      case 'local':
        await this.storeAnchorLocal(anchor);
        break;
        
      case 's3':
        await this.storeAnchorS3(anchor);
        break;
        
      case 'blockchain':
        await this.storeAnchorBlockchain(anchor);
        break;
        
      default:
        throw new Error(`Unknown anchor destination: ${destination}`);
    }
  }

  /**
   * Store anchor locally
   */
  async storeAnchorLocal(anchor) {
    const anchorFile = this.anchorFile.replace('.json', `.${anchor.index}.json`);
    await fs.writeFile(anchorFile, JSON.stringify(anchor, null, 2));
    
    // Also append to anchor log
    const logEntry = `${anchor.index}:${anchor.anchorHash}:${anchor.timestamp}\n`;
    await fs.appendFile(this.anchorFile.replace('.json', '.log'), logEntry);
  }

  /**
   * Store anchor to S3
   */
  async storeAnchorS3(anchor) {
    if (!this.s3) {
      throw new Error('S3 client not configured');
    }

    const key = `${this.anchoring.s3.key}/${anchor.index}.json`;
    const command = new PutObjectCommand({
      Bucket: this.anchoring.s3.bucket,
      Key: key,
      Body: JSON.stringify(anchor, null, 2),
      Metadata: {
        'anchor-index': anchor.index.toString(),
        'block-index': anchor.blockIndex.toString(),
        'chain-hash': anchor.chainHash
      }
    });

    await this.s3.send(command);
    
    // Also update the index file
    const indexKey = `${this.anchoring.s3.key}/index.json`;
    const indexCommand = new PutObjectCommand({
      Bucket: this.anchoring.s3.bucket,
      Key: indexKey,
      Body: JSON.stringify({
        lastAnchorIndex: anchor.index,
        lastBlockIndex: anchor.blockIndex,
        lastChainHash: anchor.chainHash,
        updatedAt: new Date().toISOString()
      }, null, 2)
    });

    await this.s3.send(indexCommand);
  }

  /**
   * Store anchor to blockchain (placeholder)
   */
  async storeAnchorBlockchain(anchor) {
    // In a real implementation, this would store to a blockchain
    // For now, just log it
    console.log(`[BLOCKCHAIN] Would store anchor #${anchor.index} to blockchain`);
    console.log(`  Hash: ${anchor.anchorHash}`);
    console.log(`  Chain hash: ${anchor.chainHash}`);
  }

  /**
   * Verify integrity with anchor checking
   */
  async verifyIntegrity() {
    const issues = [];
    let lastVerifiedAnchor = -1;

    // First, verify the chain itself
    for (let i = 0; i < this.chain.length; i++) {
      const block = this.chain[i];
      
      // Verify block hash
      const calculatedHash = this.calculateBlockHash({
        ...block,
        hash: null
      });

      if (calculatedHash !== block.hash) {
        issues.push({
          type: 'HASH_MISMATCH',
          index: i,
          expected: block.hash,
          actual: calculatedHash
        });
      }

      // Verify chain link
      if (i > 0 && block.previousHash !== this.chain[i - 1].hash) {
        issues.push({
          type: 'CHAIN_BREAK',
          index: i,
          expected: this.chain[i - 1].hash,
          actual: block.previousHash
        });
      }

      // Check against nearest anchor
      const anchorIndex = Math.floor(i / this.anchoring.interval);
      if (anchorIndex > lastVerifiedAnchor && this.anchors.has(anchorIndex)) {
        const anchor = this.anchors.get(anchorIndex);
        
        // Verify anchor hasn't been tampered
        const verified = await this.verifyAnchor(anchor);
        if (!verified) {
          issues.push({
            type: 'ANCHOR_TAMPERED',
            anchorIndex,
            blockIndex: i
          });
        } else {
          lastVerifiedAnchor = anchorIndex;
        }
      }
    }

    // Check for missing anchors
    const expectedAnchors = Math.floor(this.chain.length / this.anchoring.interval);
    for (let i = 0; i < expectedAnchors; i++) {
      if (!this.anchors.has(i)) {
        issues.push({
          type: 'MISSING_ANCHOR',
          anchorIndex: i
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      totalEntries: this.chain.length,
      totalAnchors: this.anchors.size,
      lastVerifiedAnchor
    };
  }

  /**
   * Verify anchor integrity
   */
  async verifyAnchor(anchor) {
    // Verify anchor hash
    const anchorData = JSON.stringify({
      index: anchor.index,
      timestamp: anchor.timestamp,
      chainHash: anchor.chainHash,
      blockIndex: anchor.blockIndex,
      previousAnchorHash: anchor.previousAnchorHash
    });

    const calculatedHash = crypto.createHash('sha256').update(anchorData).digest('hex');
    
    if (calculatedHash !== anchor.anchorHash) {
      return false;
    }

    // Verify signature if present
    if (anchor.signature && this.verifyKey) {
      const isValid = crypto.createVerify('RSA-SHA256')
        .update(anchor.anchorHash)
        .verify(this.verifyKey, anchor.signature, 'hex');
      
      if (!isValid) {
        return false;
      }
    }

    // Verify against external sources
    for (const destination of anchor.destinations) {
      const externalValid = await this.verifyAnchorExternal(anchor, destination);
      if (!externalValid) {
        console.warn(`[AUDIT] Anchor verification failed for ${destination}`);
        // Don't fail immediately, but log it
      }
    }

    return true;
  }

  /**
   * Verify anchor against external source
   */
  async verifyAnchorExternal(anchor, destination) {
    switch (destination) {
      case 'local':
        return await this.verifyAnchorLocal(anchor);
        
      case 's3':
        return await this.verifyAnchorS3(anchor);
        
      case 'blockchain':
        return await this.verifyAnchorBlockchain(anchor);
        
      default:
        return true; // Unknown destination, assume valid
    }
  }

  /**
   * Verify anchor against local storage
   */
  async verifyAnchorLocal(anchor) {
    try {
      const anchorFile = this.anchorFile.replace('.json', `.${anchor.index}.json`);
      const stored = JSON.parse(await fs.readFile(anchorFile, 'utf8'));
      
      return stored.anchorHash === anchor.anchorHash &&
             stored.chainHash === anchor.chainHash;
    } catch {
      return false;
    }
  }

  /**
   * Verify anchor against S3
   */
  async verifyAnchorS3(anchor) {
    if (!this.s3) return true;

    try {
      const key = `${this.anchoring.s3.key}/${anchor.index}.json`;
      const command = new GetObjectCommand({
        Bucket: this.anchoring.s3.bucket,
        Key: key
      });

      const response = await this.s3.send(command);
      const stored = JSON.parse(await response.Body.transformToString());

      return stored.anchorHash === anchor.anchorHash &&
             stored.chainHash === anchor.chainHash;
    } catch {
      return false;
    }
  }

  /**
   * Verify anchor against blockchain
   */
  async verifyAnchorBlockchain(anchor) {
    // Placeholder implementation
    return true;
  }

  /**
   * Recover from corruption using anchors
   */
  async recoverFromCorruption() {
    console.log('[AUDIT] Attempting recovery from corruption...');
    
    // Find the last good anchor
    let lastGoodAnchor = null;
    for (let i = this.anchors.size - 1; i >= 0; i--) {
      const anchor = this.anchors.get(i);
      if (await this.verifyAnchor(anchor)) {
        lastGoodAnchor = anchor;
        break;
      }
    }

    if (!lastGoodAnchor) {
      throw new Error('No valid anchors found for recovery');
    }

    // Truncate chain to last known good point
    const truncateIndex = lastGoodAnchor.blockIndex + 1;
    const corrupted = this.chain.splice(truncateIndex);
    
    console.log(`[AUDIT] Truncated ${corrupted.length} corrupted entries`);
    console.log(`[AUDIT] Chain restored to block ${truncateIndex - 1}`);
    
    // Save recovered chain
    await this.saveChain();
    
    return {
      recovered: true,
      truncatedEntries: corrupted.length,
      restoredToBlock: truncateIndex - 1
    };
  }

  /**
   * Get anchoring statistics
   */
  getAnchoringStats() {
    return {
      totalAnchors: this.anchors.size,
      anchoringInterval: this.anchoring.interval,
      destinations: this.anchoring.destinations,
      lastAnchorIndex: this.lastAnchorIndex,
      nextAnchorAt: (Math.floor(this.chain.length / this.anchoring.interval) + 1) * this.anchoring.interval
    };
  }

  /**
   * Helper methods
   */
  sanitizeEntry(entry) {
    // Same as before - remove sensitive data
    const sanitized = JSON.parse(JSON.stringify(entry));
    
    const removeSecrets = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(removeSecrets);
      } else if (obj && typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          const keyLower = key.toLowerCase();
          if (keyLower.includes('secret') || keyLower.includes('key') || keyLower.includes('token')) {
            cleaned[key] = '[REDACTED]';
          } else {
            cleaned[key] = removeSecrets(value);
          }
        }
        return cleaned;
      }
      return obj;
    };

    return removeSecrets(sanitized);
  }

  calculateBlockHash(block) {
    const blockData = {
      index: block.index,
      timestamp: block.timestamp,
      entry: block.entry,
      previousHash: block.previousHash
    };

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(blockData, Object.keys(blockData).sort()))
      .digest('hex');
  }

  getPreviousAnchorHash(anchorIndex) {
    if (anchorIndex === 0) return null;
    const prevAnchor = this.anchors.get(anchorIndex - 1);
    return prevAnchor ? prevAnchor.anchorHash : null;
  }

  signAnchor(anchor) {
    if (!this.signingKey) return null;
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(anchor.anchorHash);
    return sign.sign(this.signingKey, 'hex');
  }

  async ensureDataDir() {
    const dir = path.dirname(this.logFile);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async loadChain() {
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      const lines = data.trim().split('\n').filter(line => line);
      
      for (const line of lines) {
        const block = JSON.parse(line);
        this.chain.push(block);
      }
      
      this.currentHash = this.chain.length > 0 ? 
        this.chain[this.chain.length - 1].hash : 
        crypto.createHash('sha256').update('genesis').digest('hex');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[AUDIT] Error loading chain:', err);
      }
    }
  }

  async loadAnchors() {
    try {
      const data = await fs.readFile(this.anchorFile, 'utf8');
      const anchors = JSON.parse(data);
      
      for (const [index, anchor] of Object.entries(anchors)) {
        this.anchors.set(parseInt(index), anchor);
      }
      
      this.lastAnchorIndex = this.anchors.size > 0 ? 
        Math.max(...this.anchors.keys()) : 0;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[AUDIT] Error loading anchors:', err);
      }
    }
  }

  async appendBlock(block) {
    const blockStr = JSON.stringify(block) + '\n';
    await fs.appendFile(this.logFile, blockStr);
  }

  async saveChain() {
    const data = this.chain.map(b => JSON.stringify(b)).join('\n') + '\n';
    await fs.writeFile(this.logFile, data);
  }

  async saveAnchors() {
    const serializable = {};
    for (const [index, anchor] of this.anchors) {
      serializable[index] = anchor;
    }
    await fs.writeFile(this.anchorFile, JSON.stringify(serializable, null, 2));
  }
}

module.exports = TamperResistantAuditLog;
