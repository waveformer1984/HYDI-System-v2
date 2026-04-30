// Verify all deployed web services and marketing services
const https = require('https');

// Test service endpoint
function testService(serviceName, description) {
  return new Promise((resolve) => {
    const url = `https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/${serviceName}`;
    
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
        try {
          const response = JSON.parse(data);
          resolve({
            service: serviceName,
            description: description,
            status: 'ACTIVE',
            statusCode: res.statusCode,
            response: response
          });
        } catch (error) {
          resolve({
            service: serviceName,
            description: description,
            status: 'RESPONSE_ERROR',
            statusCode: res.statusCode,
            error: error.message,
            rawResponse: data
          });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({
        service: serviceName,
        description: description,
        status: 'ERROR',
        error: err.message
      });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        service: serviceName,
        description: description,
        status: 'TIMEOUT'
      });
    });
    
    req.end();
  });
}

// Main verification
async function verifyAllServices() {
  console.log('🔍 VERIFYING ALL DEPLOYED SERVICES');
  console.log('===================================');
  
  const services = [
    // Web Services
    { name: 'api-gateway', description: 'Central API gateway for all services' },
    { name: 'user-management', description: 'User authentication and management' },
    { name: 'payment-processing', description: 'Payment processing and billing' },
    { name: 'notification-service', description: 'Email and push notifications' },
    { name: 'analytics-service', description: 'Usage analytics and reporting' },
    { name: 'file-storage', description: 'File upload and storage service' },
    { name: 'search-service', description: 'Full-text search functionality' },
    { name: 'cache-service', description: 'Redis-based caching service' },
    
    // Marketing Services
    { name: 'marketing-automation', description: 'Automated marketing campaigns' },
    { name: 'lead-generation', description: 'Lead capture and qualification' },
    { name: 'content-management', description: 'Content creation and distribution' },
    { name: 'email-marketing', description: 'Email campaign management' },
    { name: 'social-media', description: 'Social media posting and monitoring' },
    { name: 'customer-segments', description: 'Customer segmentation and targeting' },
    { name: 'campaign-analytics', description: 'Marketing campaign performance' },
    { name: 'brand-awareness', description: 'Brand awareness tracking' }
  ];
  
  const results = {
    total: services.length,
    active: 0,
    inactive: 0,
    services: []
  };
  
  console.log('\n🌐 TESTING WEB SERVICES');
  console.log('========================');
  
  // Test web services first
  for (let i = 0; i < 8; i++) {
    const service = services[i];
    console.log(`Testing ${service.name}...`);
    
    const result = await testService(service.name, service.description);
    results.services.push(result);
    
    if (result.status === 'ACTIVE') {
      console.log(`✅ ${service.name}: ACTIVE`);
      results.active++;
    } else {
      console.log(`❌ ${service.name}: ${result.status}`);
      results.inactive++;
    }
  }
  
  console.log('\n📈 TESTING MARKETING SERVICES');
  console.log('==============================');
  
  // Test marketing services
  for (let i = 8; i < services.length; i++) {
    const service = services[i];
    console.log(`Testing ${service.name}...`);
    
    const result = await testService(service.name, service.description);
    results.services.push(result);
    
    if (result.status === 'ACTIVE') {
      console.log(`✅ ${service.name}: ACTIVE`);
      results.active++;
    } else {
      console.log(`❌ ${service.name}: ${result.status}`);
      results.inactive++;
    }
  }
  
  // Summary
  console.log('\n📊 VERIFICATION SUMMARY');
  console.log('======================');
  console.log(`Total Services: ${results.total}`);
  console.log(`Active: ${results.active}`);
  console.log(`Inactive: ${results.inactive}`);
  
  console.log('\n📋 SERVICE DETAILS:');
  results.services.forEach(service => {
    const icon = service.status === 'ACTIVE' ? '✅' : '❌';
    console.log(`${icon} ${service.service}: ${service.status}`);
  });
  
  // Service categories
  console.log('\n🌐 WEB SERVICES STATUS:');
  const webServices = results.services.slice(0, 8);
  const webActive = webServices.filter(s => s.status === 'ACTIVE').length;
  console.log(`Active: ${webActive}/8`);
  
  console.log('\n📈 MARKETING SERVICES STATUS:');
  const marketingServices = results.services.slice(8);
  const marketingActive = marketingServices.filter(s => s.status === 'ACTIVE').length;
  console.log(`Active: ${marketingActive}/8`);
  
  // Final status
  if (results.active === results.total) {
    console.log('\n🎯 ALL SERVICES VERIFIED AND OPERATIONAL');
  } else if (results.active > 0) {
    console.log('\n⚠️  PARTIAL SERVICE VERIFICATION');
  } else {
    console.log('\n🚨 NO SERVICES VERIFIED');
  }
  
  return results;
}

// Run verification
verifyAllServices().then(results => {
  console.log('\n✅ All services verification completed');
  process.exit(results.inactive > 0 ? 1 : 0);
}).catch(error => {
  console.error('Verification failed:', error.message);
  process.exit(1);
});
