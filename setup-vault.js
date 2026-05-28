const { Pool } = require('pg');
require('dotenv').config();

// Use the IP address we got from nslookup
const dbHost = '2600:1f18:2e13:9d1c:f6d4:8982:3f3b:48d0'; // IPv6 address
const dbPort = 5432;
const dbUser = 'postgres';
const dbPassword = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbName = 'postgres';

// Connection string for IPv6 host
const connectionString = `postgresql://${dbUser}:${dbPassword}@[${dbHost}]:${dbPort}/${dbName}`;

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false } // Supabase requires SSL
});

async function setupVault() {
  let client;
  try {
    client = await pool.connect();
    console.log('Connected to database');

    // Check if vault extension is installed
    const { rows: extensionRows } = await client.query(
      'SELECT * FROM pg_extension WHERE extname = $1',
      ['vault']
    );

    if (extensionRows.length === 0) {
      console.log('Vault extension not installed. Installing...');
      await client.query('CREATE EXTENSION IF NOT EXISTS vault;');
      console.log('Vault extension installed');
    } else {
      console.log('Vault extension is already installed');
    }

    // Now, we need to add secrets to the Vault.
    // However, note that the Vault extension in Supabase does not have a direct SQL API for inserting secrets.
    // Instead, we use the Vault API via the Supabase JS client or the dashboard.
    // We'll output the steps for manual addition.

    console.log('\n🔐 Vault setup complete. Now add the following secrets via the Supabase Dashboard:');
    console.log('   - project_url: https://akbnfovjdcobifeupvbn.supabase.co');
    console.log('   - publishable_key: sb_publishable_MQjXSIVLjuvhZBVN4GYGQg__R5GZGvC');
    console.log('   - (Optional) service_role_key: [already set in .env]');
    console.log('\n🔑 Use the encryption key from your .env: sb_secret_K_nr8zA3oCNWvIyj0ItxHA_AV4CkzQt');

  } catch (err) {
    console.error('Error setting up Vault:', err);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

setupVault();