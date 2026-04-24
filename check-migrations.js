require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMigrations() {
    const { data, error } = await supabase
        .from('supabase_migrations.schema_migrations')
        .select('version, name')
        .order('version');

    if (error) {
        console.error('Error fetching migrations:', error);
        return;
    }

    console.log('Current migrations:');
    data.forEach(m => {
        console.log(`  ${m.version}: ${m.name}`);
    });
}

checkMigrations();