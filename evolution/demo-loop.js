'use strict';
/**
 * Demo of the self-improvement loop against synthetic data — NO database required.
 * Runs measure -> analyze -> recommend and prints the result. Useful for seeing the
 * loop work while Supabase / local data is being set up.
 *
 *   node evolution/demo-loop.js
 */
const { assess } = require('./self-assessment');
const { proposeGoals } = require('./findings-to-goals');

function sampleEvents() {
  const events = [];
  // healthy, fast division
  for (let i = 0; i < 30; i++) events.push({ verdict: 'AUTO-APPROVE', division: 'galactic_bytes', elapsed_ms: Math.round(80 + Math.random() * 60) });
  // a division with elevated errors
  for (let i = 0; i < 20; i++) events.push({ verdict: 'REVIEW', division: 'revenue', elapsed_ms: Math.round(150 + Math.random() * 100), error_message: i < 5 ? 'timeout' : null });
  // a slow division
  for (let i = 0; i < 12; i++) events.push({ verdict: 'AUTO-APPROVE', division: 'detailer_bot', elapsed_ms: Math.round(6000 + Math.random() * 2000) });
  return events;
}

async function main() {
  const report = assess(sampleEvents(), { windowHours: 24 });
  console.log('\n=== SELF-ASSESSMENT (synthetic data) ===');
  console.log(`events=${report.total_events}  error_rate=${(report.error_rate * 100).toFixed(1)}%  p95=${report.latency_ms.p95}ms`);
  console.log('verdicts:', JSON.stringify(report.verdicts));
  console.log('\nFINDINGS:');
  for (const f of report.findings) console.log(`  [${f.severity}] ${f.message}`);

  const previewEngine = { allGoals: () => [], addGoal: async () => ({}) };
  const { proposals } = await proposeGoals(previewEngine, report); // approve=false by default
  console.log('\nPROPOSED GOALS (preview — nothing created):');
  if (!proposals.length) console.log('  (none)');
  for (const p of proposals) console.log(`  • (${p.priority}) ${p.objective}`);
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
