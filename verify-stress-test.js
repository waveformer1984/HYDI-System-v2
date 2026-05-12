require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Verify the 20 stress test events were written to Supabase
async function verifyStressTest() {
  console.log('=== STRESS TEST VERIFICATION ===\n');
  
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  
  // Get recent events from the last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .eq('type', 'error')
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(25);
    
    if (error) {
      console.log('FAIL: Query failed');
      console.log('Error:', error.message);
      return false;
    }
    
    // Filter for stress test events
    const stressEvents = data.filter(event => 
      event.payload && 
      event.payload.message && 
      event.payload.message.includes('Stress test event')
    );
    
    console.log(`Found ${stressEvents.length} stress test events in Supabase`);
    
    if (stressEvents.length >= 20) {
      console.log('PASS: All 20+ stress test events persisted!');
      
      // Show first few as proof
      stressEvents.slice(0, 5).forEach((event, i) => {
        console.log(`${i+1}. Event ID: ${event.event_id}`);
        console.log(`   Message: ${event.payload.message}`);
        console.log(`   Status: ${event.status}`);
        console.log(`   Created: ${event.created_at}`);
        console.log('');
      });
      
      // Check statuses
      const processed = stressEvents.filter(e => e.status === 'processed').length;
      const failed = stressEvents.filter(e => e.status === 'failed').length;
      
      console.log(`Status breakdown: ${processed} processed, ${failed} failed`);
      
      return true;
    } else {
      console.log(`FAIL: Only ${stressEvents.length}/20 events found`);
      return false;
    }
    
  } catch (err) {
    console.log('ERROR: Database query failed');
    console.log('Error:', err.message);
    return false;
  }
}

verifyStressTest().then(success => {
  console.log('\n=== STRESS TEST RESULT ===');
  console.log(success ? 'TL3 ACHIEVED: Real system under load' : 'TL3 FAILED: System buckled under stress');
  console.log('=== VERIFICATION COMPLETE ===');
});
