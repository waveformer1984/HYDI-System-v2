// Controlled checkout test - no URL exposure
const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/checkout',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log(`✅ Status: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.url && response.url.includes('checkout.stripe.com')) {
        console.log('✅ Live Stripe checkout session created');
        const sessionId = response.url.match(/cs_live_[a-zA-Z0-9]+/)[0];
        console.log(`🔗 Session ID: ${sessionId.substring(0, 12)}...`);
        console.log('⚠️  URL withheld for security');
      } else {
        console.log('❌ Invalid response format');
      }
    } catch (error) {
      console.log('❌ Failed to parse response:', error.message);
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Request failed: ${e.message}`);
});

// Write test data
req.write(JSON.stringify({
  tier: 'starter',
  email: 'controlled-test@hydi.local',
  company: 'test-company'
}));

req.end();

console.log('🧪 Running controlled checkout test...');
