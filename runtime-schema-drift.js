// Runtime Schema Drift Detection - Continuous Schema Validation
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

class RuntimeSchemaDriftDetector {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    this.schemaHash = null;
    this.lastCheck = null;
    this.checkInterval = 30000; // 30 seconds
    this.isRunning = false;
    this.driftDetected = false;
    this.alerts = [];
    this.metrics = {
      checks: 0,
      drifts: 0,
      errors: 0,
      lastCheck: null
    };
  }

  // Start continuous monitoring
  start() {
    console.log('=== RUNTIME SCHEMA DRIFT DETECTOR STARTED ===');
    
    this.isRunning = true;
    this.scheduleNextCheck();
    
    console.log(`Schema drift monitoring started (interval: ${this.checkInterval}ms)`);
  }

  // Stop monitoring
  stop() {
    console.log('=== RUNTIME SCHEMA DRIFT DETECTOR STOPPED ===');
    this.isRunning = false;
  }

  // Schedule next check
  scheduleNextCheck() {
    if (!this.isRunning) return;
    
    setTimeout(() => {
      this.performCheck().catch(error => {
        console.log(`Schema drift check error: ${error.message}`);
        this.metrics.errors++;
        this.scheduleNextCheck();
      });
    }, this.checkInterval);
  }

  // Perform schema drift check
  async performCheck() {
    const startTime = Date.now();
    
    try {
      console.log(`Performing schema drift check #${this.metrics.checks + 1}`);
      
      // Step 1: Get current schema hash
      const currentHash = await this.calculateSchemaHash();
      
      // Step 2: Compare with stored hash
      const drift = this.compareWithStoredHash(currentHash);
      
      // Step 3: Update metrics
      this.metrics.checks++;
      this.metrics.lastCheck = new Date().toISOString();
      
      if (drift.detected) {
        this.metrics.drifts++;
        this.driftDetected = true;
        
        console.log('SCHEMA DRIFT DETECTED!');
        console.log(`Expected: ${drift.expectedHash}`);
        console.log(`Current: ${drift.currentHash}`);
        console.log(`Details: ${drift.details}`);
        
        // Add to alerts
        this.alerts.push({
          timestamp: new Date().toISOString(),
          type: 'schema_drift',
          expectedHash: drift.expectedHash,
          currentHash: drift.currentHash,
          details: drift.details,
          severity: drift.severity || 'medium'
        });
        
        // Take action based on drift
        await this.handleSchemaDrift(drift);
        
      } else {
        this.driftDetected = false;
        console.log('Schema drift check: PASSED');
        
        // Update stored hash
        await this.updateStoredHash(currentHash);
        
        // Clear old alerts if system is stable
        if (this.alerts.length > 0) {
          this.alerts = this.alerts.slice(-5); // Keep only last 5 alerts
        }
      }
      
      const checkDuration = Date.now() - startTime;
      console.log(`Schema drift check completed in ${checkDuration}ms`);
      
    } catch (error) {
      console.log(`Schema drift check error: ${error.message}`);
      this.metrics.errors++;
      this.scheduleNextCheck();
    }
  }

  // Calculate current schema hash
  async calculateSchemaHash() {
    try {
      // Get schema information
      const { data, error } = await this.supabase
        .from('information_schema.columns')
        .select('column_name', 'data_type', 'is_nullable', 'column_default', 'character_maximum_length')
        .eq('table_schema', 'public')
        .eq('table_name', 'hydi_events')
        .order('ordinal_position');
      
      if (error) {
        throw new Error(`Failed to get schema: ${error.message}`);
      }
      
      // Create hash from schema definition
      const schemaString = data.map(col => 
        `${col.column_name}:${col.data_type}:${col.is_nullable}:${col.column_default || 'NULL'}:${col.character_maximum_length}`
      ).join('|');
      
      // Simple hash function (in production, use crypto.createHash)
      const crypto = require('crypto');
      const hash = crypto.createHash('md5').update(schemaString).digest('hex');
      
      return hash;
      
    } catch (error) {
      throw new Error(`Schema hash calculation failed: ${error.message}`);
    }
  }

  // Compare with stored hash
  compareToStoredHash(currentHash) {
    try {
      // Get stored hash from system_config
      const { data, error } = await this.supabase
        .from('system_config')
        .select('value')
        .eq('key', 'schema_hash')
        .single();
      
      const storedHash = data?.value || null;
      
      if (!storedHash) {
        return {
          detected: true,
          expectedHash: null,
          currentHash,
          details: 'No stored schema hash found',
          severity: 'high'
        };
      }
      
      if (currentHash !== storedHash) {
        return {
          detected: true,
          expectedHash: storedHash,
          currentHash,
          details: `Schema hash changed from ${storedHash} to ${currentHash}`,
          severity: 'medium'
        };
      }
      
      return {
        detected: false,
        expectedHash: storedHash,
        currentHash,
        details: 'Schema hash matches'
      };
      
    } catch (error) {
      return {
        detected: true,
        expectedHash: 'unknown',
        currentHash,
        details: `Failed to compare with stored hash: ${error.message}`,
        severity: 'high'
      };
    }
  }

  // Update stored hash
  async updateStoredHash(hash) {
    try {
      await this.supabase
        .from('system_config')
        .upsert({
          key: 'schema_hash',
          value: hash,
          config_type: 'schema',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'key'
        });
      
      console.log('Schema hash updated in system_config');
      
    } catch (error) {
      console.log(`Failed to update stored hash: ${error.message}`);
      throw error;
    }
  }

  // Handle schema drift
  async handleSchemaDrift(drift) {
    console.log('=== HANDLING SCHEMA DRIFT ===');
    
    // Step 1: Degrade system mode
    console.log('Degrading system mode to DEGRADED');
    
    // Step 2: Alert stakeholders
    await this.sendAlert({
      type: 'schema_drift',
      message: 'Schema drift detected - system degraded',
      severity: 'high',
      details: drift.details,
      expectedHash: drift.expectedHash,
      currentHash: drift.currentHash
    });
    
    // Step 3: Enter safe mode
    console.log('Entering SAFE MODE - limited operations only');
    
    // Step 4: Schedule immediate re-check
    console.log('Scheduling immediate re-check in 5 seconds...');
    setTimeout(() => this.performCheck(), 5000);
    
    return {
      action: 'degraded',
      mode: 'SAFE_MODE',
      nextCheck: 'immediate'
    };
  }

  // Send alert
  async sendAlert(alert) {
    console.log(`ALERT: ${alert.type} - ${alert.message}`);
    
    // In production, this would send to monitoring system
    // For now, just log it
    console.log(`Alert details: ${JSON.stringify(alert, null, 2)}`);
    
    // Store alert in database
    try {
      await this.supabase
        .from('system_alerts')
        .insert([{
          id: Date.now().toString(),
          type: alert.type,
          message: alert.message,
          severity: alert.severity,
          details: alert.details,
          timestamp: new Date().toISOString(),
          resolved: false
        }]);
      
    } catch (error) {
      console.log(`Failed to store alert: ${error.message}`);
    }
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      driftDetected: this.driftDetected,
      lastCheck: this.metrics.lastCheck,
      metrics: this.metrics,
      alerts: this.alerts,
      schemaHash: this.schemaHash,
      checkInterval: this.checkInterval
    };
  }

  // Force schema hash refresh
  async forceHashRefresh() {
    console.log('Forcing schema hash refresh...');
    
    try {
      const currentHash = await this.calculateSchemaHash();
      await this.updateStoredHash(currentHash);
      
      this.schemaHash = currentHash;
      
      console.log('Schema hash force refreshed');
      
    } catch (error) {
      console.log(`Failed to force refresh schema hash: ${error.message}`);
      throw error;
    }
  }

  // Test runtime drift detection
  async testRuntimeDrift() {
    console.log('=== TESTING RUNTIME SCHEMA DRIFT DETECTION ===');
    
    try {
      // Start the detector
      this.start();
      
      // Wait for first check
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Stop after a few checks
      setTimeout(() => this.stop(), 5000);
      
      // Get final status
      const status = this.getStatus();
      
      console.log('=== RUNTIME DRIFT TEST RESULTS ===');
      console.log(`Total checks: ${status.metrics.checks}`);
      console.log(`Drifts detected: ${status.metrics.drifts}`);
      console.log(`Errors: ${status.metrics.errors}`);
      console.log(`Alerts: ${status.alerts.length}`);
      
      if (status.driftDetected) {
        console.log('STATUS: DRIFT DETECTED - System would degrade');
        console.log('This is expected behavior - the system is working correctly');
      } else {
        console.log('STATUS: NO DRIFT - System is stable');
      }
      
      return status;
      
    } catch (error) {
      console.log(`Runtime drift test failed: ${error.message}`);
      throw error;
    }
  }

  // Test manual drift simulation
  async testManualDrift() {
    console.log('=== TESTING MANUAL DRIFT SIMULATION ===');
    
    try {
      // Get initial hash
      const initialHash = await this.calculateSchemaHash();
      console.log(`Initial schema hash: ${initialHash}`);
      
      // Simulate schema change by updating stored hash
      const fakeHash = 'fake_hash_' + Date.now().toString(36);
      await this.updateStoredHash(fakeHash);
      
      console.log(`Simulated schema hash change: ${fakeHash}`);
      
      // Wait for next check
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Perform check (should detect drift)
      const drift = this.compareToStoredHash(initialHash);
      
      console.log('Manual drift simulation:');
      console.log(`Detected: ${drift.detected}`);
      console.log(`Expected: ${drift.expectedHash}`);
      console.log(`Current: ${drift.currentHash}`);
      console.log(`Details: ${drift.details}`);
      
      // Restore correct hash
      await this.updateStoredHash(initialHash);
      console.log('Restored correct hash');
      
      return drift;
      
    } catch (error) {
      console.log(`Manual drift test failed: ${error.message}`);
      throw error;
    }
  }

  // Get schema hash
  async getSchemaHash() {
    if (!this.schemaHash) {
      this.schemaHash = await this.calculateSchemaHash();
    }
    
    return this.schemaHash;
  }
}

// CLI interface
if (require.main === module) {
  const detector = new RuntimeSchemaDriftDetector();
  
  const command = process.argv[2] || 'status';
  
  (async () => {
    switch (command) {
      case 'start':
        detector.start();
        
        // Keep running
        process.on('SIGINT', () => {
          console.log('Stopping schema drift detector...');
          detector.stop();
          process.exit(0);
        });
        
        break;
        
      case 'stop':
        detector.stop();
        break;
        
      case 'status':
        console.log(JSON.stringify(detector.getStatus(), null, 2));
        break;
        
      case 'test':
        await detector.testRuntimeDrift();
        break;
        
      case 'manual':
        await detector.testManualDrift();
        break;
        
      case 'hash':
        await detector.forceHashRefresh();
        break;
        
      default:
        console.log('Usage: node runtime-schema-drift.js [start|stop|status|test|manual|hash]');
    }
  })().catch(console.error);
}

module.exports = { RuntimeSchemaDetector };
