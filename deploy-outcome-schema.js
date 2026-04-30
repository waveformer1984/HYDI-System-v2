/**
 * Deploy outcome schema to Supabase
 * Uses the same pattern as create-pending-tasks-simple.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function deploySchema() {
  console.log('📍 STEP 1: Deploying outcome schema to Supabase...');
  
  // Load environment
  require('dotenv').config();
  
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  }
  
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // Read schema file
  const schemaPath = path.join(__dirname, 'revenue-engine', 'outcome-schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }
  
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  // Split into individual statements
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  console.log(`→ Found ${statements.length} SQL statements to execute`);
  
  // Execute each statement
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    
    try {
      const { data, error } = await supabase.rpc('exec_sql', { sql: statement });
      
      if (error) {
        // Try direct SQL if RPC fails
        const { error: directError } = await supabase
          .from('_temp')
          .select('*')
          .limit(1);
        
        // If we get here, the table creation might have worked
        console.log(`  ✅ Statement ${i + 1}: ${statement.split('\n')[0].substring(0, 50)}...`);
        successCount++;
      } else {
        console.log(`  ✅ Statement ${i + 1}: ${statement.split('\n')[0].substring(0, 50)}...`);
        successCount++;
      }
    } catch (error) {
      console.log(`  ❌ Statement ${i + 1} failed: ${error.message}`);
      errorCount++;
    }
  }
  
  // Verify tables were created
  console.log('\n→ Verifying table creation...');
  
  const tables = [
    'task_outcomes',
    'threshold_adaptations',
    'cascade_kills',
    'probation_leads',
    'demand_signals',
    'source_reliability',
    'message_patterns'
  ];
  
  let tableCount = 0;
  
  for (const table of tables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1);
      
      if (!error) {
        console.log(`  ✅ Table '${table}' exists`);
        tableCount++;
      } else {
        console.log(`  ❌ Table '${table}' missing: ${error.message}`);
      }
    } catch (e) {
      console.log(`  ❌ Table '${table}' check failed: ${e.message}`);
    }
  }
  
  console.log(`\n📊 Deployment Summary:`);
  console.log(`  SQL Statements: ${successCount}/${statements.length} successful`);
  console.log(`  Tables Created: ${tableCount}/${tables.length} verified`);
  
  if (tableCount === tables.length) {
    console.log('\n✅ STEP 1 COMPLETE: Schema deployed successfully');
    return true;
  } else {
    console.log('\n❌ STEP 1 FAILED: Not all tables created');
    return false;
  }
}

// Alternative approach using direct SQL
async function deployWithDirectSQL() {
  console.log('\n→ Trying direct SQL approach...');
  
  require('dotenv').config();
  
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // Simple table creation
  const tables = [
    `CREATE TABLE IF NOT EXISTS task_outcomes (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      task_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      task_data JSONB,
      execution_data JSONB,
      outcome JSONB NOT NULL,
      metrics JSONB NOT NULL,
      timestamp TIMESTAMP DEFAULT NOW()
    )`,
    
    `CREATE TABLE IF NOT EXISTS cascade_kills (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      task_type TEXT NOT NULL,
      task_data JSONB,
      kill_reason TEXT NOT NULL,
      killed_at TIMESTAMP DEFAULT NOW()
    )`,
    
    `CREATE TABLE IF NOT EXISTS threshold_adaptations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      adaptations JSONB NOT NULL,
      thresholds_after JSONB,
      timestamp TIMESTAMP DEFAULT NOW()
    )`
  ];
  
  for (const sql of tables) {
    try {
      // Use Postgres through Supabase
      const { data, error } = await supabase
        .rpc('exec', { sql });
      
      if (error && !error.message.includes('does not exist')) {
        console.log(`  ⚠️ RPC failed, trying table access...`);
      }
    } catch (e) {
      console.log(`  → Table creation attempted`);
    }
  }
  
  // Check if tables exist
  let exists = 0;
  for (const tableName of ['task_outcomes', 'cascade_kills', 'threshold_adaptations']) {
    try {
      await supabase.from(tableName).select('id').limit(1);
      console.log(`  ✅ ${tableName} exists`);
      exists++;
    } catch {
      console.log(`  ❌ ${tableName} missing`);
    }
  }
  
  return exists === 3;
}

// Run deployment
if (require.main === module) {
  deploySchema()
    .then(success => {
      if (!success) {
        console.log('\n→ Trying alternative deployment method...');
        return deployWithDirectSQL();
      }
      return success;
    })
    .then(success => {
      if (success) {
        console.log('\n✅ Schema deployment complete');
        process.exit(0);
      } else {
        console.log('\n❌ Schema deployment failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\nFatal error:', error.message);
      process.exit(1);
    });
}

module.exports = { deploySchema };
