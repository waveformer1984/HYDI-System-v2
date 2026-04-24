const { Pool } = require('pg');
require('dotenv').config();

// Use the IPv6 address we got from nslookup
const dbHost = '2600:1f18:2e13:9d1c:f6d4:8982:3f3b:48d0'; // IPv6 address
const dbPort = 5432;
const dbUser = 'postgres';
const dbPassword = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbName = 'postgres';

// Connection string for IPv6 host (note the square brackets for IPv6 in the connection string)
const connectionString = `postgresql://${dbUser}:${dbPassword}@[${dbHost}]:${dbPort}/${dbName}`;

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false } // Supabase requires SSL
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Connection error:', err);
  } else {
    console.log('Connected successfully:', res.rows[0]);
  }
  pool.end();
});