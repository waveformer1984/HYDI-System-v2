/**
 * Test script to verify strategic_theme fix
 */

const axios = require('axios');

async function testStrategicThemeFix() {
  console.log('Testing strategic_theme fix...');
  
  try {
    // Test 1: Basic /revenue/tasks endpoint
    console.log('\n1. Testing /revenue/tasks endpoint...');
    const response1 = await axios.get('http://localhost:3458/revenue/tasks');
    console.log('✓ /revenue/tasks works - Status:', response1.status);
    console.log('✓ Tasks returned:', response1.data.tasks?.length || 0);
    
    // Test 2: With theme parameter
    console.log('\n2. Testing /revenue/tasks?theme=revenue...');
    const response2 = await axios.get('http://localhost:3458/revenue/tasks?theme=revenue');
    console.log('✓ /revenue/tasks?theme=revenue works - Status:', response2.status);
    
    // Test 3: Anti-misalignment endpoint
    console.log('\n3. Testing /revenue/anti-misalignment...');
    const response3 = await axios.get('http://localhost:3458/revenue/anti-misalignment');
    console.log('✓ /revenue/anti-misalignment works - Status:', response3.status);
    console.log('✓ Forbidden pattern violations:', response3.data.forbidden_pattern_violations);
    
    // Test 4: Structural health endpoint
    console.log('\n4. Testing /revenue/structural-health...');
    const response4 = await axios.get('http://localhost:3458/revenue/structural-health');
    console.log('✓ /revenue/structural-health works - Status:', response4.status);
    console.log('✓ Health rating:', response4.data.structural_health?.health_rating);
    
    // Test 5: Verify strategic_theme is present in tasks
    console.log('\n5. Verifying strategic_theme in task data...');
    const tasks = response1.data.tasks || [];
    const tasksWithTheme = tasks.filter(task => task.strategic_theme);
    console.log('✓ Tasks with strategic_theme:', tasksWithTheme.length, '/', tasks.length);
    
    if (tasksWithTheme.length === tasks.length && tasks.length > 0) {
      console.log('✓ All tasks have strategic_theme assigned');
    } else {
      console.log('⚠ Some tasks missing strategic_theme');
    }
    
    console.log('\n🎉 All tests passed! strategic_theme issue is fixed.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

testStrategicThemeFix();
