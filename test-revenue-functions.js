// Test revenue functions
const https = require('https');

function testRevenueFunction(serviceName) {
  return new Promise((resolve) => {
    // Test without auth (should return 401)
    const options = {
      hostname: 'akbnfovjdcobifeupvbn.supabase.co',
      port: 443,
      path: `/functions/v1/${serviceName}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          service: serviceName,
          statusCode: res.statusCode,
          response: data.substring(0, 100),
          requiresAuth: res.statusCode === 401
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({
        service: serviceName,
        statusCode: 'ERROR',
        error: err.message,
        requiresAuth: false
      });
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({
        service: serviceName,
        statusCode: 'TIMEOUT',
        requiresAuth: false
      });
    });
    
    req.end();
  });
}

async function testRevenueFunctions() {
  console.log('💰 TESTING REVENUE FUNCTIONS');
  console.log('============================');
  
  const revenueServices = [
    'revenue-tracker',
    'billing-engine',
    'usage-monitor',
    'invoice-generator',
    'subscription-manager',
    'payment-processor'
  ];
  
  let authRequired = 0;
  let authNotRequired = 0;
  
  for (const service of revenueServices) {
    console.log(`Testing ${service}...`);
    
    const result = await testRevenueFunction(service);
    
    if (result.requiresAuth) {
      console.log(`✅ ${service}: JWT required (HTTP ${result.statusCode})`);
      authRequired++;
    } else {
      console.log(`❌ ${service}: JWT not required (HTTP ${result.statusCode})`);
      authNotRequired++;
    }
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
  
  console.log('\n📊 REVENUE FUNCTIONS TEST RESULTS:');
  console.log(`JWT Required: ${authRequired}/${revenueServices.length}`);
  console.log(`JWT Not Required: ${authNotRequired}/${revenueServices.length}`);
  
  if (authRequired === revenueServices.length) {
    console.log('\n✅ ALL REVENUE FUNCTIONS PROPERLY AUTHENTICATED');
    return true;
  } else {
    console.log('\n❌ SOME REVENUE FUNCTIONS LACK AUTHENTICATION');
    return false;
  }
}

testRevenueFunctions().then(allSecure => {
  console.log('\n✅ Revenue functions test completed');
  process.exit(allSecure ? 0 : 1);
}).catch(error => {
  console.error('Revenue functions test failed:', error.message);
  process.exit(1);
});
