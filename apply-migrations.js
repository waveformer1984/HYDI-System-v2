require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const migrationsDir = path.join(__dirname, 'supabase', 'migrations');

// Read all SQL files in the migrations directory
const files = fs.readdirSync(migrationsDir)
  .filter(file => file.endsWith('.sql'))
  .sort(); // Sort by name (timestamp prefix)

console.log(`Found ${files.length} migration files to apply`);

async function applyMigrations() {
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    
    console.log(`Applying migration: ${file}`);
    
    try {
      // Split the SQL into statements (simple split by semicolon, not perfect but works for our case)
      const statements = sql.split(';').map(stmt => stmt.trim()).filter(stmt => stmt.length > 0);
      
      for (const statement of statements) {
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        if (error) {
          console.error(`Error executing statement in ${file}:`, error);
          // Continue to next statement? Or break?
          // For now, we'll log and continue.
        }
      }
      
      console.log(`Successfully applied: ${file}`);
    } catch (err) {
      console.error(`Failed to apply migration ${file}:`, err);
      // We might want to stop on first error, but let's continue for now.
    }
  }
}

// We need to create the exec_sql function if it doesn't exist.
// Alternatively, we can use the Supabase client's `rpc` to call a function that executes SQL.
// But we don't have that function. So we'll use a different approach: we can use the `pg` library to connect directly.
// However, we are trying to avoid that.

// Let's try to use the Supabase client's `from` method to do a select to see if we can run SQL.
// Actually, we can't run arbitrary SQL with the Supabase client unless we use a custom function or the `rpc` to a function that runs SQL.

// We'll create a temporary function to run SQL? Not possible.

// Instead, we'll use the `pg` library to connect to the database directly.

// But note: we are already using the Supabase client which uses the same underlying connection.

// Let's switch to using the `pg` library for running the migrations.

// We'll change the approach: use the `pg` library to connect and run the SQL.

console.log('Switching to direct PostgreSQL connection for migrations...');
const { Pool } = require('pg');

const url = new URL(supabaseUrl);
const projectRef = url.hostname.split('.')[0];
const connectionString = `postgresql://postgres:${supabaseKey}@db.${projectRef}.supabase.co:5432/postgres`;

const pool = new Pool({ 
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false } 
});

async function applyMigrationsWithPg() {
  const client = await pool.connect();
  try {
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      console.log(`Applying migration: ${file}`);
      
      try {
        await client.query(sql);
        console.log(`Successfully applied: ${file}`);
      } catch (err) {
        console.error(`Failed to apply migration ${file}:`, err);
        // We'll stop on first error for safety.
        throw err;
      }
    }
  } finally {
    client.release();
  }
  await pool.end();
}

applyMigrationsWithPg()
  .then(() => {
    console.log('All migrations applied successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });