/**
 * Post-Patch Verification Protocol
 * Tests the "Forge Lockdown" implementation
 */

const { createClient } = require('@supabase/supabase-js');
const HeidiRevenueOutreach = require('./modules/heidi-revenue-outreach');
const UniversalAgentBus = require('./modules/universal-agent-bus');

require('dotenv').config();

class VerificationProtocol {
  constructor() {
    this.supabase = null;
    this.heidiOutreach = null;
    this.agentBus = null;
    
    this.initialize();
  }
  
  async initialize() {
    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (supabaseUrl && supabaseKey && !supabaseKey.includes('sb_publishable')) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      console.log('Verification: Supabase connected');
    } else {
      console.error('Verification: Supabase credentials invalid');
      process.exit(1);
    }
    
    // Initialize components
    this.heidiOutreach = new HeidiRevenueOutreach();
    this.agentBus = new UniversalAgentBus();
  }
  
  // Run all verification checks
  async runFullVerification() {
    console.log('=== FORGE LOCKDOWN VERIFICATION PROTOCOL ===\n');
    
    const results = {
      writeBackCheck: false,
      leadToMemoryCheck: false,
      hardwareStressCheck: false
    };
    
    try {
      // Check 1: Write-Back Check
      console.log('1. WRITE-BACK CHECK');
      console.log('==================');
      results.writeBackCheck = await this.performWriteBackCheck();
      console.log(`Result: ${results.writeBackCheck ? 'PASS' : 'FAIL'}\n`);
      
      // Check 2: Lead-to-Memory Check
      console.log('2. LEAD-TO-MEMORY CHECK');
      console.log('=======================');
      results.leadToMemoryCheck = await this.performLeadToMemoryCheck();
      console.log(`Result: ${results.leadToMemoryCheck ? 'PASS' : 'FAIL'}\n`);
      
      // Check 3: Hardware Stress Check
      console.log('3. HARDWARE STRESS CHECK');
      console.log('======================');
      results.hardwareStressCheck = await this.performHardwareStressCheck();
      console.log(`Result: ${results.hardwareStressCheck ? 'PASS' : 'FAIL'}\n`);
      
    } catch (err) {
      console.error('Verification protocol crashed:', err.message);
    }
    
    // Final Results
    console.log('=== VERIFICATION RESULTS ===');
    console.log(`Write-Back Check: ${results.writeBackCheck ? 'PASS' : 'FAIL'}`);
    console.log(`Lead-to-Memory Check: ${results.leadToMemoryCheck ? 'PASS' : 'FAIL'}`);
    console.log(`Hardware Stress Check: ${results.hardwareStressCheck ? 'PASS' : 'FAIL'}`);
    
    const allPassed = Object.values(results).every(result => result);
    console.log(`Overall Status: ${allPassed ? 'PASS - Forge is operational!' : 'FAIL - Issues detected'}`);
    
    return allPassed;
  }
  
  // Check 1: Write-Back Check
  async performWriteBackCheck() {
    try {
      console.log('Running dummy broadcast...');
      
      // Trigger Heidi broadcast
      const { spawn } = require('child_process');
      return new Promise((resolve) => {
        const process = spawn('node', ['heidi-system-status-broadcast.js']);
        
        process.on('close', (code) => {
          if (code === 0) {
            // Check if system_status was updated in last 60 seconds
            this.checkRecentSystemStatus()
              .then(recent => {
                console.log(`Recent system_status found: ${recent}`);
                resolve(recent);
              })
              .catch(err => {
                console.error('Failed to check system_status:', err.message);
                resolve(false);
              });
          } else {
            console.error('Heidi broadcast failed');
            resolve(false);
          }
        });
      });
    } catch (err) {
      console.error('Write-back check failed:', err.message);
      return false;
    }
  }
  
  async checkRecentSystemStatus() {
    if (!this.supabase) return false;
    
    try {
      const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();
      
      const { data, error } = await this.supabase
        .from('system_status')
        .select('*')
        .gte('last_broadcast', sixtySecondsAgo)
        .order('last_broadcast', { ascending: false })
        .limit(1);
      
      if (error) {
        console.error('System status check error:', error.message);
        return false;
      }
      
      return data && data.length > 0;
    } catch (err) {
      console.error('System status check exception:', err.message);
      return false;
    }
  }
  
  // Check 2: Lead-to-Memory Check
  async performLeadToMemoryCheck() {
    try {
      console.log('Inserting test lead...');
      
      // Insert test lead
      const testEmail = `test-${Date.now()}@verification.local`;
      const { data: leadData, error: leadError } = await this.supabase
        .from('leads')
        .insert({
          email: testEmail,
          source: 'heidi_broadcast',
          metadata: {
            test: true,
            verification: true,
            interests: ['SEO Content Generator']
          }
        })
        .select();
      
      if (leadError) {
        console.error('Failed to insert test lead:', leadError.message);
        return false;
      }
      
      const lead = leadData[0];
      console.log(`Test lead inserted: ${lead.id}`);
      
      // Process the lead through Heidi outreach
      await this.heidiOutreach.processNewLead(lead);
      
      // Check if heidi_memory entry was created
      console.log('Checking for Heidi memory entry...');
      
      const { data: memoryData, error: memoryError } = await this.supabase
        .from('heidi_memory')
        .select('*')
        .eq('user_email', testEmail)
        .single();
      
      if (memoryError) {
        console.error('Failed to check Heidi memory:', memoryError.message);
        return false;
      }
      
      const memoryExists = memoryData && memoryData.last_interaction_type === 'welcome_outreach';
      console.log(`Heidi memory entry created: ${memoryExists}`);
      
      // Cleanup test data
      await this.cleanupTestData(lead.id, testEmail);
      
      return memoryExists;
    } catch (err) {
      console.error('Lead-to-memory check failed:', err.message);
      return false;
    }
  }
  
  // Check 3: Hardware Stress Check
  async performHardwareStressCheck() {
    try {
      console.log('Simulating GPU timeout...');
      
      // Create a message that would normally go to local model
      const stressMessage = this.agentBus.createMessage(
        'TestClient',
        'LocalModel',
        'generate',
        { prompt: 'Test stress scenario', timeout: 100 },
        { priority: 'SYSTEM' }
      );
      
      // Simulate timeout by setting an invalid model
      const originalModel = process.env.LOCAL_MODEL_PATH;
      process.env.LOCAL_MODEL_PATH = '/invalid/path';
      
      try {
        // This should fail and fall back to AI Studio
        await this.agentBus.sendMessage(stressMessage);
        
        // Restore original model
        if (originalModel) {
          process.env.LOCAL_MODEL_PATH = originalModel;
        }
        
        console.log('Message handled with fallback');
        return true;
      } catch (err) {
        // Restore original model
        if (originalModel) {
          process.env.LOCAL_MODEL_PATH = originalModel;
        }
        
        // Check if error is about fallback
        const fallbackHandled = err.message.includes('fallback') || err.message.includes('AI Studio');
        console.log(`Fallback handling: ${fallbackHandled}`);
        return fallbackHandled;
      }
    } catch (err) {
      console.error('Hardware stress check failed:', err.message);
      return false;
    }
  }
  
  // Cleanup test data
  async cleanupTestData(leadId, email) {
    if (!this.supabase) return;
    
    try {
      // Delete test lead
      await this.supabase.from('leads').delete().eq('id', leadId);
      
      // Delete test memory
      await this.supabase.from('heidi_memory').delete().eq('user_email', email);
      
      console.log('Test data cleaned up');
    } catch (err) {
      console.warn('Failed to cleanup test data:', err.message);
    }
  }
}

// Run verification if called directly
if (require.main === module) {
  const verification = new VerificationProtocol();
  verification.runFullVerification()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('Verification crashed:', err);
      process.exit(1);
    });
}

module.exports = VerificationProtocol;
