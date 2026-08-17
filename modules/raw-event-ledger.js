// @deprecated Legacy file-based RAW EVENT LEDGER. Use lib/protoforge/raw-ledger.ts or protoforge/hydi-gateway/src/adapters/raw-ledger.js.
// Replacement: protoforge/hydi-gateway/ (canonical) or compatibility/raw-ledger-legacy.js
// Migration: Write through the HYDI Event Gateway POST /events. Removal target: Phase 5.
//
// RAW EVENT LEDGER - Immutable source-of-truth stream
// Stores ALL incoming events BEFORE any processing, validation, or classification
// This is the system's truth anchor - NOTHING modifies it

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class RawEventLedger extends EventEmitter {
  constructor() {
    super();
    
    // Ledger configuration
    this.ledgerPath = path.join(__dirname, '../data/raw-event-ledger.jsonl');
    this.indexPath = path.join(__dirname, '../data/raw-event-index.json');
    this.sequenceId = 0;
    
    // In-memory buffer for performance
    this.writeBuffer = [];
    this.bufferSize = 100;
    this.flushInterval = 5000; // 5 seconds
    
    // Integrity tracking
    this.ledgerHashes = new Map();
    this.lastFlushTime = null;
    
    // Statistics
    this.stats = {
      totalEvents: 0,
      eventsBySource: {},
      eventsByType: {},
      writeOperations: 0,
      flushOperations: 0,
      integrityChecks: 0
    };
    
    // Initialize
    this.initialize();
  }

  async initialize() {
    console.log('[RAW EVENT LEDGER] Initializing immutable truth source...');
    
    // Ensure data directory exists
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    
    // Load existing index
    await this.loadIndex();
    
    // Verify ledger integrity
    await this.verifyLedgerIntegrity();
    
    // Start periodic flush
    this.startPeriodicFlush();
    
    console.log(`[RAW EVENT LEDGER] Initialized - Last sequence: ${this.sequenceId}`);
    console.log('[RAW EVENT LEDGER] This is the TRUTH ANCHOR - No modifications allowed');
  }

  // Append raw event (ONLY ALLOWED OPERATION)
  async appendRawEvent(rawEvent, sourceMetadata = {}) {
    // Create immutable raw record
    const rawRecord = {
      sequence_id: ++this.sequenceId,
      received_at: new Date().toISOString(),
      raw_event: this.deepClone(rawEvent), // Store EXACTLY as received
      source_metadata: {
        source: sourceMetadata.source || 'unknown',
        ip_address: sourceMetadata.ipAddress,
        user_agent: sourceMetadata.userAgent,
        headers: sourceMetadata.headers || {},
        timestamp: sourceMetadata.timestamp || new Date().toISOString()
      },
      // NO processing, NO validation, NO classification
      // Just raw truth
      integrity: {
        event_hash: null,
        previous_hash: this.sequenceId > 1 ? Array.from(this.ledgerHashes.values()).pop() : 'GENESIS'
      }
    };
    
    // Calculate hash of the raw event (not the whole record)
    rawRecord.integrity.event_hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(rawEvent))
      .digest('hex');
    
    // Add to buffer
    this.writeBuffer.push(rawRecord);
    
    // Update statistics
    this.updateStats(rawEvent, sourceMetadata);
    
    // Emit event for downstream processing
    this.emit('raw_event_appended', {
      sequence_id: rawRecord.sequence_id,
      received_at: rawRecord.received_at,
      source: rawRecord.source_metadata.source,
      event_hash: rawRecord.integrity.event_hash
    });
    
    // Flush if buffer is full
    if (this.writeBuffer.length >= this.bufferSize) {
      await this.flushBuffer();
    }
    
    console.log(`[RAW EVENT LEDGER] Raw event appended: ${rawRecord.sequence_id}`);
    
    return rawRecord;
  }

  // Flush buffer to disk
  async flushBuffer() {
    if (this.writeBuffer.length === 0) return;
    
    const recordsToWrite = [...this.writeBuffer];
    this.writeBuffer = [];
    
    try {
      // Append all records to ledger file
      for (const record of recordsToWrite) {
        // Calculate full record hash
        const recordForHash = { ...record };
        recordForHash.integrity.full_hash = null;
        
        record.integrity.full_hash = crypto
          .createHash('sha256')
          .update(JSON.stringify(recordForHash))
          .digest('hex');
        
        // Write to ledger
        const line = JSON.stringify(record) + '\n';
        await fs.appendFile(this.ledgerPath, line, 'utf8');
        
        // Track hash for integrity
        this.ledgerHashes.set(record.sequence_id, record.integrity.full_hash);
      }
      
      // Update index
      await this.saveIndex();
      
      this.lastFlushTime = new Date().toISOString();
      this.stats.flushOperations++;
      
      console.log(`[RAW EVENT LEDGER] Flushed ${recordsToWrite.length} records to disk`);
      
    } catch (error) {
      console.error('[RAW EVENT LEDGER] Failed to flush buffer:', error);
      // Put records back in buffer
      this.writeBuffer.unshift(...recordsToWrite);
      throw error;
    }
  }

  // BLOCK: Any attempt to modify ledger
  async modifyRecord(sequenceId, newEvent) {
    console.error(`[RAW EVENT LEDGER] TAMPER ATTEMPT BLOCKED: Modify sequence ${sequenceId}`);
    console.error('[RAW EVENT LEDGER] RAW LEDGER IS IMMUTABLE - No modifications allowed');
    
    // Log tamper attempt
    this.emit('ledger_tamper_attempted', {
      type: 'MODIFY_ATTEMPT',
      sequence_id: sequenceId,
      timestamp: new Date().toISOString()
    });
    
    throw new Error('LEDGER_TAMPER_BLOCKED: Raw event ledger cannot be modified');
  }

  // BLOCK: Any attempt to delete from ledger
  async deleteRecord(sequenceId) {
    console.error(`[RAW EVENT LEDGER] TAMPER ATTEMPT BLOCKED: Delete sequence ${sequenceId}`);
    console.error('[RAW EVENT LEDGER] RAW LEDGER IS IMMUTABLE - No deletions allowed');
    
    this.emit('ledger_tamper_attempted', {
      type: 'DELETE_ATTEMPT',
      sequence_id: sequenceId,
      timestamp: new Date().toISOString()
    });
    
    throw new Error('LEDGER_TAMPER_BLOCKED: Raw event ledger cannot be deleted');
  }

  // Read raw events (ALLOWED - read-only)
  async readRawEvents(fromSequence = 1, toSequence = null, filter = {}) {
    try {
      const data = await fs.readFile(this.ledgerPath, 'utf8');
      const lines = data.trim().split('\n');
      
      const events = [];
      
      for (const line of lines) {
        if (!line) continue;
        
        const record = JSON.parse(line);
        
        // Apply sequence range
        if (record.sequence_id < fromSequence) continue;
        if (toSequence && record.sequence_id > toSequence) break;
        
        // Apply filters
        if (filter.source && record.source_metadata.source !== filter.source) continue;
        if (filter.from_date && record.received_at < filter.from_date) continue;
        if (filter.to_date && record.received_at > filter.to_date) continue;
        
        events.push(record);
      }
      
      return events;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // No ledger yet
      }
      throw error;
    }
  }

  // Get single raw event by sequence
  async getRawEvent(sequenceId) {
    const events = await this.readRawEvents(sequenceId, sequenceId);
    return events[0] || null;
  }

  // Load ledger index
  async loadIndex() {
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf8');
      const index = JSON.parse(indexData);
      this.sequenceId = index.last_sequence_id || 0;
      this.stats = index.stats || this.stats;
    } catch (error) {
      // Index doesn't exist yet
      this.sequenceId = 0;
    }
  }

  // Save ledger index
  async saveIndex() {
    const index = {
      last_sequence_id: this.sequenceId,
      last_updated: new Date().toISOString(),
      total_events: this.stats.totalEvents,
      stats: this.stats,
      ledger_path: this.ledgerPath,
      integrity: 'IMMUTABLE'
    };
    
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(index, null, 2),
      'utf8'
    );
  }

  // Verify ledger integrity
  async verifyLedgerIntegrity() {
    try {
      const data = await fs.readFile(this.ledgerPath, 'utf8');
      const lines = data.trim().split('\n');
      
      let previousHash = 'GENESIS';
      let integrityIssues = [];
      
      for (let i = 0; i < lines.length; i++) {
        const record = JSON.parse(lines[i]);
        
        // Verify sequence
        if (record.sequence_id !== i + 1) {
          integrityIssues.push({
            type: 'SEQUENCE_MISMATCH',
            expected: i + 1,
            found: record.sequence_id
          });
        }
        
        // Verify hash chain
        if (record.integrity.previous_hash !== previousHash) {
          integrityIssues.push({
            type: 'HASH_CHAIN_BREAK',
            sequence: record.sequence_id,
            expected: previousHash,
            found: record.integrity.previous_hash
          });
        }
        
        previousHash = record.integrity.full_hash;
      }
      
      this.stats.integrityChecks++;
      
      if (integrityIssues.length > 0) {
        console.error('[RAW EVENT LEDGER] INTEGRITY ISSUES:', integrityIssues);
        this.emit('ledger_integrity_violation', integrityIssues);
      } else {
        console.log(`[RAW EVENT LEDGER] Integrity verified: ${lines.length} events`);
      }
      
      return integrityIssues;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('[RAW EVENT LEDGER] No ledger to verify');
        return [];
      }
      throw error;
    }
  }

  // Update statistics
  updateStats(rawEvent, sourceMetadata) {
    this.stats.totalEvents++;
    
    // Track by source
    const source = sourceMetadata.source || 'unknown';
    this.stats.eventsBySource[source] = (this.stats.eventsBySource[source] || 0) + 1;
    
    // Track by type
    const type = rawEvent.type || 'unknown';
    this.stats.eventsByType[type] = (this.stats.eventsByType[type] || 0) + 1;
    
    this.stats.writeOperations++;
  }

  // Deep clone to prevent reference issues
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Start periodic flush
  startPeriodicFlush() {
    setInterval(async () => {
      if (this.writeBuffer.length > 0) {
        await this.flushBuffer();
      }
    }, this.flushInterval);
  }

  // Get ledger statistics
  async getStats() {
    const ledgerSize = await this.getLedgerSize();
    
    return {
      ...this.stats,
      current_sequence: this.sequenceId,
      ledger_size_bytes: ledgerSize,
      buffer_size: this.writeBuffer.length,
      last_flush: this.lastFlushTime,
      integrity_status: 'VERIFIED',
      immutability: 'ENFORCED'
    };
  }

  // Get ledger file size
  async getLedgerSize() {
    try {
      const stat = await fs.stat(this.ledgerPath);
      return stat.size;
    } catch (error) {
      return 0;
    }
  }

  // Export raw events (read-only)
  async exportEvents(format = 'json', fromSequence = 1, toSequence = null) {
    const events = await this.readRawEvents(fromSequence, toSequence);
    
    if (format === 'json') {
      return JSON.stringify(events, null, 2);
    } else if (format === 'raw') {
      // Return raw ledger lines
      const data = await fs.readFile(this.ledgerPath, 'utf8');
      const lines = data.trim().split('\n');
      return lines.filter((_, i) => i + 1 >= fromSequence && (!toSequence || i + 1 <= toSequence)).join('\n');
    } else {
      throw new Error(`Unsupported export format: ${format}`);
    }
  }

  // Force flush all buffered events
  async forceFlush() {
    console.log('[RAW EVENT LEDGER] Force flushing all buffered events...');
    await this.flushBuffer();
    console.log('[RAW EVENT LEDGER] Force flush complete');
  }

  // Stop the ledger
  async stop() {
    console.log('[RAW EVENT LEDGER] Stopping...');
    await this.forceFlush();
    console.log('[RAW EVENT LEDGER] Stopped');
  }
}

// Create singleton instance
const rawEventLedger = new RawEventLedger();

// Export the ledger
module.exports = rawEventLedger;
