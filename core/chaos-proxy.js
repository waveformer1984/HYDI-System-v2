// Chaos Proxy Layer - Real Failure Injection
class ChaosProxy {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.chaosMode = process.env.CHAOS_MODE || 'NONE';
    this.requestCount = 0;
  }

  async from(table) {
    this.requestCount++;
    
    // Apply chaos rules
    await this.applyChaosRules();
    
    // Forward to real Supabase
    const realTable = this.supabase.from(table);
    
    // Wrap methods to add chaos observability
    return {
      insert: async (data, options) => {
        const startTime = Date.now();
        const attempt = 1;
        
        try {
          const result = await realTable.insert(data, options);
          
          // Log success with metrics
          console.log(`CHAOS INSERT SUCCESS: table=${table}, attempt=${attempt}, latency=${Date.now() - startTime}ms, request=${this.requestCount}`);
          
          return result;
        } catch (error) {
          // Log failure with metrics
          console.log(`CHAOS INSERT FAILURE: table=${table}, attempt=${attempt}, error=${error.message}, latency=${Date.now() - startTime}ms, request=${this.requestCount}`);
          throw error;
        }
      },
      
      select: async (columns, options) => {
        return realTable.select(columns, options);
      },
      
      update: async (data, options) => {
        return realTable.update(data, options);
      },
      
      delete: async (options) => {
        return realTable.delete(options);
      }
    };
  }

  async applyChaosRules() {
    switch (this.chaosMode) {
      case 'DROP_DB':
        throw new Error('CHAOS: Database connection dropped');
        
      case 'DELAY_DB':
        const delay = Math.random() * 10000 + 5000; // 5-15 second delay
        console.log(`CHAOS: Delaying database request by ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        break;
        
      case 'PARTIAL_FAIL':
        if (Math.random() < 0.3) { // 30% failure rate
          throw new Error('CHAOS: Random database failure');
        }
        break;
        
      case 'TIMEOUT_DB':
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second timeout
        throw new Error('CHAOS: Database timeout');
        
      case 'NONE':
      default:
        // No chaos applied
        break;
    }
  }

  static createClient(supabaseUrl, supabaseKey) {
    const { createClient } = require('@supabase/supabase-js');
    const realClient = createClient(supabaseUrl, supabaseKey);
    return new ChaosProxy(realClient);
  }
}

module.exports = { ChaosProxy };
