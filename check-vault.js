const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkVault() {
    console.log('🔍 Checking Vault status...');

    // Try to list secrets from the vault.decrypted_secrets view
    const { data, error } = await supabase
        .from('vault.decrypted_secrets')
        .select('name, created_at');

    if (error) {
        console.error('❌ Error accessing Vault:', error.message);
        console.log('\n📝 To enable Vault, run this SQL in the Supabase SQL Editor:');
        console.log('CREATE EXTENSION IF NOT EXISTS vault;');
        return;
    }

    console.log('✅ Vault is accessible');
    console.log('📋 Current secrets in Vault:');
    if (data.length === 0) {
        console.log('   (No secrets found)');
    } else {
        data.forEach(secret => {
            console.log(`   - ${secret.name} (created: ${secret.created_at})`);
        });
    }
}

checkVault();