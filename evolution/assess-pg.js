'use strict';
/**
 * Run the self-improvement loop against local Supabase's Postgres DIRECTLY, via the
 * superuser connection — bypasses PostgREST, API keys, RLS, and table grants entirely.
 * Ideal for local dev where the `permission denied for table` / sb_secret-key friction
 * gets in the way.
 *
 *   node evolution/assess-pg.js --seed   # insert sample heidi_events, then assess
 *   node evolution/assess-pg.js          # assess current rows
 *
 * Connection: DATABASE_URL if set, else the local Supabase default
 * (postgresql://postgres:postgres@127.0.0.1:54322/postgres — shown by `supabase status`).
 */
const { Client } = require('pg');
const { assess } = require('./self-assessment');
const { proposeGoals } = require('./findings-to-goals');

const CONN = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  console.log(`[assess-pg] connected: ${CONN.replace(/:[^:@/]*@/, ':****@')}`);

  try {
    if (process.argv.includes('--seed')) {
      const rows = [];
      for (let i = 0; i < 10; i++) rows.push(['decision', 'REVIEW', 'revenue', JSON.stringify({ elapsed_ms: 200, error: i < 4 ? 'timeout' : null })]);
      for (let i = 0; i < 8; i++) rows.push(['decision', 'AUTO-APPROVE', 'galactic_bytes', JSON.stringify({ elapsed_ms: 90 })]);
      for (const r of rows) {
        await client.query('INSERT INTO heidi_events (event_type, verdict, division, payload) VALUES ($1,$2,$3,$4::jsonb)', r);
      }
      console.log(`[seed] inserted ${rows.length} events into heidi_events`);
    }

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { rows } = await client.query(
      'SELECT verdict, division, payload, created_at FROM heidi_events WHERE created_at >= $1 LIMIT 100000',
      [since]
    );
    const events = rows.map((e) => ({
      verdict: e.verdict,
      division: e.division,
      elapsed_ms: e.payload && e.payload.elapsed_ms,
      error_message: e.payload && (e.payload.error || e.payload.error_message),
    }));

    const report = assess(events, { windowHours: 24 });
    console.log('\n=== SELF-ASSESSMENT (local Postgres) ===');
    console.log(`events=${report.total_events}  error_rate=${(report.error_rate * 100).toFixed(1)}%  p95=${report.latency_ms.p95}ms`);
    console.log('verdicts:', JSON.stringify(report.verdicts));
    console.log('\nFINDINGS:');
    for (const f of report.findings) console.log(`  [${f.severity}] ${f.message}`);

    const { proposals } = await proposeGoals({ allGoals: () => [], addGoal: async () => ({}) }, report);
    console.log('\nPROPOSED GOALS (preview — nothing created):');
    if (!proposals.length) console.log('  (none)');
    for (const p of proposals) console.log(`  • (${p.priority}) ${p.objective}`);
    console.log('');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('[assess-pg] error:', e.message); process.exit(1); });
