require('dotenv').config();
const { processEvent } = require('./core/pipeline');

// Chaos test: Flood system with mixed events
async function chaosTest() {
  console.log('=== CHAOS TEST START ===\n');
  
  const eventTypes = [
    { type: 'error', weight: 20, priority: 'high' },
    { type: 'task', weight: 30, priority: 'normal' },
    { type: 'info', weight: 50, priority: 'low' }
  ];
  
  const startTime = Date.now();
  const eventCount = 100;
  const results = { success: 0, failed: 0, errors: [] };
  
  console.log(`Flooding system with ${eventCount} mixed events...\n`);
  
  // Flood phase
  const promises = [];
  for (let i = 0; i < eventCount; i++) {
    const eventType = selectEventType(eventTypes);
    const payload = generatePayload(eventType.type, i);
    
    promises.push(
      processEvent(`chaos-test-${i}`, eventType.type, payload)
        .then(result => {
          results.success++;
          return { index: i, ...result };
        })
        .catch(error => {
          results.failed++;
          results.errors.push({ index: i, error: error.message });
          return { index: i, error: error.message };
        })
    );
  }
  
  console.log('Waiting for all events to process...');
  const allResults = await Promise.all(promises);
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  console.log(`\n=== CHAOS TEST RESULTS ===`);
  console.log(`Duration: ${duration}ms`);
  console.log(`Events/sec: ${(eventCount / (duration / 1000)).toFixed(2)}`);
  console.log(`Success: ${results.success}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Error rate: ${(results.failed / eventCount * 100).toFixed(1)}%`);
  
  if (results.errors.length > 0) {
    console.log('\nSample errors:');
    results.errors.slice(0, 5).forEach(err => {
      console.log(`- Event ${err.index}: ${err.error}`);
    });
  }
  
  // Analyze results by priority
  const priorityStats = {};
  allResults.forEach(result => {
    const priority = result.route?.priority || 'unknown';
    priorityStats[priority] = (priorityStats[priority] || 0) + 1;
  });
  
  console.log('\nPriority distribution:');
  Object.entries(priorityStats).forEach(([priority, count]) => {
    console.log(`- ${priority}: ${count}`);
  });
  
  console.log('\n=== CHAOS TEST COMPLETE ===');
  
  return { results, duration, priorityStats };
}

function selectEventType(eventTypes) {
  const total = eventTypes.reduce((sum, type) => sum + type.weight, 0);
  let random = Math.random() * total;
  
  for (const eventType of eventTypes) {
    random -= eventType.weight;
    if (random <= 0) return eventType;
  }
  
  return eventTypes[0];
}

function generatePayload(type, index) {
  switch (type) {
    case 'error':
      return {
        message: `Chaos test error ${index}`,
        component: `test-module-${index % 5}`,
        severity: index % 3 === 0 ? 'high' : 'medium',
        stack: `Error: Test error ${index}\n    at test.js:${index}:1`
      };
    case 'task':
      return {
        name: `chaos-task-${index}`,
        priority: index % 4 === 0 ? 'urgent' : 'normal',
        description: `Processing chaos test item ${index}`,
        estimated_time: Math.floor(Math.random() * 300) + 60
      };
    case 'info':
      return {
        message: `System status update ${index}`,
        level: index % 3 === 0 ? 'debug' : 'info',
        service: `service-${index % 4}`,
        metric: Math.random() * 100
      };
    default:
      return { test: index };
  }
}

// Run the chaos test
chaosTest().catch(console.error);
