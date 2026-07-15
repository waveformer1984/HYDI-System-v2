/**
 * MEMORY STORE - Hybrid memory layer
 * 
 * Buffer = immediate truth (working memory)
 * Supabase = persistent storage (long-term memory)
 * 
 * Read priority: Buffer → Supabase
 * Write: Buffer (instant) → Supabase (async)
 */

const { getMemoryBuffer } = require('./MemoryBuffer.js');

class MemoryStore {
  constructor(supabase) {
    this.db = supabase;
    this.buffer = getMemoryBuffer();
    this.writeVerify = false; // No immediate verification - buffer is truth
  }

  /**
   * Write data - INSTANT to buffer, async to Supabase
   */
  async write(table, data) {
    console.log(`[MEMORY] Writing to ${table} (buffer first)...`);
    
    // Generate key for buffer
    const key = data.task_id || data.taskId || data.id || `gen_${Date.now()}_${Math.random()}`;
    console.log(`[MEMORY] Writing with key: ${key}`);
    
    // Write to buffer INSTANT - this is the truth
    const buffered = this.buffer.write(table, key, data);
    
    // Async flush to Supabase (non-blocking)
    this.buffer.flushToPersistence(this);
    
    console.log(`[MEMORY] ✓ Buffered: ${table} (instant)`);
    return buffered;
  }

  /**
   * Read data - Buffer first, then Supabase
   */
  async read(table, query = {}) {
    console.log(`[MEMORY] Reading from ${table} (buffer first)...`);
    
    // Try buffer first - INSTANT
    if (Object.keys(query).length === 0) {
      // No filters - get all from buffer
      const buffered = this.buffer.readAll(table);
      if (buffered.length > 0) {
        console.log(`[MEMORY] ✓ Buffer hit: ${buffered.length} rows`);
        return buffered;
      }
    } else if (query.task_id) {
      // Specific task_id - check buffer
      const buffered = this.buffer.read(table, query.task_id);
      if (buffered) {
        console.log(`[MEMORY] ✓ Buffer hit: ${query.task_id}`);
        return [buffered];
      }
    } else {
      // Complex query - try buffer query
      const buffered = this.buffer.query(table, query);
      if (buffered.length > 0) {
        console.log(`[MEMORY] ✓ Buffer query hit: ${buffered.length} rows`);
        return buffered;
      }
    }
    
    // Buffer miss - try Supabase
    console.log(`[MEMORY] Buffer miss, trying Supabase...`);
    
    let q = this.db.from(table).select('*');

    // Apply filters
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        q = q.eq(key, value);
      }
    });

    const { data, error } = await q;

    if (error) {
      console.error(`[MEMORY READ FAIL] ${table}:`, error);
      throw new Error(`Memory read failed: ${error.message}`);
    }

    console.log(`[MEMORY] ✓ Supabase read: ${data.length} rows`);
    return data;
  }

  /**
   * Aggregate data - Buffer first, then Supabase
   */
  async aggregate(table, column, filters = {}) {
    console.log(`[MEMORY] Aggregating ${column} from ${table} (buffer first)...`);
    
    // Try buffer first
    const buffered = this.buffer.aggregate(table, column);
    if (buffered.length > 0) {
      console.log(`[MEMORY] ✓ Buffer aggregate: ${buffered.length} values`);
      return buffered;
    }
    
    // Buffer miss - try Supabase
    console.log(`[MEMORY] Buffer miss, aggregating from Supabase...`);
    
    let q = this.db.from(table).select(column);

    // Apply filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        q = q.eq(key, value);
      }
    });

    const { data, error } = await q;

    if (error) {
      console.error(`[MEMORY AGGREGATE FAIL] ${table}:`, error);
      throw new Error(`Memory aggregate failed: ${error.message}`);
    }

    console.log(`[MEMORY] ✓ Supabase aggregate: ${data.length} values`);
    return data;
  }

  /**
   * Write with buffer verification
   * Buffer is truth - no need to read back
   */
  async writeAndVerify(table, data, verifyField = 'task_id') {
    // Write to buffer (instant truth)
    const result = await this.write(table, data);
    
    // Verify in buffer (instant)
    const key = data[verifyField] || data.task_id || data.taskId || data.id;
    console.log(`[MEMORY] Verifying with key: ${key} from data:`, Object.keys(data));
    const verify = this.buffer.read(table, key);
    
    if (!verify) {
      throw new Error(`[MEMORY INCONSISTENCY] Buffer write failed for ${table}`);
    }
    
    console.log(`[MEMORY] ✓ Buffer write-verify complete for ${table}`);
    return verify;
  }

  /**
   * Check if table exists and is accessible
   */
  async verifyTable(table) {
    console.log(`[MEMORY] Verifying table ${table}...`);
    
    try {
      const { data, error } = await this.db
        .from(table)
        .select('*')
        .limit(1);
      
      if (error) {
        if (error.message.includes('does not exist')) {
          throw new Error(`[MEMORY] Table ${table} does not exist`);
        }
        throw error;
      }
      
      console.log(`[MEMORY] ✓ Table ${table} is accessible`);
      return true;
    } catch (e) {
      console.error(`[MEMORY] ✗ Table ${table} verification failed:`, e.message);
      return false;
    }
  }

  /**
   * Initialize required tables
   */
  async initialize() {
    console.log('[MEMORY] Initializing memory store...');
    
    const requiredTables = [
      'task_outcomes',
      'cascade_kills',
      'threshold_adaptations'
    ];
    
    let allExist = true;
    
    for (const table of requiredTables) {
      const exists = await this.verifyTable(table);
      if (!exists) {
        allExist = false;
        console.error(`[MEMORY] Required table missing: ${table}`);
      }
    }
    
    if (!allExist) {
      throw new Error(
        '[MEMORY] Initialization failed: Missing required tables. ' +
        'Run the SQL in Supabase dashboard first.'
      );
    }
    
    console.log('[MEMORY] ✓ All required tables verified');
    return true;
  }

  /**
   * Get memory statistics
   */
  async getStats() {
    const stats = {};
    
    try {
      stats.task_outcomes = (await this.read('task_outcomes')).length;
      stats.cascade_kills = (await this.read('cascade_kills')).length;
      stats.threshold_adaptations = (await this.read('threshold_adaptations')).length;
    } catch (e) {
      console.error('[MEMORY] Failed to get stats:', e.message);
      stats.error = e.message;
    }
    
    return stats;
  }
}

/**
 * Create a memory store instance
 */
function createMemoryStore(supabase) {
  return new MemoryStore(supabase);
}

module.exports = { MemoryStore, createMemoryStore };
