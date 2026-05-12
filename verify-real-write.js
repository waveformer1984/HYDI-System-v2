require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Verify the real event was written to Supabase
async function verifyRealWrite() {
  console.log('=== REAL WRITE VERIFICATION ===\n');
  
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  
  const eventId = '18ddcab6-aec4-4f0c-9444-e7cab408711a';
  
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .eq('event_id', eventId)
      .single();
    
    if (error) {
      console.log('FAIL: Event not found in database');
      console.log('Error:', error.message);
      return false;
    }
    
    if (data) {
      console.log('PASS: Event found in Supabase!');
      console.log('Event ID:', data.event_id);
      console.log('Type:', data.type);
      console.log('Status:', data.status);
      console.log('Source:', data.source);
      console.log('Payload:', JSON.stringify(data.payload, null, 2));
      console.log('Created:', data.created_at);
      
      // Check if AI analysis was attempted
      if (data.ai_analysis) {
        console.log('AI Analysis:', data.ai_analysis.substring(0, 100) + '...');
      } else {
        console.log('AI Analysis: None (expected - AI service not running)');
      }
      
      return true;
    }
    
  } catch (err) {
    console.log('ERROR: Database query failed');
    console.log('Error:', err.message);
    return false;
  }
}

verifyRealWrite().then(success => {
  console.log('\n=== VERIFICATION RESULT ===');
  console.log(success ? 'SUCCESS: Real integration confirmed' : 'FAILURE: Integration broken');
  console.log('=== VERIFICATION COMPLETE ===');
});
