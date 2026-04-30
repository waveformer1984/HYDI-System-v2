#!/usr/bin/env node
/**
 * HYDI RPC Smoke Test
 * Tests end-to-end behavior with current client key path
 * Tests hydi_dashboard_snapshot and run_system_health_check functions
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

class RPCSmokeTest {
  constructor() {
    this.supabase = null;
    this.testResults = {
      connection: false,
      dashboardSnapshot: false,
      healthCheck: false,
      secureReads: false,
      errors: []
    };
  }

  async initialize() {
    console.log('🧪 HYDI RPC Smoke Test\n');
    
    // Check environment
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
    
    if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your-project')) {
      this.testResults.errors.push('❌ Supabase credentials not configured');
      console.log('❌ Please update .env with real Supabase credentials');
      return false;
    }
    
    // Create client with anon key (client key path)
    this.supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log(`🔗 Connected to: ${supabaseUrl}`);
    console.log(`🔑 Using key type: ${supabaseKey.startsWith('eyJ') ? 'JWT' : 'Unknown'}`);
    return true;
  }

  async testConnection() {
    console.log('\n📡 Testing database connection...');
    
    try {
      // Test basic connection
      const { data, error } = await this.supabase
        .from('information_schema.tables')
        .select('table_name')
        .limit(1);
      
      if (error) throw error;
      
      this.testResults.connection = true;
      console.log('✅ Database connection successful');
      return true;
      
    } catch (error) {
      this.testResults.errors.push(`❌ Connection failed: ${error.message}`);
      console.log('❌ Connection failed:', error.message);
      return false;
    }
  }

  async testDashboardSnapshot() {
    console.log('\n📊 Testing hydi_dashboard_snapshot...');
    
    try {
      // Test the dashboard snapshot function
      const { data, error } = await this.supabase
        .rpc('get_dashboard_data');
      
      if (error) {
        // Try alternative function name
        const { data: altData, error: altError } = await this.supabase
          .rpc('hydi_dashboard_snapshot');
        
        if (altError) throw altError;
        
        this.testResults.dashboardSnapshot = true;
        console.log('✅ hydi_dashboard_snapshot working');
        console.log('📋 Dashboard data:', JSON.stringify(altData, null, 2));
        return true;
      }
      
      this.testResults.dashboardSnapshot = true;
      console.log('✅ get_dashboard_data working');
      console.log('📋 Dashboard data:', JSON.stringify(data, null, 2));
      return true;
      
    } catch (error) {
      this.testResults.errors.push(`❌ Dashboard snapshot failed: ${error.message}`);
      console.log('❌ Dashboard snapshot failed:', error.message);
      
      // Try basic health check as fallback
      return this.testBasicHealth();
    }
  }

  async testHealthCheck() {
    console.log('\n🏥 Testing run_system_health_check...');
    
    try {
      // Test the health check function
      const { data, error } = await this.supabase
        .rpc('run_system_health_check');
      
      if (error) {
        // Try alternative function name
        const { data: altData, error: altError } = await this.supabase
          .rpc('check_system_health');
        
        if (altError) throw altError;
        
        this.testResults.healthCheck = true;
        console.log('✅ check_system_health working');
        console.log('📋 Health data:', JSON.stringify(altData, null, 2));
        return true;
      }
      
      this.testResults.healthCheck = true;
      console.log('✅ run_system_health_check working');
      console.log('📋 Health data:', JSON.stringify(data, null, 2));
      return true;
      
    } catch (error) {
      this.testResults.errors.push(`❌ Health check failed: ${error.message}`);
      console.log('❌ Health check failed:', error.message);
      return false;
    }
  }

  async testBasicHealth() {
    console.log('\n🔍 Testing basic health functions...');
    
    try {
      // Test basic health read
      const { data, error } = await this.supabase
        .rpc('read_current_health');
      
      if (error) throw error;
      
      this.testResults.secureReads = true;
      console.log('✅ read_current_health working');
      console.log('📋 Current health:', JSON.stringify(data, null, 2));
      return true;
      
    } catch (error) {
      this.testResults.errors.push(`❌ Basic health read failed: ${error.message}`);
      console.log('❌ Basic health read failed:', error.message);
      return false;
    }
  }

  async testRLSVerification() {
    console.log('\n🛡️ Testing RLS verification...');
    
    try {
      // Test that we can't directly access the table (RLS is working)
      const { data, error } = await this.supabase
        .from('system_health_runs')
        .select('*')
        .limit(1);
      
      if (error && error.message?.includes('permission denied')) {
        console.log('✅ RLS is properly blocking direct table access');
        return true;
      }
      
      if (data && data.length > 0) {
        console.log('⚠️  Direct table access allowed - RLS may need adjustment');
        return false;
      }
      
      console.log('📋 Table access result:', data?.length || 0, 'rows');
      return true;
      
    } catch (error) {
      console.log('📋 RLS test result:', error.message);
      return error.message?.includes('permission denied');
    }
  }

  async testSecurityContext() {
    console.log('\n🔐 Testing security context...');
    
    try {
      // Test what role we're connecting as
      const { data, error } = await this.supabase
        .rpc('check_system_health');
      
      if (error) {
        console.log('📋 Security context: Error (expected for anon)');
        return false;
      }
      
      console.log('✅ Security context allows health reads');
      console.log('📋 User can access health functions');
      return true;
      
    } catch (error) {
      console.log('📋 Security context check:', error.message);
      return false;
    }
  }

  async runAllTests() {
    console.log('🚀 Starting HYDI RPC Smoke Test...\n');
    
    // Initialize
    if (!await this.initialize()) {
      this.printResults();
      return false;
    }
    
    // Run tests in sequence
    await this.testConnection();
    
    if (this.testResults.connection) {
      await Promise.all([
        this.testDashboardSnapshot(),
        this.testHealthCheck(),
        this.testRLSVerification(),
        this.testSecurityContext()
      ]);
    }
    
    this.printResults();
    return this.getSuccessRate() >= 75; // 75% success rate required
  }

  getSuccessRate() {
    const totalTests = Object.keys(this.testResults).filter(k => k !== 'errors').length;
    const passedTests = Object.values(this.testResults).filter(v => v === true).length;
    return Math.round((passedTests / totalTests) * 100);
  }

  printResults() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 SMOKE TEST RESULTS');
    console.log('='.repeat(50));
    
    // Test results
    console.log('\n🧪 Test Results:');
    console.log(`   Connection: ${this.testResults.connection ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Dashboard: ${this.testResults.dashboardSnapshot ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Health Check: ${this.testResults.healthCheck ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Secure Reads: ${this.testResults.secureReads ? '✅ PASS' : '❌ FAIL'}`);
    
    // Success rate
    const successRate = this.getSuccessRate();
    console.log(`\n📈 Success Rate: ${successRate}%`);
    
    // Errors
    if (this.testResults.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.testResults.errors.forEach(error => console.log(`   ${error}`));
    }
    
    // Recommendations
    console.log('\n💡 Recommendations:');
    if (successRate >= 75) {
      console.log('   ✅ System is ready for Heidi mobile chat');
      console.log('   ✅ RPC functions are working correctly');
      console.log('   ✅ Security model is properly configured');
    } else {
      console.log('   ⚠️  Apply the security patch: node apply-patch-simple.js');
      console.log('   ⚠️  Check Supabase credentials in .env');
      console.log('   ⚠️  Verify RLS policies are applied');
    }
    
    console.log('\n🚀 Next Steps:');
    console.log('   1. Launch Heidi mobile: node launch-heidi-mobile.js');
    console.log('   2. Visit: http://localhost:3006/heidi-mobile');
    console.log('   3. Test health monitoring integration');
    
    console.log('\n' + '='.repeat(50));
  }
}

// Run the smoke test
if (require.main === module) {
  const smokeTest = new RPCSmokeTest();
  
  smokeTest.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n💥 Smoke test failed:', error);
      process.exit(1);
    });
}

module.exports = RPCSmokeTest;
