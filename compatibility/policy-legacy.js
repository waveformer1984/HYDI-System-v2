// Compatibility wrapper: keeper/policy-engine.js -> lib/protoforge/policy-engine.js
// @deprecated Import lib/protoforge/policy-engine.js directly. Removal target: Phase 5.

const { PolicyEngine } = require('../lib/protoforge/policy-engine');

module.exports = { PolicyEngine };
