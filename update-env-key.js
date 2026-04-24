/**
 * Update .env with Supabase Service Role Key
 * Run this after getting your key from Supabase dashboard
 */

const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('🔑 Update Supabase Service Role Key\n');
console.log('Please get your key from: https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/settings/api\n');

rl.question('Paste your Service Role Key here: ', (key) => {
    if (!key || key.trim() === '') {
        console.log('❌ No key provided');
        rl.close();
        return;
    }

    // Read current .env
    const envPath = '.env';
    let envContent = fs.readFileSync(envPath, 'utf8');

    // Replace the placeholder
    envContent = envContent.replace(
        'SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY_HERE"',
        `SUPABASE_SERVICE_ROLE_KEY="${key.trim()}"`
    );

    // Write back
    fs.writeFileSync(envPath, envContent);

    console.log('\n✅ Updated .env file with your Service Role Key');
    console.log('\nYou can now run: node start-workers.js');
    
    rl.close();
});
