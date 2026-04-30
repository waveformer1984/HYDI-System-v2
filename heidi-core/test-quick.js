/**
 * Quick test of HEIDI core components (no server)
 */

const OllamaClient = require('./brain/ollama-client');
const HeidiMemory = require('./memory/sqlite-store');
const ReflectionEngine = require('./reflect/reflection-engine');
const ActionExecutor = require('./actions/action-executor');

async function test() {
  console.log('🧠 HEIDI Component Test\n');

  // Test Memory
  console.log('1. Testing Memory...');
  const memory = new HeidiMemory();
  await memory.initialize();
  console.log('   ✓ Memory initialized');
  
  await memory.storeShortTerm('test input', 'test response', { test: true }, 0.8);
  console.log('   ✓ Stored short term memory');
  
  const recent = await memory.getRecentContext(5);
  console.log('   ✓ Retrieved', recent.length, 'items');

  // Test Reflection
  console.log('\n2. Testing Reflection...');
  const reflection = new ReflectionEngine(memory);
  const insight = await reflection.reflect('test input', 'test response', 0.8);
  console.log('   ✓ Reflection generated:', insight ? 'yes' : 'no');

  // Test Actions
  console.log('\n3. Testing Actions...');
  const actions = new ActionExecutor();
  console.log('   ✓ Action executor created');
  console.log('   ✓ Approved actions:', Array.from(actions.approvedActions).join(', '));

  // Test Brain (check if Ollama available)
  console.log('\n4. Testing Brain...');
  const brain = new OllamaClient();
  const available = await brain.isAvailable();
  console.log('   ✓ Ollama available:', available);
  
  if (available) {
    const models = await brain.getModels();
    console.log('   ✓ Models:', models.join(', '));
  } else {
    console.log('   ⚠ Start Ollama: ollama run llama3');
  }

  console.log('\n✅ Component test complete');
  
  await memory.close();
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
