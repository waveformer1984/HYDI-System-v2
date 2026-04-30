// Fixed key audit with proper .env parsing
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const https = require('https');

// Load environment with better parsing
function loadEnvironment() {
  const envContent = fs.readFileSync('.env', 'utf8');
  const env = {};
  
  const lines = envContent.split('\n');
  lines.forEach(line => {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') return;
    
    // Handle both quoted and unquoted values
    const quotedMatch = line.match(/^([^=]+)=(["'])(.+)\2$/);
    const unquotedMatch = line.match(/^([^=]+)=(.+)$/);
    
    if (quotedMatch) {
      env[quotedMatch[1].trim()] = quotedMatch[3].trim();
    } else if (unquotedMatch) {
      env[unquotedMatch[1].trim()] = unquotedMatch[2].trim();
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

// Test Vercel connectivity
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

// Check Vercel environment
async function checkVercelEnvironment() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    
    exec('vercel env ls production', (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
        return;
      }
      
      const lines = stdout.split('\n');
      const envVars = lines
        .filter(line => line.trim() && !line.startsWith('>') && !line.includes('Environment Variables found'))
        .map(line => {
          const match = line.match(/^\s*(\w+)\s+/);
          return match ? match[1] : null;
        })
        .filter(Boolean);
      
      resolve({ success: true, envVars });
    });
  });
}

// Main audit function
async function runFixedAudit() {
  console.log('🔍 FIXED SYSTEM KEY AUDIT');
  console.log('==========================');
  
  const env = loadEnvironment();
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    details: []
  };
  
  console.log('\n📋 LOCAL .env AUDIT');
  console.log('===================');
  
  // Required keys with their importance
  const requiredKeys = {
    'SUPABASE_URL': { critical: true, test: 'supabase' },
    'SUPABASE_ANON_KEY': { critical: true, test: 'supabase' },
    'SUPABASE_SERVICE_ROLE_KEY': { critical: true, test: 'supabase' },
    'STRIPE_SECRET_KEY': { critical: true, test: 'stripe' },
    'STRIPE_WEBHOOK_SECRET': { critical: false, test: null },
    'STRIPE_WEBHOOK_SECRET_01': { critical: false, test: null },
    'KEEPER_BREAK_GLASS_TOKEN': { critical: true, test: null },
    'NEXT_PUBLIC_SUPABASE_URL': { critical: false, test: null },
    'SUPABASE_PUBLISHABLE_KEY': { critical: false, test: null }
  };
  
  // Check each local key
  for (const [keyName, config] of Object.entries(requiredKeys)) {
    results.total++;
    
    const keyValue = env[keyName];
    const present = !!keyValue && keyValue !== '' && keyValue !== '[REDACTED]';
    
    if (!present) {
      const status = keyValue === '[REDACTED]' ? 'REDACTED' : 'MISSING';
      console.log(`❌ ${keyName}: ${status}${config.critical ? ' (CRITICAL)' : ''}`);
      results.failed++;
      results.details.push({ key: keyName, status, critical: config.critical, source: 'local' });
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
        source: 'local',
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
      source: 'local',
      value: keyValue.substring(0, 8) + '...'
    });
  }
  
  console.log('\n🌐 VERCEL ENVIRONMENT AUDIT');
  console.log('========================');
  
  // Check Vercel environment
  const vercelCheck = await checkVercelEnvironment();
  
  if (vercelCheck.success) {
    console.log('✅ Vercel CLI: CONNECTED');
    console.log(`✅ Environment variables found: ${vercelCheck.envVars.length}`);
    
    const criticalVercelKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'STRIPE_SECRET_KEY', 'KEEPER_BREAK_GLASS_TOKEN'];
    
    criticalVercelKeys.forEach(key => {
      if (vercelCheck.envVars.includes(key)) {
        console.log(`✅ Vercel ${key}: PRESENT`);
      } else {
        console.log(`❌ Vercel ${key}: MISSING`);
        results.failed++;
      }
    });
  } else {
    console.log(`❌ Vercel CLI: ${vercelCheck.error}`);
    results.failed++;
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
      console.log(`  - ${failure.key}: ${failure.status} (${failure.source})`);
    });
  }
  
  return results;
}

// Run the audit
runFixedAudit().then(results => {
  process.exit(results.failed > 0 ? 1 : 0);
}).catch(error => {
  console.error('Audit failed:', error.message);
  process.exit(1);
});
