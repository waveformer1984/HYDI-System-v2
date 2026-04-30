// Secrets and configuration parity check
const fs = require('fs');
const { exec } = require('child_process');

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

// Check Supabase secrets
function checkSupabaseSecrets() {
  return new Promise((resolve) => {
    exec('npx supabase secrets list --project-ref akbnfovjdcobifeupvbn', (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
        return;
      }
      
      const lines = stdout.split('\n');
      const secrets = {};
      
      lines.forEach(line => {
        const match = line.match(/^\s*(\w+)\s+\|/);
        if (match) {
          secrets[match[1]] = 'PRESENT';
        }
      });
      
      resolve({ success: true, secrets });
    });
  });
}

// Check Vercel secrets
function checkVercelSecrets() {
  return new Promise((resolve) => {
    exec('vercel env ls production', (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message });
        return;
      }
      
      const lines = stdout.split('\n');
      const secrets = {};
      
      lines.forEach(line => {
        const match = line.match(/^\s*(\w+)\s+/);
        if (match && !line.includes('Environment Variables found')) {
          secrets[match[1]] = 'PRESENT';
        }
      });
      
      resolve({ success: true, secrets });
    });
  });
}

// Main secrets parity check
async function runSecretsParityCheck() {
  console.log('🔑 SECRETS/CONFIG PARITY CHECK');
  console.log('============================');
  
  const localEnv = loadEnvironment();
  
  console.log('\n📋 Checking local .env secrets...');
  const localSecrets = {
    'SUPABASE_URL': localEnv.SUPABASE_URL ? 'PRESENT' : 'MISSING',
    'SUPABASE_ANON_KEY': localEnv.SUPABASE_ANON_KEY ? 'PRESENT' : 'MISSING',
    'SUPABASE_SERVICE_ROLE_KEY': localEnv.SUPABASE_SERVICE_ROLE_KEY ? 'PRESENT' : 'MISSING',
    'STRIPE_SECRET_KEY': localEnv.STRIPE_SECRET_KEY ? 'PRESENT' : 'MISSING',
    'STRIPE_WEBHOOK_SECRET': localEnv.STRIPE_WEBHOOK_SECRET ? 'PRESENT' : 'MISSING',
    'STRIPE_WEBHOOK_SECRET_01': localEnv.STRIPE_WEBHOOK_SECRET_01 ? 'PRESENT' : 'MISSING',
    'KEEPER_BREAK_GLASS_TOKEN': localEnv.KEEPER_BREAK_GLASS_TOKEN && localEnv.KEEPER_BREAK_GLASS_TOKEN !== '[REDACTED]' ? 'PRESENT' : 'REDACTED',
    'VERCEL_TOKEN': localEnv.VERCEL_TOKEN ? 'PRESENT' : 'MISSING'
  };
  
  console.log('Local .env:');
  Object.entries(localSecrets).forEach(([key, status]) => {
    const icon = status === 'PRESENT' ? '✅' : status === 'REDACTED' ? '🔒' : '❌';
    console.log(`  ${icon} ${key}: ${status}`);
  });
  
  console.log('\n🌐 Checking Supabase secrets...');
  const supabaseResult = await checkSupabaseSecrets();
  
  if (supabaseResult.success) {
    console.log('Supabase secrets:');
    const criticalSecrets = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY', 
      'SUPABASE_SERVICE_ROLE_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_WEBHOOK_SECRET_01',
      'KEEPER_BREAK_GLASS_TOKEN'
    ];
    
    criticalSecrets.forEach(secret => {
      const status = supabaseResult.secrets[secret] || 'MISSING';
      const icon = status === 'PRESENT' ? '✅' : '❌';
      console.log(`  ${icon} ${secret}: ${status}`);
    });
  } else {
    console.log(`❌ Supabase secrets check failed: ${supabaseResult.error}`);
  }
  
  console.log('\n☁️  Checking Vercel secrets...');
  const vercelResult = await checkVercelSecrets();
  
  if (vercelResult.success) {
    console.log('Vercel secrets:');
    const criticalSecrets = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY', 
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_WEBHOOK_SECRET_01',
      'KEEPER_BREAK_GLASS_TOKEN',
      'VERCEL_TOKEN'
    ];
    
    criticalSecrets.forEach(secret => {
      const status = vercelResult.secrets[secret] || 'MISSING';
      const icon = status === 'PRESENT' ? '✅' : '❌';
      console.log(`  ${icon} ${secret}: ${status}`);
    });
  } else {
    console.log(`❌ Vercel secrets check failed: ${vercelResult.error}`);
  }
  
  // Function-specific secrets check
  console.log('\n🔍 Function-specific secrets requirements:');
  
  const functionSecrets = {
    'stripe-webhook': ['STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY'],
    'payment-processing': ['STRIPE_SECRET_KEY'],
    'user-management': ['SUPABASE_SERVICE_ROLE_KEY'],
    'analytics-service': ['SUPABASE_SERVICE_ROLE_KEY'],
    'file-storage': ['SUPABASE_SERVICE_ROLE_KEY']
  };
  
  Object.entries(functionSecrets).forEach(([functionName, requiredSecrets]) => {
    console.log(`\n${functionName}:`);
    requiredSecrets.forEach(secret => {
      const localStatus = localSecrets[secret];
      const supabaseStatus = supabaseResult.success ? (supabaseResult.secrets[secret] || 'MISSING') : 'ERROR';
      const vercelStatus = vercelResult.success ? (vercelResult.secrets[secret] || 'MISSING') : 'ERROR';
      
      const allPresent = localStatus === 'PRESENT' && supabaseStatus === 'PRESENT' && vercelStatus === 'PRESENT';
      const icon = allPresent ? '✅' : '⚠️';
      
      console.log(`  ${icon} ${secret}: Local=${localStatus}, Supabase=${supabaseStatus}, Vercel=${vercelStatus}`);
    });
  });
  
  // Summary
  console.log('\n📊 SECRETS PARITY SUMMARY');
  console.log('========================');
  
  const missingLocal = Object.entries(localSecrets).filter(([_, status]) => status === 'MISSING').length;
  const missingSupabase = supabaseResult.success ? 
    Object.keys(localSecrets).filter(key => !supabaseResult.secrets[key]).length : 0;
  const missingVercel = vercelResult.success ? 
    Object.keys(localSecrets).filter(key => !vercelResult.secrets[key]).length : 0;
  
  console.log(`Missing in local .env: ${missingLocal}`);
  console.log(`Missing in Supabase: ${missingSupabase}`);
  console.log(`Missing in Vercel: ${missingVercel}`);
  
  if (missingLocal === 0 && missingSupabase === 0 && missingVercel === 0) {
    console.log('\n✅ All secrets synchronized across environments');
  } else {
    console.log('\n⚠️  Secrets parity issues detected - may cause runtime failures');
  }
  
  return {
    localMissing: missingLocal,
    supabaseMissing: missingSupabase,
    vercelMissing: missingVercel
  };
}

// Run the check
runSecretsParityCheck().then(results => {
  console.log('\n✅ Secrets parity check completed');
  process.exit((results.localMissing > 0 || results.supabaseMissing > 0 || results.vercelMissing > 0) ? 1 : 0);
}).catch(error => {
  console.error('Secrets parity check failed:', error.message);
  process.exit(1);
});
