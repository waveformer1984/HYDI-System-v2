require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testIdempotency() {
  console.log('Testing database-level idempotency...');
  
  const testId = 'test-idempotency-' + Date.now();
  
  try {
    // First insert
    const { data, error } = await createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ).from('hydi_events')
      .insert([{
        event_id: testId,
        type: 'idempotency_test',
        status: 'pending',
        timestamp: new Date().toISOString(),
        source: 'test_system',
        retry_count: 0,
        schema_version: '1.2.0',
        correlation_id: testId,
        payload: {
          message: 'Database idempotency test',
          timestamp: Date.now()
        }
      }]).select();
    
    if (error) {
      console.log(`First insert failed: ${error.message}`);
      return { success: false, error: error.message };
    }
    
    // Second insert (should be idempotent)
    const { data: insertResult, error: insertError } = await createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ).from('hydi_events')
      .insert([{
        event_id: testId,
        type: 'idempotency_test',
        status: 'pending',
        timestamp: new Date().toISOString(),
        source: 'test_system',
        retry_count: 0,
        schema_version: '1.2.0',
        correlation_id: testId,
        payload: {
          message: 'Database idempotency test',
          timestamp: Date.now()
        }
      }]).select();
    
    if (insertError) {
      console.log(`Second insert failed: ${insertError.message}`);
      return { success: false, error: insertError.message };
    }
    
    // Check for exactly one event
    const { data: checkResult, error: checkError } = await createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ).from('hydi_events')
      .select('event_id')
      .eq('event_id', 'test-idempotency-' + Date.now())
      .single();
    
    const found = checkResult ? checkResult.length === 1 : 0;
    
    console.log(`Database idempotency: ${found ? 'PASSED' : 'FAILED'}`);
    
    return {
      success: found,
      details: found ? 'Exactly 1 event in database' : 'No events found'
    };
  } catch (error) {
    console.log(`Idempotency test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// CLI interface
if (require.main === module) {
  testIdempotency().catch(console.error);
}
