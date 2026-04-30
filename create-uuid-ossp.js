require('dotenv').config();
const { Pool } = require('pg');

const url = new URL(process.env.SUPABASE_URL);
const projectRef = url.hostname.split('.')[0];
const connectionString = `postgresql://postgres:${process.env.SUPABASE_SERVICE_ROLE_KEY}@db.${projectRef}.supabase.co:5432/postgres`;

const pool = new Pool({ 
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false } 
});

pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"', (err, res) => {
  if (err) {
    console.error('Error creating extension:', err);
  } else {
    console.log('Extension created successfully:', res.rowCount);
  }
  pool.end();
});