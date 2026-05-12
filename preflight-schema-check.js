// Pre-Flight Schema Check - Prevent "Stale Cache" Surprises
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

class PreFlightSchemaCheck {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    this.requiredColumns = [
      { name: 'event_id', type: 'text', nullable: false },
      { name: 'type', type: 'text', nullable: false },
      { name: 'status', type: 'text', nullable: false },
      { name: 'timestamp', type: 'timestamptz', nullable: false },
      { name: 'payload', type: 'jsonb', nullable: false },
      { name: 'source', type: 'text', nullable: false },
      { name: 'retry_count', type: 'integer', nullable: false },
      { name: 'schema_version', type: 'text', nullable: true },
      { name: 'correlation_id', type: 'text', nullable: true }
    ];
    
    this.requiredTables = [
      'hydi_events',
      'processed_events',
      'processing_locks',
      'system_config'
    ];
  }

  async runPreFlightCheck() {
    console.log('=== PRE-FLIGHT SCHEMA CHECK ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    
    const results = {
      tables: { passed: false, errors: [] },
      columns: { passed: false, errors: [] },
      indexes: { passed: false, errors: [] },
      constraints: { passed: false, errors: [] },
      overall: { passed: false, errors: [] }
    };
    
    try {
      // Check 1: Required tables exist
      await this.checkTables(results.tables);
      
      // Check 2: Required columns exist
      await this.checkColumns(results.columns);
      
      // Check 3: Required indexes exist
      await this.checkIndexes(results.indexes);
      
      // Check 4: Required constraints exist
      await this.checkConstraints(results.constraints);
      
      // Overall assessment
      results.overall.passed = Object.values(results).every(r => r.passed);
      
      if (results.overall.passed) {
        console.log('PRE-FLIGHT CHECK: PASSED');
        console.log('All required schema components verified');
      } else {
        console.log('PRE-FLIGHT CHECK: FAILED');
        console.log('Schema issues detected - refusing to start');
      }
      
      this.printDetailedResults(results);
      
      return results;
      
    } catch (error) {
      console.log(`Pre-flight check failed: ${error.message}`);
      results.overall.errors.push(error.message);
      return results;
    }
  }

  async checkTables(results) {
    console.log('Checking required tables...');
    
    try {
      const { data, error } = await this.supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .in('table_name', this.requiredTables);
      
      if (error) {
        throw new Error(`Table check failed: ${error.message}`);
      }
      
      const existingTables = data.map(t => t.table_name);
      const missingTables = this.requiredTables.filter(t => !existingTables.includes(t));
      
      if (missingTables.length > 0) {
        results.errors.push(`Missing tables: ${missingTables.join(', ')}`);
        console.log(`Missing tables: ${missingTables.join(', ')}`);
      } else {
        console.log('All required tables found');
        results.passed = true;
      }
      
      results.missingTables = missingTables;
      
    } catch (error) {
      results.errors.push(error.message);
      console.log(`Table check error: ${error.message}`);
    }
  }

  async checkColumns(results) {
    console.log('Checking required columns...');
    
    try {
      const { data, error } = await this.supabase
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable, column_default')
        .eq('table_name', 'hydi_events')
        .in('column_name', this.requiredColumns.map(c => c.name));
      
      if (error) {
        throw new Error(`Column check failed: ${error.message}`);
      }
      
      const existingColumns = data.map(c => c.column_name);
      const missingColumns = this.requiredColumns.filter(c => !existingColumns.includes(c.name));
      
      if (missingColumns.length > 0) {
        results.errors.push(`Missing columns: ${missingColumns.map(c => c.name).join(', ')}`);
        console.log(`Missing columns: ${missingColumns.map(c => c.name).join(', ')}`);
      } else {
        console.log('All required columns found');
        results.passed = true;
      }
      
      results.missingColumns = missingColumns;
      
      // Check column types
      const typeIssues = [];
      for (const column of this.requiredColumns) {
        const existing = data.find(c => c.column_name === column.name);
        
        if (existing) {
          if (!this.isTypeCompatible(column.type, existing.data_type)) {
            typeIssues.push(`${column.name}: expected ${column.type}, got ${existing.data_type}`);
          }
          
          if (column.nullable && existing.is_nullable === 'NO') {
            typeIssues.push(`${column.name}: expected nullable, got NOT NULL`);
          }
          
          if (!column.nullable && existing.is_nullable === 'YES') {
            typeIssues.push(`${column.name}: expected NOT NULL, got nullable`);
          }
        }
      }
      
      if (typeIssues.length > 0) {
        results.errors.push(`Type issues: ${typeIssues.join(', ')}`);
        console.log(`Type issues: ${typeIssues.join(', ')}`);
        results.passed = false;
      }
      
      results.typeIssues = typeIssues;
      
    } catch (error) {
      results.errors.push(error.message);
      console.log(`Column check error: ${error.message}`);
    }
  }

  async checkIndexes(results) {
    console.log('Checking required indexes...');
    
    try {
      const requiredIndexes = [
        'idx_hydi_events_correlation_id',
        'idx_hydi_events_type_status',
        'idx_hydi_events_timestamp_desc'
      ];
      
      const { data, error } = await this.supabase
        .from('pg_indexes')
        .select('indexname')
        .eq('schemaname', 'public')
        .in('indexname', requiredIndexes);
      
      if (error) {
        throw new Error(`Index check failed: ${error.message}`);
      }
      
      const existingIndexes = data.map(i => i.indexname);
      const missingIndexes = requiredIndexes.filter(i => !existingIndexes.includes(i));
      
      if (missingIndexes.length > 0) {
        results.errors.push(`Missing indexes: ${missingIndexes.join(', ')}`);
        console.log(`Missing indexes: ${missingIndexes.join(', ')}`);
      } else {
        console.log('All required indexes found');
        results.passed = true;
      }
      
      results.missingIndexes = missingIndexes;
      
    } catch (error) {
      results.errors.push(error.message);
      console.log(`Index check error: ${error.message}`);
    }
  }

  async checkConstraints(results) {
    console.log('Checking required constraints...');
    
    try {
      const { data, error } = await this.supabase
        .from('information_schema.table_constraints')
        .select('constraint_name, constraint_type')
        .eq('table_name', 'hydi_events')
        .eq('constraint_type', 'PRIMARY KEY');
      
      if (error) {
        throw new Error(`Constraint check failed: ${error.message}`);
      }
      
      if (data.length === 0) {
        results.errors.push('Missing PRIMARY KEY constraint');
        console.log('Missing PRIMARY KEY constraint');
      } else {
        console.log('PRIMARY KEY constraint found');
        results.passed = true;
      }
      
      results.constraints = data;
      
    } catch (error) {
      results.errors.push(error.message);
      console.log(`Constraint check error: ${error.message}`);
    }
  }

  isTypeCompatible(expected, actual) {
    const typeMap = {
      'text': ['text', 'varchar', 'character varying'],
      'integer': ['integer', 'bigint', 'smallint'],
      'timestamptz': ['timestamptz', 'timestamp with time zone'],
      'jsonb': ['jsonb', 'json']
    };
    
    const compatibleTypes = typeMap[expected] || [expected];
    return compatibleTypes.includes(actual.toLowerCase());
  }

  printDetailedResults(results) {
    console.log('\n=== PRE-FLIGHT CHECK RESULTS ===');
    
    Object.entries(results).forEach(([category, result]) => {
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(`${status}: ${category}`);
      
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach(error => {
          console.log(`  - ${error}`);
        });
      }
    });
    
    console.log('\n=== RECOMMENDATIONS ===');
    
    if (results.overall.passed) {
      console.log('System is ready to start');
    } else {
      console.log('Run the following SQL commands in Supabase:');
      
      if (results.tables.missingTables?.length > 0) {
        console.log(`-- Create missing tables`);
        results.tables.missingTables.forEach(table => {
          console.log(`CREATE TABLE ${table} (...);`);
        });
      }
      
      if (results.columns.missingColumns?.length > 0) {
        console.log(`-- Add missing columns`);
        results.columns.missingColumns.forEach(col => {
          console.log(`ALTER TABLE hydi_events ADD COLUMN ${col.name} ${col.type};`);
        });
      }
      
      if (results.typeIssues?.length > 0) {
        console.log(`-- Fix type issues`);
        results.typeIssues.forEach(issue => {
          console.log(`-- ${issue}`);
        });
      }
      
      if (results.indexes.missingIndexes?.length > 0) {
        console.log(`-- Create missing indexes`);
        results.indexes.missingIndexes.forEach(index => {
          console.log(`CREATE INDEX ${index} ON hydi_events (...);`);
        });
      }
      
      console.log('\nAfter running SQL, run: NOTIFY pgrst, \'reload schema\';');
    }
  }

  // Auto-fix common issues
  async autoFix() {
    console.log('=== AUTO-FIX COMMON ISSUES ===');
    
    try {
      // Try to refresh schema cache
      const { error } = await this.supabase.rpc('reload_schema');
      
      if (error) {
        console.log('Schema cache refresh failed - requires manual SQL');
        return { success: false, error: error.message };
      }
      
      console.log('Schema cache refreshed successfully');
      
      // Re-run pre-flight check
      const results = await this.runPreFlightCheck();
      
      return {
        success: results.overall.passed,
        results
      };
      
    } catch (error) {
      console.log(`Auto-fix failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// CLI interface
if (require.main === module) {
  const check = new PreFlightSchemaCheck();
  
  const command = process.argv[2] || 'check';
  
  (async () => {
    switch (command) {
      case 'check':
        await check.runPreFlightCheck();
        break;
        
      case 'fix':
        await check.autoFix();
        break;
        
      default:
        console.log('Usage: node preflight-schema-check.js [check|fix]');
    }
  })().catch(console.error);
}

module.exports = { PreFlightSchemaCheck };
