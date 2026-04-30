/**
 * Check project mismatch
 */

require('dotenv').config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Checking Project Match\n');
console.log('Supabase URL:', url);
console.log('Project from URL:', url?.match(/https:\/\/([^.]+)/)?.[1]);

// Decode JWT to get project ref
const parts = key?.split('.');
if (parts && parts.length === 3) {
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        console.log('\nDecoded JWT payload:');
        console.log('Project ref from JWT:', payload.ref);
        console.log('Role:', payload.role);
        
        if (url?.match(/https:\/\/([^.]+)/)?.[1] !== payload.ref) {
            console.log('\n❌ MISMATCH DETECTED!');
            console.log('Your URL is for project: wufhlhrbskacneneylqa');
            console.log('Your key is for project: akbnfovjdcobifeupvbn');
            console.log('\nYou need a key from the correct project!');
        } else {
            console.log('\n✅ Projects match');
        }
    } catch (err) {
        console.log('Failed to decode JWT');
    }
}
