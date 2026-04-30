const FUNCTION_URL = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE';

(async () => {
  console.log('Creating TEST MODE Connect account for Galactic Bytes...');
  console.log('========================================================\n');
  
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'create',
        client_id: 'd46e05b7-12a9-47d2-8384-61e6fe8f10af',
        account_data: {
          type: 'express',
          country: 'US',
          email: 'test@galacticbytes.com',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true }
          },
          business_profile: {
            name: 'Galactic Bytes TEST',
            url: 'https://galacticbytes.com'
          }
        }
      })
    });
    
    const data = await response.json();
    console.log('Status Code:', response.status);
    console.log('\nResponse Body:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.success && data.data) {
      console.log('\n✅ Test Connect Account Created!');
      console.log('─'.repeat(50));
      console.log('Account ID:', data.data.account_id);
      console.log('Type:', data.data.type);
      console.log('Email:', data.data.email || 'Not set');
      console.log('Charges Enabled:', data.data.charges_enabled);
      console.log('Payouts Enabled:', data.data.payouts_enabled);
      
      // Save for next steps
      console.log('\n💾 Saving account info...');
      require('fs').writeFileSync('test-connect-account.json', JSON.stringify(data.data, null, 2));
      console.log('Saved to: test-connect-account.json');
      
      // Next steps
      console.log('\n📋 Next Steps:');
      console.log('1. Create onboarding link for client');
      console.log('2. Test the payout flow');
      console.log('3. Verify webhook events');
      
    } else if (data.error) {
      console.log('\n❌ Error:');
      console.log(data.error);
      
      if (data.error.includes('test mode')) {
        console.log('\n💡 This is expected in test mode.');
        console.log('   The account structure is created but limited.');
      }
    }
    
  } catch (err) {
    console.error('\n❌ Request failed:', err.message);
  }
})();
