#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local)'); process.exit(1); }
const client = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  console.log('\n📋 Checking Procedural Memory Facts');
  console.log('═'.repeat(80));

  const { data: facts, error } = await client
    .from('hydi_facts')
    .select('id, division, content, confidence')
    .order('division');

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log(`\nTotal facts: ${facts.length}\n`);

  // Group by division
  const byDivision = {};
  facts.forEach(f => {
    if (!byDivision[f.division]) byDivision[f.division] = [];
    byDivision[f.division].push(f);
  });

  Object.entries(byDivision).forEach(([div, divFacts]) => {
    console.log(`\n${div.toUpperCase()} (${divFacts.length} facts):`);
    console.log('─'.repeat(80));
    divFacts.forEach((f, i) => {
      console.log(`${i+1}. [${(f.confidence * 100).toFixed(0)}%] ${f.content.substring(0, 100)}`);
    });
  });

  // Check for decision bounds
  console.log('\n' + '═'.repeat(80));
  console.log('SEARCHING FOR DECISION BOUNDS...\n');

  const hasThreshold = facts.some(f => f.content.includes('0.85') || f.content.includes('threshold'));
  const hasMax = facts.some(f => f.content.includes('10000') || f.content.includes('$10') || f.content.includes('max_approve'));
  const hasLease = facts.some(f => f.content.includes('120') || f.content.includes('lease') || f.content.includes('TTL'));

  console.log(`Contains "0.85" or "threshold": ${hasThreshold ? '✅' : '❌'}`);
  console.log(`Contains "$10k" or "max_approve": ${hasMax ? '✅' : '❌'}`);
  console.log(`Contains "120" or "lease": ${hasLease ? '✅' : '❌'}`);

  if (!hasThreshold || !hasMax || !hasLease) {
    console.log('\n⚠️  Missing decision bounds in procedural memory!');
    console.log('These should be seeded from system configuration.');
  } else {
    console.log('\n✅ All decision bounds present in facts');
  }

  console.log('\n' + '═'.repeat(80));
})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
