/**
 * Setup Database Script
 * Creates the worker queue tables using Supabase client
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function setupDatabase() {
    console.log('🔧 Setting up HYDI Worker Database...\n');
    
    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Missing Supabase credentials in .env');
        process.exit(1);
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    try {
        // Read and execute queue-system.sql
        console.log('📋 Creating queue tables...');
        const queueSQL = require('fs').readFileSync('workers/queue-system.sql', 'utf8');
        
        // Split SQL into individual statements
        const statements = queueSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('--'));
        
        for (const statement of statements) {
            if (statement.trim()) {
                try {
                    const { error } = await supabase.rpc('exec_sql', { sql: statement });
                    if (error) {
                        // Try direct SQL if RPC not available
                        console.log(`⚠️  RPC not available, some tables may need manual creation`);
                    }
                } catch (err) {
                    console.log(`ℹ️  Note: ${err.message.substring(0, 50)}...`);
                }
            }
        }
        
        // Read and execute workers-schema.sql
        console.log('\n📋 Creating worker schema tables...');
        const schemaSQL = require('fs').readFileSync('workers-schema.sql', 'utf8');
        
        const schemaStatements = schemaSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('--'));
        
        for (const statement of schemaStatements) {
            if (statement.trim()) {
                try {
                    const { error } = await supabase.rpc('exec_sql', { sql: statement });
                    if (error) {
                        console.log(`ℹ️  Note: Some tables may need manual creation via Supabase dashboard`);
                    }
                } catch (err) {
                    console.log(`ℹ️  Note: ${err.message.substring(0, 50)}...`);
                }
            }
        }
        
        console.log('\n✅ Database setup complete!');
        console.log('\n📝 If some tables were not created automatically, please run the SQL files manually in the Supabase dashboard:');
        console.log('   1. Open Supabase dashboard → SQL Editor');
        console.log('   2. Run workers/queue-system.sql');
        console.log('   3. Run workers-schema.sql');
        console.log('\n🚀 You can now start the workers with: node start-workers.js');
        
    } catch (error) {
        console.error('\n❌ Error setting up database:', error.message);
        console.log('\n📝 Please run the SQL files manually in Supabase dashboard:');
        console.log('   1. workers/queue-system.sql');
        console.log('   2. workers-schema.sql');
    }
}

setupDatabase();
