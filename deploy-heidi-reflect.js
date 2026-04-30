const https = require('https');
const fs = require('fs');

const projectRef = 'akbnfovjdcobifeupvbn';
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE';

const functionCode = fs.readFileSync('supabase/functions/heidi-reflect/index.ts', 'utf8');

const data = JSON.stringify({
  slug: 'heidi-reflect',
  name: 'heidi-reflect',
  source: functionCode,
  verify_jwt: false
});

const options = {
  hostname: 'api.supabase.com',
  port: 443,
  path: `/v1/projects/${projectRef}/functions/heidi-reflect`,
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  },
  timeout: 60000
};

console.log('Deploying heidi-reflect function...');

const req = https.request(options, (res) => {
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log('Response:', responseData.substring(0, 500));
    
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✓ Deployment successful!');
      process.exit(0);
    } else {
      console.error('✗ Deployment failed');
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error(`Request error: ${e.message}`);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Request timeout');
  req.destroy();
  process.exit(1);
});

req.write(data);
req.end();
