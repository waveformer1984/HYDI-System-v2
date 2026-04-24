/**
 * PHASE 2 — VAULT CONFIGURATION
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkVault() {
    console.log('🔐 PHASE 2 — VAULT CONFIGURATION\n');
    
    // Check current secrets
    const { data: secrets, error } = await supabase
        .from('vault.decrypted_secrets')
        .select('name')
        .order('name');
    
    if (error) {
        console.log('❌ Vault not accessible:', error.message);
        return false;
    }
    
    const required = ['project_url', 'anon_key', 'publishable_key', 'service_role_key'];
    const missing = required.filter(r => !secrets?.some(s => s.name === r));
    
    if (missing.length > 0) {
        console.log('⚠️  Missing secrets:');
        missing.forEach(name => {
            console.log(`   - ${name}`);
        });
        
        console.log('\nRequired values:');
        if (missing.includes('project_url')) {
            console.log(`   project_url: ${process.env.SUPABASE_URL}`);
        }
        if (missing.includes('anon_key')) {
            console.log(`   anon_key: ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'SET YOUR ANON KEY'}`);
        }
        if (missing.includes('publishable_key')) {
            console.log(`   publishable_key: ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'SET YOUR ANON KEY'}`);
        }
        if (missing.includes('service_role_key')) {
            console.log(`   service_role_key: ${process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20)}...`);
        }
        
        return false;
    }
    
    console.log('✅ All required secrets present');
    
    // Test access
    const { data: test } = await supabase
        .from('vault.decrypted_secrets')
        .select('name')
        .eq('name', 'project_url')
        .single();
    
    console.log('✅ Vault access verified');
    return true;
}

checkVault();
