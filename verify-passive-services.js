// Verify newly deployed passive services
const https = require('https');
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

// Test service endpoint
function testService(serviceName, endpoint) {
  return new Promise((resolve) => {
    const url = new URL(endpoint);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${loadEnvironment().SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            service: serviceName,
            status: 'ACTIVE',
            response: response,
            statusCode: res.statusCode
          });
        } catch (error) {
          resolve({
            service: serviceName,
            status: 'RESPONSE_ERROR',
            error: error.message,
            statusCode: res.statusCode
          });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({
        service: serviceName,
        status: 'ERROR',
        error: err.message
      });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        service: serviceName,
        status: 'TIMEOUT'
      });
    });
    
    req.end();
  });
}

// Main verification
async function verifyPassiveServices() {
  console.log('🔍 VERIFYING PASSIVE WEB SERVICES');
  console.log('===============================');
  
  const env = loadEnvironment();
  const baseUrl = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1';
  
  const services = [
    { name: 'Event Streaming', endpoint: `${baseUrl}/events-stream` },
    { name: 'Job Processor', endpoint: `${baseUrl}/jobs-processor` },
    { name: 'Monitoring Health', endpoint: `${baseUrl}/monitoring-health` },
    { name: 'Stripe Webhook', endpoint: `${baseUrl}/stripe-webhook` }
  ];
  
  const results = {
    total: services.length,
    active: 0,
    inactive: 0,
    services: []
  };
  
  for (const service of services) {
    console.log(`Testing ${service.name}...`);
    
    const result = await testService(service.name, service.endpoint);
    results.services.push(result);
    
    if (result.status === 'ACTIVE') {
      console.log(`✅ ${service.name}: ACTIVE`);
      console.log(`   Response: ${result.response.status || 'OK'}`);
      results.active++;
    } else {
      console.log(`❌ ${service.name}: ${result.status}`);
      if (result.error) console.log(`   Error: ${result.error}`);
      results.inactive++;
    }
    console.log('');
  }
  
  // Summary
  console.log('📊 VERIFICATION SUMMARY');
  console.log('======================');
  console.log(`Total Services: ${results.total}`);
  console.log(`Active: ${results.active}`);
  console.log(`Inactive: ${results.inactive}`);
  
  console.log('\n📋 SERVICE DETAILS:');
  results.services.forEach(service => {
    const icon = service.status === 'ACTIVE' ? '✅' : '❌';
    console.log(`${icon} ${service.service}: ${service.status}`);
  });
  
  // Final status
  if (results.active === results.total) {
    console.log('\n🎯 ALL PASSIVE SERVICES ACTIVATED');
  } else if (results.active > 0) {
    console.log('\n⚠️  PARTIAL SERVICE ACTIVATION');
  } else {
    console.log('\n🚨 NO SERVICES ACTIVATED');
  }
  
  return results;
}

// Run verification
verifyPassiveServices().then(results => {
  console.log('\n✅ Passive services verification completed');
  process.exit(results.inactive > 0 ? 1 : 0);
}).catch(error => {
  console.error('Verification failed:', error.message);
  process.exit(1);
});
