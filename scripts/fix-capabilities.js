const fs = require('fs');
let c = fs.readFileSync('lib/heidi/CapabilityRegistry.ts', 'utf8');
// Fix autonomyLevel -> autonomyRequirement
c = c.replace(/autonomyLevel: 0,/g, 'autonomyRequirement: 0,');
c = c.replace(/autonomyLevel: 2,/g, 'autonomyRequirement: 2,');
// Remove requiredParams and optionalParams lines (not in CapabilityDescriptor)
c = c.replace(/\s*requiredParams: \[[^\]]*\],/g, '');
c = c.replace(/\s*optionalParams: \[[^\]]*\],/g, '');
fs.writeFileSync('lib/heidi/CapabilityRegistry.ts', c);
console.log('done');
