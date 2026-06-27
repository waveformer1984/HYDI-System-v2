#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const client = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  console.log('\nREVIEWING AUDIT TRAIL');
  console.log('─'.repeat(80));

  // Get all events from last hour
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

  const { data: events, error } = await client
    .from('heidi_events')
    .select('*')
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching events:', error);
    process.exit(1);
  }

  if (!events || events.length === 0) {
    console.log('(No events in the last hour)\n');
    process.exit(0);
  }

  console.log(`Found ${events.length} decision events:\n`);

  // Summary by verdict
  const verdictCounts = {};
  events.forEach(e => {
    verdictCounts[e.verdict] = (verdictCounts[e.verdict] || 0) + 1;
  });

  console.log('VERDICT SUMMARY:');
  Object.entries(verdictCounts).forEach(([verdict, count]) => {
    const icon = {
      'AUTO-APPROVE': '✅',
      'REVIEW': '🔍',
      'BLOCK': '❌',
      'USER-APPROVED': '👤',
      'USER-REJECTED': '⛔'
    }[verdict] || '•';
    console.log(`  ${icon} ${verdict}: ${count}`);
  });

  console.log('\n' + '─'.repeat(80));
  console.log('RECENT DECISIONS (Last 5):\n');

  events.slice(0, 5).forEach((e, i) => {
    const icon = {
      'AUTO-APPROVE': '✅',
      'REVIEW': '🔍',
      'BLOCK': '❌',
      'USER-APPROVED': '👤',
      'USER-REJECTED': '⛔'
    }[e.verdict] || '•';

    console.log(`${i+1}. ${icon} ${e.verdict}`);
    console.log(`   Reason: ${e.reason}`);
    console.log(`   Task ID: ${e.task_id?.substring(0, 8)}...`);
    console.log(`   Memory IDs: ${e.memory_ids?.length || 0} facts used`);
    console.log(`   Time: ${new Date(e.created_at).toLocaleTimeString()}`);
    console.log('');
  });

  console.log('─'.repeat(80));
  console.log(`✅ AUDIT TRAIL COMPLETE\n`);
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
