#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const client = createClient('http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const taskId = 'f52d558a-1682-4655-b571-e5aa6200213d';

  const { data: events } = await client
    .from('heidi_events')
    .select('*')
    .eq('task_id', taskId)
    .order('timestamp', { ascending: false });

  console.log('Audit Trail for $5k Financial Task:');
  console.log('─'.repeat(80));

  if (!events || events.length === 0) {
    console.log('(no events recorded yet)');
    process.exit(0);
  }

  events.slice(0, 3).forEach((e, i) => {
    console.log(`${i+1}. Verdict: ${e.verdict}`);
    console.log(`   Reason: ${e.reason}`);
    console.log(`   Time: ${e.timestamp}`);
    console.log(`   Memory IDs: ${e.memory_ids?.length || 0} facts used`);
    console.log('');
  });

  console.log('─'.repeat(80));
  console.log(`Total events: ${events.length}`);
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
