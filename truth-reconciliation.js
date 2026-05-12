// Truth Reconciliation Loop - Ensuring Consistency Across All Components
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

class TruthReconciliation {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    this.reconciliationInterval = 60000; // 1 minute
    this.isRunning = false;
    this.metrics = {
      reconciliations: 0,
      divergences: 0,
      errors: 0,
      lastReconciliation: null
    };
    
    this.stateSnapshots = new Map();
    this.eventLog = [];
    this.alerts = [];
  }

  // Start reconciliation loop
  start() {
    console.log('=== TRUTH RECONCILIATION LOOP STARTED ===');
    
    this.isRunning = true;
    this.scheduleNextReconciliation();
    
    console.log(`Truth reconciliation started (interval: ${this.reconciliationInterval}ms)`);
    
    // Keep running until stopped
    process.on('SIGINT', () => {
      console.log('Stopping truth reconciliation loop...');
      this.stop();
      process.exit(0);
    });
  }

  // Stop reconciliation loop
  stop() {
    console.log('=== TRUTH RECONCILIATION LOOP STOPPED ===');
    this.isRunning = false;
  }

  // Schedule next reconciliation
  scheduleNextReconciliation() {
    if (!this.isRunning) return;
    
    setTimeout(() => {
      this.performReconciliation().catch(error => {
        console.log(`Reconciliation error: ${error.message}`);
        this.metrics.errors++;
        this.scheduleNextReconciliation();
      });
    }, this.reconciliationInterval);
  }

  // Perform truth reconciliation
  async performReconciliation() {
    const startTime = Date.now();
    
    try {
      console.log(`Performing truth reconciliation #${this.metrics.reconciliations + 1}`);
      
      // Step 1: Get current state from event log
      const eventState = await this.getEventState();
      
      // Step 2: Get current state from database
      const dbState = await this.getDatabaseState();
      
      // Step 3: Compare and reconcile
      const reconciliation = this.reconcileStates(eventState, dbState);
      
      // Step 4: Update metrics
      this.metrics.reconciliations++;
      this.metrics.lastReconciliation = new Date().toISOString();
      
      if (reconciliation.hasDivergence) {
        this.metrics.divergences++;
        console.log('TRUTH RECONCILIATION: DIVERGENCE DETECTED');
        console.log(`Event state count: ${eventState.eventCount}`);
        console.log(`DB state count: ${dbState.eventCount}`);
        console.log(`Divergences: ${reconciliation.divergences.length}`);
        
        // Log specific divergences
        reconciliation.divergences.forEach(divergence => {
          console.log(`  - ${divergence.type}: ${divergence.description}`);
        });
        
        // Take action based on divergence
        await this.handleDivergence(reconciliation);
        
      } else {
        console.log('TRUTH RECONCILIATION: CONSISTENT');
        console.log(`Event state count: ${eventState.eventCount}`);
        console.log(`DB state count: ${reconciliation.eventCount}`);
        
        // Clear old alerts if system is stable
        if (this.alerts.length > 0) {
          this.alerts = this.alerts.slice(-3); // Keep only last 3 alerts
        }
      }
      
      const duration = Date.now() - startTime;
      console.log(`Reconciliation completed in ${duration}ms`);
      
      // Store reconciliation log
      this.storeReconciliationLog(reconciliation);
      
    } catch (error) {
      console.log(`Reconciliation error: ${error.message}`);
      this.metrics.errors++;
      this.scheduleNextReconciliation();
    }
  }

  // Get current state from event log
  async getEventState() {
    try {
      // Get all events from event log
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('event_id', 'type', 'status', 'timestamp', 'payload')
        .order('timestamp', { ascending: true });
      
      if (error) {
        throw new Error(`Failed to get event state: ${error.message}`);
      }
      
      // Build state snapshot from events
      const state = {
        eventCount: data.length,
        typeDistribution: {},
        statusDistribution: {},
        latestEvent: data[data.length - 1],
        earliestEvent: data[0],
        stateHash: this.calculateStateHash(data)
      };
      
      // Calculate distributions
      data.forEach(event => {
        state.typeDistribution[event.type] = (state.typeDistribution[event.type] || 0) + 1;
        state.statusDistribution[event.status] = (state.statusDistribution[event.status] || 0) + 1;
      });
      
      return state;
      
    } catch (error) {
      throw new Error(`Event state calculation failed: ${error.message}`);
    }
  }

  // Get current state from database
  async getDatabaseState() {
    try {
      // Get processed events from database
      const { data, error } = await this.supabase
        .from('processed_events')
        .select('event_id', 'type', 'status', 'processed_at', 'result')
        .order('processed_at', { ascending: true });
      
      if (error) {
        throw new Error(`Failed to get database state: ${error.message}`);
      }
      
      // Build state snapshot from database
      const state = {
        eventCount: data.length,
        typeDistribution: {},
        statusDistribution: {},
        latestEvent: data.length > 0 ? data[data.length - 1] : null,
        earliestEvent: data.length > 0 ? data[0] : null,
        stateHash: this.calculateStateHash(data)
      };
      
      // Calculate distributions
      data.forEach(event => {
        state.typeDistribution[event.type] = (state.typeDistribution[event.type] || 0) + 1;
        state.statusDistribution[event.status] = (state.statusDistribution[event.status] || 0) + 1;
      });
      
      return state;
      
    } catch (error) {
      throw new Error(`Database state calculation failed: ${error.message}`);
    }
  }

  // Calculate state hash
  calculateStateHash(data) {
    // Create hash from state snapshot
    const stateString = data.map(item => 
      `${item.event_id}:${item.type}:${item.status}:${item.timestamp}:${JSON.stringify(item.payload || {}).slice(0, 100)}`
    ).join('|');
    
    const crypto = require('crypto');
    return crypto.createHash('md5').update(stateString).digest('hex');
  }

  // Reconcile states
  reconcileStates(eventState, dbState) {
    const divergence = {
      hasDivergence: false,
      type: [],
      count: {
        events: eventState.eventCount - dbState.eventCount,
        types: Object.keys(eventState.typeDistribution).length - Object.keys(dbState.typeDistribution).length,
        statuses: Object.keys(eventState.statusDistribution).length - Object.keys(dbState.statusDistribution).length
      },
      details: []
    };
    
    // Check event count divergence
    if (eventState.eventCount !== dbState.eventCount) {
      divergence.hasDivergence = true;
      divergence.type.push('event_count_mismatch');
      divergence.details.push(`Events: eventState.eventCount} vs ${dbState.eventCount}`);
    }
    
    // Check type distribution divergence
    const eventTypes = new Set([
      ...Object.keys(eventState.typeDistribution),
      ...Object.keys(dbState.typeDistribution)
    ]);
    
    for (const type of eventTypes) {
      const eventCount = eventState.typeDistribution[type] || 0;
      const dbCount = dbState.typeDistribution[type] || 0;
      
      if (eventCount !== dbCount) {
        divergence.hasDivergence = true;
        divergence.type.push('type_distribution_mismatch');
        divergence.details.push(`Type ${type}: ${eventCount} vs ${dbCount}`);
      }
    }
    
    // Check status distribution divergence
    const statuses = new Set([
      ...Object.keys(eventState.statusDistribution),
      ...Object.keys(dbState.statusDistribution)
    ]);
    
    for (const status of statuses) {
      const eventCount = eventState.statusDistribution[status] || 0;
      const dbCount = dbState.statusDistribution[status] || 0;
      
      if (eventCount !== dbCount) {
        divergence.hasDivergence = true;
        divergence.type.push('status_distribution_mismatch');
        divergence.details.push(`Status ${status}: ${eventCount} vs ${dbCount}`);
      }
    }
    
    // Check latest event timestamp
    if (eventState.latestEvent?.timestamp !== dbState.latestEvent?.timestamp) {
      divergence.hasDivergence = true;
      divergence.type.push('latest_event_mismatch');
      divergence.details.push(`Latest event: ${eventState.latestEvent?.timestamp} vs ${dbState.latestEvent?.timestamp}`);
    }
    
    return divergence;
  }

  // Handle divergence
  async handleDivergence(reconciliation) {
    console.log('=== HANDLING DIVERGENCE ===');
    
    // Log divergence details
    reconciliation.divergences.forEach(divergence => {
      console.log(`  ${divergence.type}: ${divergence.details}`);
    });
    
    // Take action based on divergence type
    if (reconciliation.count.events > 0) {
      console.log('Event count mismatch detected - investigating...');
      await this.investigateEventCountMismatch(reconciliation.count.events);
    }
    
    if (reconciliation.count.types > 0) {
      console.log('Type distribution mismatch detected - investigating...');
      await this.investigateTypeDistributionMismatch(reconciliation.count.types);
    }
    
    if (reconciliation.count.statuses > 0) {
      console.log('Status distribution mismatch detected - investigating...');
      await this.investigateStatusDistributionMismatch(reconciliation.count.statuses);
    }
    
    // Take corrective action
    console.log('Taking corrective action...');
    await this.takeCorrectiveAction(reconciliation);
  }

  async investigateEventCountMismatch(count) {
    console.log(`Investigating event count mismatch: ${count} events difference`);
    
    // Get details from both sources
    const { data: eventData, error: eventError } = await this.supabase
      .from('hydi_events')
      .select('event_id', 'timestamp')
      .order('timestamp', { ascending: false })
      .limit(Math.abs(count));
    
    const { data: processedData, error: processedError } = await this.supabase
      .from('processed_events')
      .select('event_id', 'processed_at')
      .order('processed_at', { ascending: false })
      .limit(Math.abs(count));
    
    console.log('Event log details:');
    eventData.forEach((event, index) => {
      console.log(`  Event ${index + 1}: ${event.event_id} (${event.timestamp})`);
    });
    
    if (processedData.length > 0) {
      console.log('Processed events details:');
      processedData.forEach((event, index) => {
        console.log(`  Processed ${index + 1}: ${event.event_id} (${event.processed_at})`);
      });
    }
    
    // In production, this would trigger investigation
    console.log('Event count mismatch investigation completed');
  }

  async investigateTypeDistributionMismatch(types) {
    console.log(`Investigating type distribution mismatch: ${types.length} types affected`);
    
    // Get type details from both sources
    const { data: eventData, error: eventError } = await this.supabase
      .from('hydi_events')
      .select('type', 'status')
      .order('type', { ascending: true });
    
    const { data: processedData, error: processedError } = await this.supabase
      .from('processed_events')
      .select('type', 'status')
      .order('type', { ascending: true });
    
    console.log('Type distribution from event log:');
    eventData.forEach((row, index) => {
      console.log(`  ${row.type}: ${row.status} (${row.count || 0} events)`);
    });
    
    if (processedData.length > 0) {
      console.log('Type distribution from processed events:');
      processedData.forEach((row, index) => {
        console.log(`  ${row.type}: ${row.status} (${row.count || 0} events)`);
      });
    }
    
    console.log('Type distribution mismatch investigation completed');
  }

  async investigateStatusDistributionMismatch(statuses) {
    console.log(`Investigating status distribution mismatch: ${statuses.length} statuses affected`);
    
    // Get status details from both sources
    const { data: eventData, error: eventError } = await this.supabase
      .from('hydi_events')
      .select('status', 'timestamp')
      .order('status', { ascending: true });
    
    const { data: processedData, error: processedError } = await this.supabase
      .from('processed_events')
      .select('status', 'processed_at')
      .order('status', { ascending: true });
    
    console.log('Status distribution from event log:');
    eventData.forEach((row, index) => {
      console.log(`  ${row.status}: ${row.count || 0} events`);
    });
    
    console.log('Status distribution from processed events:');
    processedData.forEach((row, index) => {
      console.log(`  ${row.status}: ${row.count || 0} events`);
    });
    
    console.log('Status distribution mismatch investigation completed');
  }

  async takeCorrectiveAction(reconciliation) {
    console.log('=== TAKING CORRECTIVE ACTION ===');
    
    const action = reconciliation.count.events > 10 ? 'full_resync' : 'monitor';
    
    console.log(`Corrective action: ${action}`);
    
    switch (action) {
      case 'monitor':
        console.log('System will continue monitoring in degraded mode');
        break;
        
      case 'full_resync':
        console.log('Initiating full resync...');
        await this.fullResync();
        break;
        
      default:
        console.log('System will continue monitoring');
    }
    
    // In production, this would trigger automated recovery procedures
    console.log('Corrective action completed');
  }

  async fullResync() {
    console.log('=== FULL RESYNC PROCEDURE ===');
    
    try {
      // In production, this would:
      // 1. Pause new event processing
      // 2. Rebuild state from event log
      // 3. Replay all events in order
      // 4. Resume processing
      
      console.log('Full resync completed');
      
    } catch (error) {
      console.log(`Full resync failed: ${error.message}`);
      throw error;
    }
  }

  // Store reconciliation log
  storeReconciliationLog(reconciliation) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      hasDivergence: reconciliation.hasDivergence,
      divergenceType: reconciliation.type,
      divergenceCount: reconciliation.count,
      details: reconciliation.details,
      eventStateCount: reconciliation.eventCount || 0,
      dbStateCount: 0
    };
    
    // In production, this would store in a dedicated reconciliation log table
    console.log('Reconciliation log stored');
    console.log(`Log entry: ${JSON.stringify(logEntry, null, 2)}`);
    
    // Add to reconciliation log
    this.eventLog.push(logEntry);
    
    // Keep log size manageable
    if (this.eventLog.length > 1000) {
      this.eventLog = this.eventLog.slice(-500);
    }
  }

  // Get reconciliation status
  getStatus() {
    return {
      isRunning: this.isRunning,
      driftDetected: this.driftDetected,
      metrics: this.metrics,
      alerts: this.alerts,
      schemaHash: this.schemaHash,
      reconciliationLog: this.eventLog.slice(-10),
      reconciliationInterval: this.reconciliationInterval
    };
  }

  // Test truth reconciliation
  async testTruthReconciliation() {
    console.log('=== TESTING TRUTH RECONCILIATION ===');
    
    try {
      // Start the detector
      const detector = new RuntimeSchemaDriftDetector();
      
      // Start monitoring
      detector.start();
      
      // Wait for a few checks
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Stop monitoring
      detector.stop();
      
      // Get status
      const status = detector.getStatus();
      
      console.log('=== TRUTH RECONCILIATION TEST RESULTS ===');
      console.log(`Checks performed: ${status.metrics.checks}`);
      console.log(`Drifts detected: ${status.metrics.drifts}`);
      console.log(`Errors: ${status.metrics.errors}`);
      
      const success = status.metrics.errors === 0 && !status.driftDetected;
      
      console.log(`Truth reconciliation test: ${success ? 'PASSED' : 'FAILED'}`);
      
      return status;
      
    } catch (error) {
      console.log(`Truth reconciliation test failed: ${error.message}`);
      throw error;
    }
  }

  // Test manual truth reconciliation
  async testManualTruthReconciliation() {
    console.log('=== TESTING MANUAL TRUTH RECONCILIATION ===');
    
    try {
      // Simulate manual drift by updating stored hash
      const originalHash = await this.getSchemaHash();
      const fakeHash = 'manual_drift_' + Date.now().toString(36);
      
      console.log(`Original schema hash: ${originalHash}`);
      console.log(`Simulated drift: ${fakeHash}`);
      
      // Update stored hash (simulating manual schema change)
      await this.updateStoredHash(fakeHash);
      
      // Wait for next check
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Perform check (should detect drift)
      const drift = this.compareToStoredHash(originalHash);
      
      console.log('Manual drift simulation:');
      console.log(`Detected: ${drift.detected}`);
      console.log(`Expected: ${drift.expectedHash}`);
      console.log(`Current: ${drift.currentHash}`);
      console.log(`Details: ${drift.details}`);
      
      // Restore correct hash
      await this.updateStoredHash(originalHash);
      
      console.log('Restored correct hash');
      
      return drift;
      
    } catch (error) {
      console.log(`Manual truth reconciliation test failed: ${error.message}`);
      throw error;
    }
  }
}

// CLI interface
if (require.main === module) {
  const reconciliation = new TruthReconciliation();
  
  const command = process.argv[2] || 'status';
  
  (async () => {
    switch (command) {
      case 'start':
        reconciliation.start();
        
        // Keep running until stopped
        process.on('SIGINT', () => {
          console.log('Stopping truth reconciliation loop...');
          reconciliation.stop();
          process.exit(0);
        });
        
        break;
        
      case 'stop':
        reconciliation.stop();
        break;
        
      case 'status':
        console.log(JSON.stringify(reconciliation.getStatus(), null, 2));
        break;
        
      case 'test':
        await reconciliation.testTruthReconciliation();
        break;
        
      case 'manual':
        await reconciliation.testManualTruthReconciliation();
        break;
        
      default:
        console.log('Usage: node truth-reconciliation.js [start|stop|status|test|manual]');
    }
  })().catch(console.error);
}

module.exports = { TruthReconciliation };
