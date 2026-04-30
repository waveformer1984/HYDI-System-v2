// Simple test script for ProtoForge Kilo Node
const kilo = require('./kilo');

async function testSystem() {
  console.log('Starting ProtoForge System Test...');
  
  try {
    // Initialize Kilo
    await kilo.initialize();
    console.log('✓ Kilo initialized');
    
    // Test execution
    const result = await kilo.execute('test_task');
    console.log('✓ Task execution result:', result);
    
    // Test event emission
    const event = {
      type: 'test_event',
      payload: { message: 'Hello ProtoForge' }
    };
    
    kilo.emit(event);
    console.log('✓ Event emitted to Cascade');
    
    console.log('All tests passed! System is operational.');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testSystem();
