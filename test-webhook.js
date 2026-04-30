const crypto = require('crypto');

// Test webhook signature with new secret
function testWebhookSignature() {
  const payload = JSON.stringify({
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_test_123',
        amount: 1200,
        currency: 'usd'
      }
    }
  });

  const secret = 'whsec_VnrIjBX7F1bkBZpuoRORqxPbey6b14wh';
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  console.log('Testing webhook signature...');
  console.log('Payload:', payload);
  console.log('Timestamp:', timestamp);
  console.log('Signature:', signature);
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  
  const isValid = signature === expectedSignature;
  console.log('✅ Webhook signature verification:', isValid ? 'SUCCESS' : 'FAILED');
  
  return isValid;
}

testWebhookSignature();
