require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { EventContractValidator } = require('./event-contracts');

// Event Replay Engine - Rebuilds state from event history
class ReplayEngine {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.validator = new EventContractValidator();
    this.processors = new Map();
    this.state = new Map();
    this.replayLog = [];
  }

  // Register event processor
  registerProcessor(type, processor) {
    this.processors.set(type, processor);
  }

  // Replay events from a specific time range
  async replayEvents(options = {}) {
    const {
      fromTimestamp,
      toTimestamp,
      eventTypes,
      limit = 1000,
      dryRun = false,
      stopOnError = true
    } = options;
    
    console.log('=== REPLAY ENGINE START ===');
    console.log(`From: ${fromTimestamp || 'beginning'}`);
    console.log(`To: ${toTimestamp || 'now'}`);
    console.log(`Types: ${eventTypes || 'all'}`);
    console.log(`Dry Run: ${dryRun}`);
    
    try {
      // Fetch events to replay
      const events = await this.fetchEvents(options);
      console.log(`Found ${events.length} events to replay`);
      
      if (events.length === 0) {
        console.log('No events to replay');
        return { success: true, replayed: 0, errors: [] };
      }
      
      // Reset state for clean replay
      this.state.clear();
      this.replayLog = [];
      
      // Replay events in chronological order
      const results = {
        success: true,
        replayed: 0,
        errors: [],
        state: {}
      };
      
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        
        try {
          // Validate event
          const validation = this.validator.validateEvent(event);
          
          if (!validation.valid) {
            const error = `Event validation failed: ${validation.errors.join(', ')}`;
            console.log(`ERROR [${i+1}/${events.length}]: ${error}`);
            
            results.errors.push({
              event_id: event.event_id,
              error,
              index: i
            });
            
            if (stopOnError) {
              results.success = false;
              break;
            }
            continue;
          }
          
          // Process event
          if (!dryRun) {
            await this.processEvent(validation.event);
          }
          
          results.replayed++;
          console.log(`[${i+1}/${events.length}] Processed: ${validation.event.event_id} (${validation.event.type})`);
          
          // Log replay step
          this.replayLog.push({
            timestamp: new Date().toISOString(),
            event_id: validation.event.event_id,
            type: validation.event.type,
            action: dryRun ? 'dry_run' : 'processed',
            state_size: this.state.size
          });
          
        } catch (error) {
          const errorMsg = `Processing failed: ${error.message}`;
          console.log(`ERROR [${i+1}/${events.length}]: ${errorMsg}`);
          
          results.errors.push({
            event_id: event.event_id,
            error: errorMsg,
            index: i
          });
          
          if (stopOnError) {
            results.success = false;
            break;
          }
        }
      }
      
      // Final state snapshot
      results.state = this.getStateSnapshot();
      
      console.log('=== REPLAY ENGINE COMPLETE ===');
      console.log(`Success: ${results.success}`);
      console.log(`Replayed: ${results.replayed}/${events.length}`);
      console.log(`Errors: ${results.errors.length}`);
      console.log(`Final State: ${results.state.totalEvents} events, ${results.state.aggregates.size} aggregates`);
      
      return results;
      
    } catch (error) {
      console.log(`Replay failed: ${error.message}`);
      return { success: false, error: error.message, replayed: 0, errors: [] };
    }
  }

  async fetchEvents(options) {
    let query = this.supabase
      .from('hydi_events')
      .select('*')
      .order('timestamp', { ascending: true });
    
    // Apply filters
    if (options.fromTimestamp) {
      query = query.gte('timestamp', options.fromTimestamp);
    }
    
    if (options.toTimestamp) {
      query = query.lte('timestamp', options.toTimestamp);
    }
    
    if (options.eventTypes && options.eventTypes.length > 0) {
      query = query.in('type', options.eventTypes);
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw new Error(`Failed to fetch events: ${error.message}`);
    }
    
    return data || [];
  }

  async processEvent(event) {
    const processor = this.processors.get(event.type);
    
    if (!processor) {
      console.log(`No processor for event type: ${event.type}`);
      return;
    }
    
    // Update state before processing
    this.updateState(event);
    
    // Process the event
    await processor(event, this.state);
    
    // Update state after processing
    this.updateState(event, 'processed');
  }

  updateState(event, status = null) {
    // Update event counts
    const key = `events:${event.type}:${event.status}`;
    this.state.set(key, (this.state.get(key) || 0) + 1);
    
    // Update aggregates
    const aggKey = `type:${event.type}`;
    this.state.set(aggKey, (this.state.get(aggKey) || 0) + 1);
    
    // Update status counts
    const statusKey = `status:${event.status}`;
    this.state.set(statusKey, (this.state.get(statusKey) || 0) + 1);
    
    // Track latest event
    this.state.set('latest_event', event);
    this.state.set('latest_timestamp', event.timestamp);
    
    // Update total count
    this.state.set('total_events', (this.state.get('total_events') || 0) + 1);
  }

  getStateSnapshot() {
    const snapshot = {};
    
    // Convert Map to object
    for (const [key, value] of this.state.entries()) {
      snapshot[key] = value;
    }
    
    return {
      ...snapshot,
      aggregates: Object.keys(snapshot)
        .filter(key => key.startsWith('type:'))
        .reduce((acc, key) => {
          acc[key.replace('type:', '')] = snapshot[key];
          return acc;
        }, {}),
      status_counts: Object.keys(snapshot)
        .filter(key => key.startsWith('status:'))
        .reduce((acc, key) => {
          acc[key.replace('status:', '')] = snapshot[key];
          return acc;
        }, {}),
      replay_log: this.replayLog
    };
  }

  // Verify consistency of replayed state
  async verifyConsistency(replayResults) {
    console.log('=== CONSISTENCY VERIFICATION ===');
    
    try {
      // Fetch current database state
      const dbEvents = await this.supabase
        .from('hydi_events')
        .select('type, status')
        .order('timestamp', { ascending: true });
      
      if (dbEvents.error) {
        throw new Error(`Failed to verify consistency: ${dbEvents.error.message}`);
      }
      
      // Count events in database
      const dbCounts = {};
      for (const event of dbEvents.data) {
        const typeKey = `type:${event.type}`;
        const statusKey = `status:${event.status}`;
        
        dbCounts[typeKey] = (dbCounts[typeKey] || 0) + 1;
        dbCounts[statusKey] = (dbCounts[statusKey] || 0) + 1;
      }
      
      // Compare with replayed state
      const replayState = replayResults.state;
      const mismatches = [];
      
      for (const [key, replayValue] of Object.entries(replayState)) {
        if (key.startsWith('type:') || key.startsWith('status:')) {
          const dbValue = dbCounts[key] || 0;
          if (dbValue !== replayValue) {
            mismatches.push({
              key,
              replayed: replayValue,
              database: dbValue,
              difference: replayValue - dbValue
            });
          }
        }
      }
      
      if (mismatches.length === 0) {
        console.log('CONSISTENCY CHECK: PASSED');
        console.log('Replayed state matches database state');
      } else {
        console.log('CONSISTENCY CHECK: FAILED');
        console.log('Mismatches found:');
        mismatches.forEach(m => {
          console.log(`- ${m.key}: replayed=${m.replayed}, database=${m.database}, diff=${m.difference}`);
        });
      }
      
      return {
        consistent: mismatches.length === 0,
        mismatches,
        dbCounts,
        replayState
      };
      
    } catch (error) {
      console.log(`Consistency verification failed: ${error.message}`);
      return { consistent: false, error: error.message };
    }
  }

  // Get replay statistics
  getReplayStats() {
    return {
      total_replays: this.replayLog.length,
      processors_registered: this.processors.size,
      state_size: this.state.size,
      last_replay: this.replayLog[this.replayLog.length - 1]?.timestamp || null
    };
  }
}

// Default processors
const defaultProcessors = {
  'error': async (event, state) => {
    console.log(`Processing error event: ${event.event_id}`);
    // Add error handling logic here
  },
  
  'system': async (event, state) => {
    console.log(`Processing system event: ${event.event_id}`);
    // Add system handling logic here
  },
  
  'orchestration_test': async (event, state) => {
    console.log(`Processing test event: ${event.event_id}`);
    // Add test handling logic here
  }
};

// CLI interface
if (require.main === module) {
  const replay = new ReplayEngine();
  
  // Register default processors
  Object.entries(defaultProcessors).forEach(([type, processor]) => {
    replay.registerProcessor(type, processor);
  });
  
  const command = process.argv[2] || 'replay';
  
  (async () => {
    switch (command) {
      case 'replay':
        const results = await replay.replayEvents({
          limit: 100,
          dryRun: process.argv.includes('--dry-run')
        });
        
        if (results.success) {
          const consistency = await replay.verifyConsistency(results);
          console.log('\n=== FINAL RESULTS ===');
          console.log(`Consistent: ${consistency.consistent}`);
        }
        break;
        
      case 'stats':
        console.log(JSON.stringify(replay.getReplayStats(), null, 2));
        break;
        
      case 'verify':
        // Run verification on last replay
        console.log('No replay data available. Run replay first.');
        break;
        
      default:
        console.log('Usage: node replay-engine.js [replay|stats|verify] [--dry-run]');
    }
  })().catch(console.error);
}

module.exports = { ReplayEngine, defaultProcessors };
