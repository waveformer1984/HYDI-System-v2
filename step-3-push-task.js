#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  console.log('\n📍 STEP 3: Push Test Task');
  console.log('═'.repeat(80));

  // Push a deployment task (non-sensitive, 88% confidence)
  const { data: inserted, error } = await client
    .from('agent_bus')
    .insert({
      type: 'operational_decision',
      division: 'deployment',
      payload: { action: 'restart_service', service: 'resonator', region: 'us-east-1' },
      confidence: 0.88,
      within_bounds: true,
      status: 'pending'
    })
    .select();

  if (error) {
    console.error('❌ Error pushing task:', error);
    process.exit(1);
  }

  const task = inserted[0];
  console.log('\n✅ TASK PUSHED:');
  console.log(`  ID: ${task.id}`);
  console.log(`  Type: ${task.type}`);
  console.log(`  Division: ${task.division}`);
  console.log(`  Confidence: ${(task.confidence * 100).toFixed(0)}%`);
  console.log(`  Status: ${task.status}`);
  console.log(`  Created: ${new Date(task.created_at).toLocaleTimeString()}\n`);

  // Wait for Heidi to process
  console.log('⏳ Waiting for Heidi to process (5 seconds)...\n');
  await new Promise(r => setTimeout(r, 5000));

  // Check if task is still pending or was processed
  const { data: updated } = await client
    .from('agent_bus')
    .select('status')
    .eq('id', task.id)
    .single();

  console.log('RESULT:');
  console.log(`  Current Status: ${updated.status}`);

  if (updated.status === 'pending') {
    console.log('  ℹ️  Task awaiting decision (Heidi may still be processing)\n');
  } else if (updated.status === 'completed') {
    console.log('  ✅ Task executed!\n');
  } else {
    console.log(`  Status: ${updated.status}\n`);
  }

  console.log('NEXT: Check advisory API for pending decisions');
  console.log(`  curl http://localhost:3459/api/decisions/pending\n`);
})().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
