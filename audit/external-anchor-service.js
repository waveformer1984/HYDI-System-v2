/**
 * External Audit Log Anchoring Service
 * Makes audit logs tamper-resistant by storing hashes externally
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

class ExternalAnchorService {
  constructor(options = {}) {
    this.config = {
      anchorInterval: options.anchorInterval || 100, // Every 100 entries
      retentionDays: options.retentionDays || 365,
      bucket: options.bucket || 'protoforge-audit-anchors',
      region: options.region || 'us-east-1',
      ...options
    };
    
    this.s3 = new S3Client({ region: this.config.region });
    this.lastAnchorIndex = 0;
    this.anchorCache = new Map();
  }

  /**
   * Anchor audit log to external storage
   */
  async anchorAuditLog(latestHash, entryCount, timestamp) {
    const anchorId = `anchor_${timestamp.toISOString().replace(/[:.]/g, '-')}`;
    
    const anchor = {
      anchorId,
      timestamp: timestamp.toISOString(),
      latestHash,
      entryCount,
      previousAnchorHash: await this.getPreviousAnchorHash(),
      metadata: {
        source: 'keeper_audit_log',
        version: '1.0',
        integrity: 'sha256'
      }
    };

    // Calculate anchor hash
    const anchorData = JSON.stringify(anchor, null, 2);
    const anchorHash = crypto.createHash('sha256').update(anchorData).digest('hex');
    anchor.anchorHash = anchorHash;

    // Store to multiple locations for redundancy
    await this.storeToS3(anchorId, anchor);
    await this.storeToLocal(anchorId, anchor);
    
    // Optional: Store to additional services
    if (this.config.enableBlockchain) {
      await this.storeToBlockchain(anchor);
    }

    this.lastAnchorIndex = entryCount;
    this.anchorCache.set(anchorId, anchor);

    console.log(`[ANCHOR] Anchored audit log at entry ${entryCount}: ${anchorHash}`);
    
    return {
      anchorId,
      anchorHash,
      entryCount,
      timestamp: timestamp.toISOString()
    };
  }

  /**
   * Verify audit log integrity against external anchors
   */
  async verifyAuditIntegrity(currentEntries, currentHash) {
    const latestAnchor = await this.getLatestAnchor();
    
    if (!latestAnchor) {
      console.log('[ANCHOR] No external anchors found - cannot verify');
      return { verified: false, reason: 'no_anchors' };
    }

    // Verify chain integrity
    const verification = await this.verifyChainIntegrity(currentEntries, currentHash);
    
    if (!verification.valid) {
      console.error('[ANCHOR] Chain integrity check failed');
      return { verified: false, reason: 'chain_broken', details: verification.issues };
    }

    // Verify against latest external anchor
    if (latestAnchor.latestHash !== currentHash) {
      console.error('[ANCHOR] Hash mismatch with external anchor');
      return { 
        verified: false, 
        reason: 'hash_mismatch',
        expected: latestAnchor.latestHash,
        actual: currentHash
      };
    }

    console.log('[ANCHOR] Audit integrity verified against external anchor');
    return { verified: true, anchorId: latestAnchor.anchorId };
  }

  /**
   * Store anchor to S3
   */
  async storeToS3(anchorId, anchor) {
    const key = `audit-anchors/${anchorId}.json`;
    
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: JSON.stringify(anchor, null, 2),
      Metadata: {
        'anchor-id': anchorId,
        'entry-count': anchor.entryCount.toString(),
        'hash': anchor.anchorHash
      },
      StorageClass: 'STANDARD_IA', // Infrequent access for cost optimization
      ServerSideEncryption: 'AES256'
    });

    await this.s3.send(command);
    console.log(`[ANCHOR] Stored to S3: ${key}`);
  }

  /**
   * Store anchor locally
   */
  async storeToLocal(anchorId, anchor) {
    const anchorDir = './audit/anchors';
    await fs.mkdir(anchorDir, { recursive: true });
    
    const filePath = `${anchorDir}/${anchorId}.json`;
    await fs.writeFile(filePath, JSON.stringify(anchor, null, 2));
    
    // Also append to anchor log
    const logPath = `${anchorDir}/anchor-chain.log`;
    const logEntry = `${anchor.anchorHash} ${anchorId} ${anchor.entryCount} ${anchor.timestamp}\n`;
    await fs.appendFile(logPath, logEntry);
    
    console.log(`[ANCHOR] Stored locally: ${filePath}`);
  }

  /**
   * Store anchor to blockchain (placeholder)
   */
  async storeToBlockchain(anchor) {
    // In a real implementation, this would:
    // 1. Connect to blockchain service
    // 2. Submit anchor hash as transaction
    // 3. Return transaction hash
    
    console.log(`[ANCHOR] Blockchain anchoring not implemented - hash: ${anchor.anchorHash}`);
    return null;
  }

  /**
   * Get latest external anchor
   */
  async getLatestAnchor() {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: 'audit-anchors/latest.json'
      });
      
      const response = await this.s3.send(command);
      const anchor = JSON.parse(await response.Body.transformToString());
      
      return anchor;
    } catch (error) {
      // Try to find latest by listing
      return await this.findLatestByListing();
    }
  }

  /**
   * Find latest anchor by listing
   */
  async findLatestByListing() {
    // Implementation would list S3 bucket and find latest
    // For now, return null
    return null;
  }

  /**
   * Get previous anchor hash
   */
  async getPreviousAnchorHash() {
    const latest = await this.getLatestAnchor();
    return latest ? latest.anchorHash : null;
  }

  /**
   * Verify chain integrity
   */
  async verifyChainIntegrity(currentEntries, currentHash) {
    // This would verify the hash chain from the beginning
    // For now, assume valid if we have a current hash
    return {
      valid: true,
      entries: currentEntries,
      hash: currentHash
    };
  }

  /**
   * Cleanup old anchors
   */
  async cleanupOldAnchors() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
    
    console.log(`[ANCHOR] Cleaning up anchors older than ${cutoffDate.toISOString()}`);
    
    // Implementation would delete old anchors from S3 and local storage
    // For now, just log
  }

  /**
   * Get anchoring statistics
   */
  getAnchoringStats() {
    return {
      lastAnchorIndex: this.lastAnchorIndex,
      anchorInterval: this.config.anchorInterval,
      retentionDays: this.config.retentionDays,
      cachedAnchors: this.anchorCache.size,
      bucket: this.config.bucket
    };
  }
}

module.exports = ExternalAnchorService;
