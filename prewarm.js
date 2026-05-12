require('dotenv').config();
const { processEvent } = require('./hydi-processor');

// Pre-warming script for JIT compilation and connection pooling
async function prewarm(count = 50) {
  console.log(`=== PREWARMING: ${count} events ===`);
  
  const startTime = Date.now();
  const promises = [];
  
  for (let i = 0; i < count; i++) {
    const promise = processEvent('prewarm', 'error', {
      prewarm: true,
      index: i,
      timestamp: Date.now()
    });
    promises.push(promise);
  }
  
  try {
    const results = await Promise.allSettled(promises);
    const success = results.filter(r => r.value?.success).length;
    const failed = results.filter(r => r.value?.success === false || r.status === 'rejected').length;
    
    const duration = Date.now() - startTime;
    console.log(`PREWARM COMPLETE: ${success} success, ${failed} failed, ${duration}ms`);
    console.log(`Throughput: ${(count / (duration / 1000)).toFixed(2)} events/sec`);
    
    return { success, failed, duration };
  } catch (error) {
    console.log('PREWARM ERROR:', error.message);
    return { success: 0, failed: count, duration: 0 };
  }
}

// Run prewarming if called directly
if (require.main === module) {
  const count = parseInt(process.argv[2]) || 50;
  prewarm(count).then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { prewarm };
