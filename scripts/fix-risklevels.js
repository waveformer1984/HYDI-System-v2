const fs = require('fs');
let c = fs.readFileSync('lib/heidi/CapabilityRegistry.ts', 'utf8');
c = c.replace(/riskLevel: 0,/g, "riskLevel: 'R0',");
c = c.replace(/riskLevel: 1,/g, "riskLevel: 'R1',");
fs.writeFileSync('lib/heidi/CapabilityRegistry.ts', c);
console.log('done');
