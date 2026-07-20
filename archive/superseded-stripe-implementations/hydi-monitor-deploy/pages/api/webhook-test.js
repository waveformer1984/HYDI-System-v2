import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log('=== WEBHOOK TEST ENTRY ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', Object.keys(req.headers));
  
  if (req.method !== 'POST') return res.status(405).end();

  // Simple test insert without signature verification
  try {
    const testEvent = {
      event_id: `test_${Date.now()}`,
      type: 'test.webhook',
      event_type: 'test.webhook',
      status: 'received',
      processed: false,
      provider: 'test',
      payload: { test: true, timestamp: new Date().toISOString() }
    };

    const { data, error } = await supabase
      .from('webhook_events')
      .insert(testEvent)
      .select();

    if (error) {
      console.error('❌ Test insert failed:', error);
      return res.status(500).json({ error: error.message, details: error });
    }

    console.log('✅ Test insert successful:', data);
    return res.status(200).json({ success: true, event_id: testEvent.event_id });
    
  } catch (error) {
    console.error('❌ Test webhook failed:', error);
    return res.status(500).json({ error: 'Test webhook failed', details: error });
  }
}
