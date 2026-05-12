require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Single Source of Truth Enforcement System
class SourceOfTruth {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.primary = 'supabase'; // supabase is the single source of truth
    this.driftDetection = {
      env: new Map(),
      schema: new Map(),
      state: new Map()
    };
  }

  // Enforce single source of truth
  async enforcePrimarySource() {
    console.log('=== ENFORCING SINGLE SOURCE OF TRUTH ===');
    console.log(`Primary Source: ${this.primary}`);
    
    try {
      // Step 1: Verify Supabase is accessible
      const supabaseHealth = await this.verifySupabaseHealth();
      if (!supabaseHealth) {
        throw new Error('Primary source (Supabase) is not healthy');
      }
      
      // Step 2: Check for environment drift
      await this.checkEnvironmentDrift();
      
      // Step 3: Check for schema drift
      await this.checkSchemaDrift();
      
      // Step 4: Check for state drift
      await this.checkStateDrift();
      
      // Step 5: Reconcile any drift found
      await this.reconcileDrift();
      
      console.log('=== SOURCE OF TRUTH ENFORCEMENT COMPLETE ===');
      
      return {
        primary: this.primary,
        healthy: true,
        drift: this.driftDetection
      };
      
    } catch (error) {
      console.log(`Source of truth enforcement failed: ${error.message}`);
      return {
        primary: this.primary,
        healthy: false,
        error: error.message
      };
    }
  }

  async verifySupabaseHealth() {
    try {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('count')
        .limit(1);
      
      if (error) {
        console.log(`Supabase health check failed: ${error.message}`);
        return false;
      }
      
      console.log('Supabase health check: PASSED');
      return true;
      
    } catch (error) {
      console.log(`Supabase health check error: ${error.message}`);
      return false;
    }
  }

  async checkEnvironmentDrift() {
    console.log('Checking environment drift...');
    
    // Expected environment variables
    const expectedEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NODE_ENV: process.env.NODE_ENV || 'development',
      ENVIRONMENT: process.env.ENVIRONMENT || 'development'
    };
    
    // Get stored environment from Supabase
    const { data, error } = await this.supabase
      .from('system_config')
      .select('key, value')
      .eq('config_type', 'environment');
    
    if (error) {
      console.log('Environment drift check: No stored environment found');
      // Store current environment as baseline
      await this.storeEnvironmentBaseline(expectedEnv);
      return;
    }
    
    const storedEnv = {};
    for (const item of data) {
      storedEnv[item.key] = item.value;
    }
    
    // Compare environments
    const drift = [];
    for (const [key, expectedValue] of Object.entries(expectedEnv)) {
      const storedValue = storedEnv[key];
      
      if (!storedValue) {
        drift.push({ key, issue: 'missing_in_source', expected: expectedValue });
      } else if (storedValue !== expectedValue) {
        drift.push({ key, issue: 'value_mismatch', expected: expectedValue, stored: storedValue });
      }
    }
    
    if (drift.length > 0) {
      console.log(`Environment drift detected: ${drift.length} issues`);
      drift.forEach(d => {
        console.log(`- ${d.key}: ${d.issue}`);
        if (d.expected) console.log(`  Expected: ${d.expected}`);
        if (d.stored) console.log(`  Stored: ${d.stored}`);
      });
      
      this.driftDetection.env = drift;
    } else {
      console.log('Environment drift check: PASSED');
    }
  }

  async checkSchemaDrift() {
    console.log('Checking schema drift...');
    
    try {
      // Get current schema from Supabase
      const { data, error } = await this.supabase
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable, column_default')
        .eq('table_name', 'hydi_events')
        .order('ordinal_position');
      
      if (error) {
        console.log(`Schema drift check failed: ${error.message}`);
        return;
      }
      
      // Expected schema
      const expectedSchema = {
        'event_id': { type: 'text', nullable: false, default: null },
        'type': { type: 'text', nullable: false, default: null },
        'status': { type: 'text', nullable: false, default: "'pending'" },
        'timestamp': { type: 'timestamptz', nullable: false, default: 'now()' },
        'payload': { type: 'jsonb', nullable: false, default: null },
        'source': { type: 'text', nullable: false, default: "'system'" },
        'retry_count': { type: 'integer', nullable: false, default: '0' },
        'schema_version': { type: 'text', nullable: true, default: null }
      };
      
      const currentSchema = {};
      for (const column of data) {
        currentSchema[column.column_name] = {
          type: column.data_type,
          nullable: column.is_nullable === 'YES',
          default: column.column_default
        };
      }
      
      // Compare schemas
      const drift = [];
      
      // Check for missing columns
      for (const [colName, expected] of Object.entries(expectedSchema)) {
        if (!currentSchema[colName]) {
          drift.push({ 
            column: colName, 
            issue: 'missing_in_source', 
            expected: expected 
          });
        } else {
          const current = currentSchema[colName];
          
          // Check type compatibility
          if (!this.isTypeCompatible(expected.type, current.type)) {
            drift.push({ 
              column: colName, 
              issue: 'type_mismatch', 
              expected: expected.type, 
              current: current.type 
            });
          }
          
          // Check nullability
          if (expected.nullable !== current.nullable) {
            drift.push({ 
              column: colName, 
              issue: 'nullability_mismatch', 
              expected: expected.nullable, 
              current: current.nullable 
            });
          }
        }
      }
      
      // Check for extra columns
      for (const colName of Object.keys(currentSchema)) {
        if (!expectedSchema[colName]) {
          drift.push({ 
            column: colName, 
            issue: 'extra_column', 
            current: currentSchema[colName] 
          });
        }
      }
      
      if (drift.length > 0) {
        console.log(`Schema drift detected: ${drift.length} issues`);
        drift.forEach(d => {
          console.log(`- ${d.column}: ${d.issue}`);
        });
        
        this.driftDetection.schema = drift;
      } else {
        console.log('Schema drift check: PASSED');
      }
      
    } catch (error) {
      console.log(`Schema drift check error: ${error.message}`);
    }
  }

  async checkStateDrift() {
    console.log('Checking state drift...');
    
    try {
      // Get recent events from Supabase
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('type, status, timestamp')
        .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('timestamp', { ascending: false })
        .limit(1000);
      
      if (error) {
        console.log(`State drift check failed: ${error.message}`);
        return;
      }
      
      // Analyze event patterns
      const state = {
        recent_events: data.length,
        type_distribution: {},
        status_distribution: {},
        latest_event: data[0] || null
      };
      
      for (const event of data) {
        state.type_distribution[event.type] = (state.type_distribution[event.type] || 0) + 1;
        state.status_distribution[event.status] = (state.status_distribution[event.status] || 0) + 1;
      }
      
      // Check for anomalies
      const anomalies = [];
      
      // Check for unusual status distribution
      const totalEvents = data.length;
      const failedRate = (state.status_distribution.failed || 0) / totalEvents;
      
      if (failedRate > 0.1) { // More than 10% failures
        anomalies.push({
          type: 'high_failure_rate',
          value: failedRate,
          threshold: 0.1
        });
      }
      
      // Check for event gaps
      if (data.length > 0) {
        const latestEvent = data[0];
        const timeSinceLatest = Date.now() - new Date(latestEvent.timestamp).getTime();
        
        if (timeSinceLatest > 30 * 60 * 1000) { // No events in 30 minutes
          anomalies.push({
            type: 'event_gap',
            minutes: Math.floor(timeSinceLatest / 60000),
            threshold: 30
          });
        }
      }
      
      if (anomalies.length > 0) {
        console.log(`State drift detected: ${anomalies.length} anomalies`);
        anomalies.forEach(a => {
          console.log(`- ${a.type}: ${JSON.stringify(a)}`);
        });
        
        this.driftDetection.state = anomalies;
      } else {
        console.log('State drift check: PASSED');
      }
      
    } catch (error) {
      console.log(`State drift check error: ${error.message}`);
    }
  }

  async reconcileDrift() {
    console.log('Reconciling detected drift...');
    
    const drifts = Object.values(this.driftDetection).flat();
    
    if (drifts.length === 0) {
      console.log('No drift to reconcile');
      return;
    }
    
    // Reconcile environment drift
    if (this.driftDetection.env.length > 0) {
      console.log('Reconciling environment drift...');
      await this.reconcileEnvironmentDrift();
    }
    
    // Reconcile schema drift
    if (this.driftDetection.schema.length > 0) {
      console.log('Reconciling schema drift...');
      await this.reconcileSchemaDrift();
    }
    
    // Reconcile state drift
    if (this.driftDetection.state.length > 0) {
      console.log('State drift detected but requires manual intervention');
      console.log('Please review the anomalies and take appropriate action');
    }
  }

  async reconcileEnvironmentDrift() {
    const expectedEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NODE_ENV: process.env.NODE_ENV || 'development',
      ENVIRONMENT: process.env.ENVIRONMENT || 'development'
    };
    
    // Store current environment as source of truth
    for (const [key, value] of Object.entries(expectedEnv)) {
      await this.supabase
        .from('system_config')
        .upsert({
          key,
          value,
          config_type: 'environment',
          updated_at: new Date().toISOString()
        });
    }
    
    console.log('Environment reconciliation complete');
  }

  async reconcileSchemaDrift() {
    // This would typically run schema migrations
    // For now, just log what needs to be done
    console.log('Schema reconciliation requires manual migration:');
    
    for (const drift of this.driftDetection.schema) {
      if (drift.issue === 'missing_in_source') {
        console.log(`  ADD COLUMN: ${drift.column} ${drift.expected.type}`);
      } else if (drift.issue === 'type_mismatch') {
        console.log(`  ALTER COLUMN: ${drift.column} to ${drift.expected.type}`);
      }
    }
    
    console.log('Please run manual schema migrations and re-run verification');
  }

  async storeEnvironmentBaseline(env) {
    console.log('Storing environment baseline...');
    
    for (const [key, value] of Object.entries(env)) {
      await this.supabase
        .from('system_config')
        .upsert({
          key,
          value,
          config_type: 'environment',
          created_at: new Date().toISOString()
        });
    }
  }

  isTypeCompatible(expected, current) {
    // Simplified type compatibility check
    const typeMap = {
      'text': ['text', 'varchar', 'char'],
      'integer': ['integer', 'bigint', 'smallint'],
      'timestamptz': ['timestamptz', 'timestamp'],
      'jsonb': ['jsonb', 'json']
    };
    
    const compatibleTypes = typeMap[expected] || [expected];
    return compatibleTypes.includes(current);
  }

  // Get current source of truth status
  async getStatus() {
    return {
      primary: this.primary,
      drift: this.driftDetection,
      last_check: new Date().toISOString()
    };
  }
}

// CLI interface
if (require.main === module) {
  const sot = new SourceOfTruth();
  
  const command = process.argv[2] || 'enforce';
  
  (async () => {
    switch (command) {
      case 'enforce':
        await sot.enforcePrimarySource();
        break;
        
      case 'status':
        const status = await sot.getStatus();
        console.log(JSON.stringify(status, null, 2));
        break;
        
      case 'health':
        const healthy = await sot.verifySupabaseHealth();
        console.log(`Primary source healthy: ${healthy}`);
        break;
        
      default:
        console.log('Usage: node source-of-truth.js [enforce|status|health]');
    }
  })().catch(console.error);
}

module.exports = { SourceOfTruth };
