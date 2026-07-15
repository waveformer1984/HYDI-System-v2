const FUNCTION_URL = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE';

(async () => {
  console.log('Checking Stripe key configuration...');
  console.log('====================================\n');
  
  // First, let's check if we can at least retrieve accounts
  console.log('1. Testing list action (should work even with invalid key for DB-backed data):');
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
    console.log('Response:', JSON.stringify(listData, null, 2));
  } catch (err) {
    console.error('List failed:', err.message);
  }
  
  console.log('\n2. The issue:');
  console.log('   - The Edge Function is using a test key (sk_test_...)');
  console.log('   - Your .env has a live key (rk_live_...)');
  console.log('   - Edge Functions use secrets, not .env files');
  
  console.log('\n3. To fix:');
  console.log('   a) Go to Supabase Dashboard → Functions → stripe-connect-admin');
  console.log('   b) Click "Secrets"');
  console.log('   c) Add/update STRIPE_SECRET_KEY with your live key');
  console.log('   d) Redeploy the function');
  
  console.log('\n4. For now, let\'s use test mode:');
  console.log('   - Create a test Connect account with test key');
  console.log('   - Verify the flow works');
  console.log('   - Then rotate to live key');
})();
