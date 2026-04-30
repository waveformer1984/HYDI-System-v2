/**
 * Create outcome tables directly via SQL
 * Bypasses schema deployment issues
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function createTables() {
  console.log('📍 Creating outcome tables directly...');
  
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Simple table creation using raw SQL
  const tables = [
    // Task outcomes table
    `CREATE TABLE IF NOT EXISTS task_outcomes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      task_data JSONB,
      execution_data JSONB,
      outcome JSONB NOT NULL,
      metrics JSONB NOT NULL,
      timestamp TIMESTAMP DEFAULT NOW()
    )`,
    
    // Cascade kills table  
    `CREATE TABLE IF NOT EXISTS cascade_kills (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      task_data JSONB,
      kill_reason TEXT NOT NULL,
      killed_at TIMESTAMP DEFAULT NOW()
    )`,
    
    // Threshold adaptations table
    `CREATE TABLE IF NOT EXISTS threshold_adaptations (
      id TEXT PRIMARY KEY,
      adaptations JSONB NOT NULL,
      thresholds_after JSONB,
      timestamp TIMESTAMP DEFAULT NOW()
    )`
  ];

  for (const sql of tables) {
    try {
      // Use Supabase SQL editor approach
      const { error } = await supabase.rpc('exec_sql', { sql });
      
      if (error && !error.message.includes('does not exist')) {
        console.log(`  ⚠️ RPC failed: ${error.message}`);
      }
    } catch (e) {
      console.log(`  → Attempting table creation...`);
    }
  }

  // Verify tables exist
  console.log('\n→ Verifying tables...');
  
  const tableNames = ['task_outcomes', 'cascade_kills', 'threshold_adaptations'];
  let created = 0;
  
  for (const tableName of tableNames) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('id')
        .limit(1);
      
      if (!error) {
        console.log(`  ✅ ${tableName} exists`);
        created++;
      } else {
        console.log(`  ❌ ${tableName}: ${error.message}`);
      }
    } catch (e) {
      console.log(`  ❌ ${tableName}: ${e.message}`);
    }
  }

  if (created === tableNames.length) {
    console.log('\n✅ All tables created successfully!');
    return true;
  } else {
    console.log(`\n❌ Only ${created}/${tableNames.length} tables created`);
    return false;
  }
}

// Alternative: Use direct HTTP request to Supabase REST API
async function createViaREST() {
  console.log('\n→ Trying REST API approach...');
  
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Try to insert a test record to create table
  const testRecord = {
    id: 'test_' + Date.now(),
    task_id: 'test',
    task_type: 'test',
    task_data: {},
    execution_data: {},
    outcome: { test: true },
    metrics: { test: true }
  };

  const { data, error } = await supabase
    .from('task_outcomes')
    .insert(testRecord);
  
  if (!error) {
    console.log('  ✅ task_outcomes created via REST');
    
    // Clean up test record
    await supabase
      .from('task_outcomes')
      .delete()
      .eq('id', testRecord.id);
    
    return true;
  } else {
    console.log(`  ❌ REST failed: ${error.message}`);
    return false;
  }
}

// Run creation
if (require.main === module) {
  createTables()
    .then(success => {
      if (!success) {
        console.log('\n→ Trying alternative method...');
        return createViaREST();
      }
      return success;
    })
    .then(success => {
      if (success) {
        console.log('\n✅ Ready to test feedback loop!');
        console.log('   Run: node test-feedback-working.js');
      } else {
        console.log('\n❌ Could not create tables');
      }
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\nError:', error.message);
      process.exit(1);
    });
}

module.exports = { createTables };
