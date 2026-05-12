require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
// const { ChaosProxy } = require('./core/chaos-proxy'); // DISABLED

// HYDI Processor - Core Logic with Exponential Backoff
class HYDIProcessor {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.chaosMode = process.env.CHAOS_MODE || 'NONE';
  }

  async processEvent(source, type, payload) {
    const event = {
      event_id: uuidv4(),
      source,
      type,
      status: 'pending',
      payload,
      timestamp: new Date().toISOString(), // Changed from created_at
      created_at: new Date().toISOString(),
      retries: 0,
      retry_count: 0
    };

    console.log(`PROCESSING: ${event.event_id} - ${type} from ${source}`);
    
    try {
      await this.writeEventWithRetry(event);
      return { success: true, event };
    } catch (error) {
      console.log(`FAILED: ${event.event_id} - ${error.message}`);
      return { success: false, error: error.message, event };
    }
  }

  async writeEventWithRetry(event, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`WRITE ATTEMPT: ${event.event_id} - attempt ${attempt + 1}/${maxRetries + 1}`);
        
        const { data, error } = await this.supabase
          .from('hydi_events')
          .insert([event])
          .select();

        if (error) {
          throw new Error(`Supabase error: ${error.message}`);
        }

        console.log(`WRITE SUCCESS: ${event.event_id} - persisted on attempt ${attempt + 1}`);
        return { success: true, data: data[0] };

      } catch (error) {
        lastError = error;
        event.retries = attempt;
        
        console.log(`WRITE FAILED: ${event.event_id} - attempt ${attempt + 1} - ${error.message}`);
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`RETRY DELAY: ${event.event_id} - waiting ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          event.status = 'failed';
          event.failure_reason = lastError.message;
          console.log(`MAX RETRIES EXCEEDED: ${event.event_id} - marking as failed`);
        }
      }
    }
    
    throw lastError;
  }

  async getEventStats() {
    try {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('status')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const stats = data.reduce((acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1;
        return acc;
      }, {});

      return stats;
    } catch (error) {
      console.log('Stats query failed:', error.message);
      return { error: error.message };
    }
  }
}

// Export required functions
const processor = new HYDIProcessor();

module.exports = {
  processEvent: processor.processEvent.bind(processor),
  retryWrapper: processor.writeEventWithRetry.bind(processor),
  stateTracker: processor.getEventStats.bind(processor)
};
