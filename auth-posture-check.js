// Auth posture check - verify JWT vs public access requirements
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

// Test endpoint with and without auth
function testAuthRequirement(serviceName) {
  return new Promise((resolve) => {
    const baseUrl = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1';
    
    // Test without auth first
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
        const result = {
          service: serviceName,
          noAuthStatus: res.statusCode,
          noAuthResponse: data
        };
        
        // Test with auth
        const authOptions = {
          ...options,
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${loadEnvironment().SUPABASE_ANON_KEY}`
          }
        };
        
        const authReq = https.request(authOptions, (authRes) => {
          let authData = '';
          authRes.on('data', chunk => authData += chunk);
          authRes.on('end', () => {
            result.authStatus = authRes.statusCode;
            result.authResponse = authData;
            
            // Determine auth requirement
            if (res.statusCode === 200 && authRes.statusCode === 200) {
              result.authRequirement = 'PUBLIC';
              result.recommendation = '✅ Public access appropriate';
            } else if (res.statusCode === 401 && authRes.statusCode === 200) {
              result.authRequirement = 'JWT_REQUIRED';
              result.recommendation = '🔒 JWT correctly required';
            } else if (res.statusCode === 200 && authRes.statusCode === 200) {
              result.authRequirement = 'JWT_OPTIONAL';
              result.recommendation = '⚠️  Consider requiring JWT';
            } else {
              result.authRequirement = 'UNKNOWN';
              result.recommendation = '❌ Unexpected behavior';
            }
            
            resolve(result);
          });
        });
        
        authReq.on('error', () => {
          result.authStatus = 'ERROR';
          resolve(result);
        });
        
        authReq.setTimeout(5000, () => {
          authReq.destroy();
          result.authStatus = 'TIMEOUT';
          resolve(result);
        });
        
        authReq.end();
      });
    });
    
    req.on('error', () => {
      resolve({
        service: serviceName,
        noAuthStatus: 'ERROR',
        authRequirement: 'UNKNOWN',
        recommendation: '❌ Service unavailable'
      });
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({
        service: serviceName,
        noAuthStatus: 'TIMEOUT',
        authRequirement: 'UNKNOWN',
        recommendation: '❌ Service timeout'
      });
    });
    
    req.end();
  });
}

// Main auth posture check
async function runAuthPostureCheck() {
  console.log('🔐 AUTH POSTURE CHECK');
  console.log('====================');
  
  const services = [
    // Web Services
    'api-gateway',
    'user-management',
    'payment-processing',
    'notification-service',
    'analytics-service',
    'file-storage',
    'search-service',
    'cache-service',
    
    // Marketing Services
    'marketing-automation',
    'lead-generation',
    'content-management',
    'email-marketing',
    'social-media',
    'customer-segments',
    'campaign-analytics',
    'brand-awareness',
    
    // Passive Services
    'events-stream',
    'jobs-processor',
    'monitoring-health',
    'stripe-webhook'
  ];
  
  const results = {
    total: services.length,
    public: 0,
    jwtRequired: 0,
    jwtOptional: 0,
    unknown: 0,
    services: []
  };
  
  console.log('\n🔍 Testing authentication requirements...');
  
  for (const serviceName of services) {
    console.log(`Testing ${serviceName}...`);
    
    const result = await testAuthRequirement(serviceName);
    results.services.push(result);
    
    switch (result.authRequirement) {
      case 'PUBLIC':
        results.public++;
        break;
      case 'JWT_REQUIRED':
        results.jwtRequired++;
        break;
      case 'JWT_OPTIONAL':
        results.jwtOptional++;
        break;
      default:
        results.unknown++;
        break;
    }
    
    console.log(`  ${result.recommendation}`);
  }
  
  // Summary
  console.log('\n📊 AUTH POSTURE SUMMARY');
  console.log('=======================');
  console.log(`Total Services: ${results.total}`);
  console.log(`Public Access: ${results.public}`);
  console.log(`JWT Required: ${results.jwtRequired}`);
  console.log(`JWT Optional: ${results.jwtOptional}`);
  console.log(`Unknown: ${results.unknown}`);
  
  console.log('\n🔍 DETAILED RESULTS:');
  results.services.forEach(service => {
    console.log(`${service.service}: ${service.authRequirement} - ${service.recommendation}`);
  });
  
  // Security assessment
  console.log('\n🚨 SECURITY ASSESSMENT:');
  
  const criticalServices = [
    'user-management',
    'payment-processing',
    'file-storage',
    'analytics-service'
  ];
  
  const criticalServicesResults = results.services.filter(s => 
    criticalServices.includes(s.service)
  );
  
  const insecureCriticalServices = criticalServicesResults.filter(s => 
    s.authRequirement === 'PUBLIC' || s.authRequirement === 'JWT_OPTIONAL'
  );
  
  if (insecureCriticalServices.length > 0) {
    console.log('❌ CRITICAL SERVICES WITH INSECURE ACCESS:');
    insecureCriticalServices.forEach(service => {
      console.log(`   - ${service.service}: ${service.authRequirement}`);
    });
    console.log('\n🔒 RECOMMENDATION: Enable JWT authentication for critical services');
  } else {
    console.log('✅ All critical services have appropriate authentication');
  }
  
  return results;
}

// Run the check
runAuthPostureCheck().then(results => {
  console.log('\n✅ Auth posture check completed');
  process.exit(results.unknown > 0 ? 1 : 0);
}).catch(error => {
  console.error('Auth posture check failed:', error.message);
  process.exit(1);
});
