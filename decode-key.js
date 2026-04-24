/**
 * Decode the Service Role Key to check if it's a valid JWT
 */

const key = "EX9uv5zQc2EPfNhUGIgU8cNstvd27Hwua8Of5hDNqiwe2vzqhjIeeIEz3UxizW1HydWhDLJytLLPGfwSqw9gag==";

console.log('🔍 Analyzing the provided key...\n');
console.log('Key length:', key.length);
console.log('Key format:', key.includes('.') ? 'JWT format' : 'Not JWT format');

if (!key.includes('.')) {
    console.log('\n❌ This is not a JWT token. JWT tokens have dots (.) in them.');
    console.log('\nThis appears to be base64 encoded.');
    
    try {
        const decoded = Buffer.from(key, 'base64').toString('utf8');
        console.log('\nDecoded value:', decoded);
    } catch (err) {
        console.log('\nFailed to decode as base64');
    }
    
    console.log('\n⚠️  You need the actual Service Role JWT token from Supabase dashboard.');
    console.log('It should look like: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3Mi...');
} else {
    console.log('\n✅ This appears to be a JWT token');
}
