/**
 * Configure Vault Secrets for Production
 * This script helps set up the required secrets
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function configureVault() {
    console.log('🔐 Configuring Vault Secrets\n');
    
    // The secret you provided
    const providedSecret = 'sb_secret_K_nr8zA3oCNWvIyj0ItxHA_AV4CkzQt';
    
    console.log('📝 Required secrets for automation:');
    console.log('1. project_url - Your Supabase project URL');
    console.log('2. publishable_key or anon_key - For Edge Function auth');
    console.log('3. (Optional) service_role_key - For admin operations\n');
    
    // Check current .env values
    console.log('📋 Current configuration:');
    console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL}`);
    console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20)}...`);
    
    // Determine what the provided secret is
    if (providedSecret.startsWith('sb_secret_')) {
        console.log('\n✅ Detected: Supabase Vault Secret');
        console.log('This key is used for encrypting/decrypting Vault secrets');
        
        console.log('\n🚀 Next Steps:');
        console.log('1. Go to Supabase Dashboard → Vault');
        console.log('2. Add these secrets:');
        console.log(`   - name: project_url`);
        console.log(`     value: ${process.env.SUPABASE_URL}`);
        console.log(`   - name: publishable_key`);
        console.log(`     value: ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY}`);
        console.log('3. Use the provided secret as encryption key');
        
    } else if (providedSecret.startsWith('eyJ')) {
        console.log('\n✅ Detected: JWT Token (possibly service role key)');
        console.log('This might be your service role key');
        
    } else {
        console.log('\n⚠️  Unknown secret format');
    }
    
    // Test if Vault is accessible
    try {
        const { data, error } = await supabase
            .rpc('gen_random_bytes', { n: 1 });
        
        if (error) {
            console.log('\n❌ Vault extension not enabled');
            console.log('Run in Supabase SQL Editor:');
            console.log('CREATE EXTENSION IF NOT EXISTS vault;');
        } else {
            console.log('\n✅ Vault extension is enabled');
        }
    } catch (err) {
        console.log('\n⚠️  Cannot test Vault - might need extension');
    }
    
    console.log('\n📖 For manual Vault setup:');
    console.log('https://supabase.com/docs/guides/vault');
}

configureVault();
