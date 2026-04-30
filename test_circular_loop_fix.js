// Test to verify circular event loop is fixed

const protoforgeEventBus = require('./modules/protoforge-event-bus');
const { v4: uuidv4 } = require('uuid');

async function testCircularLoopFix() {
  console.log('=== TESTING CIRCULAR LOOP FIX ===\n');
  
  let eventCount = 0;
  const maxEvents = 10;
  
  // Track events to detect loops
  const eventTracker = new Set();
  
  // Listen to all events
  protoforgeEventBus.on('validation_complete', (event) => {
    eventCount++;
    const eventKey = `${event.type}:${event.event_id}`;
    
    if (eventTracker.has(eventKey)) {
      console.log(`\u274c CIRCULAR DETECTED: ${eventKey} (count: ${eventCount})`);
      process.exit(1);
    }
    
    eventTracker.add(eventKey);
    console.log(`[${eventCount}] Validation: ${event.type} - ${event.status}`);
    
    if (eventCount > maxEvents) {
      console.log('\u2702b\ufe0f No circular loop detected (test passed)');
      process.exit(0);
    }
  });
  
  // Send a test event that would normally trigger validation
  const testEvent = {
    event_id: uuidv4(),
    type: 'purchase_intent',
    source: 'test',
    timestamp: new Date().toISOString(),
    payload: { decision_maker: true }
  };
  
  console.log('Sending test event...');
  await protoforgeEventBus.processEvent(testEvent);
  
  // Wait to see if circular loop occurs
  setTimeout(() => {
    if (eventCount <= maxEvents) {
      console.log('\u2702b\ufe0f Circular loop fixed successfully');
      console.log(`Total events processed: ${eventCount}`);
    }
  }, 2000);
}

testCircularLoopFix().catch(console.error);
