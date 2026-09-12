const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });

pool.query("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'notifications'::regclass AND contype = 'c'").then(r => {
  console.log('CHECK constraints on notifications:');
  r.rows.forEach(row => console.log('  ', row.pg_get_constraintdef));
  pool.end();
}).catch(e => { console.log('Error:', e.message); pool.end(); });
