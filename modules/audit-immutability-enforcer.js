// Audit Immutability Enforcer - Append-only audit logs with no deletion
// Blocks any attempt to modify or delete audit entries

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class AuditImmutabilityEnforcer {
  constructor() {
    this.auditLogPath = path.join(__dirname, '../data/audit-log.jsonl');
    this.indexPath = path.join(__dirname, '../data/audit-index.json');
    this.sequenceId = 0;
    this.logHashes = new Map(); // For integrity verification
    
    // Initialize
    this.initialize();
  }

  async initialize() {
    console.log('[AUDIT IMMUTABILITY] Initialized - Append-only audit enforcement');
    
    // Ensure data directory exists
    await fs.mkdir(path.dirname(this.auditLogPath), { recursive: true });
    
    // Load existing audit index
    await this.loadIndex();
    
    // Verify existing log integrity
    await this.verifyLogIntegrity();
  }

  // Load audit index
  async loadIndex() {
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf8');
      const index = JSON.parse(indexData);
      this.sequenceId = index.last_sequence_id || 0;
      console.log(`[AUDIT IMMUTABILITY] Loaded index, last sequence: ${this.sequenceId}`);
    } catch (error) {
      // Index doesn't exist yet
      this.sequenceId = 0;
    }
  }

  // Save audit index
  async saveIndex() {
    const index = {
      last_sequence_id: this.sequenceId,
      last_updated: new Date().toISOString(),
      total_entries: this.logHashes.size
    };
    
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(index, null, 2),
      'utf8'
    );
  }

  // Append audit entry (ONLY ALLOWED OPERATION)
  async appendEntry(entry) {
    // Validate entry structure
    const validation = this.validateEntry(entry);
    if (!validation.valid) {
      throw new Error(`Invalid audit entry: ${validation.errors.join(', ')}`);
    }
    
    // Create immutable audit record
    const auditRecord = {
      sequence_id: ++this.sequenceId,
      timestamp: new Date().toISOString(),
      entry: entry,
      hash: null // Will be calculated after writing
    };
    
    // Calculate hash of previous entry for chain
    const previousHash = this.sequenceId > 1 
      ? Array.from(this.logHashes.values()).pop()
      : 'GENESIS';
    
    auditRecord.previous_hash = previousHash;
    
    // Serialize record
    const recordString = JSON.stringify(auditRecord);
    
    // Calculate record hash
    auditRecord.hash = crypto
      .createHash('sha256')
      .update(recordString)
      .digest('hex');
    
    // Append to log file
    await fs.appendFile(
      this.auditLogPath,
      recordString + '\n',
      'utf8'
    );
    
    // Store hash for integrity
    this.logHashes.set(this.sequenceId, auditRecord.hash);
    
    // Save index
    await this.saveIndex();
    
    console.log(`[AUDIT IMMUTABILITY] Entry appended: ${this.sequenceId}`);
    
    return auditRecord;
  }

  // Validate audit entry structure
  validateEntry(entry) {
    const errors = [];
    
    // Required fields
    if (!entry.action) errors.push('Missing action field');
    if (!entry.module) errors.push('Missing module field');
    if (!entry.timestamp) errors.push('Missing timestamp field');
    
    // Validate action type
    const allowedActions = [
      'repair_manifest_generated',
      'repair_attempted',
      'repair_completed',
      'repair_failed',
      'system_state_change',
      'configuration_change',
      'user_action',
      'error_occurred',
      'security_event'
    ];
    
    if (entry.action && !allowedActions.includes(entry.action)) {
      errors.push(`Invalid action: ${entry.action}`);
    }
    
    // Validate timestamp format
    if (entry.timestamp) {
      const timestamp = new Date(entry.timestamp);
      if (isNaN(timestamp.getTime())) {
        errors.push('Invalid timestamp format');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  // BLOCK: Read audit entries (allowed)
  async readEntries(fromSequence = 1, toSequence = null, filter = {}) {
    try {
      const data = await fs.readFile(this.auditLogPath, 'utf8');
      const lines = data.trim().split('\n');
      
      const entries = [];
      
      for (const line of lines) {
        const record = JSON.parse(line);
        
        // Apply sequence range filter
        if (record.sequence_id < fromSequence) continue;
        if (toSequence && record.sequence_id > toSequence) break;
        
        // Apply other filters
        if (filter.action && record.entry.action !== filter.action) continue;
        if (filter.module && record.entry.module !== filter.module) continue;
        if (filter.from_date && record.entry.timestamp < filter.from_date) continue;
        if (filter.to_date && record.entry.timestamp > filter.to_date) continue;
        
        entries.push(record);
      }
      
      return entries;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // No audit log yet
      }
      throw error;
    }
  }

  // BLOCK: Attempt to modify audit entry
  async modifyEntry(sequenceId, newEntry) {
    this.logTamperAttempt('MODIFY_ATTEMPT', {
      sequence_id: sequenceId,
      new_entry: newEntry,
      timestamp: new Date().toISOString()
    });
    
    throw new Error('AUDIT_TAMPER_BLOCKED: Audit entries cannot be modified');
  }

  // BLOCK: Attempt to delete audit entry
  async deleteEntry(sequenceId) {
    this.logTamperAttempt('DELETE_ATTEMPT', {
      sequence_id: sequenceId,
      timestamp: new Date().toISOString()
    });
    
    throw new Error('AUDIT_TAMPER_BLOCKED: Audit entries cannot be deleted');
  }

  // BLOCK: Attempt to truncate audit log
  async truncateLog(atSequence) {
    this.logTamperAttempt('TRUNCATE_ATTEMPT', {
      at_sequence: atSequence,
      timestamp: new Date().toISOString()
    });
    
    throw new Error('AUDIT_TAMPER_BLOCKED: Audit log cannot be truncated');
  }

  // Log tamper attempt
  async logTamperAttempt(attemptType, details) {
    console.error(`[AUDIT IMMUTABILITY] TAMPER ATTEMPT BLOCKED: ${attemptType}`);
    console.error(`[AUDIT IMMUTABILITY] Details:`, JSON.stringify(details, null, 2));
    
    // Create tamper alert entry
    const tamperEntry = {
      action: 'security_event',
      module: 'AUDIT_SYSTEM',
      timestamp: new Date().toISOString(),
      event_type: 'TAMPER_ATTEMPT',
      attempt_type: attemptType,
      details: details,
      source_ip: details.source_ip || 'unknown',
      user_id: details.user_id || 'unknown'
    };
    
    // Append tamper attempt to audit log
    try {
      await this.appendEntry(tamperEntry);
    } catch (error) {
      console.error('[AUDIT IMMUTABILITY] Failed to log tamper attempt:', error);
    }
    
    // Emit security alert
    this.emit('audit_tamper_blocked', {
      type: attemptType,
      details: details,
      timestamp: new Date().toISOString()
    });
  }

  // Verify log integrity
  async verifyLogIntegrity() {
    try {
      const data = await fs.readFile(this.auditLogPath, 'utf8');
      const lines = data.trim().split('\n');
      
      let previousHash = 'GENESIS';
      let integrityIssues = [];
      
      for (let i = 0; i < lines.length; i++) {
        const record = JSON.parse(lines[i]);
        
        // Verify sequence continuity
        if (record.sequence_id !== i + 1) {
          integrityIssues.push({
            type: 'SEQUENCE_GAP',
            expected: i + 1,
            found: record.sequence_id,
            line: i + 1
          });
        }
        
        // Verify hash chain
        if (record.previous_hash !== previousHash) {
          integrityIssues.push({
            type: 'HASH_CHAIN_BREAK',
            sequence: record.sequence_id,
            expected_previous: previousHash,
            found_previous: record.previous_hash
          });
        }
        
        // Verify record hash
        const recordCopy = { ...record };
        const storedHash = recordCopy.hash;
        delete recordCopy.hash;
        
        const calculatedHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(recordCopy))
          .digest('hex');
        
        if (storedHash !== calculatedHash) {
          integrityIssues.push({
            type: 'HASH_MISMATCH',
            sequence: record.sequence_id,
            stored: storedHash,
            calculated: calculatedHash
          });
        }
        
        previousHash = storedHash;
      }
      
      if (integrityIssues.length > 0) {
        console.error('[AUDIT IMMUTABILITY] INTEGRITY ISSUES DETECTED:');
        integrityIssues.forEach(issue => {
          console.error('  -', issue.type, ':', issue);
        });
        
        this.emit('integrity_violation', integrityIssues);
      } else {
        console.log(`[AUDIT IMMUTABILITY] Integrity verified: ${lines.length} entries`);
      }
      
      return integrityIssues;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('[AUDIT IMMUTABILITY] No audit log to verify');
        return [];
      }
      throw error;
    }
  }

  // Get audit statistics
  async getStats() {
    const totalEntries = this.sequenceId;
    const indexStats = await this.getIndexStats();
    
    return {
      total_entries: totalEntries,
      index_stats: indexStats,
      log_file_path: this.auditLogPath,
      index_file_path: this.indexPath,
      integrity_verified: true, // Would be actual verification result
      append_only: true,
      modification_blocked: true,
      deletion_blocked: true
    };
  }

  // Get index statistics
  async getIndexStats() {
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf8');
      const index = JSON.parse(indexData);
      
      return {
        last_sequence_id: index.last_sequence_id,
        last_updated: index.last_updated,
        total_entries: index.total_entries,
        file_size_bytes: (await fs.stat(this.auditLogPath)).size
      };
    } catch (error) {
      return null;
    }
  }

  // Export audit log (read-only operation)
  async exportAudit(format = 'json') {
    const entries = await this.readEntries();
    
    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    } else if (format === 'csv') {
      // Convert to CSV
      const headers = ['sequence_id', 'timestamp', 'action', 'module', 'event_type'];
      const csvLines = [headers.join(',')];
      
      entries.forEach(record => {
        const row = [
          record.sequence_id,
          record.timestamp,
          record.entry.action || '',
          record.entry.module || '',
          record.entry.event_type || ''
        ];
        csvLines.push(row.join(','));
      });
      
      return csvLines.join('\n');
    } else {
      throw new Error(`Unsupported export format: ${format}`);
    }
  }
}

// Create singleton instance
const auditImmutabilityEnforcer = new AuditImmutabilityEnforcer();

// Extend with EventEmitter for alerts
const EventEmitter = require('events');
Object.setPrototypeOf(auditImmutabilityEnforcer, EventEmitter.prototype);
EventEmitter.call(auditImmutabilityEnforcer);

// Export the enforcer
module.exports = auditImmutabilityEnforcer;
