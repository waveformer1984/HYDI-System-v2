// Full system key audit and configuration verification
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const https = require('https');

// Load environment
function loadEnvironment() {
  const envContent = fs.readFileSync('.env', 'utf8');
  const env = {};
  
  const lines = envContent.split('\n');
  lines.forEach(line => {
    const match = line.match(/^([^=]+)=(.+)$/);
    if (match && !line.startsWith('#')) {
      env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
  
  return env;
}

// Test Supabase connectivity
async function testSupabaseConnection(supabaseUrl, serviceKey) {
  const supabase = createClient(supabaseUrl, serviceKey);
  
  try {
    const { data, error } = await supabase.from('clients').select('count').limit(1);
    return { success: !error, error: error?.message };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Test Stripe connectivity
async function testStripeConnectivity(stripeKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: '/v1/account',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${stripeKey}`
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ 
          success: res.statusCode === 200, 
          statusCode: res.statusCode,
          error: res.statusCode !== 200 ? `HTTP ${res.statusCode}` : null
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
    
    req.end();
  });
}

// Test Vercel API connectivity
async function testVercelConnectivity(vercelToken) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.vercel.com',
      port: 443,
      path: '/v9/user',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${vercelToken}`
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ 
          success: res.statusCode === 200, 
          statusCode: res.statusCode,
          error: res.statusCode !== 200 ? `HTTP ${res.statusCode}` : null
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
    
    req.end();
  });
}

// Validate key formats
function validateKeyFormat(key, type) {
  const validations = {
    'SUPABASE_URL': {
      pattern: /^https:\/\/[a-z0-9-]+\.supabase\.co$/,
      description: 'Must be a valid Supabase URL'
    },
    'SUPABASE_ANON_KEY': {
      pattern: /^eyJ[a-zA-Z0-9_-]+$/,
      description: 'Must be a valid JWT token'
    },
    'SUPABASE_SERVICE_ROLE_KEY': {
      pattern: /^eyJ[a-zA-Z0-9_-]+$/,
      description: 'Must be a valid JWT token'
    },
    'STRIPE_SECRET_KEY': {
      pattern: /^sk_(live|test)_[a-zA-Z0-9]+$/,
      description: 'Must be a valid Stripe secret key'
    },
    'STRIPE_WEBHOOK_SECRET': {
      pattern: /^whsec_[a-zA-Z0-9]+$/,
      description: 'Must be a valid Stripe webhook secret'
    },
    'KEEPER_BREAK_GLASS_TOKEN': {
      pattern: /^[a-f0-9]{64}$/,
      description: 'Must be a 64-character hex string'
    },
    'VERCEL_TOKEN': {
      pattern: /^vercel_[a-zA-Z0-9_-]+$/,
      description: 'Must be a valid Vercel token'
    }
  };
  
  const validation = validations[type];
  if (!validation) {
    return { valid: true, description: 'No validation rule' };
  }
  
  return {
    valid: validation.pattern.test(key),
    description: validation.description,
    pattern: validation.pattern
  };
}

// Main audit function
async function runFullAudit() {
  console.log('🔍 FULL SYSTEM KEY AUDIT');
  console.log('========================');
  
  const env = loadEnvironment();
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    details: []
  };
  
  // Required keys with their importance
  const requiredKeys = {
    'SUPABASE_URL': { critical: true, test: 'supabase' },
    'SUPABASE_ANON_KEY': { critical: true, test: 'supabase' },
    'SUPABASE_SERVICE_ROLE_KEY': { critical: true, test: 'supabase' },
    'STRIPE_SECRET_KEY': { critical: true, test: 'stripe' },
    'STRIPE_WEBHOOK_SECRET': { critical: false, test: null },
    'STRIPE_WEBHOOK_SECRET_01': { critical: false, test: null },
    'KEEPER_BREAK_GLASS_TOKEN': { critical: true, test: null },
    'VERCEL_TOKEN': { critical: true, test: 'vercel' },
    'NEXT_PUBLIC_SUPABASE_URL': { critical: false, test: null },
    'SUPABASE_PUBLISHABLE_KEY': { critical: false, test: null }
  };
  
  console.log('\n📋 KEY PRESENCE AUDIT');
  console.log('===================');
  
  // Check each key
  for (const [keyName, config] of Object.entries(requiredKeys)) {
    results.total++;
    
    const keyValue = env[keyName];
    const present = !!keyValue && keyValue !== '';
    
    if (!present) {
      console.log(`❌ ${keyName}: MISSING${config.critical ? ' (CRITICAL)' : ''}`);
      results.failed++;
      results.details.push({ key: keyName, status: 'MISSING', critical: config.critical });
      continue;
    }
    
    // Validate format
    const formatValidation = validateKeyFormat(keyName, keyValue);
    
    if (!formatValidation.valid) {
      console.log(`❌ ${keyName}: INVALID FORMAT - ${formatValidation.description}`);
      results.failed++;
      results.details.push({ 
        key: keyName, 
        status: 'INVALID_FORMAT', 
        critical: config.critical,
        description: formatValidation.description
      });
      continue;
    }
    
    console.log(`✅ ${keyName}: PRESENT${config.critical ? ' (CRITICAL)' : ''}`);
    results.passed++;
    results.details.push({ 
      key: keyName, 
      status: 'PRESENT', 
      critical: config.critical,
      value: keyValue.substring(0, 8) + '...'
    });
  }
  
  console.log('\n🔗 CONNECTIVITY TESTS');
  console.log('===================');
  
  // Test Supabase connectivity
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Testing Supabase connectivity...');
    const supabaseTest = await testSupabaseConnection(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    
    if (supabaseTest.success) {
      console.log('✅ Supabase: CONNECTED');
    } else {
      console.log(`❌ Supabase: CONNECTION FAILED - ${supabaseTest.error}`);
      results.failed++;
    }
  }
  
  // Test Stripe connectivity
  if (env.STRIPE_SECRET_KEY) {
    console.log('Testing Stripe connectivity...');
    const stripeTest = await testStripeConnectivity(env.STRIPE_SECRET_KEY);
    
    if (stripeTest.success) {
      console.log('✅ Stripe: CONNECTED');
    } else {
      console.log(`❌ Stripe: CONNECTION FAILED - ${stripeTest.error}`);
      results.failed++;
    }
  }
  
  // Test Vercel connectivity
  if (env.VERCEL_TOKEN) {
    console.log('Testing Vercel connectivity...');
    const vercelTest = await testVercelConnectivity(env.VERCEL_TOKEN);
    
    if (vercelTest.success) {
      console.log('✅ Vercel: CONNECTED');
    } else {
      console.log(`❌ Vercel: CONNECTION FAILED - ${vercelTest.error}`);
      results.failed++;
    }
  }
  
  // Summary
  console.log('\n📊 AUDIT SUMMARY');
  console.log('===============');
  console.log(`Total Keys Checked: ${results.total}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Warnings: ${results.warnings}`);
  
  const criticalFailures = results.details.filter(d => d.critical && d.status !== 'PRESENT');
  
  if (criticalFailures.length === 0) {
    console.log('\n🎯 AUDIT RESULT: ✅ ALL CRITICAL KEYS CONFIGURED CORRECTLY');
  } else {
    console.log('\n🚨 AUDIT RESULT: ❌ CRITICAL ISSUES FOUND');
    console.log('Critical failures:');
    criticalFailures.forEach(failure => {
      console.log(`  - ${failure.key}: ${failure.status}`);
    });
  }
  
  // Detailed results
  console.log('\n📋 DETAILED RESULTS');
  console.log('==================');
  results.details.forEach(detail => {
    const icon = detail.status === 'PRESENT' ? '✅' : '❌';
    console.log(`${icon} ${detail.key}: ${detail.status}${detail.value ? ` (${detail.value})` : ''}`);
  });
  
  return results;
}

// Run the audit
runFullAudit().then(results => {
  process.exit(results.failed > 0 ? 1 : 0);
}).catch(error => {
  console.error('Audit failed:', error.message);
  process.exit(1);
});
