require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testPayoutFlow() {
  console.log('Starting payout flow test...');

  // 1. Create a test client for Galactic Bytes
  const clientData = {
    client_name: 'Galactic Bytes',
    project_name: 'Galactic Bytes Project',
    stripe_customer_id: 'cus_test_galacticbytes_001',
    email: 'galactic.bytes@example.com',
    payout_schedule: 'monthly',
    status: 'active'
  };

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert([clientData])
    .select();

  if (clientError) {
    console.error('Error creating client:', clientError);
    return;
  }

  console.log('Created client:', client[0]);
  const clientId = client[0].client_id;

  // 2. Insert a test ledger entry for the client
  // We'll simulate a payment of $100 with platform fee 20% and agent fee 10%
  const ledgerData = {
    stripe_customer_id: 'cus_test_galacticbytes_001',
    project_name: 'Galactic Bytes Project',
    amount_gross: 100.00,
    platform_fee_percent: 20.0,
    agent_fee_percent: 10.0,
    platform_fee_amount: 20.00,
    agent_fee_amount: 10.00,
    net_amount: 70.00,
    status: 'completed'
  };

  const { data: ledgerEntry, error: ledgerError } = await supabase
    .from('ledger')
    .insert([ledgerData])
    .select();

  if (ledgerError) {
    console.error('Error creating ledger entry:', ledgerError);
    return;
  }

  console.log('Created ledger entry:', ledgerEntry[0]);

  // 3. Run the generate_monthly_payouts function
  // We need to set the date range to include today (or adjust the function to use a specific month)
  // For simplicity, we'll adjust the function's date range by setting the system date via a parameter?
  // Since we cannot change the system date, we'll modify the function temporarily to use a fixed period.
  // Instead, let's insert the ledger entry with a timestamp within the last month.

  // Actually, the ledger entry we just inserted has a timestamp of 'now' (default).
  // So it should be within the current month.

  // Let's call the generate_monthly_payouts function
  const { data: functionResult, error: functionError } = await supabase
    .rpc('generate_monthly_payouts');

  if (functionError) {
    console.error('Error generating monthly payouts:', functionError);
    return;
  }

  console.log('Monthly payouts generation completed.');

  // 4. Check the payouts table for the client
  const { data: payouts, error: payoutsError } = await supabase
    .from('payouts')
    .select('*')
    .eq('client_id', clientId);

  if (payoutsError) {
    console.error('Error fetching payouts:', payoutsError);
    return;
  }

  console.log('Payouts for client:', payouts);

  // 5. Optionally, process the payout (if any)
  if (payouts.length > 0) {
    const payout = payouts[0];
    if (payout.status === 'pending') {
      const { data: processResult, error: processError } = await supabase
        .rpc('process_payout', { p_payout_id: payout.payout_id });

      if (processError) {
        console.error('Error processing payout:', processError);
        return;
      }

      console.log('Payout processed:', processResult);
    }
  }

  console.log('Test completed.');
}

// Run the test
testPayoutFlow().catch(err => {
  console.error('Test failed:', err);
});