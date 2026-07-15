'use strict';
/**
 * Run the self-improvement loop against a LIVE Supabase (local or remote).
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment / .env — never
 * hard-code the key here.
 *
 *   # .env already points at local Supabase (copy .env.local .env), then:
 *   node evolution/assess-live.js
 *   node evolution/assess-live.js --seed     # insert a few sample heidi_events first (local dev only)
 *
 * Prints the assessment, findings, and proposed goals (preview — creates nothing).
 */
// Load env explicitly, preferring .env.local, and OVERRIDE any pre-existing value
// (e.g. a leftover/persistent Windows SUPABASE_URL) so we reliably hit the DB the
// file points at. Set SUPABASE_ENV_FILE to force a specific file.
(() => {
  try {
    const dotenv = require('dotenv');
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const candidates = process.env.SUPABASE_ENV_FILE
      ? [process.env.SUPABASE_ENV_FILE]
      : ['.env.local', '.env'].map((f) => path.join(root, f));
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        Object.assign(process.env, dotenv.parse(fs.readFileSync(file)));
        console.log(`[assess-live] loaded env from ${path.basename(file)}`);
        break;
      }
    }
  } catch (_) { /* dotenv optional */ }
})();
const { createClient } = require('@supabase/supabase-js');
const { assessFromSupabase } = require('./self-assessment');
const { proposeGoals } = require('./findings-to-goals');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (via .env or the shell).');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  console.log(`[assess-live] target: ${new URL(url).host}`);

  if (process.argv.includes('--seed')) {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push({ event_type: 'decision', verdict: 'REVIEW', division: 'revenue', created_at: iso(now - 1000 * i), payload: { elapsed_ms: 200, error: i < 4 ? 'timeout' : null } });
    for (let i = 0; i < 8; i++) rows.push({ event_type: 'decision', verdict: 'AUTO-APPROVE', division: 'galactic_bytes', created_at: iso(now - 1500 * i), payload: { elapsed_ms: 90 } });
    const { error } = await supabase.from('heidi_events').insert(rows);
    if (error) console.error('[seed] failed:', error.message);
    else console.log(`[seed] inserted ${rows.length} sample events into heidi_events`);
  }

  const report = await assessFromSupabase(supabase, { windowHours: 24 });
  console.log('\n=== SELF-ASSESSMENT (live) ===');
  console.log(`events=${report.total_events}  error_rate=${(report.error_rate * 100).toFixed(1)}%  p95=${report.latency_ms.p95}ms`);
  console.log('verdicts:', JSON.stringify(report.verdicts));
  console.log('\nFINDINGS:');
  for (const f of report.findings) console.log(`  [${f.severity}] ${f.message}`);

  const previewEngine = { allGoals: () => [], addGoal: async () => ({}) };
  const { proposals } = await proposeGoals(previewEngine, report);
  console.log('\nPROPOSED GOALS (preview — nothing created):');
  if (!proposals.length) console.log('  (none)');
  for (const p of proposals) console.log(`  • (${p.priority}) ${p.objective}`);
  console.log('');
}

main().catch((e) => { console.error('[assess-live] error:', e.message); process.exit(1); });
