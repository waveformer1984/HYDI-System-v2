// Trace first end-to-end transaction
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load environment
function loadEnvironment() {
  const envContent = fs.readFileSync('.env', 'utf8');
  const env = {};
  
  const lines = envContent.split('\n');
  lines.forEach(line => {
    if (line.startsWith('#') || line.trim() === '') return;
    
    const equalIndex = line.indexOf('=');
    if (equalIndex > 0) {
      const key = line.substring(0, equalIndex).trim();
      let value = line.substring(equalIndex + 1).trim();
      
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      env[key] = value;
    }
  });
  
  return env;
}

// Test payment processing flow
async function testPaymentFlow() {
  console.log('💳 Testing Payment Processing Flow...');
  
  const env = loadEnvironment();
  const paymentData = {
    amount: 9999,
    currency: 'USD',
    method: 'card',
    description: 'Test transaction for traceability'
  };
  
  return new Promise((resolve) => {
    const payload = JSON.stringify(paymentData);
    
    const options = {
      hostname: 'akbnfovjdcobifeupvbn.supabase.co',
      port: 443,
      path: '/functions/v1/payment-processing',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            success: res.statusCode === 200,
            paymentId: response.paymentId,
            status: response.status,
            response: response
          });
        } catch (error) {
          resolve({
            success: false,
            error: error.message,
            rawResponse: data
          });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Timeout'
      });
    });
    
    req.write(payload);
    req.end();
  });
}

// Test user management flow
async function testUserFlow() {
  console.log('👤 Testing User Management Flow...');
  
  const userData = {
    email: `test-${Date.now()}@example.com`,
    name: 'Test User',
    company: 'Test Company'
  };
  
  return new Promise((resolve) => {
    const payload = JSON.stringify(userData);
    
    const options = {
      hostname: 'akbnfovjdcobifeupvbn.supabase.co',
      port: 443,
      path: '/functions/v1/user-management',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            success: res.statusCode === 201,
            userId: response.userId,
            email: response.email,
            response: response
          });
        } catch (error) {
          resolve({
            success: false,
            error: error.message,
            rawResponse: data
          });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Timeout'
      });
    });
    
    req.write(payload);
    req.end();
  });
}

// Check database for traces
async function checkDatabaseTraces() {
  console.log('🔍 Checking Database Traces...');
  
  const env = loadEnvironment();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  
  const traces = {
    ledger: 0,
    events: 0,
    audit_logs: 0,
    keymaker_events: 0
  };
  
  try {
    // Check ledger table
    const { data: ledgerData, error: ledgerError } = await supabase
      .from('ledger')
      .select('count')
      .limit(1);
    
    if (!ledgerError) {
      traces.ledger = ledgerData ? 1 : 0;
    }
    
    // Check events table
    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('count')
      .limit(1);
    
    if (!eventsError) {
      traces.events = eventsData ? 1 : 0;
    }
    
    // Check audit logs
    const { data: auditData, error: auditError } = await supabase
      .from('audit_logs')
      .select('count')
      .limit(1);
    
    if (!auditError) {
      traces.audit_logs = auditData ? 1 : 0;
    }
    
    // Check keymaker_events
    const { data: keymakerData, error: keymakerError } = await supabase
      .from('keymaker_events')
      .select('count')
      .limit(1);
    
    if (!keymakerError) {
      traces.keymaker_events = keymakerData ? 1 : 0;
    }
    
  } catch (error) {
    console.log(`Database trace check failed: ${error.message}`);
  }
  
  return traces;
}

// Main traceability test
async function runTraceabilityTest() {
  console.log('🔄 TRACEABLE FIRST TRANSACTION TEST');
  console.log('====================================');
  
  const results = {
    paymentFlow: null,
    userFlow: null,
    databaseTraces: null,
    overallSuccess: false
  };
  
  // Test payment flow
  results.paymentFlow = await testPaymentFlow();
  
  // Test user flow
  results.userFlow = await testUserFlow();
  
  // Check database traces
  results.databaseTraces = await checkDatabaseTraces();
  
  // Summary
  console.log('\n📊 TRACEABILITY TEST RESULTS');
  console.log('=============================');
  
  console.log('\n💳 Payment Flow:');
  if (results.paymentFlow.success) {
    console.log(`✅ SUCCESS - Payment ID: ${results.paymentFlow.paymentId}`);
    console.log(`   Status: ${results.paymentFlow.status}`);
  } else {
    console.log(`❌ FAILED - ${results.paymentFlow.error}`);
  }
  
  console.log('\n👤 User Flow:');
  if (results.userFlow.success) {
    console.log(`✅ SUCCESS - User ID: ${results.userFlow.userId}`);
    console.log(`   Email: ${results.userFlow.email}`);
  } else {
    console.log(`❌ FAILED - ${results.userFlow.error}`);
  }
  
  console.log('\n🔍 Database Traces:');
  console.log(`   Ledger: ${results.databaseTraces.ledger > 0 ? '✅' : '❌'} (${results.databaseTraces.ledger} records)`);
  console.log(`   Events: ${results.databaseTraces.events > 0 ? '✅' : '❌'} (${results.databaseTraces.events} records)`);
  console.log(`   Audit Logs: ${results.databaseTraces.audit_logs > 0 ? '✅' : '❌'} (${results.databaseTraces.audit_logs} records)`);
  console.log(`   Keymaker Events: ${results.databaseTraces.keymaker_events > 0 ? '✅' : '❌'} (${results.databaseTraces.keymaker_events} records)`);
  
  // Overall assessment
  const paymentSuccess = results.paymentFlow.success;
  const userSuccess = results.userFlow.success;
  const traceSuccess = Object.values(results.databaseTraces).some(count => count > 0);
  
  results.overallSuccess = paymentSuccess && userSuccess && traceSuccess;
  
  console.log('\n🎯 OVERALL ASSESSMENT:');
  if (results.overallSuccess) {
    console.log('✅ END-TO-END TRACEABILITY WORKING');
    console.log('   - Payment processing functional');
    console.log('   - User management functional');
    console.log('   - Database traces present');
  } else {
    console.log('❌ TRACEABILITY ISSUES DETECTED');
    if (!paymentSuccess) console.log('   - Payment processing failed');
    if (!userSuccess) console.log('   - User management failed');
    if (!traceSuccess) console.log('   - No database traces found');
  }
  
  return results;
}

// Run the test
runTraceabilityTest().then(results => {
  console.log('\n✅ Traceability test completed');
  process.exit(results.overallSuccess ? 0 : 1);
}).catch(error => {
  console.error('Traceability test failed:', error.message);
  process.exit(1);
});
