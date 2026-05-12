require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Schema Validator and Cache Refresher
class SchemaValidator {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  async validateSchema() {
    console.log('=== SCHEMA VALIDATION ===');
    
    try {
      // Check current schema
      console.log('Step 1: Checking current schema...');
      const currentSchema = await this.getCurrentSchema();
      
      console.log('Current schema columns:');
      for (const col of currentSchema) {
        console.log(`- ${col.column_name}: ${col.data_type} (${col.is_nullable ? 'NULLABLE' : 'NOT NULL'})`);
      }
      
      // Check required columns
      const requiredColumns = ['event_id', 'type', 'status', 'timestamp', 'payload', 'retry_count', 'source'];
      const missingColumns = requiredColumns.filter(col => 
        !currentSchema.some(schema => schema.column_name === col)
      );
      
      if (missingColumns.length > 0) {
        console.log(`Missing required columns: ${missingColumns.join(', ')}`);
        return { valid: false, missingColumns: missingColumns, currentSchema };
      }
      
      console.log('Schema validation: PASSED');
      return { valid: true, missingColumns: [], currentSchema };
      
    } catch (error) {
      console.log(`Schema validation failed: ${error.message}`);
      return { valid: false, error: error.message };
    }
  }

  async getCurrentSchema() {
    try {
      const { data, error } = await this.supabase
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable, column_default')
        .eq('table_name', 'hydi_events')
        .order('ordinal_position');
      
      if (error) throw error;
      return data;
    } catch (error) {
      throw new Error(`Failed to get schema: ${error.message}`);
    }
  }

  async addMissingColumns(missingColumns) {
    console.log('=== ADDING MISSING COLUMNS ===');
    
    if (!missingColumns || missingColumns.length === 0) {
      console.log('No missing columns to add');
      return;
    }
    
    for (const column of missingColumns) {
      try {
        let sql;
        
        if (column === 'retry_count') {
          sql = 'ALTER TABLE hydi_events ADD COLUMN retry_count INT DEFAULT 0';
        } else if (column === 'source') {
          sql = "ALTER TABLE hydi_events ADD COLUMN source TEXT NOT NULL DEFAULT 'orchestrator'";
        } else {
          console.log(`Unknown column: ${column}`);
          continue;
        }
        
        console.log(`Adding column: ${column}`);
        const { error } = await this.supabase.rpc('exec_sql', { sql });
        
        if (error) {
          throw new Error(`Failed to add ${column}: ${error.message}`);
        }
        
        console.log(`Successfully added: ${column}`);
        
      } catch (error) {
        console.log(`Failed to add ${column}: ${error.message}`);
      }
    }
  }

  async refreshCache() {
    console.log('=== REFRESHING POSTGREST CACHE ===');
    
    try {
      const { error } = await this.supabase.rpc('reload_schema');
      
      if (error) {
        throw new Error(`Failed to refresh cache: ${error.message}`);
      }
      
      console.log('PostGREST cache refreshed successfully');
      
      // Wait a moment for cache to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.log(`Cache refresh failed: ${error.message}`);
    }
  }

  async testInsert() {
    console.log('=== TESTING INSERT ===');
    
    const { v4: uuidv4 } = require('uuid');
    const testEvent = {
      event_id: uuidv4(),
      type: 'schema_test',
      status: 'pending',
      timestamp: new Date().toISOString(),
      source: 'schema_validator',
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
      
      if (error) throw error;
      
      console.log('Test insert: SUCCESS');
      console.log(`Event ID: ${data[0].event_id}`);
      
      // Clean up test event
      await this.supabase
        .from('hydi_events')
        .delete()
        .eq('event_id', testEvent.event_id);
      
      return { success: true };
      
    } catch (error) {
      console.log(`Test insert: FAILED - ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async fullValidation() {
    console.log('=== FULL SCHEMA VALIDATION AND FIX ===');
    
    // Step 1: Validate current schema
    const validation = await this.validateSchema();
    
    if (!validation.valid) {
      console.log('Schema issues detected - attempting fixes...');
      
      // Step 2: Add missing columns
      await this.addMissingColumns(validation.missingColumns);
      
      // Step 3: Refresh cache
      await this.refreshCache();
      
      // Step 4: Re-validate
      console.log('Re-validating schema...');
      const revalidation = await this.validateSchema();
      
      if (revalidation.valid) {
        console.log('Schema validation: PASSED after fixes');
        
        // Step 5: Test insert
        const testResult = await this.testInsert();
        
        if (testResult.success) {
          console.log('Full validation: SUCCESS');
          return { success: true };
        } else {
          console.log(`Insert test failed: ${testResult.error}`);
          return { success: false, error: testResult.error };
        }
      } else {
        console.log('Schema validation still FAILED');
        return { success: false, error: 'Schema validation failed after fixes' };
      }
    } else {
      console.log('Schema validation: PASSED (no fixes needed)');
      
      // Test insert anyway
      const testResult = await this.testInsert();
      
      if (testResult.success) {
        console.log('Full validation: SUCCESS');
        return { success: true };
      } else {
        console.log(`Insert test failed: ${testResult.error}`);
        return { success: false, error: testResult.error };
      }
    }
  }
}

// CLI interface
if (require.main === module) {
  const validator = new SchemaValidator();
  
  const command = process.argv[2] || 'validate';
  
  (async () => {
    switch (command) {
      case 'validate':
        await validator.validateSchema();
        break;
      case 'fix':
        await validator.fullValidation();
        break;
      case 'test':
        await validator.testInsert();
        break;
      case 'refresh':
        await validator.refreshCache();
        break;
      default:
        console.log('Usage: node schema-validator.js [validate|fix|test|refresh]');
    }
  })().catch(console.error);
}

module.exports = { SchemaValidator };
