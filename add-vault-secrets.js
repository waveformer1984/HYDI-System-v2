/**
 * Add missing secrets to Vault
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addVaultSecrets() {
    console.log('🔐 Adding secrets to Vault...\n');
    
    const secrets = {
        project_url: 'https://akbnfovjdcobifeupvbn.supabase.co',
        anon_key: 'e4Ivl6JdT5MTDDVV'
    };
    
    for (const [name, value] of Object.entries(secrets)) {
        console.log(`Adding ${name}...`);
        
        // Note: This requires vault.create_secret function
        // If it doesn't work, you'll need to add via Dashboard
        try {
            const { data, error } = await supabase.rpc('vault_create_secret', {
                name: name,
                secret: value
            });
            
            if (error) {
                console.log(`❌ Failed to add ${name}: ${error.message}`);
                console.log('Please add manually via Dashboard');
            } else {
                console.log(`✅ Added ${name}`);
            }
        } catch (err) {
            console.log(`⚠️  Cannot add via API. Use Dashboard:`);
            console.log(`   Name: ${name}`);
            console.log(`   Value: ${value}\n`);
        }
    }
    
    // Verify existing secrets
    console.log('\n📋 Current Vault secrets:');
    try {
        const { data } = await supabase
            .from('vault.decrypted_secrets')
            .select('name, created_at')
            .order('name');
        
        if (data) {
            data.forEach(secret => {
                console.log(`  - ${secret.name} (added: ${secret.created_at})`);
            });
        }
    } catch (err) {
        console.log('Cannot list secrets via API');
    }
    
    console.log('\n🚀 After adding secrets, run:');
    console.log('node production-risk-check.js');
}

addVaultSecrets();
