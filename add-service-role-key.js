/**
 * ADD SERVICE_ROLE_KEY TO VAULT
 * Run this to add the missing secret
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// You need to use your actual service role key here
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env file');
    console.log('\nAdd this to your .env file:');
    console.log('SUPABASE_SERVICE_ROLE_KEY=your_actual_service_role_key_here');
    process.exit(1);
}

console.log('🔐 Adding service_role_key to Vault...\n');

// Create admin client with the key
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    SERVICE_ROLE_KEY
);

async function addServiceRoleKey() {
    try {
        // First, let's check if it already exists
        const { data: existing, error: checkError } = await supabaseAdmin
            .from('vault.decrypted_secrets')
            .select('name')
            .eq('name', 'service_role_key')
            .single();

        if (existing) {
            console.log('✅ service_role_key already exists in Vault');
            return;
        }

        // Add the secret to Vault
        const { data, error } = await supabaseAdmin
            .from('vault.secrets')
            .insert({
                name: 'service_role_key',
                description: 'Service role key for worker authentication',
                secret: SERVICE_ROLE_KEY
            })
            .select();

        if (error) {
            console.error('❌ Failed to add secret:', error);
            
            // Try alternative method using vault.add_secret function
            console.log('\nTrying alternative method...');
            const { data: altData, error: altError } = await supabaseAdmin
                .rpc('vault.add_secret', {
                    name: 'service_role_key',
                    secret: SERVICE_ROLE_KEY,
                    description: 'Service role key for worker authentication'
                });
                
            if (altError) {
                console.error('❌ Alternative method also failed:', altError);
                console.log('\nManual steps:');
                console.log('1. Go to Supabase Dashboard > Vault');
                console.log('2. Click "Add Secret"');
                console.log('3. Name: service_role_key');
                console.log('4. Value: (your service role key)');
                console.log('5. Click "Save"');
            } else {
                console.log('✅ Added service_role_key to Vault (alternative method)');
            }
        } else {
            console.log('✅ Added service_role_key to Vault');
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

addServiceRoleKey().then(() => {
    console.log('\n📋 Next steps:');
    console.log('1. Run: node verify-hardening.js');
    console.log('2. Should show 8/8 objects found');
});
