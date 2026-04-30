// Simple test for checkout API
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
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Response: ${data}`);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

// Write data to request body
req.write(JSON.stringify({
  tier: 'starter',
  email: 'test@example.com',
  company: 'test'
}));

req.end();
