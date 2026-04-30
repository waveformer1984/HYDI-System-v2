// Vercel API check - bypass CLI encoding issues
// Requires: VERCEL_TOKEN environment variable

const https = require('https');
const fs = require('fs');

async function checkVercelEnv() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = 'prj_MgoAarRxtvm4Ed2RknVFpGcPcUqr'; // Your project ID
  
  if (!token) {
    console.log('❌ VERCEL_TOKEN environment variable required');
    return false;
  }
  
  const requiredKeys = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'KEEPER_BREAK_GLASS_TOKEN'
  ];
  
  try {
    const envVars = await getVercelEnvVars(token, projectId);
    const missing = requiredKeys.filter(key => !envVars.includes(key));
    
    if (missing.length === 0) {
      console.log('✅ All required Vercel env vars present');
      return true;
    } else {
      console.log(`❌ Missing Vercel env vars: ${missing.join(', ')}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Vercel API check failed: ${error.message}`);
    return false;
  }
}

function getVercelEnvVars(token, projectId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.vercel.com',
      port: 443,
      path: `/v9/projects/${projectId}/env`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const envVars = parsed.envs || [];
          const keys = envVars.map(env => env.key);
          resolve(keys);
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

// Run if called directly
if (require.main === module) {
  checkVercelEnv().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { checkVercelEnv };
