// RAW EVENT LEDGER V2 - Single Source of Truth
// IMMUTABLE append-only store - NOTHING modifies it

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

class RawEventLedgerV2 extends EventEmitter {
  constructor() {
    super();
    
    // Configuration
    this.ledgerPath = path.join(__dirname, '../data/raw-ledger-v2.jsonl');
    this.indexPath = path.join(__dirname, '../data/raw-ledger-index-v2.json');
    
    // In-memory cache for performance
    this.events = [];
    this.index = new Map(); // id -> position in array
    this.maxMemoryEvents = 10000; // Keep last 10k in memory
    
    // Persistence
    this.needsFlush = false;
    this.flushInterval = 5000; // 5 seconds
    
    // Statistics
    this.stats = {
      totalEvents: 0,
      eventsBySource: new Map(),
      eventsByType: new Map(),
      lastEventId: null,
      lastTimestamp: null
    };
    
    this.initialize();
  }

  async initialize() {
    console.log('[RAW LEDGER V2] Initializing - Single Source of Truth');
    
    // Ensure data directory exists
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    
    // Load existing ledger
    await this.loadLedger();
    
    // Start periodic flush
    this.startPeriodicFlush();
    
    console.log(`[RAW LEDGER V2] Loaded ${this.events.length} events`);
    console.log('[RAW LEDGER V2] RULE: Nothing modifies this ledger - READ ONLY for all other layers');
  }

  // APPEND ONLY - The only write operation allowed
  async append(event) {
    // Create immutable record
    const record = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      event: this.deepClone(event), // Store exactly as received
      hash: null, // Will be calculated
      position: this.events.length // Position in ledger
    };
    
    // Calculate hash of event content
    record.hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(record.event))
      .digest('hex');
    
    // Add to in-memory ledger
    this.events.push(record);
    this.index.set(record.id, record.position);
    
    // Update statistics
    this.updateStats(event);
    
    // Mark for flush
    this.needsFlush = true;
    
    // Emit event (for downstream layers)
    this.emit('event_appended', {
      id: record.id,
      position: record.position,
      timestamp: record.timestamp,
      hash: record.hash
    });
    
    console.log(`[RAW LEDGER V2] Event appended: ${record.id} (position ${record.position})`);
    
    return record;
  }

  // QUERY operations - Read only
  query(filterFn) {
    return this.events.filter(filterFn);
  }

  // Get by ID
  getById(id) {
    const position = this.index.get(id);
    return position !== undefined ? this.events[position] : null;
  }

  // Get by position
  getByPosition(position) {
    return position >= 0 && position < this.events.length 
      ? this.events[position] 
      : null;
  }

  // Get range
  getRange(fromPosition, toPosition) {
    return this.events.slice(fromPosition, toPosition + 1);
  }

  // Get latest N events
  getLatest(count = 100) {
    return this.events.slice(-count);
  }

  // Get by source
  getBySource(source) {
    return this.events.filter(e => e.event.source === source);
  }

  // Get by type
  getByType(type) {
    return this.events.filter(e => e.event.type === type);
  }

  // Get by time range
  getByTimeRange(startTime, endTime) {
    return this.events.filter(e => 
      e.timestamp >= startTime && e.timestamp <= endTime
    );
  }

  // Load ledger from disk
  async loadLedger() {
    try {
      const data = await fs.readFile(this.ledgerPath, 'utf8');
      const lines = data.trim().split('\n');
      
      this.events = [];
      this.index.clear();
      
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        
        const record = JSON.parse(lines[i]);
        this.events.push(record);
        this.index.set(record.id, i);
        
        // Update stats
        if (record.event.source) {
          this.stats.eventsBySource.set(
            record.event.source,
            (this.stats.eventsBySource.get(record.event.source) || 0) + 1
          );
        }
        if (record.event.type) {
          this.stats.eventsByType.set(
            record.event.type,
            (this.stats.eventsByType.get(record.event.type) || 0) + 1
          );
        }
      }
      
      this.stats.totalEvents = this.events.length;
      if (this.events.length > 0) {
        const lastEvent = this.events[this.events.length - 1];
        this.stats.lastEventId = lastEvent.id;
        this.stats.lastTimestamp = lastEvent.timestamp;
      }
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[RAW LEDGER V2] Failed to load ledger:', error);
      }
    }
  }

  // Flush to disk
  async flush() {
    if (!this.needsFlush) return;
    
    try {
      // Only flush new events
      const lastFlushIndex = await this.getLastFlushIndex();
      const newEvents = this.events.slice(lastFlushIndex);
      
      if (newEvents.length === 0) return;
      
      // Append to file
      const lines = newEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(this.ledgerPath, lines, 'utf8');
      
      // Save index
      await this.saveIndex();
      
      this.needsFlush = false;
      
      console.log(`[RAW LEDGER V2] Flushed ${newEvents.length} events to disk`);
      
    } catch (error) {
      console.error('[RAW LEDGER V2] Failed to flush:', error);
    }
  }

  // Get last flush index
  async getLastFlushIndex() {
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf8');
      const index = JSON.parse(indexData);
      return index.lastFlushIndex || 0;
    } catch (error) {
      return 0;
    }
  }

  // Save index
  async saveIndex() {
    const index = {
      lastFlushIndex: this.events.length,
      lastEventId: this.stats.lastEventId,
      lastTimestamp: this.stats.lastTimestamp,
      totalEvents: this.stats.totalEvents,
      updatedAt: new Date().toISOString()
    };
    
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(index, null, 2),
      'utf8'
    );
  }

  // Update statistics
  updateStats(event) {
    this.stats.totalEvents++;
    this.stats.lastEventId = this.events[this.events.length - 1].id;
    this.stats.lastTimestamp = this.events[this.events.length - 1].timestamp;
    
    if (event.source) {
      this.stats.eventsBySource.set(
        event.source,
        (this.stats.eventsBySource.get(event.source) || 0) + 1
      );
    }
    
    if (event.type) {
      this.stats.eventsByType.set(
        event.type,
        (this.stats.eventsByType.get(event.type) || 0) + 1
      );
    }
  }

  // Start periodic flush
  startPeriodicFlush() {
    setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  // Deep clone to prevent reference issues
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      eventsBySource: Object.fromEntries(this.stats.eventsBySource),
      eventsByType: Object.fromEntries(this.stats.eventsByType),
      memoryEvents: this.events.length,
      needsFlush: this.needsFlush
    };
  }

  // Verify integrity
  async verifyIntegrity() {
    const issues = [];
    
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      
      // Verify position
      if (event.position !== i) {
        issues.push({
          type: 'POSITION_MISMATCH',
          id: event.id,
          expected: i,
          found: event.position
        });
      }
      
      // Verify hash
      const calculatedHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(event.event))
        .digest('hex');
      
      if (event.hash !== calculatedHash) {
        issues.push({
          type: 'HASH_MISMATCH',
          id: event.id,
          stored: event.hash,
          calculated: calculatedHash
        });
      }
    }
    
    console.log(`[RAW LEDGER V2] Integrity check: ${issues.length} issues found`);
    return issues;
  }

  // Force flush
  async forceFlush() {
    console.log('[RAW LEDGER V2] Force flushing...');
    await this.flush();
    console.log('[RAW LEDGER V2] Force flush complete');
  }

  // Get ledger info
  getInfo() {
    return {
      type: 'RAW_EVENT_LEDGER_V2',
      description: 'Single Source of Truth - Immutable Append-Only Store',
      rules: [
        'APPEND ONLY - No modifications allowed',
        'READ ONLY for all other layers',
        'IMMUTABLE - Once written, never changed',
        'HASHED - Content integrity verified'
      ],
      stats: this.getStats()
    };
  }
}

// Create singleton
const rawEventLedgerV2 = new RawEventLedgerV2();

module.exports = rawEventLedgerV2;
