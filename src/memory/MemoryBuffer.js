/**
 * MEMORY BUFFER - Working memory layer
 * 
 * In-process, immediate truth for decision-making
 * No network dependency, no latency, no uncertainty
 */

class MemoryBuffer {
  constructor() {
    // In-memory storage
    this.buffer = new Map();
    this.maxSize = 10000; // Prevent memory leaks
    this.flushQueue = [];
    this.flushing = false;
    
    // Statistics
    this.stats = {
      writes: 0,
      reads: 0,
      hits: 0,
      misses: 0,
      flushes: 0
    };
  }

  /**
   * Write to buffer - INSTANT
   */
  write(table, key, data) {
    this.stats.writes++;
    
    // Create table namespace if needed
    if (!this.buffer.has(table)) {
      this.buffer.set(table, new Map());
    }
    
    // Store with timestamp
    const tableMap = this.buffer.get(table);
    tableMap.set(key, {
      ...data,
      _buffered: true,
      _timestamp: Date.now()
    });
    
    // Add to flush queue
    this.flushQueue.push({
      table,
      key,
      data,
      timestamp: Date.now()
    });
    
    // Trigger async flush if not already running
    if (!this.flushing) {
      this.flushToPersistence();
    }
    
    // Prevent memory leaks
    if (tableMap.size > this.maxSize) {
      this.evictOldest(tableMap);
    }
    
    return data;
  }

  /**
   * Read from buffer - INSTANT
   */
  read(table, key) {
    this.stats.reads++;
    
    const tableMap = this.buffer.get(table);
    if (tableMap && tableMap.has(key)) {
      this.stats.hits++;
      return tableMap.get(key);
    }
    
    this.stats.misses++;
    return null;
  }

  /**
   * Read all from table - INSTANT
   */
  readAll(table) {
    this.stats.reads++;
    
    const tableMap = this.buffer.get(table);
    if (tableMap) {
      return Array.from(tableMap.values());
    }
    
    return [];
  }

  /**
   * Query with filters - INSTANT
   */
  query(table, filters = {}) {
    this.stats.reads++;
    
    const tableMap = this.buffer.get(table);
    if (!tableMap) {
      return [];
    }
    
    const results = [];
    
    for (const [, value] of tableMap) {
      let matches = true;
      
      // Check each filter
      for (const [field, expected] of Object.entries(filters)) {
        if (value[field] !== expected) {
          matches = false;
          break;
        }
      }
      
      if (matches) {
        results.push(value);
      }
    }
    
    return results;
  }

  /**
   * Aggregate field - INSTANT
   */
  aggregate(table, field) {
    this.stats.reads++;
    
    const tableMap = this.buffer.get(table);
    if (!tableMap) {
      return [];
    }
    
    const results = [];
    
    for (const value of tableMap.values()) {
      if (value[field] !== undefined) {
        results.push(value[field]);
      }
    }
    
    return results;
  }

  /**
   * Check if exists - INSTANT
   */
  exists(table, key) {
    const tableMap = this.buffer.get(table);
    return tableMap && tableMap.has(key);
  }

  /**
   * Get size of table
   */
  size(table) {
    const tableMap = this.buffer.get(table);
    return tableMap ? tableMap.size : 0;
  }

  /**
   * Clear table
   */
  clear(table) {
    if (table) {
      this.buffer.delete(table);
    } else {
      this.buffer.clear();
    }
  }

  /**
   * Async flush to persistence
   * This happens in background, doesn't block decisions
   */
  async flushToPersistence(persistenceLayer = null) {
    if (this.flushing || this.flushQueue.length === 0) {
      return;
    }
    
    this.flushing = true;
    this.stats.flushes++;
    
    // Take a snapshot of queue
    const toFlush = [...this.flushQueue];
    this.flushQueue = [];
    
    if (persistenceLayer) {
      try {
        // Flush in batches to avoid overwhelming
        const batchSize = 100;
        for (let i = 0; i < toFlush.length; i += batchSize) {
          const batch = toFlush.slice(i, i + batchSize);
          
          await Promise.all(
            batch.map(item => 
              persistenceLayer.write(item.table, item.data)
                .catch(e => console.error('[BUFFER] Flush failed:', e))
            )
          );
        }
        
        console.log(`[BUFFER] Flushed ${toFlush.length} items to persistence`);
      } catch (e) {
        console.error('[BUFFER] Flush error:', e);
        // Items stay in buffer for retry
        this.flushQueue.unshift(...toFlush);
      }
    }
    
    this.flushing = false;
    
    // Continue if more items queued
    if (this.flushQueue.length > 0 && !this._destroyed) {
      this._retryTimeout = setTimeout(() => this.flushToPersistence(persistenceLayer), 1000);
    }
  }

  /**
   * Load from persistence (for initialization)
   */
  async loadFromPersistence(table, persistenceLayer) {
    try {
      const data = await persistenceLayer.read(table);
      
      const tableMap = new Map();
      data.forEach(item => {
        tableMap.set(item.task_id || item.id, item);
      });
      
      this.buffer.set(table, tableMap);
      console.log(`[BUFFER] Loaded ${data.length} items into ${table} buffer`);
    } catch (e) {
      console.error(`[BUFFER] Failed to load ${table}:`, e);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      bufferSize: this.buffer.size,
      queueSize: this.flushQueue.length,
      hitRate: this.stats.reads > 0 ? (this.stats.hits / this.stats.reads * 100).toFixed(1) + '%' : '0%',
      tables: Array.from(this.buffer.keys())
    };
  }

  /**
   * Evict oldest entries to prevent memory leaks
   */
  evictOldest(tableMap) {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, value] of tableMap) {
      if (value._timestamp < oldestTime) {
        oldestTime = value._timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      tableMap.delete(oldestKey);
    }
  }

  /**
   * Force flush all pending items
   */
  async forceFlush(persistenceLayer) {
    while (this.flushQueue.length > 0) {
      await this.flushToPersistence(persistenceLayer);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  /**
   * Cancel pending retry and release in-memory state
   */
  destroy() {
    this._destroyed = true;
    if (this._retryTimeout) {
      clearTimeout(this._retryTimeout);
      this._retryTimeout = null;
    }
    this.buffer.clear();
    this.flushQueue = [];
  }
}

/**
 * Global buffer instance
 */
let globalBuffer = null;

function getMemoryBuffer() {
  if (!globalBuffer) {
    globalBuffer = new MemoryBuffer();
  }
  return globalBuffer;
}

function createMemoryBuffer() {
  return new MemoryBuffer();
}

module.exports = { MemoryBuffer, getMemoryBuffer, createMemoryBuffer };
