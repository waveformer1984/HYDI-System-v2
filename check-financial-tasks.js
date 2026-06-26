#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const client = createClient('http://127.0.0.1:54321', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz');

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
