const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findSQLFunction() {
    console.log('🔍 Searching for a function that can execute SQL...');

    // Try to list functions in the pg_catalog schema
    let { data: functions, error } = await supabase
        .from('pg_proc')
        .select('proname, pronamespace')
        .eq('pronamespace', (await supabase.from('pg_namespace').select('oid').eq('nspname', 'pg_catalog').single()).data.oid);

    if (error) {
        console.error('Error accessing pg_proc:', error);
        // Try information_schema.routines
        console.log('Trying information_schema.routines...');
        const { data: routines, error: routineError } = await supabase
            .from('information_schema.routines')
            .select('routine_name, routine_schema');
        if (routineError) {
            console.error('Error accessing information_schema.routines:', routineError);
            return;
        }
        console.log('Found routines:', routines.length);
        // Look for routines that might execute SQL
        const sqlRoutines = routines.filter(r => 
            r.routine_name.toLowerCase().includes('exec') || 
            r.routine_name.toLowerCase().includes('sql') ||
            r.routine_name.toLowerCase().includes('query')
        );
        console.log('Potential SQL executing routines:', sqlRoutines);
        return;
    }

    console.log('Found functions in pg_catalog:', functions.length);
    // Look for functions that might execute SQL
    const sqlFunctions = functions.filter(f => 
        f.proname.toLowerCase().includes('exec') || 
        f.proname.toLowerCase().includes('sql') ||
        f.proname.toLowerCase().includes('query')
    );
    console.log('Potential SQL executing functions:', sqlFunctions);

    // If we find one, try to use it
    if (sqlFunctions.length > 0) {
        console.log(`\n� Found ${sqlFunctions.length} potential function(s). Trying the first one:`, sqlFunctions[0].proname);
        // We don't know the signature, so we can't call it safely.
        // We'll just output the name and let the user decide.
        console.log(`\n📝 Please run the following SQL in the Supabase SQL Editor:`);
        console.log('CREATE EXTENSION IF NOT EXISTS vault;');
        console.log('\\nThen, add the required secrets to the Vault:');
        console.log('   - project_url: https://akbnfovjdcobifeupvbn.supabase.co');
        console.log('   - publishable_key: sb_publishable_MQjXSIVLjuvhZBVN4GYGQg__R5GZGvC');
        console.log('   - (Optional) service_role_key: [already in .env]');
        console.log('\\n🔑 Use the encryption key from your .env: <your sb_secret_ key from .env - not shown>');
    } else {
        console.log('❌ No function found that can execute SQL.');
        console.log('\n📝 Please run the following SQL in the Supabase SQL Editor:');
        console.log('CREATE EXTENSION IF NOT EXISTS vault;');
        console.log('\\nThen, add the required secrets to the Vault:');
        console.log('   - project_url: https://akbnfovjdcobifeupvbn.supabase.co');
        console.log('   - publishable_key: sb_publishable_MQjXSIVLjuvhZBVN4GYGQg__R5GZGvC');
        console.log('   - (Optional) service_role_key: [already in .env]');
        console.log('\\n🔑 Use the encryption key from your .env: <your sb_secret_ key from .env - not shown>');
    }
}

findSQLFunction();