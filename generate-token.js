const crypto = require('crypto');
const token = crypto.randomBytes(32).toString('base64');
console.log(token);
