require('dotenv').config();

// Quick burst test for chaos scenario
async function testBurst(count = 10) {
  console.log(`=== BURST TEST: ${count} events ===\n`);
  
  const results = [];
  
  for (let i = 0; i < count; i++) {
    try {
      const payload = {
        message: `burst-event-${i}`,
        index: i,
        timestamp: Date.now(),
        test: 'chaos-burst'
      };
      
      const response = await fetch('http://localhost:3001/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      results.push({ index: i, success: result.success, eventId: result.event_id });
      console.log(`Event ${i}: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.event_id || 'NO ID'}`);
      
    } catch (error) {
      results.push({ index: i, success: false, error: error.message });
      console.log(`Event ${i}: FAILED - ${error.message}`);
    }
    
    // Small delay between events
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\nBURST RESULTS: ${success} success, ${failed} failed`);
  
  return { success, failed, results };
}

// Get count from command line
const count = parseInt(process.argv[2]) || 10;
testBurst(count);
