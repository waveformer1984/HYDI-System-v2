const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });
(async () => {
  try {
    const r = await pool.query('SELECT count(*) as cnt FROM revenue_prospects');
    console.log('Supabase DB: READY (' + r.rows[0].cnt + ' prospects)');
    const t = await pool.query("SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('revenue_prospects','revenue_opportunities','revenue_ledger','customer_services','revenue_events','heidi_goals','heidi_identity','cognitive_cycle_audit','chat_conversations','chat_messages','communication_events')");
    console.log('Required tables: ' + t.rows[0].cnt + '/10 present');
  } catch(e) { console.log('Supabase DB: FAILED - ' + e.message); }
  await pool.end();
})();
