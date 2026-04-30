// Generate new break glass token
const crypto = require('crypto');

const token = crypto.randomBytes(32).toString('hex');
console.log('🔐 NEW BREAK GLASS TOKEN:');
console.log('========================');
console.log(token);
console.log('');
console.log('Add this to your .env file:');
console.log(`KEEPER_BREAK_GLASS_TOKEN=${token}`);
