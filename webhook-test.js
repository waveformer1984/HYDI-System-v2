// Test webhook endpoint health
require('dotenv').config();

const https = require('https');

const data = JSON.stringify({ test: 'healthcheck' });

const options = {
  hostname: 'akbnfovjdcobifeupvbn.supabase.co',
  port: 443,
  path: '/functions/v1/stripe-webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  console.log(`✅ Webhook Status: ${res.statusCode}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log(`📄 Response: ${responseData}`);
  });
});

req.on('error', (e) => {
  console.error(`❌ Webhook test failed: ${e.message}`);
});

req.write(data);
req.end();

console.log('🔗 Testing webhook endpoint...');
