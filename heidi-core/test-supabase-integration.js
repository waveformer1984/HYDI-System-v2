#!/usr/bin/env node

/**
 * TEST SUPABASE INTEGRATION
 * 
 * Tests the HYDI-Supabase integration using proper Supabase client
 */

const { createClient } = require('@supabase/supabase-js');

class SupabaseIntegrationTest {
  constructor() {
    // Load from .env file (parent directory)
    require('dotenv').config({ path: '../.env' });
    
    this.supabaseUrl = process.env.SUPABASE_URL || 'https://akbnfovjdcobifeupvbn.supabase.co';
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!this.supabaseKey) {
      console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
      process.exit(1);
    }
    
    this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
  }

  async testRpcFunctions() {
    console.log('🧪 Testing Supabase RPC Functions...');
    
    try {
      // Test alignment evaluation
      console.log('📊 Testing evaluate_external_alignment...');
      const evalResult = await this.supabase.rpc('evaluate_external_alignment', {
        p_window: '7 days'
      });
      
      if (evalResult.error) {
        console.error('❌ Evaluation RPC failed:', evalResult.error);
      } else {
        console.log('✅ Evaluation RPC Success:');
        console.log(JSON.stringify(evalResult.data, null, 2));
      }
      
      // Test alignment caps
      console.log('\n🎯 Testing apply_alignment_caps...');
      const capResult = await this.supabase.rpc('apply_alignment_caps', {
        p_warning_threshold: 0.15,
        p_critical_threshold: 0.30
      });
      
      if (capResult.error) {
        console.error('❌ Caps RPC failed:', capResult.error);
      } else {
        console.log('✅ Caps RPC Success:');
        console.log(JSON.stringify(capResult.data, null, 2));
      }
      
      return { evalResult, capResult };
      
    } catch (error) {
      console.error('💥 RPC Test Failed:', error.message);
      return null;
    }
  }

  async testOutcomeInsertion() {
    console.log('\n📥 Testing Outcome Insertion...');
    
    try {
      const testOutcome = {
        outcome_type: 'test_hslp_launch',
        predicted_score: 0.95,
        actual_score: 0.857,
        confidence_score: 0.92,
        source: 'integration_test',
        metadata: {
          boot_phase: 8,
          drift_score: 0.0,
          integrity_score: 0.857,
          test_timestamp: new Date().toISOString()
        }
      };
      
      const { data, error } = await this.supabase
        .from('hydi_external_outcomes')
        .insert(testOutcome)
        .select('id,event_id,created_at')
        .single();
      
      if (error) {
        console.error('❌ Outcome Insertion Failed:', error);
      } else {
        console.log('✅ Outcome Inserted Successfully:');
        console.log(JSON.stringify(data, null, 2));
      }
      
      return { data, error };
      
    } catch (error) {
      console.error('💥 Outcome Insertion Failed:', error.message);
      return null;
    }
  }

  async checkTables() {
    console.log('\n🔍 Checking Table Structure...');
    
    const tables = [
      'hydi_external_outcomes',
      'hydi_calibration_audits', 
      'hydi_reality_gap_snapshots',
      'hydi_recalibration_events'
    ];
    
    for (const table of tables) {
      try {
        const { data, error } = await this.supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (error) {
          console.log(`❌ ${table}: ${error.message}`);
        } else {
          console.log(`✅ ${table}: Accessible`);
        }
      } catch (err) {
        console.log(`❌ ${table}: ${err.message}`);
      }
    }
  }

  async runFullTest() {
    console.log('🚀 SUPABASE INTEGRATION TEST');
    console.log('============================');
    
    // Check environment
    console.log(`📍 URL: ${this.supabaseUrl}`);
    console.log(`🔑 Key: ${this.supabaseKey ? 'Present' : 'Missing'}`);
    
    // Test tables
    await this.checkTables();
    
    // Test RPC functions
    const rpcResults = await this.testRpcFunctions();
    
    // Test outcome insertion
    const insertResult = await this.testOutcomeInsertion();
    
    // Summary
    console.log('\n📊 TEST SUMMARY');
    console.log('===============');
    console.log(`RPC Functions: ${rpcResults ? 'WORKING' : 'FAILED'}`);
    console.log(`Outcome Insert: ${insertResult ? 'WORKING' : 'FAILED'}`);
    
    if (rpcResults && insertResult) {
      console.log('\n🎉 SUPABASE INTEGRATION READY');
    } else {
      console.log('\n❌ SUPABASE INTEGRATION NEEDS FIXES');
    }
  }
}

// Run tests if executed directly
if (require.main === module) {
  const tester = new SupabaseIntegrationTest();
  tester.runFullTest().catch(error => {
    console.error('💥 Test Suite Failed:', error);
    process.exit(1);
  });
}

module.exports = SupabaseIntegrationTest;
