require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function verifyDashboard() {
  console.log('=== DASHBOARD VERIFICATION ===\n');
  
  // Check all event types are present
  const { data: allEvents, error: allError } = await supabase
    .from('hydi_events')
    .select('type, status, ai_analysis, retries')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (allError) {
    console.error('ERROR fetching events:', allError);
    return;
  }
  
  console.log('Recent events:');
  allEvents.forEach(event => {
    console.log(`- ${event.type.toUpperCase()}: ${event.status} | AI: ${event.ai_analysis ? 'YES' : 'NO'} | Retries: ${event.retries}`);
  });
  
  // Check status distribution
  const { data: statusData } = await supabase
    .from('hydi_events')
    .select('status');
  
  const statusCounts = statusData.reduce((acc, event) => {
    acc[event.status] = (acc[event.status] || 0) + 1;
    return acc;
  }, {});
  
  console.log('\nStatus distribution:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`- ${status}: ${count}`);
  });
  
  // Check for failures and retries
  const { data: failures } = await supabase
    .from('hydi_events')
    .select('event_id, type, status, retries')
    .or('retries.gt.0,status.eq.failed');
  
  if (failures.length > 0) {
    console.log('\nFailures/Retries:');
    failures.forEach(failure => {
      console.log(`- ${failure.event_id}: ${failure.status} (${failure.retries} retries)`);
    });
  } else {
    console.log('\nNo failures or retries detected');
  }
  
  console.log('\n=== VERIFICATION COMPLETE ===');
}

verifyDashboard();
