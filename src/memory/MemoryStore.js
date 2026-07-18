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
const logger = require('../../lib/structured-logger').child({ component: 'MemoryStore' });

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
    logger.info('Writing to table (buffer first)', { table });

    // Generate key for buffer
    const key = data.task_id || data.taskId || data.id || `gen_${Date.now()}_${Math.random()}`;
    logger.info('Writing with key', { key });

    // Write to buffer INSTANT - this is the truth
    const buffered = this.buffer.write(table, key, data);

    // Async flush to Supabase (non-blocking)
    this.buffer.flushToPersistence(this);

    logger.info('Buffered write complete (instant)', { table });
    return buffered;
  }

  /**
   * Read data - Buffer first, then Supabase
   */
  async read(table, query = {}) {
    logger.info('Reading from table (buffer first)', { table });

    // Try buffer first - INSTANT
    if (Object.keys(query).length === 0) {
      // No filters - get all from buffer
      const buffered = this.buffer.readAll(table);
      if (buffered.length > 0) {
        logger.info('Buffer hit', { rows: buffered.length });
        return buffered;
      }
    } else if (query.task_id) {
      // Specific task_id - check buffer
      const buffered = this.buffer.read(table, query.task_id);
      if (buffered) {
        logger.info('Buffer hit', { taskId: query.task_id });
        return [buffered];
      }
    } else {
      // Complex query - try buffer query
      const buffered = this.buffer.query(table, query);
      if (buffered.length > 0) {
        logger.info('Buffer query hit', { rows: buffered.length });
        return buffered;
      }
    }

    // Buffer miss - try Supabase
    logger.info('Buffer miss, trying Supabase', { table });

    let q = this.db.from(table).select('*');

    // Apply filters
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        q = q.eq(key, value);
      }
    });

    const { data, error } = await q;

    if (error) {
      logger.error('Memory read failed', { table, error });
      throw new Error(`Memory read failed: ${error.message}`);
    }

    logger.info('Supabase read complete', { rows: data.length });
    return data;
  }

  /**
   * Aggregate data - Buffer first, then Supabase
   */
  async aggregate(table, column, filters = {}) {
    logger.info('Aggregating column from table (buffer first)', { table, column });

    // Try buffer first
    const buffered = this.buffer.aggregate(table, column);
    if (buffered.length > 0) {
      logger.info('Buffer aggregate hit', { values: buffered.length });
      return buffered;
    }

    // Buffer miss - try Supabase
    logger.info('Buffer miss, aggregating from Supabase', { table, column });

    let q = this.db.from(table).select(column);

    // Apply filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        q = q.eq(key, value);
      }
    });

    const { data, error } = await q;

    if (error) {
      logger.error('Memory aggregate failed', { table, error });
      throw new Error(`Memory aggregate failed: ${error.message}`);
    }

    logger.info('Supabase aggregate complete', { values: data.length });
    return data;
  }

  /**
   * Write with buffer verification
   * Buffer is truth - no need to read back
   */
  async writeAndVerify(table, data, verifyField = 'task_id') {
    // Write to buffer (instant truth)
    await this.write(table, data);
    
    // Verify in buffer (instant)
    const key = data[verifyField] || data.task_id || data.taskId || data.id;
    logger.info('Verifying with key', { key, dataKeys: Object.keys(data) });
    const verify = this.buffer.read(table, key);

    if (!verify) {
      throw new Error(`[MEMORY INCONSISTENCY] Buffer write failed for ${table}`);
    }

    logger.info('Buffer write-verify complete', { table });
    return verify;
  }

  /**
   * Check if table exists and is accessible
   */
  async verifyTable(table) {
    logger.info('Verifying table', { table });

    try {
      const { error } = await this.db
        .from(table)
        .select('*')
        .limit(1);

      if (error) {
        if (error.message.includes('does not exist')) {
          throw new Error(`[MEMORY] Table ${table} does not exist`);
        }
        throw error;
      }

      logger.info('Table is accessible', { table });
      return true;
    } catch (e) {
      logger.error('Table verification failed', { table, error: e });
      return false;
    }
  }

  /**
   * Initialize required tables
   */
  async initialize() {
    logger.info('Initializing memory store');

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
        logger.error('Required table missing', { table });
      }
    }

    if (!allExist) {
      throw new Error(
        '[MEMORY] Initialization failed: Missing required tables. ' +
        'Run the SQL in Supabase dashboard first.'
      );
    }

    logger.info('All required tables verified');
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
      logger.error('Failed to get stats', { error: e });
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
