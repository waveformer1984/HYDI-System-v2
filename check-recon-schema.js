const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });

async function main() {
  // webhook_events schema
  const r1 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'webhook_events' ORDER BY ordinal_position");
  console.log('webhook_events columns:');
  r1.rows.forEach(row => console.log('  ', row.column_name, row.data_type));

  // revenue_ledger schema
  const r2 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'revenue_ledger' ORDER BY ordinal_position");
  console.log('\nrevenue_ledger columns:');
  r2.rows.forEach(row => console.log('  ', row.column_name, row.data_type));

  // webhook_events status values
  const r3 = await pool.query("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'webhook_events'::regclass AND contype = 'c'");
  console.log('\nwebhook_events CHECK constraints:');
  r3.rows.forEach(row => console.log('  ', row.pg_get_constraintdef));

  // Count webhook_events by status
  const r4 = await pool.query("SELECT status, count(*) FROM webhook_events GROUP BY status");
  console.log('\nwebhook_events by status:');
  r4.rows.forEach(row => console.log('  ', row.status, row.count));

  // Count revenue_ledger entries
  const r5 = await pool.query("SELECT count(*) as total, count(*) FILTER (WHERE verified) as verified, count(*) FILTER (WHERE NOT verified) as unverified FROM revenue_ledger");
  console.log('\nrevenue_ledger counts:');
  console.log('  total:', r5.rows[0].total, 'verified:', r5.rows[0].verified, 'unverified:', r5.rows[0].unverified);

  // Count customer_jobs
  const r6 = await pool.query("SELECT count(*) as total, count(*) FILTER (WHERE job_status = 'delivered') as delivered FROM customer_jobs");
  console.log('\ncustomer_jobs counts:');
  console.log('  total:', r6.rows[0].total, 'delivered:', r6.rows[0].delivered);

  await pool.end();
}
main().catch(e => { console.log('Error:', e.message); process.exit(1); });
