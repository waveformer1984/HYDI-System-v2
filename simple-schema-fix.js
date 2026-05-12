require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Simple Schema Fix - Direct approach
class SimpleSchemaFix {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  async testAndFix() {
    console.log('=== SIMPLE SCHEMA FIX ===');
    
    // Test 1: Try insert with all required fields
    console.log('Test 1: Testing insert with required fields...');
    const testEvent = {
      event_id: uuidv4(),
      type: 'schema_fix_test',
      status: 'pending',
      timestamp: new Date().toISOString(),
      source: 'simple_fix',
      retry_count: 0,
      payload: {
        test: true,
        timestamp: Date.now()
      }
    };
    
    try {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .insert([testEvent])
        .select();
      
      if (error) {
        console.log(`Insert failed: ${error.message}`);
        
        // Try to fix common schema issues
        if (error.message.includes('column') && error.message.includes('does not exist')) {
          console.log('Schema issue detected - attempting fixes...');
          return await this.fixSchema(error.message);
        }
        
        throw error;
      }
      
      console.log('Insert test: SUCCESS');
      console.log(`Event ID: ${data[0].event_id}`);
      
      // Clean up
      await this.supabase
        .from('hydi_events')
        .delete()
        .eq('event_id', testEvent.event_id);
      
      return { success: true };
      
    } catch (error) {
      console.log(`Test failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async fixSchema(errorMessage) {
    console.log('=== ATTEMPTING SCHEMA FIXES ===');
    
    // Extract missing columns from error message
    const missingColumns = this.extractMissingColumns(errorMessage);
    
    if (missingColumns.length === 0) {
      console.log('Could not determine missing columns from error message');
      return { success: false, error: 'Could not determine schema issues' };
    }
    
    console.log(`Attempting to add columns: ${missingColumns.join(', ')}`);
    
    for (const column of missingColumns) {
      try {
        await this.addColumn(column);
        console.log(`Successfully added: ${column}`);
      } catch (error) {
        console.log(`Failed to add ${column}: ${error.message}`);
      }
    }
    
    // Wait for schema to update
    console.log('Waiting for schema to propagate...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test again
    console.log('Testing again after fixes...');
    return await this.testAndFix();
  }

  extractMissingColumns(errorMessage) {
    const columns = [];
    
    // Common patterns for missing column errors
    if (errorMessage.includes('retry_count')) {
      columns.push('retry_count');
    }
    
    if (errorMessage.includes('source')) {
      columns.push('source');
    }
    
    if (errorMessage.includes('event_id')) {
      columns.push('event_id');
    }
    
    if (errorMessage.includes('type')) {
      columns.push('type');
    }
    
    if (errorMessage.includes('status')) {
      columns.push('status');
    }
    
    if (errorMessage.includes('timestamp')) {
      columns.push('timestamp');
    }
    
    if (errorMessage.includes('payload')) {
      columns.push('payload');
    }
    
    return columns;
  }

  async addColumn(columnName) {
    let sql;
    
    if (columnName === 'retry_count') {
      sql = 'ALTER TABLE hydi_events ADD COLUMN retry_count INT DEFAULT 0';
    } else if (columnName === 'source') {
      sql = "ALTER TABLE hydi_events ADD COLUMN source TEXT NOT NULL DEFAULT 'system'";
    } else if (columnName === 'event_id') {
      // event_id should be UUID type, but let's use TEXT for simplicity
      sql = 'ALTER TABLE hydi_events ADD COLUMN event_id TEXT';
    } else if (columnName === 'type') {
      sql = 'ALTER TABLE hydi_events ADD COLUMN type TEXT';
    } else if (columnName === 'status') {
      sql = 'ALTER TABLE hydi_events ADD COLUMN status TEXT DEFAULT "pending"';
    } else if (columnName === 'timestamp') {
      sql = 'ALTER TABLE hydi_events ADD COLUMN timestamp TIMESTAMPTZ DEFAULT NOW()';
    } else if (columnName === 'payload') {
      sql = 'ALTER TABLE hydi_events ADD COLUMN payload JSONB';
    } else {
      throw new Error(`Unknown column: ${columnName}`);
    }
    
    console.log(`Executing: ${sql}`);
    
    // Use raw SQL execution
    const { data, error } = await this.supabase.rpc('exec', { sql });
    
    if (error) {
      throw new Error(`Failed to add column ${columnName}: ${error.message}`);
    }
    
    console.log(`Column added successfully: ${columnName}`);
  }
}

// CLI interface
if (require.main === module) {
  const fixer = new SimpleSchemaFix();
  
  fixer.testAndFix().then(result => {
    console.log('\n=== FINAL RESULT ===');
    console.log(`Success: ${result.success}`);
    if (!result.success) {
      console.log(`Error: ${result.error}`);
    }
  }).catch(error => {
    console.error('Schema fix failed:', error.message);
  });
}

module.exports = { SimpleSchemaFix };
