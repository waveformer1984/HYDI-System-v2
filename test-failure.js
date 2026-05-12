require('dotenv').config();

// Test pipeline truthfulness under Supabase failure
async function testFailureScenario() {
  console.log('=== FAILURE SCENARIO TEST ===\n');
  
  // Temporarily break Supabase connection
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_KEY;
  
  // Set invalid credentials to simulate failure
  process.env.SUPABASE_URL = 'https://invalid.supabase.co';
  process.env.SUPABASE_KEY = 'invalid-key';
  
  try {
    // Import fresh pipeline with broken env
    const { processEvent } = require('./core/pipeline');
    
    console.log('Testing event processing with broken Supabase...');
    
    const result = await processEvent('failure-test', 'error', {
      message: 'This should fail',
      test: 'failure-scenario'
    });
    
    console.log('RESULT:', result);
    
    if (result.dbError) {
      console.log('PASS: Pipeline correctly reported database error');
    } else {
      console.log('FAIL: Pipeline lied about success');
    }
    
  } catch (error) {
    console.log('PASS: Pipeline threw error on failure');
    console.log('Error:', error.message);
  } finally {
    // Restore original credentials
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_KEY = originalKey;
  }
}

testFailureScenario();
