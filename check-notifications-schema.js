const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });

pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'notifications' ORDER BY ordinal_position").then(r => {
  console.log('notifications columns:');
  r.rows.forEach(row => console.log('  ', row.column_name, row.data_type));
  pool.end();
}).catch(e => { console.log('Error:', e.message); pool.end(); });
