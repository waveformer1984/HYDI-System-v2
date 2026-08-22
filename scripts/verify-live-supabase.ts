/**
 * Verify live Supabase connectivity and intervention table state.
 * NO MOCKS — connects to the actual local Supabase instance.
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }

  console.log(`Supabase URL: ${url}`);
  console.log(`Key length: ${key.length}`);

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  // 1. Check connectivity — query a known table
  console.log('\n=== Connectivity check ===');
  const { data: healthData, error: healthError } = await supabase
    .from('adaptive_operator_events')
    .select('count')
    .limit(1);
  if (healthError) {
    console.log(`adaptive_operator_events: ${healthError.message}`);
  } else {
    console.log(`adaptive_operator_events: accessible (${healthData?.length ?? 0} rows returned)`);
  }

  // 2. Check if human_intervention_requests table exists
  console.log('\n=== human_intervention_requests table ===');
  const { data: intData, error: intError } = await supabase
    .from('human_intervention_requests')
    .select('*')
    .limit(1);
  if (intError) {
    console.log(`ERROR: ${intError.message}`);
    console.log('Table does not exist — migration needs to be applied');
  } else {
    console.log(`Table exists and is accessible (${intData?.length ?? 0} rows)`);
    if (intData && intData.length > 0) {
      console.log('Sample row:', JSON.stringify(intData[0], null, 2));
    }
  }

  // 3. Check table columns by inserting a test row
  console.log('\n=== Column check ===');
  const testId = `test_probe_${Date.now()}`;
  const { error: insertError } = await supabase
    .from('human_intervention_requests')
    .insert({
      request_id: testId,
      goal_id: 'test_probe_goal',
      blocker: 'test',
      required_action: 'test',
      why_required: 'test',
      intervention_type: 'UNKNOWN',
      status: 'pending',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
  if (insertError) {
    console.log(`Insert error: ${insertError.message}`);
    console.log('Table may not exist or schema is wrong');
  } else {
    console.log('Insert successful — all required columns present');

    // Read it back
    const { data: readBack, error: readError } = await supabase
      .from('human_intervention_requests')
      .select('*')
      .eq('request_id', testId)
      .single();
    if (readError) {
      console.log(`Read-back error: ${readError.message}`);
    } else {
      console.log('Read-back successful');
      console.log('Columns:', Object.keys(readBack).join(', '));
    }

    // Clean up
    const { error: delError } = await supabase
      .from('human_intervention_requests')
      .delete()
      .eq('request_id', testId);
    if (delError) {
      console.log(`Cleanup error: ${delError.message}`);
    } else {
      console.log('Cleanup successful — test row deleted');
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
