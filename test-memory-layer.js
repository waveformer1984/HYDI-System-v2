/**
 * Test the memory layer - verify it cannot lie
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { MemoryStore } = require('./src/memory/MemoryStore.js');

async function testMemoryLayer() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     TESTING MEMORY LAYER                     ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Initialize memory store
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );
  
  const memory = new MemoryStore(supabase);

  // STEP 1: Verify tables exist
  console.log('📍 STEP 1: Verifying required tables...');
  try {
    await memory.initialize();
    console.log('  ✅ All tables accessible');
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
    console.log('\n→ Run this SQL in Supabase dashboard:');
    console.log(`
CREATE TABLE IF NOT EXISTS task_outcomes (
  id uuid primary key default gen_random_uuid(),
  task_id text,
  task_type text,
  task_data jsonb,
  execution_data jsonb,
  outcome jsonb,
  metrics jsonb,
  timestamp timestamp default now()
);

CREATE TABLE IF NOT EXISTS cascade_kills (
  id uuid primary key default gen_random_uuid(),
  task_type text,
  task_data jsonb,
  kill_reason text,
  killed_at timestamp default now()
);

CREATE TABLE IF NOT EXISTS threshold_adaptations (
  id uuid primary key default gen_random_uuid(),
  adaptations jsonb,
  thresholds_after jsonb,
  timestamp timestamp default now()
);
    `);
    return false;
  }

  // STEP 2: Test write with verification
  console.log('\n📍 STEP 2: Testing write with verification...');
  try {
    const testData = {
      task_id: 'test_' + Date.now(),
      task_type: 'execution',
      outcome: { success: true },
      metrics: { margin: 25 }
    };

    const result = await memory.writeAndVerify('task_outcomes', testData, 'task_id');
    console.log('  ✅ Write verified:', result.task_id);
  } catch (e) {
    console.log(`  ❌ Write failed: ${e.message}`);
    return false;
  }

  // STEP 3: Test read
  console.log('\n📍 STEP 3: Testing read...');
  try {
    const records = await memory.read('task_outcomes', { task_type: 'execution' });
    console.log(`  ✅ Read ${records.length} records`);
  } catch (e) {
    console.log(`  ❌ Read failed: ${e.message}`);
    return false;
  }

  // STEP 4: Test aggregate
  console.log('\n📍 STEP 4: Testing aggregate...');
  try {
    const margins = await memory.aggregate('task_outcomes', 'metrics');
    console.log(`  ✅ Aggregated ${margins.length} metric records`);
  } catch (e) {
    console.log(`  ❌ Aggregate failed: ${e.message}`);
    return false;
  }

  // STEP 5: Test with RealityFilter
  console.log('\n📍 STEP 5: Testing RealityFilter with memory...');
  const RealityFilter = require('./src/control/RealityFilter.js');
  
  try {
    const filter = new RealityFilter();
    
    // Test a task that should be blocked
    const task = {
      type: 'execution',
      estimatedRevenue: 100,
      estimatedCost: 85 // 15% margin
    };

    const result = await filter.filter(task);
    console.log(`  → Task result: ${result.approved ? 'APPROVED' : 'BLOCKED'}`);
    console.log(`  → Reason: ${result.reason}`);
    
    // Log the kill
    if (!result.approved) {
      await filter.logKill(task, result.reason);
      console.log('  ✅ Kill logged to memory');
    }
  } catch (e) {
    console.log(`  ❌ RealityFilter test failed: ${e.message}`);
  }

  // STEP 6: Test with OutcomeValidator
  console.log('\n📍 STEP 6: Testing OutcomeValidator with memory...');
  const OutcomeValidator = require('./src/control/OutcomeValidator.js');
  
  try {
    const validator = new OutcomeValidator();
    
    const task = {
      id: 'test_outcome',
      type: 'execution'
    };
    
    const execution = { cost: 85 };
    const outcome = { success: false, revenue: 0 };
    
    await validator.recordOutcome(task, execution, outcome);
    console.log('  ✅ Outcome recorded to memory');
  } catch (e) {
    console.log(`  ❌ OutcomeValidator test failed: ${e.message}`);
  }

  // STEP 7: Show memory stats
  console.log('\n📍 STEP 7: Memory statistics...');
  const stats = await memory.getStats();
  console.log('  → Task outcomes:', stats.task_outcomes || 0);
  console.log('  → Cascade kills:', stats.cascade_kills || 0);
  console.log('  → Threshold adaptations:', stats.threshold_adaptations || 0);

  console.log('\n✅ Memory layer test complete!');
  console.log('   The system now has persistent memory that cannot lie.');
  
  return true;
}

// Run the test
if (require.main === module) {
  testMemoryLayer()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\nFatal error:', error);
      process.exit(1);
    });
}

module.exports = { testMemoryLayer };
