// Test JWT authentication directly
const https = require('https');

function testJWTAuth(serviceName) {
  return new Promise((resolve) => {
    // Test without auth
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

async function testAllCriticalServices() {
  console.log('🔐 TESTING JWT AUTHENTICATION ON CRITICAL SERVICES');
  console.log('==================================================');
  
  const criticalServices = [
    'user-management',
    'payment-processing', 
    'analytics-service',
    'file-storage'
  ];
  
  let authRequired = 0;
  let authNotRequired = 0;
  
  for (const service of criticalServices) {
    console.log(`Testing ${service}...`);
    
    const result = await testJWTAuth(service);
    
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
  
  console.log('\n📊 AUTHENTICATION TEST RESULTS:');
  console.log(`JWT Required: ${authRequired}/${criticalServices.length}`);
  console.log(`JWT Not Required: ${authNotRequired}/${criticalServices.length}`);
  
  if (authRequired === criticalServices.length) {
    console.log('\n✅ ALL CRITICAL SERVICES PROPERLY AUTHENTICATED');
    return true;
  } else {
    console.log('\n❌ SOME CRITICAL SERVICES LACK AUTHENTICATION');
    return false;
  }
}

testAllCriticalServices().then(allSecure => {
  console.log('\n✅ JWT authentication test completed');
  process.exit(allSecure ? 0 : 1);
}).catch(error => {
  console.error('JWT authentication test failed:', error.message);
  process.exit(1);
});
