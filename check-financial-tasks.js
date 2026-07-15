#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const client = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data, error } = await client
    .from('agent_bus')
    .select('*')
    .eq('division', 'financial');

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('Financial tasks in agent_bus:');
  if (data.length === 0) {
    console.log('  (none)');
  } else {
    data.forEach(t => {
      console.log(`  ID: ${t.id}, Status: ${t.status}, Amount: $${t.payload?.amount || 'N/A'}, Confidence: ${t.confidence}`);
    });
  }
})();
