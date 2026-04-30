// Test simple persistence directly
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSimplePersistence() {
  try {
    console.log('Testing simple persistence...');
    
    const testEvent = {
      event_id: '550e8400-e29b-41d4-a716-446655440060',
      type: 'user_interaction',
      source: 'web_ui',
      timestamp: '2026-04-21T20:53:00.000Z',
      payload: { action: 'click', target: 'button' },
      processed: true,
      stored_at: new Date().toISOString()
    };
    
    // Simple v2 upsert
    const { data, error } = await supabase
      .from('hydi_events')
      .upsert(testEvent, { onConflict: 'event_id' });
    
    if (error) {
      console.error('Persistence failed:', error);
      return false;
    }
    
    console.log('Persistence successful!');
    console.log('Stored data:', data);
    return true;
    
  } catch (err) {
    console.error('Test failed:', err);
    return false;
  }
}

testSimplePersistence();
