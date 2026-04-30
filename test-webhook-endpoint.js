// Test webhook endpoint with Stripe signature verification
const https = require('https');
const crypto = require('crypto');
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

// Create Stripe test event
function createTestEvent() {
  return {
    id: 'evt_test_' + Date.now(),
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_test_' + Date.now(),
        object: 'payment_intent',
        amount: 2000,
        currency: 'usd',
        status: 'succeeded',
        metadata: {
          order_id: 'test_order_123'
        }
      }
    }
  };
}

// Sign event with Stripe webhook secret
function signEvent(event, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = timestamp + '.' + JSON.stringify(event);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

// Test webhook endpoint
function testWebhookEndpoint() {
  return new Promise((resolve) => {
    const env = loadEnvironment();
    const webhookUrl = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-webhook';
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET_01;
    
    if (!webhookSecret) {
      resolve({
        success: false,
        error: 'Webhook secret not found in environment'
      });
      return;
    }
    
    // Create test event
    const testEvent = createTestEvent();
    
    // Sign the event
    const signature = signEvent(testEvent, webhookSecret);
    
    // Prepare request
    const payload = JSON.stringify(testEvent);
    
    const options = {
      hostname: 'akbnfovjdcobifeupvbn.supabase.co',
      port: 443,
      path: '/functions/v1/stripe-webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    console.log('🔗 Testing webhook endpoint...');
    console.log(`URL: ${webhookUrl}`);
    console.log(`Event Type: ${testEvent.type}`);
    console.log(`Payment Amount: $${testEvent.data.object.amount / 100}`);
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`Status Code: ${res.statusCode}`);
        console.log(`Response: ${data}`);
        
        try {
          const response = JSON.parse(data);
          
          resolve({
            success: res.statusCode === 200,
            statusCode: res.statusCode,
            response: response,
            eventProcessed: testEvent.id,
            signature: signature.split(',')[0] + ',...' // Show only timestamp part
          });
        } catch (error) {
          resolve({
            success: res.statusCode === 200,
            statusCode: res.statusCode,
            response: data,
            error: error.message
          });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });
    
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Request timeout'
      });
    });
    
    req.write(payload);
    req.end();
  });
}

// Run test
async function runWebhookTest() {
  console.log('🧪 STRIPE WEBHOOK ENDPOINT TEST');
  console.log('===============================');
  
  const result = await testWebhookEndpoint();
  
  console.log('\n📊 TEST RESULTS:');
  console.log('================');
  
  if (result.success) {
    console.log('✅ Webhook Test: PASSED');
    console.log(`✅ Status Code: ${result.statusCode}`);
    console.log(`✅ Event Processed: ${result.eventProcessed}`);
    console.log(`✅ Response: ${JSON.stringify(result.response)}`);
  } else {
    console.log('❌ Webhook Test: FAILED');
    console.log(`❌ Error: ${result.error}`);
    if (result.statusCode) {
      console.log(`❌ Status Code: ${result.statusCode}`);
    }
  }
  
  return result;
}

// Execute test
runWebhookTest().then(result => {
  console.log('\n✅ Webhook test completed');
  process.exit(result.success ? 0 : 1);
}).catch(error => {
  console.error('Test failed:', error.message);
  process.exit(1);
});
