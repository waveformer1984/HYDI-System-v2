require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Verify what actually happened during chaos test
async function verifyChaosResults() {
  console.log('=== CHAOS TEST VERIFICATION ===\n');
  
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  
  try {
    // Get recent events from the last 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .gte('created_at', twoMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (error) {
      console.log('Query failed:', error.message);
      return;
    }
    
    console.log(`Found ${data.length} recent events:`);
    
    // Group by phase
    const phases = {
      normal: data.filter(e => e.payload.message === 'normal-test'),
      disconnect: data.filter(e => e.payload.message && e.payload.message.includes('disconnect-')),
      recovery: data.filter(e => e.payload.message && e.payload.message.includes('recovery-'))
    };
    
    console.log(`\nNormal phase: ${phases.normal.length} events`);
    console.log(`Disconnect phase: ${phases.disconnect.length} events`);
    console.log(`Recovery phase: ${phases.recovery.length} events`);
    
    // Check statuses
    const statuses = data.reduce((acc, event) => {
      acc[event.status] = (acc[event.status] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\nStatus breakdown:');
    Object.entries(statuses).forEach(([status, count]) => {
      console.log(`- ${status}: ${count}`);
    });
    
    // Check for failures and retries
    const failures = data.filter(e => e.status === 'failed' || e.retries > 0);
    
    if (failures.length > 0) {
      console.log('\nFailed/Retried events:');
      failures.forEach(event => {
        console.log(`- ${event.event_id}: ${event.status} (${event.retries} retries)`);
        if (event.failure_reason) {
          console.log(`  Reason: ${event.failure_reason}`);
        }
      });
    }
    
    // Show actual persistence
    console.log('\nActual persistence verification:');
    console.log(`Total events in database: ${data.length}`);
    console.log(`Expected events: 9 (1 normal + 5 disconnect + 3 recovery)`);
    
    if (data.length >= 9) {
      console.log('SUCCESS: All chaos test events persisted!');
    } else {
      console.log(`WARNING: Only ${data.length}/9 events found`);
    }
    
  } catch (err) {
    console.log('Verification failed:', err.message);
  }
}

verifyChaosResults();
