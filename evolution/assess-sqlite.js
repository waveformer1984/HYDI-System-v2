'use strict';
/**
 * Run the self-improvement loop against a LOCAL SQLite store — no Supabase required.
 *
 *   node evolution/assess-sqlite.js --seed   # seed sample events into the local DB, then assess
 *   node evolution/assess-sqlite.js          # assess whatever is currently in the local DB
 *
 * DB file: ./data/heidi_events_local.db (override with LOCAL_EVENT_DB).
 */
const fs = require('fs');
const path = require('path');
const { LocalEventStore, assessFromSqlite } = require('./local-event-store');
const { proposeGoals } = require('./findings-to-goals');

async function main() {
  const dbPath = process.env.LOCAL_EVENT_DB || path.join(__dirname, '..', 'data', 'heidi_events_local.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const store = await new LocalEventStore({ dbPath }).init();
  console.log(`[assess-sqlite] store: ${store.usingSqlite ? dbPath : 'in-memory fallback (sqlite3 not loaded)'}`);

  if (process.argv.includes('--seed')) {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push({ verdict: 'REVIEW', division: 'revenue', elapsed_ms: 200, error_message: i < 4 ? 'timeout' : null, created_at: iso(now - 1000 * i) });
    for (let i = 0; i < 8; i++) rows.push({ verdict: 'AUTO-APPROVE', division: 'galactic_bytes', elapsed_ms: 90, created_at: iso(now - 1500 * i) });
    await store.recordMany(rows);
    console.log(`[seed] recorded ${rows.length} events`);
  }

  const report = await assessFromSqlite(store, { windowHours: 24 });
  console.log('\n=== SELF-ASSESSMENT (local SQLite) ===');
  console.log(`events=${report.total_events}  error_rate=${(report.error_rate * 100).toFixed(1)}%  p95=${report.latency_ms.p95}ms`);
  console.log('verdicts:', JSON.stringify(report.verdicts));
  console.log('\nFINDINGS:');
  for (const f of report.findings) console.log(`  [${f.severity}] ${f.message}`);

  const { proposals } = await proposeGoals({ allGoals: () => [], addGoal: async () => ({}) }, report);
  console.log('\nPROPOSED GOALS (preview — nothing created):');
  if (!proposals.length) console.log('  (none)');
  for (const p of proposals) console.log(`  • (${p.priority}) ${p.objective}`);
  console.log('');

  await store.close();
}

main().catch((e) => { console.error('[assess-sqlite] error:', e.message); process.exit(1); });
