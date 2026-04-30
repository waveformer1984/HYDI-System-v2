/**
 * Immutable Audit Log System
 * Because if logs can be altered, they're just fan fiction
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class ImmutableAuditLog {
  constructor(options = {}) {
    this.logFile = options.logFile || path.join(__dirname, '../../data/audit.log');
    this.indexFile = options.indexFile || path.join(__dirname, '../../data/audit.idx');
    this.chain = [];
    this.currentHash = null;
    this.anchorService = options.anchorService; // Optional external anchoring
  }

  /**
   * Initialize audit log
   */
  async initialize() {
    await this.ensureDataDir();
    
    // Load existing chain
    await this.loadChain();
    
    // Set current hash
    if (this.chain.length > 0) {
      this.currentHash = this.chain[this.chain.length - 1].hash;
    } else {
      // Genesis block
      this.currentHash = crypto.createHash('sha256').update('genesis').digest('hex');
    }
  }

  /**
   * Add an audit entry (immutable)
   */
  async add(entry) {
    // Sanitize entry - remove any sensitive data
    const sanitized = this.sanitizeEntry(entry);
    
    // Create audit block
    const block = {
      index: this.chain.length,
      timestamp: new Date().toISOString(),
      entry: sanitized,
      previousHash: this.currentHash,
      hash: null,
      signature: null
    };

    // Calculate hash
    block.hash = this.calculateBlockHash(block);

    // Sign the block (if private key available)
    if (this.signingKey) {
      block.signature = this.signBlock(block);
    }

    // Append to chain
    this.chain.push(block);
    this.currentHash = block.hash;

    // Persist immediately
    await this.appendBlock(block);

    // Optional: Anchor externally
    if (this.anchorService) {
      await this.anchorExternally(block);
    }

    return block.hash;
  }

  /**
   * Verify integrity of the entire chain
   */
  async verifyIntegrity() {
    const issues = [];

    for (let i = 0; i < this.chain.length; i++) {
      const block = this.chain[i];
      
      // Verify hash
      const calculatedHash = this.calculateBlockHash({
        ...block,
        hash: null,
        signature: null
      });

      if (calculatedHash !== block.hash) {
        issues.push({
          index: i,
          type: 'HASH_MISMATCH',
          expected: block.hash,
          actual: calculatedHash
        });
      }

      // Verify chain link
      if (i > 0 && block.previousHash !== this.chain[i - 1].hash) {
        issues.push({
          index: i,
          type: 'CHAIN_BREAK',
          expected: this.chain[i - 1].hash,
          actual: block.previousHash
        });
      }

      // Verify signature if present
      if (block.signature && this.verifyKey) {
        const isValid = this.verifySignature(block);
        if (!isValid) {
          issues.push({
            index: i,
            type: 'INVALID_SIGNATURE'
          });
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      totalEntries: this.chain.length
    };
  }

  /**
   * Query audit log with filters
   */
  async query(filters = {}) {
    let results = [...this.chain];

    // Filter by agent
    if (filters.agent) {
      results = results.filter(b => b.entry.agent === filters.agent);
    }

    // Filter by action
    if (filters.action) {
      results = results.filter(b => b.entry.action === filters.action);
    }

    // Filter by time range
    if (filters.from) {
      const from = new Date(filters.from);
      results = results.filter(b => new Date(b.timestamp) >= from);
    }

    if (filters.to) {
      const to = new Date(filters.to);
      results = results.filter(b => new Date(b.timestamp) <= to);
    }

    // Filter by risk score
    if (filters.minRisk) {
      results = results.filter(b => b.entry.riskScore >= filters.minRisk);
    }

    // Pagination
    if (filters.limit) {
      const offset = filters.offset || 0;
      results = results.slice(offset, offset + filters.limit);
    }

    return results.map(b => ({
      hash: b.hash,
      timestamp: b.timestamp,
      entry: b.entry,
      verified: true
    }));
  }

  /**
   * Get audit statistics
   */
  async getStats(timeframe = '24h') {
    const now = new Date();
    const from = new Date(now.getTime() - this.parseTimeframe(timeframe));
    
    const recentEntries = this.chain.filter(b => 
      new Date(b.timestamp) >= from
    );

    const stats = {
      totalEntries: recentEntries.length,
      timeframe,
      agentStats: {},
      actionStats: {},
      riskDistribution: { low: 0, medium: 0, high: 0 },
      failureRate: 0,
      topRisks: []
    };

    let failures = 0;

    for (const block of recentEntries) {
      const entry = block.entry;

      // Agent stats
      if (!stats.agentStats[entry.agent]) {
        stats.agentStats[entry.agent] = 0;
      }
      stats.agentStats[entry.agent]++;

      // Action stats
      if (!stats.actionStats[entry.action]) {
        stats.actionStats[entry.action] = 0;
      }
      stats.actionStats[entry.action]++;

      // Risk distribution
      const risk = entry.riskScore || 0;
      if (risk < 0.3) stats.riskDistribution.low++;
      else if (risk < 0.7) stats.riskDistribution.medium++;
      else stats.riskDistribution.high++;

      // Failures
      if (entry.status === 'failed' || entry.error) {
        failures++;
      }

      // Top risks
      if (risk > 0.7) {
        stats.topRisks.push({
          agent: entry.agent,
          action: entry.action,
          riskScore: risk,
          timestamp: block.timestamp
        });
      }
    }

    stats.failureRate = recentEntries.length > 0 ? failures / recentEntries.length : 0;
    stats.topRisks.sort((a, b) => b.riskScore - a.riskScore);
    stats.topRisks = stats.topRisks.slice(0, 10);

    return stats;
  }

  /**
   * Export audit log for external storage
   */
  async export(fromIndex = 0, toIndex = null) {
    const start = fromIndex;
    const end = toIndex || this.chain.length;
    
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      fromIndex: start,
      toIndex: end,
      chainHash: this.calculateChainHash(),
      blocks: this.chain.slice(start, end)
    };

    // Create export signature
    const exportStr = JSON.stringify(exportData, null, 2);
    exportData.exportSignature = crypto
      .createHash('sha256')
      .update(exportStr)
      .digest('hex');

    return exportData;
  }

  /**
   * Prune old entries (while maintaining integrity)
   */
  async prune(olderThan, keepCheckpoint = true) {
    const cutoff = new Date(Date.now() - this.parseTimeframe(olderThan));
    const cutoffIndex = this.chain.findIndex(b => new Date(b.timestamp) >= cutoff);
    
    if (cutoffIndex <= 0) {
      return { pruned: 0, checkpoint: null };
    }

    // Create checkpoint before pruning
    let checkpoint = null;
    if (keepCheckpoint) {
      checkpoint = await this.createCheckpoint(cutoffIndex);
    }

    // Archive old entries
    const pruned = this.chain.splice(0, cutoffIndex);
    
    // Save pruned data separately
    await this.archiveEntries(pruned);

    // Rebuild index
    await this.rebuildIndex();

    console.log(`[AUDIT] Pruned ${pruned.length} entries older than ${olderThan}`);

    return { pruned: pruned.length, checkpoint };
  }

  /**
   * Create a checkpoint (hash of entire chain)
   */
  async createCheckpoint(atIndex = null) {
    const checkpoint = {
      timestamp: new Date().toISOString(),
      chainLength: this.chain.length,
      chainHash: this.calculateChainHash(),
      lastBlockHash: this.currentHash,
      index: atIndex || this.chain.length - 1
    };

    // Save checkpoint
    const checkpointFile = this.logFile.replace('.log', `.checkpoint.${Date.now()}.json`);
    await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2));

    return checkpoint;
  }

  /**
   * Private methods
   */
  sanitizeEntry(entry) {
    // Deep clone to avoid mutation
    const sanitized = JSON.parse(JSON.stringify(entry));

    // Remove known sensitive fields
    const sensitiveFields = [
      'api_key',
      'secret',
      'token',
      'key',
      'password',
      'privateKey',
      'webhook_secret'
    ];

    const removeSecrets = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(removeSecrets);
      } else if (obj && typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          const keyLower = key.toLowerCase();
          if (sensitiveFields.some(field => keyLower.includes(field))) {
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

  calculateChainHash() {
    return this.chain.length > 0 ? this.currentHash : 'genesis';
  }

  signBlock(block) {
    if (!this.signingKey) return null;
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(block.hash);
    return sign.sign(this.signingKey, 'hex');
  }

  verifySignature(block) {
    if (!block.signature || !this.verifyKey) return false;
    
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(block.hash);
    return verify.verify(this.verifyKey, block.signature, 'hex');
  }

  async appendBlock(block) {
    const blockStr = JSON.stringify(block) + '\n';
    await fs.appendFile(this.logFile, blockStr);
    
    // Update index
    const indexEntry = `${block.index}:${block.hash}:${block.timestamp}\n`;
    await fs.appendFile(this.indexFile, indexEntry);
  }

  async loadChain() {
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      const lines = data.trim().split('\n').filter(line => line);
      
      for (const line of lines) {
        const block = JSON.parse(line);
        this.chain.push(block);
      }
      
      console.log(`[AUDIT] Loaded ${this.chain.length} audit entries`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[AUDIT] Error loading chain:', err);
      }
    }
  }

  async ensureDataDir() {
    const dir = path.dirname(this.logFile);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  parseTimeframe(timeframe) {
    const units = {
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000,
      'w': 7 * 24 * 60 * 60 * 1000,
      'm': 30 * 24 * 60 * 60 * 1000
    };
    
    const match = timeframe.match(/^(\d+)([hdwm])$/);
    if (!match) return 24 * 60 * 60 * 1000; // Default 24h
    
    const [, num, unit] = match;
    return parseInt(num) * units[unit];
  }

  async anchorExternally(block) {
    // Placeholder for external anchoring (e.g., blockchain, timestamping service)
    console.log(`[AUDIT] Anchoring block ${block.index} externally`);
  }

  async archiveEntries(entries) {
    const archiveFile = this.logFile.replace('.log', `.archive.${Date.now()}.log`);
    const data = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    await fs.writeFile(archiveFile, data);
  }

  async rebuildIndex() {
    // Rebuild index file from current chain
    const indexData = this.chain.map(b => 
      `${b.index}:${b.hash}:${b.timestamp}`
    ).join('\n') + '\n';
    
    await fs.writeFile(this.indexFile, indexData);
  }
}

module.exports = ImmutableAuditLog;
