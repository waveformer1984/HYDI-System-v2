#!/usr/bin/env node
/**
 * Test the Stripe Connect Admin function
 */

const FUNCTION_URL = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE';

async function testFunction() {
  console.log('Testing Stripe Connect Admin function...\n');

  try {
    // Test list action
    console.log('▶ Testing list action...');
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'list' })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!');
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.error('❌ Error:', data);
    }

  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
}

testFunction();
