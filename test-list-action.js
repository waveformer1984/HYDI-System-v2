const FUNCTION_URL = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE';

(async () => {
  console.log('Testing action: "list"');
  console.log('===================');
  
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
    
    console.log('Status Code:', response.status);
    console.log('Response Body:');
    console.log(JSON.stringify(data, null, 2));
    
    // Analysis
    console.log('\nAnalysis:');
    if (data.data && Array.isArray(data.data)) {
      console.log(`- Returned array with ${data.data.length} items`);
      if (data.data.length === 0) {
        console.log('- Empty list - likely DB-backed (no local mappings)');
      } else {
        console.log('- Has data - checking source...');
        if (data.data[0].client_id) {
          console.log('- Contains client_id - DB-backed from clients table');
        }
        if (data.data[0].id || data.data[0].object === 'account') {
          console.log('- Contains Stripe account fields - Stripe API-backed');
        }
      }
    } else if (data.error) {
      console.log('- Error response:', data.error);
    }
    
  } catch (err) {
    console.error('Request failed:', err.message);
  }
})();
