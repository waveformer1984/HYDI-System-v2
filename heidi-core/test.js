/**
 * HEIDI Quick Test
 * Verify everything works
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3456';

async function test() {
  console.log('🧠 Testing HEIDI\n');

  // Test 1: Health
  console.log('1. Health check...');
  try {
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('   ✓ Status:', health.data.status);
    console.log('   ✓ Brain:', health.data.brain);
  } catch (e) {
    console.log('   ✗ Health check failed:', e.message);
    console.log('   Is HEIDI running? (npm start)');
    return;
  }

  // Test 2: State
  console.log('\n2. State check...');
  try {
    const state = await axios.get(`${BASE_URL}/state`);
    console.log('   ✓ Status:', state.data.status);
    console.log('   ✓ Brain model:', state.data.brain.model);
    console.log('   ✓ Memory initialized:', state.data.memory.initialized);
  } catch (e) {
    console.log('   ✗ State check failed:', e.message);
  }

  // Test 3: Think (if brain available)
  console.log('\n3. Think test...');
  try {
    const think = await axios.post(`${BASE_URL}/think`, {
      input: 'Hello Heidi, what is your purpose?',
      context: { test: true }
    });
    console.log('   ✓ Response received');
    console.log('   ✓ Latency:', think.data.latency_ms, 'ms');
    console.log('   ✓ Confidence:', think.data.confidence);
    console.log('   ✓ Model:', think.data.model);
    console.log('\n   Response preview:', think.data.response.substring(0, 100) + '...');
  } catch (e) {
    console.log('   ✗ Think failed:', e.message);
    if (e.response?.data?.error) {
      console.log('   Error:', e.response.data.error);
    }
  }

  // Test 4: Reflection
  console.log('\n4. Reflection test...');
  try {
    const reflect = await axios.post(`${BASE_URL}/reflect`, {
      window_minutes: 10
    });
    console.log('   ✓ Insights:', reflect.data.insights_generated);
  } catch (e) {
    console.log('   ✗ Reflection failed:', e.message);
  }

  // Test 5: Action (safe log only)
  console.log('\n5. Action test...');
  try {
    const act = await axios.post(`${BASE_URL}/act`, {
      type: 'log_event',
      target: 'test_event',
      payload: { test: true, timestamp: Date.now() }
    });
    console.log('   ✓ Action executed:', act.data.result.result);
  } catch (e) {
    console.log('   ✗ Action failed:', e.message);
  }

  console.log('\n✅ Tests complete');
}

test().catch(console.error);
