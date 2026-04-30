const FUNCTION_URL = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE';

async function createAndList() {
  console.log('🔧 ProtoForge Stripe Connect Setup');
  console.log('==================================\n');
  
  // First, list current accounts
  console.log('1. Checking current accounts...');
  try {
    const listResponse = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'list' })
    });
    
    const listData = await listResponse.json();
    console.log('Status:', listResponse.status);
    console.log('Current accounts:');
    console.log(JSON.stringify(listData, null, 2));
    
    if (listData.data && listData.data.length > 0) {
      console.log('\n✅ Found existing accounts');
      listData.data.forEach(acc => {
        console.log(`- ${acc.client_name}: ${acc.stripe_account_id || 'No Connect account yet'}`);
      });
    }
    
  } catch (err) {
    console.error('List failed:', err.message);
  }
  
  // Check if we need to create
  console.log('\n2. To create a Connect account, you need to:');
  console.log('   a) Configure STRIPE_SECRET_KEY in Supabase secrets');
  console.log('   b) Use this command:');
  console.log('      node create-connect-account.js');
  
  console.log('\n3. Current status:');
  console.log('   - Function deployed: ✅');
  console.log('   - Database tables: ✅');
  console.log('   - Stripe key configured: ❌ (needs live key in Supabase secrets)');
  console.log('   - Connect accounts created: ❌ (needs valid key)');
  
  console.log('\n4. What you need to do:');
  console.log('   1. Go to https://akbnfovjdcobifeupvbn.supabase.co/functions/secrets');
  console.log('   2. Add STRIPE_SECRET_KEY with your live key');
  console.log('   3. Redeploy stripe-connect-admin function');
  console.log('   4. Run: node create-connect-account.js');
  console.log('   5. The response will contain the acct_... ID you need');
}

createAndList();
