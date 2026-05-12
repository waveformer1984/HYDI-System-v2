require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function querySpecificEvent() {
  const eventId = '89dcc4e8-6e0f-4c11-a1e2-843530e56a55';
  
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .eq('event_id', eventId);
    
    if (error) {
      console.log('Query error:', error);
      return;
    }
    
    console.log('FOUND:', data.length, 'events');
    data.forEach(event => {
      console.log('Event:', event.event_id);
      console.log('- Type:', event.type);
      console.log('- Status:', event.status);
      console.log('- Timestamp:', event.timestamp);
      console.log('- Payload:', event.payload);
    });
    
  } catch (err) {
    console.log('Exception:', err.message);
  }
}

querySpecificEvent();
