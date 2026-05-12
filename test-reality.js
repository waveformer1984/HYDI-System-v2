require('dotenv').config();

// Test the improved failure handling
async function testReality() {
  console.log('=== REALITY TEST ===\n');
  
  // Test 1: Normal operation
  console.log('1. Testing normal operation...');
  try {
    const { processEvent } = require('./core/pipeline');
    const result = await processEvent('reality-test', 'info', { message: 'normal test' });
    console.log('PASS: Normal operation works');
    console.log('Status:', result.event.status);
  } catch (error) {
    console.log('FAIL: Normal operation failed:', error.message);
  }
  
  // Test 2: AI analysis failure
  console.log('\n2. Testing AI analysis failure...');
  try {
    const { processEvent } = require('./core/pipeline');
    const result = await processEvent('reality-test', 'error', { message: 'test AI failure' });
    console.log('AI Analysis:', result.event.ai_analysis?.substring(0, 50) + '...');
    console.log('Status:', result.event.status);
  } catch (error) {
    console.log('AI failure handled:', error.message);
  }
  
  // Test 3: Database failure simulation
  console.log('\n3. Testing database failure...');
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_KEY;
  
  process.env.SUPABASE_URL = 'https://invalid.supabase.co';
  process.env.SUPABASE_KEY = 'invalid-key';
  
  try {
    // Clear require cache to get fresh pipeline with broken env
    delete require.cache[require.resolve('./core/pipeline')];
    const { processEvent } = require('./core/pipeline');
    
    const result = await processEvent('reality-test', 'error', { message: 'test DB failure' });
    
    if (result.success === false && result.dbError) {
      console.log('PASS: Database failure properly detected');
      console.log('Error:', result.dbError);
      console.log('Event status:', result.event.status);
      console.log('Retries:', result.event.retries);
    } else {
      console.log('FAIL: Database failure not properly handled');
    }
    
  } catch (error) {
    console.log('Database failure handled:', error.message);
  } finally {
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_KEY = originalKey;
  }
  
  console.log('\n=== REALITY TEST COMPLETE ===');
}

testReality();
