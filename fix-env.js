/**
 * Fix .env with correct Service Role Key format
 */

const fs = require('fs');

console.log('🔧 Fixing .env file...\n');

// Read current .env
const envPath = '.env';
let envContent = fs.readFileSync(envPath, 'utf8');

console.log('Current .env file has:');
console.log(envContent.split('\n').find(line => line.includes('SUPABASE_SERVICE_ROLE_KEY')));

console.log('\n⚠️  You need to replace it with a JWT token starting with "eyJ..."');
console.log('\n📝 To fix manually:');
console.log('1. Open .env file');
console.log('2. Replace line 5 with your actual Service Role Key');
console.log('3. Save the file');
console.log('\n🔑 Get your key from: https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/settings/api');
console.log('\nLook for "service_role" key under "Project API keys" section');
