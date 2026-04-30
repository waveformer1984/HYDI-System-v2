const FUNCTION_URL = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE';

(async () => {
  console.log('Creating Stripe Connect account for Galactic Bytes...');
  console.log('====================================================\n');
  
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
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true }
          },
          business_profile: {
            name: 'Galactic Bytes Inc',
            url: 'https://galacticbytes.com'
          }
        }
      })
    });
    
    const data = await response.json();
    console.log('Status Code:', response.status);
    console.log('\nResponse Body:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.success && data.data.account_id) {
      console.log('\n✅ SUCCESS - Connect Account Created!');
      console.log('─'.repeat(50));
      console.log('Account ID:', data.data.account_id);
      console.log('Type:', data.data.type);
      console.log('Charges Enabled:', data.data.charges_enabled);
      console.log('Payouts Enabled:', data.data.payouts_enabled);
      console.log('Requirements:', data.data.requirements ? 'See response' : 'None');
      
      // Next steps
      console.log('\n📋 Next Steps:');
      console.log('1. Save this Account ID for the client');
      console.log('2. Create onboarding link for client');
      console.log('3. Test payout flow');
      
      // Offer to create login link
      console.log('\n💡 Create login link for client dashboard?');
      console.log('Run: node create-login-link.js ' + data.data.account_id);
    } else if (data.error) {
      console.log('\n❌ Error creating account:');
      console.log(data.error);
    }
    
  } catch (err) {
    console.error('\n❌ Request failed:', err.message);
  }
})();
