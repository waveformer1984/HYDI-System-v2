#!/usr/bin/env node
/**
 * Verify Stripe API key rotation and webhook setup
 */

const crypto = require('crypto');

const FUNCTION_URL = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_SERVICE_ROLE_KEY';

async function verifyStripeIntegration() {
  console.log('🔐 Stripe Integration Verification');
  console.log('===================================\n');
  
  // 1. Test API key works
  console.log('1. Testing Stripe API connectivity...');
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'list' })
    });
    
    const data = await response.json();
    
    if (data.success && !data.error) {
      console.log('✅ Stripe API key is working');
    } else if (data.error && data.error.includes('Invalid API Key')) {
      console.log('❌ Stripe API key is invalid or not updated');
      console.log('   Error:', data.error);
    } else {
      console.log('⚠️  Unexpected response:', data);
    }
  } catch (err) {
    console.error('❌ Request failed:', err.message);
  }
  
  // 2. Test webhook signature validation
  console.log('\n2. Testing webhook signature validation...');
  const testPayload = JSON.stringify({
    type: 'account.updated',
    created: Math.floor(Date.now() / 1000),
    object: 'event',
    data: { object: { id: 'acct_test' } }
  });
  
  const testSecret = 'whsec_test'; // Replace with your actual webhook secret
  const testSignature = crypto
    .createHmac('sha256', testSecret)
    .update(testPayload, 'utf8')
    .digest('hex');
  
  console.log('📋 To test webhook validation:');
  console.log('   Payload:', testPayload);
  console.log('   Expected Signature:', `t=${Date.now()},${testSignature}`);
  console.log('   Use stripe-cli: stripe listen --forward-to localhost:3000/api/webhook');
  
  // 3. Check function logs for any auth errors
  console.log('\n3. Next steps:');
  console.log('   - Check function logs in Supabase dashboard');
  console.log('   - Look for any remaining auth errors');
  console.log('   - Test a real Stripe Connect account creation');
  console.log('   - Verify webhook events are received');
}

verifyStripeIntegration();
