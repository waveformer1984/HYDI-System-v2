require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Force Schema Fix - Bypass cache issues
class ForceSchemaFix {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  async forceFix() {
    console.log('=== FORCE SCHEMA FIX ===');
    
    // Step 1: Try raw SQL to add columns
    console.log('Step 1: Adding missing columns via raw SQL...');
    
    const columns = [
      { name: 'retry_count', sql: 'ALTER TABLE hydi_events ADD COLUMN retry_count INT DEFAULT 0' },
      { name: 'source', sql: "ALTER TABLE hydi_events ADD COLUMN source TEXT NOT NULL DEFAULT 'system'" }
    ];
    
    for (const column of columns) {
      try {
        console.log(`Adding column: ${column.name}`);
        
        // Use raw SQL execution
        const { data, error } = await this.supabase.rpc('exec', { sql: column.sql });
        
        if (error) {
          console.log(`Failed to add ${column.name}: ${error.message}`);
          console.log(`SQL: ${column.sql}`);
        } else {
          console.log(`Successfully added: ${column.name}`);
        }
        
      } catch (error) {
        console.log(`Error adding ${column.name}: ${error.message}`);
      }
    }
    
    // Step 2: Wait for schema to propagate
    console.log('Step 2: Waiting for schema to propagate...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 3: Test insert
    console.log('Step 3: Testing insert...');
    const testResult = await this.testInsert();
    
    if (testResult.success) {
      console.log('SUCCESS: Schema fixed and insert working');
    } else {
      console.log('FAILED: Schema fix failed');
      console.log(`Error: ${testResult.error}`);
    }
    
    return testResult;
  }

  async testInsert() {
    const testEvent = {
      event_id: uuidv4(),
      type: 'force_schema_test',
      status: 'pending',
      timestamp: new Date().toISOString(),
      source: 'force_fix',
      retry_count: 0,
      payload: {
        test: true,
        timestamp: Date.now(),
        phase: 'schema_fix'
      }
    };
    
    try {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .insert([testEvent])
        .select();
      
      if (error) throw error;
      
      console.log(`Insert SUCCESS: ${data[0].event_id}`);
      
      // Clean up
      await this.supabase
        .from('hydi_events')
        .delete()
        .eq('event_id', testEvent.event_id);
      
      return { success: true, data: data[0] };
      
    } catch (error) {
      console.log(`Insert FAILED: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async verifySchema() {
    console.log('=== VERIFYING CURRENT SCHEMA ===');
    
    try {
      // Try to select a sample row to see current schema
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('*')
        .limit(1);
      
      if (error) {
        console.log(`Schema verification failed: ${error.message}`);
        return { success: false, error: error.message };
      }
      
      if (data.length === 0) {
        console.log('No data in table - cannot verify schema');
        return { success: false, error: 'No data to verify schema' };
      }
      
      const sample = data[0];
      const availableColumns = Object.keys(sample);
      
      console.log('Available columns:');
      for (const col of availableColumns) {
        console.log(`- ${col}: ${typeof sample[col]} (${sample[col]})`);
      }
      
      const requiredColumns = ['event_id', 'type', 'status', 'timestamp', 'payload', 'retry_count', 'source'];
      const missingColumns = requiredColumns.filter(col => !availableColumns.includes(col));
      
      if (missingColumns.length > 0) {
        console.log(`Missing required columns: ${missingColumns.join(', ')}`);
        return { success: false, missingColumns, availableColumns };
      }
      
      console.log('Schema verification: PASSED');
      return { success: true, availableColumns };
      
    } catch (error) {
      console.log(`Schema verification failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// CLI interface
if (require.main === module) {
  const fixer = new ForceSchemaFix();
  
  const command = process.argv[2] || 'fix';
  
  (async () => {
    switch (command) {
      case 'verify':
        await fixer.verifySchema();
        break;
      case 'fix':
        await fixer.forceFix();
        break;
      case 'test':
        await fixer.testInsert();
        break;
      default:
        console.log('Usage: node force-schema-fix.js [verify|fix|test]');
    }
  })().catch(error => {
    console.error('Force schema fix failed:', error.message);
  });
}

module.exports = { ForceSchemaFix };
