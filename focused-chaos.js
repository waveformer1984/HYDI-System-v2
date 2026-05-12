require('dotenv').config();

// Focused Chaos Test: Database Disconnect with Live Dashboard
async function focusedChaosTest() {
  console.log('=== FOCUSED CHAOS TEST ===\n');
  
  try {
    // Step 1: Verify normal operation
    console.log('1. Verifying normal operation...');
    const normalResult = await sendEvent('normal-test', 'Database disconnect chaos test');
    console.log(`Normal event: ${normalResult.success ? 'SUCCESS' : 'FAILED'}`);
    
    // Step 2: Start dashboard stream monitoring
    console.log('\n2. Starting dashboard stream monitoring...');
    console.log('Open http://localhost:3002 in another tab to watch live updates');
    
    // Step 3: Break database connection
    console.log('\n3. Breaking database connection...');
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_KEY;
    
    process.env.SUPABASE_URL = 'https://invalid.supabase.co';
    process.env.SUPABASE_KEY = 'invalid-key';
    
    // Step 4: Send events during disconnect
    console.log('4. Sending events during disconnect (watch dashboard)...');
    for (let i = 0; i < 5; i++) {
      const result = await sendEvent(`disconnect-${i}`, `Event during database disconnect ${i}`);
      console.log(`Disconnect event ${i}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      await sleep(1000);
    }
    
    // Step 5: Restore connection
    console.log('\n5. Restoring database connection...');
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_KEY = originalKey;
    
    // Step 6: Send recovery events
    console.log('6. Sending recovery events (watch dashboard recover)...');
    for (let i = 0; i < 3; i++) {
      const result = await sendEvent(`recovery-${i}`, `Recovery event ${i}`);
      console.log(`Recovery event ${i}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      await sleep(1000);
    }
    
    console.log('\n=== FOCUSED CHAOS TEST COMPLETE ===');
    console.log('Check dashboard at http://localhost:3002 for live stream behavior');
    
  } catch (error) {
    console.error('Chaos test failed:', error.message);
  }
}

async function sendEvent(message, payload) {
  try {
    const response = await fetch('http://localhost:3001/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, payload })
    });
    
    const result = await response.json();
    return { success: result.success, eventId: result.event_id };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

focusedChaosTest();
