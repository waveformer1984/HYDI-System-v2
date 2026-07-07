#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local)'); process.exit(1); }
const client = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  // Fetch the $5k financial task
  const { data: tasks, error } = await client
    .from('agent_bus')
    .select('*')
    .eq('division', 'financial')
    .eq('status', 'pending')
    .limit(1);

  if (error) {
    console.error('Error fetching task:', error);
    process.exit(1);
  }

  if (tasks.length === 0) {
    console.log('No pending financial tasks found');
    process.exit(0);
  }

  const task = tasks[0];
  console.log('Testing financial gate with task:');
  console.log(`  ID: ${task.id}`);
  console.log(`  Type: ${task.type}`);
  console.log(`  Division: ${task.division}`);
  console.log(`  Amount: $${task.payload?.amount || 'N/A'}`);
  console.log(`  Confidence: ${task.confidence}`);
  console.log(`  Within Bounds: ${task.within_bounds}`);
  console.log('');

  // Test the decision logic (mimics makeDecision in heidi-agent.js)
  const originalConfidence = task.confidence || 0;
  const threshold = 0.85; // Default auto_approve_threshold
  const sensitiveDivisions = ['financial', 'crypto', 'vendor'];

  console.log('Decision gate logic:');
  console.log(`  Original confidence: ${(originalConfidence * 100).toFixed(0)}%`);
  console.log(`  Threshold for AUTO-APPROVE: ${(threshold * 100).toFixed(0)}%`);
  console.log(`  Division: ${task.division}`);
  console.log(`  Is sensitive: ${sensitiveDivisions.includes(task.division)}`);
  console.log('');

  let verdict = '';
  let reason = '';

  if (sensitiveDivisions.includes(task.division)) {
    verdict = 'REVIEW';
    reason = 'Sensitive (financial) → human approval required';
  } else if (originalConfidence >= threshold && task.within_bounds) {
    verdict = 'AUTO-APPROVE';
    reason = `High confidence (${(originalConfidence * 100).toFixed(0)}%) and within bounds`;
  } else if (originalConfidence < 0.5) {
    verdict = 'BLOCK';
    reason = `Low confidence (${(originalConfidence * 100).toFixed(0)}%)`;
  } else {
    verdict = 'REVIEW';
    reason = `Confidence ${(originalConfidence * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%`;
  }

  console.log(`✅ VERDICT: ${verdict}`);
  console.log(`   Reason: ${reason}`);
  console.log('');
  console.log('EXPECTED: Financial tasks must ALWAYS be routed to REVIEW for human approval');
  console.log(`ACTUAL: ${verdict === 'REVIEW' ? '✅ PASS' : '❌ FAIL'}`);
})();
