// Debug Vercel API - list all environment variables
const https = require('https');

async function listAllVercelEnv() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = 'prj_MgoAarRxtvm4Ed2RknVFpGcPcUqr';
  
  if (!token) {
    console.log('❌ VERCEL_TOKEN environment variable required');
    return false;
  }
  
  try {
    const envVars = await getVercelEnvVars(token, projectId);
    console.log('✅ All Vercel environment variables:');
    envVars.forEach(env => {
      console.log(`  - ${env.key} (${env.type})`);
    });
    return true;
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
          resolve(parsed.envs || []);
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
  listAllVercelEnv().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { listAllVercelEnv };
